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
const logicSource = readFileSync(join(root, 'src/logic.mjs'), 'utf8');
const logic = await import(new URL('../src/logic.mjs', import.meta.url).href);

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

test('la source est une collection unique et non bindable', () => {
  const { collectionId } = config.properties;
  assert.equal(collectionId.type, 'Collection');
  assert.equal(collectionId.options.paginated, true);
  assert.equal(collectionId.defaultValue, null);
  assert.notEqual(collectionId.bindable, true, 'un ID de collection ne se binde pas');
});

test('les anciennes proprietes de source ont disparu', () => {
  // Designer deux fois la meme collection permettait d'en selectionner deux
  // differentes, avec une auto-detection par egalite de reference fragile.
  assert.equal(config.properties.items, undefined);
  assert.equal(config.properties.paginatedSource, undefined);
  assert.doesNotMatch(source, /parsePaginatedSource/);
  assert.doesNotMatch(source, /content\.items/);
});

test('le mode manuel est actif par defaut', () => {
  // Le chargement au defilement reste a valider dans le studio : le declencheur
  // explicite est le comportement par defaut en attendant.
  const { manualLoad } = config.properties;
  assert.equal(manualLoad.type, 'OnOff');
  assert.equal(manualLoad.defaultValue, true);
  assert.equal(manualLoad.section, 'settings');
});

test('aucune propriete de cle unique n est demandee', () => {
  // Avec une pagination par offset, la position absolue identifie deja chaque ligne.
  // Une cle metier mal choisie fusionnait des lignes distinctes sans aucun signe.
  assert.equal(config.properties.itemKey, undefined);
  assert.doesNotMatch(source, /itemKey/);
  assert.doesNotMatch(logicSource, /resolveKey|identityFields/);
});

test('un clic manuel ne peut jamais rester sans effet', () => {
  // Un declencheur visible mais inerte ne laisse aucune trace a diagnostiquer.
  const start = source.indexOf('const onManualLoad');
  const body = source.slice(start, start + 1200);
  assert.match(body, /STATES\.LOADING/, 'un verrou non confirme doit etre relache');
  assert.match(body, /STATES\.TIMED_OUT/);
  assert.match(body, /STATES\.INITIALIZING/);
  assert.match(body, /wwLog/, 'tout refus doit etre journalise');
});

test('aucune page recue n est silencieusement ignoree', () => {
  // La branche `ignore` sortait du watcher sans relacher pendingOffset : l etat
  // restait `loading` indefiniment et le composant se figeait.
  assert.doesNotMatch(source, /mode === 'ignore'/);
});

test('le libelle du chargement manuel est masque hors mode manuel', () => {
  const { manualLoadLabel } = config.properties;
  assert.equal(typeof manualLoadLabel.hidden, 'function');
  assert.equal(manualLoadLabel.hidden({ manualLoad: false }), true);
  assert.equal(manualLoadLabel.hidden({ manualLoad: true }), false);
});

test('le prechargement est masque en mode manuel', () => {
  const { preloadScreens } = config.properties;
  assert.equal(preloadScreens.hidden({ manualLoad: true }), true);
  assert.equal(preloadScreens.hidden({ manualLoad: false }), false);
});

test('aucun reglage en pixels n est demande a l utilisateur', () => {
  // La hauteur d un element est mesuree, et la distance de declenchement derivee de
  // la hauteur visible : ni l une ni l autre ne peut etre devinee a la main.
  assert.equal(config.properties.estimatedItemHeight, undefined);
  assert.equal(config.properties.rootMargin, undefined);
  assert.match(source, /measureItemHeight/);
  assert.match(source, /resolveTriggerDistance/);
});

test('le prechargement s exprime en hauteurs d ecran', () => {
  const { preloadScreens } = config.properties;
  assert.equal(preloadScreens.defaultValue, 1);
  assert.ok(preloadScreens.options.min > 0);
});

test('le declencheur manuel ne depend pas de l etat interne', () => {
  // Il doit rester visible tant que le total n est pas couvert : un refetch amont
  // ramene l etat a `initializing` et le faisait disparaitre a tort.
  assert.match(source, /hasMorePages\(currentPagination\(\)\)/);
});

test('le conteneur de defilement reel est recherche', () => {
  // WeWeb applique la hauteur du studio a un wrapper parent : observer la racine du
  // composant ne declenche alors jamais le chargement.
  assert.match(source, /findScrollContainer/);
  assert.match(source, /parentElement/);
});

test('le chargement n est plus bloque en mode edition', () => {
  // Ce garde-fou empechait tout chargement dans le studio : le composant ne
  // paginait jamais pendant l'edition de la page.
  assert.doesNotMatch(source, /if \(isEditing\.value\) return/);
});

test('la page initiale est protegee par un etat dedie', () => {
  assert.match(source, /STATES\.INITIALIZING/);
  assert.match(source, /assessCollection/);
});

test('une generation de source invalide les callbacks de l ancienne collection', () => {
  assert.match(source, /sourceGeneration/);
  assert.match(source, /generation !== sourceGeneration\.value/);
});

test('l acces au store est centralise', () => {
  // Un seul appel reel au getter interne : un changement de contrat WeWeb n'a
  // qu'un point d'impact. Les mentions en commentaire sont ignorees.
  const accesses = source.match(/getters\?\.\['data\/getCollections'\]/g) || [];
  assert.equal(accesses.length, 1, 'un seul point d acces au store interne WeWeb');
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

test('une collection introuvable produit une erreur dediee', () => {
  // Un identifiant renseigne mais absent du store signale une selection obsolete,
  // qu'il ne faut pas confondre avec un chargement en cours.
  assert.match(source, /ERROR_CODES\.COLLECTION_NOT_FOUND/);
  assert.match(source, /COLLECTION_LOOKUP_GRACE_MS/);
});

test('tout code declare a un message et un emetteur', () => {
  const declared = Object.keys(logic.ERROR_CODES);

  // Un code sans message produirait « Erreur de pagination inconnue » dans le studio.
  const withoutMessage = declared.filter(code => !logic.ERROR_MESSAGES[logic.ERROR_CODES[code]]);
  assert.deepEqual(withoutMessage, [], `codes sans message : ${withoutMessage.join(', ')}`);

  // Un code doit etre emis soit directement par le composant, soit relaye depuis
  // logic.mjs via `fail(verdict.code)` ou `fail(pagination.code)`.
  const relayed = /fail\((?:verdict|pagination|plan|source)\.code\)/.test(source);
  const orphans = declared.filter(code => !source.includes(code) && !relayed);
  assert.deepEqual(orphans, [], `codes jamais atteignables : ${orphans.join(', ')}`);
});

test('les codes produits par logic.mjs sont relayes au workflow', () => {
  for (const relay of ['fail(verdict.code)', 'fail(pagination.code)', 'fail(plan.code)']) {
    assert.ok(source.includes(relay), `${relay} doit relayer le code au workflow`);
  }
});

test('un clic manuel aboutit meme si l etat est encore initializing', () => {
  // Un declencheur visible mais sans effet est une panne silencieuse.
  const marker = 'const onManualLoad';
  const start = source.indexOf(marker);
  const body = source.slice(start, start + 500);
  assert.match(body, /STATES\.INITIALIZING/);
  assert.match(body, /STATES\.IDLE/);
});
