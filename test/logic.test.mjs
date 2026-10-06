/**
 * Tests de la logique pure, executables hors WeWeb : `npm test`.
 *
 * Le simulateur reproduit le comportement du plugin Supabase :
 *   query.range(collection.offset, collection.offset + collection.limit - 1)
 * c'est-a-dire une page qui REMPLACE la precedente, d'ou la necessite d'accumuler
 * cote composant.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  STATES,
  ERROR_CODES,
  mergeItems,
  resetItems,
  validatePagination,
  planNextFetch,
  isLastPage,
  classifyIncoming,
  classifyPage,
  assessCollection,
  hasMorePages,
  resolveItemHeight,
  resolveTriggerDistance,
  canTransition,
  canLoad,
  transition,
} from '../src/logic.mjs';

/**
 * Simule une vue SQL paginee cote serveur.
 *
 * `available` = lignes reellement servies.
 * `total`     = valeur annoncee par le COUNT, dissociable de `available` pour
 *               simuler un total errone.
 */
function createSource(available, limit, announcedTotal) {
  return {
    available,
    total: announcedTotal === undefined ? available : announcedTotal,
    limit,
    offset: 0,
    page() {
      const rows = [];
      const end = Math.min(this.offset + this.limit, this.available);
      for (let i = this.offset; i < end; i += 1) rows.push({ id: i + 1, label: `row-${i + 1}` });
      return rows;
    },
    setOffset(next) {
      this.offset = next;
    },
    pagination() {
      return { limit: this.limit, offset: this.offset, total: this.total };
    },
  };
}

/** Rejoue un scroll infini complet. */
function drain(source, maxIterations = 1000) {
  let items = [];
  let keys = new Set();
  let fetches = 0;
  let outcome = null;

  const first = resetItems({ incoming: source.page(), offset: source.offset});
  items = first.items;
  keys = first.keys;
  fetches += 1;

  for (let i = 0; i < maxIterations; i += 1) {
    const plan = planNextFetch(source.pagination());
    if (plan.action !== 'fetch') return { items, keys, fetches, final: plan, outcome };

    source.setOffset(plan.offset);
    const incoming = source.page();
    const merged = mergeItems({ current: items, keys, incoming, offset: plan.offset});
    items = merged.items;
    keys = merged.keys;
    fetches += 1;

    outcome = classifyPage({
      incomingCount: incoming.length,
      added: merged.added,
      pagination: source.pagination(),
    });

    if (outcome.outcome !== 'continue') {
      return { items, keys, fetches, final: { action: outcome.outcome }, outcome };
    }
  }

  throw new Error('drain: pas de convergence');
}

/* ================================================================== *
 * mergeItems
 * ================================================================== */

test('mergeItems accumule sans muter les entrees', () => {
  const current = [{ key: 0, data: { id: 1 } }];
  const frozen = Object.freeze(current.slice());
  const keys = new Set([0]);

  const result = mergeItems({
    current: frozen,
    keys,
    incoming: [{ id: 2 }, { id: 3 }],
    offset: 1,
    itemKey: 'id',
  });

  assert.equal(result.added, 2);
  assert.equal(result.items.length, 3);
  assert.equal(frozen.length, 1, 'le tableau source ne doit pas etre mute');
  assert.equal(keys.size, 1, 'le Set source ne doit pas etre mute');
});

test('mergeItems ignore une page deja accumulee au meme offset', () => {
  // La position absolue sert de garde-fou : rejouer la meme page ne duplique rien.
  const first = resetItems({ incoming: [{ id: 1 }, { id: 2 }], offset: 0 });
  const replay = mergeItems({
    current: first.items,
    keys: first.keys,
    incoming: [{ id: 1 }, { id: 2 }],
    offset: 0,
  });

  assert.equal(replay.added, 0, 'aucune ligne ajoutee');
  assert.equal(replay.items.length, 2);
});

test('mergeItems accumule des pages d offsets differents', () => {
  const first = resetItems({ incoming: [{ id: 1 }, { id: 2 }], offset: 0 });
  const second = mergeItems({
    current: first.items,
    keys: first.keys,
    incoming: [{ id: 3 }, { id: 4 }],
    offset: 2,
  });

  assert.equal(second.added, 2);
  assert.deepEqual(second.items.map(entry => entry.data.id), [1, 2, 3, 4]);
});

/* ================================================================== *
 * validatePagination
 * ================================================================== */

test('validatePagination accepte des metadonnees coherentes', () => {
  const result = validatePagination({ limit: 50, offset: 100, total: 500 });
  assert.deepEqual(result, { ok: true, limit: 50, offset: 100, total: 500 });
});

test('validatePagination refuse une limite absente, nulle ou negative', () => {
  for (const limit of [undefined, null, 0, -1, '', NaN, 'abc']) {
    const result = validatePagination({ limit, offset: 0, total: 100 });
    assert.equal(result.ok, false, `limit=${String(limit)}`);
    assert.equal(result.code, ERROR_CODES.INVALID_LIMIT);
  }
});

test('validatePagination refuse une limite fractionnaire', () => {
  const result = validatePagination({ limit: 50.5, offset: 0, total: 100 });
  assert.equal(result.code, ERROR_CODES.INVALID_LIMIT);
});

test('validatePagination refuse un offset negatif ou fractionnaire', () => {
  assert.equal(validatePagination({ limit: 50, offset: -1, total: 100 }).code, ERROR_CODES.INVALID_OFFSET);
  assert.equal(validatePagination({ limit: 50, offset: 1.5, total: 100 }).code, ERROR_CODES.INVALID_OFFSET);
  assert.equal(validatePagination({ limit: 50, offset: null, total: 100 }).code, ERROR_CODES.INVALID_OFFSET);
});

test('validatePagination refuse un total absent, negatif ou fractionnaire', () => {
  // `Number(null)` vaut 0 : un total absent ne doit pas passer pour un total nul.
  assert.equal(validatePagination({ limit: 50, offset: 0, total: null }).code, ERROR_CODES.INVALID_TOTAL);
  assert.equal(validatePagination({ limit: 50, offset: 0, total: undefined }).code, ERROR_CODES.INVALID_TOTAL);
  assert.equal(validatePagination({ limit: 50, offset: 0, total: -1 }).code, ERROR_CODES.INVALID_TOTAL);
  assert.equal(validatePagination({ limit: 50, offset: 0, total: 10.5 }).code, ERROR_CODES.INVALID_TOTAL);
});

test('validatePagination refuse des metadonnees absentes', () => {
  assert.equal(validatePagination(null).code, ERROR_CODES.NO_METADATA);
  assert.equal(validatePagination(undefined).code, ERROR_CODES.NO_METADATA);
  assert.equal(validatePagination('nope').code, ERROR_CODES.NO_METADATA);
});

test('validatePagination accepte un total nul', () => {
  assert.equal(validatePagination({ limit: 50, offset: 0, total: 0 }).ok, true);
});

/* ================================================================== *
 * planNextFetch
 * ================================================================== */

test('planNextFetch avance d une page', () => {
  assert.deepEqual(planNextFetch({ limit: 50, offset: 0, total: 500 }), {
    action: 'fetch',
    offset: 50,
    limit: 50,
    total: 500,
  });
});

test('planNextFetch s arrete en fin de collection', () => {
  assert.equal(planNextFetch({ limit: 50, offset: 450, total: 500 }).action, 'end');
  assert.equal(planNextFetch({ limit: 50, offset: 0, total: 30 }).action, 'end');
  assert.equal(planNextFetch({ limit: 50, offset: 0, total: 0 }).action, 'end');
});

test('planNextFetch fonde la fin sur l offset, pas sur le nombre accumule', () => {
  // La deduplication peut rendre le nombre d'elements accumules inferieur au total :
  // s'y fier ferait croire a tort qu'il reste des pages a charger.
  const plan = planNextFetch({ limit: 50, offset: 450, total: 500 });
  assert.equal(plan.action, 'end', 'offset 450 + limit 50 >= 500');
});

test('planNextFetch remonte les erreurs de validation', () => {
  assert.equal(planNextFetch({ limit: 0, offset: 0, total: 100 }).code, ERROR_CODES.INVALID_LIMIT);
  assert.equal(planNextFetch({ limit: 50, offset: 0, total: null }).code, ERROR_CODES.INVALID_TOTAL);
  assert.equal(planNextFetch(null).code, ERROR_CODES.NO_METADATA);
});

test('isLastPage identifie la derniere page', () => {
  assert.equal(isLastPage({ limit: 50, offset: 450, total: 500 }), true);
  assert.equal(isLastPage({ limit: 50, offset: 400, total: 500 }), false);
  assert.equal(isLastPage({ limit: 50, offset: 0, total: 0 }), true);
  assert.equal(isLastPage({ limit: 50, offset: 100, total: 137 }), true);
  assert.equal(isLastPage({ limit: 0, offset: 0, total: 10 }), false, 'metadonnees invalides');
});

/* ================================================================== *
 * classifyIncoming
 * ================================================================== */

test('classifyIncoming accumule quand l offset correspond a la page demandee', () => {
  assert.deepEqual(classifyIncoming({ pendingOffset: 50, currentOffset: 50 }), {
    mode: 'append',
    offset: 50,
  });
});

test('classifyIncoming accepte la page meme si l offset amont est en retard', () => {
  // WeWeb peut publier les donnees avant que getPaginationOptions() ne reflete le
  // nouvel offset. Refuser la page bloquait definitivement le composant : le verrou
  // n etait jamais relache et le declencheur manuel devenait inerte.
  const verdict = classifyIncoming({ pendingOffset: 100, currentOffset: 50 });
  assert.equal(verdict.mode, 'append');
  assert.equal(verdict.offset, 100, 'l offset demande fait foi');
  assert.equal(verdict.offsetLagging, true);
});

test('classifyIncoming remet a zero sur un changement amont non sollicite', () => {
  assert.deepEqual(classifyIncoming({ pendingOffset: null, currentOffset: 0 }), {
    mode: 'reset',
    offset: 0,
  });
});

test('classifyIncoming n efface pas l accumulateur si un tiers pilote la pagination', () => {
  // Aucune page demandee mais offset amont non nul : accumuler sans purger.
  assert.deepEqual(classifyIncoming({ pendingOffset: null, currentOffset: 100 }), {
    mode: 'append',
    offset: 100,
  });
});

test('classifyIncoming traite pendingOffset 0 comme une demande valide', () => {
  assert.deepEqual(classifyIncoming({ pendingOffset: 0, currentOffset: 0 }), {
    mode: 'append',
    offset: 0,
  });
});

test('une reponse tardive a l offset attendu reste accumulable', () => {
  // Scenario du timeout : le verrou est conserve, donc pendingOffset vaut encore 50.
  // La reponse tardive doit etre ajoutee, jamais interpretee comme un reset.
  const { mode, offset } = classifyIncoming({ pendingOffset: 50, currentOffset: 50 });
  assert.equal(mode, 'append');
  assert.equal(offset, 50);
});

/* ================================================================== *
 * classifyPage
 * ================================================================== */

test('classifyPage poursuit sur une page normale', () => {
  const verdict = classifyPage({
    incomingCount: 50,
    added: 50,
    pagination: { limit: 50, offset: 50, total: 500 },
  });
  assert.equal(verdict.outcome, 'continue');
});

test('classifyPage termine sur la derniere page', () => {
  const verdict = classifyPage({
    incomingCount: 37,
    added: 37,
    pagination: { limit: 50, offset: 100, total: 137 },
  });
  assert.equal(verdict.outcome, 'end');
});

test('classifyPage termine sur une page vide quand le total est couvert', () => {
  // offset 500 et total 500 : toutes les lignes sont deja couvertes, une page vide
  // confirme simplement la fin.
  const verdict = classifyPage({
    incomingCount: 0,
    added: 0,
    pagination: { limit: 50, offset: 500, total: 500 },
  });
  assert.equal(verdict.outcome, 'end');
});

test('classifyPage signale une page vide alors que des lignes sont annoncees', () => {
  // offset 450 avec total 500 : 50 lignes devraient arriver. En recevoir zero est une
  // anomalie, pas une fin de collection.
  const verdict = classifyPage({
    incomingCount: 0,
    added: 0,
    pagination: { limit: 50, offset: 450, total: 500 },
  });
  assert.equal(verdict.outcome, 'error');
  assert.equal(verdict.code, ERROR_CODES.EMPTY_PAGE);
});

test('classifyPage signale une page vide avant la fin annoncee', () => {
  const verdict = classifyPage({
    incomingCount: 0,
    added: 0,
    pagination: { limit: 50, offset: 50, total: 500 },
  });
  assert.equal(verdict.outcome, 'error');
  assert.equal(verdict.code, ERROR_CODES.EMPTY_PAGE);
});

test('classifyPage signale une page non vide entierement dupliquee', () => {
  // Ne doit pas etre presente comme une fin normale : cela masquerait une mauvaise
  // cle unique, une collision, ou une reponse au mauvais offset.
  const verdict = classifyPage({
    incomingCount: 50,
    added: 0,
    pagination: { limit: 50, offset: 50, total: 500 },
  });
  assert.equal(verdict.outcome, 'error');
  assert.equal(verdict.code, ERROR_CODES.DUPLICATE_PAGE);
});

test('classifyPage prefere l anomalie de duplication a la fin de collection', () => {
  const verdict = classifyPage({
    incomingCount: 50,
    added: 0,
    pagination: { limit: 50, offset: 450, total: 500 },
  });
  assert.equal(verdict.code, ERROR_CODES.DUPLICATE_PAGE);
});

/* ================================================================== *
 * Machine a etats
 * ================================================================== */

test('seul idle autorise un chargement', () => {
  assert.equal(canLoad(STATES.IDLE), true);
  assert.equal(canLoad(STATES.INITIALIZING), false);
  assert.equal(canLoad(STATES.LOADING), false);
  assert.equal(canLoad(STATES.TIMED_OUT), false);
  assert.equal(canLoad(STATES.ENDED), false);
  assert.equal(canLoad(STATES.FAILED), false);
});

test('les transitions nominales sont autorisees', () => {
  assert.equal(canTransition(STATES.IDLE, STATES.LOADING), true);
  assert.equal(canTransition(STATES.LOADING, STATES.IDLE), true);
  assert.equal(canTransition(STATES.LOADING, STATES.TIMED_OUT), true);
  assert.equal(canTransition(STATES.LOADING, STATES.ENDED), true);
  assert.equal(canTransition(STATES.LOADING, STATES.FAILED), true);
  assert.equal(canTransition(STATES.IDLE, STATES.ENDED), true);
});

test('une requete expiree peut encore se resoudre', () => {
  assert.equal(canTransition(STATES.TIMED_OUT, STATES.IDLE), true);
  assert.equal(canTransition(STATES.TIMED_OUT, STATES.ENDED), true);
});

test('une requete expiree ne peut pas relancer un chargement directement', () => {
  assert.equal(canTransition(STATES.TIMED_OUT, STATES.LOADING), false);
});

test('les etats terminaux ne repartent que par un reset', () => {
  assert.equal(canTransition(STATES.ENDED, STATES.LOADING), false);
  assert.equal(canTransition(STATES.FAILED, STATES.LOADING), false);
  assert.equal(canTransition(STATES.ENDED, STATES.IDLE), true);
  assert.equal(canTransition(STATES.FAILED, STATES.IDLE), true);
  assert.equal(canTransition(STATES.ENDED, STATES.INITIALIZING), true);
});

test('initializing ne permet pas de charger avant la page initiale', () => {
  // Sans cette garde, un `[]` de collection non fetchee serait pris pour une page
  // initiale vide et la page 0 serait sautee.
  assert.equal(canLoad(STATES.INITIALIZING), false);
  assert.equal(canTransition(STATES.INITIALIZING, STATES.IDLE), true);
  assert.equal(canTransition(STATES.INITIALIZING, STATES.LOADING), false);
});

/* ================================================================== *
 * assessCollection
 * ================================================================== */

test('assessCollection signale une collection absente', () => {
  assert.equal(assessCollection(null).status, 'missing');
  assert.equal(assessCollection(undefined).status, 'missing');
  assert.equal(assessCollection('nope').status, 'missing');
});

test('assessCollection signale un chargement en cours', () => {
  assert.equal(assessCollection({ isFetching: true, data: [] }).status, 'loading');
  assert.equal(assessCollection({ isFetched: false, data: [] }).status, 'loading');
  assert.equal(assessCollection({ data: null }).status, 'loading');
  assert.equal(assessCollection({ data: undefined }).status, 'loading');
});

test('assessCollection ne confond pas un tableau vide non fetche avec une page vide', () => {
  // Cas central du saut de page initiale.
  assert.equal(assessCollection({ data: [] }).status, 'loading');
});

test('assessCollection accepte un tableau vide confirme comme fetche', () => {
  assert.equal(assessCollection({ data: [], isFetched: true }).status, 'ready');
  assert.equal(assessCollection({ data: [], isFetching: false }).status, 'ready');
});

test('assessCollection accepte des donnees presentes', () => {
  const assessment = assessCollection({ data: [{ id: 1 }] });
  assert.equal(assessment.status, 'ready');
  assert.deepEqual(assessment.data, [{ id: 1 }]);
});

test('assessCollection signale une erreur de collection', () => {
  assert.equal(assessCollection({ error: { message: 'boom' }, data: [] }).status, 'error');
});

test('assessCollection signale des donnees non exploitables', () => {
  assert.equal(assessCollection({ data: 'texte' }).status, 'invalid');
  assert.equal(assessCollection({ data: 42 }).status, 'invalid');
});

/* ================================================================== *
 * Page incomplete
 * ================================================================== */

test('classifyPage signale une page finale trop courte', () => {
  // offset 100 + limit 50 >= total 137 est vrai, mais seules 110 lignes sont
  // couvertes : la liste serait tronquee en se declarant complete.
  const verdict = classifyPage({
    incomingCount: 10,
    added: 10,
    pagination: { limit: 50, offset: 100, total: 137 },
  });
  assert.equal(verdict.outcome, 'error');
  assert.equal(verdict.code, ERROR_CODES.INCOMPLETE_PAGE);
});

test('classifyPage accepte une page finale partielle coherente', () => {
  const verdict = classifyPage({
    incomingCount: 37,
    added: 37,
    pagination: { limit: 50, offset: 100, total: 137 },
  });
  assert.equal(verdict.outcome, 'end', '100 + 37 = 137 : le total est couvert');
});

test('classifyPage fonde la couverture sur le nombre recu, pas sur la limite', () => {
  const short = classifyPage({
    incomingCount: 20,
    added: 20,
    pagination: { limit: 50, offset: 50, total: 100 },
  });
  assert.equal(short.outcome, 'error');
  assert.equal(short.code, ERROR_CODES.INCOMPLETE_PAGE);

  const exact = classifyPage({
    incomingCount: 50,
    added: 50,
    pagination: { limit: 50, offset: 50, total: 100 },
  });
  assert.equal(exact.outcome, 'end');
});

test('classifyPage reste prudent sans metadonnees fiables', () => {
  assert.equal(classifyPage({ incomingCount: 0, added: 0, pagination: null }).outcome, 'end');
  assert.equal(classifyPage({ incomingCount: 10, added: 10, pagination: null }).outcome, 'continue');
  assert.equal(
    classifyPage({ incomingCount: 10, added: 0, pagination: null }).code,
    ERROR_CODES.DUPLICATE_PAGE
  );
});

test('transition rejette une transition illegale sans corrompre l etat', () => {
  const result = transition(STATES.FAILED, STATES.LOADING);
  assert.equal(result.state, STATES.FAILED);
  assert.equal(result.changed, false);
  assert.equal(result.rejected, true);
});

test('transition vers le meme etat ne change rien', () => {
  const result = transition(STATES.LOADING, STATES.LOADING);
  assert.equal(result.changed, false);
});

/* ================================================================== *
 * Scenarios de bout en bout
 * ================================================================== */

test('scroll complet sur 500 elements par pages de 50', () => {
  const { items, fetches, final } = drain(createSource(500, 50));

  assert.equal(items.length, 500);
  assert.equal(fetches, 10, '500 / 50 = 10 requetes, aucune superflue');
  assert.equal(final.action, 'end');
  assert.deepEqual(items.map(e => e.data.id).slice(0, 3), [1, 2, 3]);
  assert.equal(items[499].data.id, 500);
  assert.equal(new Set(items.map(e => e.key)).size, 500, 'aucun doublon');
});

test('scroll complet sur 5000 elements (cible de production)', () => {
  const { items, fetches } = drain(createSource(5000, 50));
  assert.equal(items.length, 5000);
  assert.equal(fetches, 100);
});

test('derniere page partielle', () => {
  const { items, fetches, final } = drain(createSource(137, 50));
  assert.equal(items.length, 137);
  assert.equal(fetches, 3);
  assert.equal(final.action, 'end');
});

test('collection vide', () => {
  const { items, fetches, final } = drain(createSource(0, 50));
  assert.equal(items.length, 0);
  assert.equal(fetches, 1, 'aucune requete de pagination sur une collection vide');
  assert.equal(final.action, 'end');
});

test('collection plus courte que la limite', () => {
  const { items, fetches } = drain(createSource(12, 50));
  assert.equal(items.length, 12);
  assert.equal(fetches, 1);
});

test('total surestime : la page vide prematuree est signalee comme anomalie', () => {
  // Le serveur annonce 500 mais n'en sert que 60. La page a l'offset 100 est vide
  // alors que le total annonce en promettait davantage : anomalie, pas fin normale.
  const { items, outcome } = drain(createSource(60, 50, 500));
  assert.equal(items.length, 60);
  assert.equal(outcome.outcome, 'error');
  assert.equal(outcome.code, ERROR_CODES.EMPTY_PAGE);
});

test('un total surestime en bord de page est signale, pas masque', () => {
  // La source annonce 150 lignes mais n'en sert que 60 : le total est faux. Le
  // signaler vaut mieux que presenter une liste tronquee comme complete.
  const { items, outcome } = drain(createSource(60, 50, 150));
  assert.equal(items.length, 60);
  assert.equal(outcome.outcome, 'error');
  assert.equal(outcome.code, ERROR_CODES.EMPTY_PAGE);
});

test('deux pages consecutives s accumulent sans se recouvrir', () => {
  const first = resetItems({ incoming: [{ id: 1 }, { id: 2 }, { id: 3 }], offset: 0 });
  const second = mergeItems({
    current: first.items,
    keys: first.keys,
    incoming: [{ id: 4 }, { id: 5 }, { id: 6 }],
    offset: 3,
  });

  assert.equal(second.added, 3);
  assert.deepEqual(second.items.map(e => e.data.id), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(second.items.map(e => e.key), [0, 1, 2, 3, 4, 5], 'cles = positions absolues');
});

test('changement de filtre amont : reset de l accumulateur', () => {
  const first = resetItems({ incoming: [{ id: 1 }, { id: 2 }], offset: 0 });
  assert.equal(first.items.length, 2);

  const { mode } = classifyIncoming({ pendingOffset: null, currentOffset: 0 });
  assert.equal(mode, 'reset');

  const after = resetItems({ incoming: [{ id: 99 }], offset: 0 });
  assert.equal(after.items.length, 1);
  assert.equal(after.items[0].data.id, 99);
});

/* ================================================================== *
 * Visibilite du declencheur manuel
 * ================================================================== */

test('hasMorePages reste vrai tant que le total n est pas couvert', () => {
  assert.equal(hasMorePages({ limit: 50, offset: 0, total: 500 }), true);
  assert.equal(hasMorePages({ limit: 50, offset: 400, total: 500 }), true);
});

test('hasMorePages devient faux sur la derniere page', () => {
  assert.equal(hasMorePages({ limit: 50, offset: 450, total: 500 }), false);
  assert.equal(hasMorePages({ limit: 50, offset: 0, total: 30 }), false);
  assert.equal(hasMorePages({ limit: 50, offset: 0, total: 0 }), false);
});

test('hasMorePages est faux sans metadonnees fiables', () => {
  // Mieux vaut masquer le declencheur que proposer une action qui echouera.
  assert.equal(hasMorePages(null), false);
  assert.equal(hasMorePages({ limit: 0, offset: 0, total: 100 }), false);
});

/* ================================================================== *
 * Hauteur et distance de declenchement
 * ================================================================== */

test('resolveItemHeight prefere la mesure reelle', () => {
  assert.equal(resolveItemHeight({ measured: 123.4, fallback: 80 }), 123);
});

test('resolveItemHeight retombe sur la valeur par defaut avant mesure', () => {
  assert.equal(resolveItemHeight({ measured: null, fallback: 80 }), 80);
  assert.equal(resolveItemHeight({ measured: 0, fallback: 80 }), 80);
  assert.equal(resolveItemHeight({ measured: NaN, fallback: 80 }), 80);
  assert.equal(resolveItemHeight({ measured: -10, fallback: 80 }), 80);
  assert.equal(resolveItemHeight({}), 80);
});

test('resolveTriggerDistance suit la hauteur visible', () => {
  assert.equal(resolveTriggerDistance({ viewportHeight: 600, itemHeight: 80, screens: 1 }), 600);
  assert.equal(resolveTriggerDistance({ viewportHeight: 600, itemHeight: 80, screens: 2 }), 1200);
  assert.equal(resolveTriggerDistance({ viewportHeight: 1000, itemHeight: 80, screens: 0.5 }), 500);
});

test('resolveTriggerDistance garde un plancher sur un conteneur tres court', () => {
  // Un conteneur de 100px ne doit pas declencher le chargement trop tard.
  const distance = resolveTriggerDistance({ viewportHeight: 100, itemHeight: 80, screens: 1 });
  assert.ok(distance >= 160, `plancher de deux elements attendu, recu ${distance}`);
});

test('resolveTriggerDistance reste utilisable sans mesure', () => {
  const distance = resolveTriggerDistance({ viewportHeight: 0, itemHeight: 0, screens: 1 });
  assert.ok(distance >= 100, 'une distance minimale doit rester garantie');
});

test('resolveTriggerDistance corrige des parametres invalides', () => {
  assert.ok(resolveTriggerDistance({ viewportHeight: 600, itemHeight: 80, screens: 0 }) > 0);
  assert.ok(resolveTriggerDistance({ viewportHeight: 600, itemHeight: 80, screens: -1 }) > 0);
  assert.ok(resolveTriggerDistance({ viewportHeight: NaN, itemHeight: NaN, screens: NaN }) >= 100);
});
