import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'src/wwElement.vue'), 'utf8');
const configSource = readFileSync(join(root, 'ww-config.js'), 'utf8');
const { default: config } = await import(
  `data:text/javascript;base64,${Buffer.from(configSource).toString('base64')}`
);

test('la source est un unique selecteur de collection paginee', () => {
  assert.equal(config.properties.collectionId.type, 'Collection');
  assert.equal(config.properties.collectionId.options.paginated, true);
  assert.equal(config.properties.items, undefined);
  assert.equal(config.properties.paginatedSource, undefined);
});

test('le mode manuel est actif par defaut et garde un libelle configurable', () => {
  assert.equal(config.properties.manualLoad.defaultValue, true);
  assert.equal(config.properties.manualLoadLabel.bindable, true);
  assert.equal(config.properties.manualLoadLabel.multiLang, true);
});

test('le bouton manuel est rendu uniquement selon le mode et apres les elements', () => {
  assert.match(source, /<button\s+[\s\S]*?v-if="isManual"/);
  assert.ok(source.indexOf('v-for="entry in entries"') < source.indexOf('v-if="isManual"'));
  assert.doesNotMatch(source, /position:\s*sticky/);
});

test('seule une requete en vol desactive le bouton de debug', () => {
  assert.match(source, /:disabled="manualDisabled"/);
  assert.match(source, /manualDisabled\s*=\s*computed\(\(\)\s*=>\s*!!request\.value\)/);
  assert.doesNotMatch(source, /manualDisabled[\s\S]{0,100}STATUS\.ENDED/);
  assert.doesNotMatch(source, /Fin de la collection/);
});

test('le clic manuel utilise le meme chemin de pagination que le scroll', () => {
  const start = source.indexOf('const onManualLoad');
  const body = source.slice(start, source.indexOf('};', start) + 2);
  assert.match(body, /loadMore\('manuel'\)/);
  assert.doesNotMatch(body, /STATUS\.ENDED/);
});

test('le bouton ne depasse le total qu apres la vraie derniere page', () => {
  const start = source.indexOf('const loadMore');
  const body = source.slice(start, source.indexOf('};', start) + 2);
  assert.match(body, /planNextFetch/);
  assert.match(body, /plan\.action === 'end'/);
  assert.match(body, /offset: acceptedOffset\.value \?\? pagination\.offset/);
  assert.doesNotMatch(body, /entries\.value\.length\s*>?=\s*pagination\.total/);
});

test('le scroll appelle le meme chemin de pagination avec l origine scroll', () => {
  assert.match(source, /loadMore\('scroll'\)/);
  assert.equal([...source.matchAll(/wwLib\.wwCollection\.setOffset/g)].length, 1);
});

test('le runtime n utilise qu un watcher principal de collection', () => {
  const watcherCount = [...source.matchAll(/\bwatch\(/g)].length;
  assert.equal(watcherCount, 2, 'un watcher de collection et un watcher de mode manuel');
  assert.match(source, /Un seul watcher gere atomiquement/);
});

test('le mode automatique ecoute le scroll reel des wrappers WeWeb', () => {
  assert.doesNotMatch(source, /IntersectionObserver/);
  assert.doesNotMatch(source, /ResizeObserver/);
  assert.match(source, /document\.addEventListener\('scroll', scheduleScrollCheck, \{ capture: true, passive: true \}\)/);
  assert.match(source, /element\.scrollHeight > element\.clientHeight \+ 1/);
  assert.match(source, /sentinel\.value\.getBoundingClientRect\(\)\.top <= scrollBoundary\(\) \+ SCROLL_MARGIN/);
  assert.match(source, /requestAnimationFrame\(checkScrollPosition\)/);
});

test('ni le clic ni le scroll ne sont bloques par un etat ended stale', () => {
  const loadMoreStart = source.indexOf('const loadMore');
  const loadMoreBody = source.slice(loadMoreStart, source.indexOf('};', loadMoreStart) + 2);
  const checkStart = source.indexOf('const checkScrollPosition');
  const checkBody = source.slice(checkStart, source.indexOf('};', checkStart) + 2);
  assert.doesNotMatch(loadMoreBody, /STATUS\.ENDED/);
  assert.doesNotMatch(checkBody, /STATUS\.ENDED/);
});

test('le mode manuel empeche l installation de l ecoute du scroll', () => {
  assert.match(source, /const setupAutoScroll/);
  assert.match(source, /if \(isManual\.value[^\n]*\) return;/);
  assert.match(source, /teardownAutoScroll\(\)/);
});

test('le timeout conserve la requete en vol', () => {
  const start = source.indexOf('fetchTimeout = setTimeout');
  const block = source.slice(start, source.indexOf('}, FETCH_TIMEOUT_MS)', start));
  assert.doesNotMatch(block, /request\.value\s*=\s*null/);
  assert.match(block, /keepRequest:\s*true/);
});

test('la page recue utilise l offset demande pour fusion et classification', () => {
  assert.match(source, /const offset = request\.value \? request\.value\.offset : pagination\.offset/);
  assert.match(source, /processPage\(data, pagination, offset\)/);
});

test('la page suivante part du dernier offset accepte, pas de metadonnees potentiellement en retard', () => {
  assert.match(source, /offset:\s*acceptedOffset\.value \?\? pagination\.offset/);
  assert.match(source, /acceptedOffset\.value = offset/);
});

test('une collection deja positionnee est rechargee depuis zero', () => {
  assert.match(source, /entries\.value\.length === 0 && pagination\.offset !== 0/);
  assert.match(source, /requestPage\(0\)/);
});

test('aucune compatibilite avec un paginator externe n est conservee', () => {
  assert.match(source, /offset initial=/);
  assert.doesNotMatch(source, /offsetLagging|classifyIncoming|hasMorePages/);
});

test('content visibility conserve une estimation simple', () => {
  assert.match(source, /content-visibility:\s*auto/);
  assert.match(source, /contain-intrinsic-size:\s*auto 80px/);
});

test('les evenements exposes correspondent au runtime', () => {
  const declared = config.triggerEvents.map(event => event.name).sort();
  assert.deepEqual(declared, ['error', 'loadMore', 'reachEnd']);
  for (const name of declared) assert.match(source, new RegExp(`name: '${name}'`));
});

test('aucune dependance runtime n est ajoutee', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
});
