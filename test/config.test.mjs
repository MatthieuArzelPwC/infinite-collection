/**
 * Verifie la coherence entre ww-config.js et src/wwElement.vue.
 *
 * Attrape la classe de bug la plus courante sur un composant WeWeb : une propriete
 * utilisee dans le composant mais absente de la configuration (elle vaudra
 * silencieusement `undefined` dans le studio), ou un evenement emis mais non
 * declare (il n'apparaitra pas dans les workflows).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'src/wwElement.vue'), 'utf8');

// `ww-config.js` doit garder ce nom et cette extension (contrat WeWeb) tout en
// etant un module ES. Node le lirait comme du CommonJS : on l'evalue donc via une
// data URL, sans modifier le fichier.
const configSource = readFileSync(join(root, 'ww-config.js'), 'utf8');
const { default: config } = await import(
  `data:text/javascript;base64,${Buffer.from(configSource).toString('base64')}`
);

const declaredProps = Object.keys(config.properties);
const declaredEvents = config.triggerEvents.map(event => event.name);

/** Proprietes consommees via `content.X` ou `props.content.X`. */
function usedProperties(code) {
  const found = new Set();
  for (const match of code.matchAll(/\bcontent\.([A-Za-z_$][\w$]*)/g)) found.add(match[1]);
  return [...found];
}

/**
 * Evenements emis.
 *
 * On exige la forme `emit('trigger-event', { name: 'X'` afin de ne pas confondre
 * avec les autres usages de `name:` dans le fichier.
 */
function emittedEvents(code) {
  const found = new Set();
  // `[\s\S]` plutot que `\s` : les emissions sont souvent reparties sur plusieurs
  // lignes, et un motif trop strict validerait un evenement jamais emis.
  const pattern = /emit\(\s*'trigger-event'\s*,\s*\{[\s\S]{0,40}?name:\s*'([A-Za-z][\w-]*)'/g;
  for (const match of code.matchAll(pattern)) found.add(match[1]);
  return [...found];
}

test('toute propriete utilisee est declaree dans ww-config.js', () => {
  const missing = usedProperties(source).filter(prop => !declaredProps.includes(prop));
  assert.deepEqual(missing, [], `proprietes utilisees mais non declarees : ${missing.join(', ')}`);
});

test('tout evenement emis est declare dans triggerEvents', () => {
  const missing = emittedEvents(source).filter(name => !declaredEvents.includes(name));
  assert.deepEqual(missing, [], `evenements emis mais non declares : ${missing.join(', ')}`);
});

test('tout evenement declare est effectivement emis', () => {
  const emitted = emittedEvents(source);
  const unused = declaredEvents.filter(name => !emitted.includes(name));
  assert.deepEqual(unused, [], `evenements declares mais jamais emis : ${unused.join(', ')}`);
});

test('items est bindable en repeatable', () => {
  assert.equal(config.properties.items.bindable, 'repeatable');
});

test('itemElement est cache et instancie une Flexbox WeWeb', () => {
  const { itemElement } = config.properties;
  assert.equal(itemElement.hidden, true);
  assert.equal(itemElement.defaultValue.isWwObject, true);
  assert.match(
    itemElement.defaultValue.type,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    'le type doit etre un UUID de composant WeWeb'
  );
});

test('aucune propriete de hauteur : elle vient du studio', () => {
  const heightLike = declaredProps.filter(prop => /^height$|maxHeight|minHeight/i.test(prop));
  assert.deepEqual(heightLike, [], 'la hauteur doit rester geree par les proprietes standard du studio');
});

test('le composant ne fixe pas de hauteur en dur', () => {
  const styleBlock = source.slice(source.indexOf('<style'));
  // `height: 100%` est autorise (hériter du parent) ; une valeur absolue ne l'est pas.
  const hardcoded = [...styleBlock.matchAll(/^\s*height:\s*([^;]+);/gm)]
    .map(match => match[1].trim())
    .filter(value => !['100%', 'auto', '1px'].includes(value));
  assert.deepEqual(hardcoded, [], `hauteurs en dur detectees : ${hardcoded.join(', ')}`);
});

test('content-visibility est applique aux elements repetes', () => {
  assert.match(source, /content-visibility:\s*auto/);
  assert.match(source, /contain-intrinsic-size/);
});

test('aucune dependance runtime', async () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined, 'le composant doit rester sans dependance runtime');
});

test('la racine est un conteneur de scroll vertical', () => {
  assert.match(source, /overflow-y:\s*auto/);
});

/* ================================================================== *
 * Contrat de pagination (plan V1)
 * ================================================================== */

test('aucun fallback workflow : loadMore n est jamais emis avec des valeurs nulles', () => {
  // Le repli workflow a ete retire : une source introuvable doit produire `error`,
  // pas un `loadMore` inexploitable reemis a chaque scroll.
  assert.doesNotMatch(
    source,
    /name:\s*'loadMore'[\s\S]{0,200}offset:\s*null/,
    'loadMore ne doit plus etre emis avec un offset nul'
  );
});

test('l evenement error transporte un code exploitable', () => {
  assert.match(source, /name:\s*'error'[\s\S]{0,120}code:/);
  const errorEvent = config.triggerEvents.find(event => event.name === 'error');
  assert.ok(errorEvent.event && 'code' in errorEvent.event, 'le code doit etre declare dans ww-config.js');
});

test('le timeout ne libere pas le verrou', () => {
  // Regression critique : liberer `pendingOffset` au timeout fait classer la reponse
  // tardive comme un reset, ce qui efface toutes les pages accumulees.
  const timeoutBlock = source.slice(source.indexOf('fetchTimeout = setTimeout'));
  const body = timeoutBlock.slice(0, timeoutBlock.indexOf('FETCH_TIMEOUT_MS'));
  assert.doesNotMatch(body, /pendingOffset\.value\s*=\s*null/, 'le verrou doit etre conserve au timeout');
});

test('tous les timers sont annules au demontage', () => {
  const marker = 'onBeforeUnmount(() => {';
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, 'onBeforeUnmount doit etre present');
  const body = source.slice(start, source.indexOf('});', start) + 3);
  for (const cleanup of ['teardownWatchers', 'clearObserverRetry', 'clearFetchTimeout']) {
    assert.match(body, new RegExp(cleanup), `${cleanup} doit etre appele au demontage`);
  }
});

test('la machine a etats est utilisee pour autoriser les chargements', () => {
  assert.match(source, /canLoad\(state\.value\)/, 'le declenchement doit passer par canLoad');
  assert.doesNotMatch(source, /isExhausted/, 'isExhausted doit avoir ete remplace par la machine a etats');
});
