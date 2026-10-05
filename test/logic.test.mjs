/**
 * Tests de la logique pure, executables hors WeWeb : `npm test`.
 *
 * Le simulateur reproduit le comportement du plugin Supabase :
 *   query.range(collection.offset, collection.offset + collection.limit - 1)
 * c'est-a-dire une page qui REMPLACE la precedente, d'ou la necessite
 * d'accumuler cote composant.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  resolveKey,
  mergeItems,
  resetItems,
  planNextFetch,
  classifyIncoming,
  parsePaginatedSource,
} from '../src/logic.mjs';

/**
 * Simule une vue SQL paginee cote serveur.
 *
 * `available` = nombre de lignes reellement servies.
 * `total`     = nombre annonce par le COUNT. Volontairement dissociable de
 *               `available` pour simuler un total errone.
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

/** Rejoue un scroll infini complet et retourne l'accumulateur + le nombre de fetchs. */
function drain(source, itemKey = 'id', maxIterations = 1000) {
  let items = [];
  let keys = new Set();
  let fetches = 0;

  const first = resetItems({ incoming: source.page(), offset: source.offset, itemKey });
  items = first.items;
  keys = first.keys;
  fetches += 1;

  for (let i = 0; i < maxIterations; i += 1) {
    const plan = planNextFetch({ ...source.pagination(), loadedCount: items.length });
    if (plan.action !== 'fetch') return { items, keys, fetches, final: plan };

    source.setOffset(plan.offset);
    const merged = mergeItems({
      current: items,
      keys,
      incoming: source.page(),
      offset: plan.offset,
      itemKey,
    });
    items = merged.items;
    keys = merged.keys;
    fetches += 1;

    if (merged.added === 0) return { items, keys, fetches, final: { action: 'end' } };
  }

  throw new Error('drain: pas de convergence');
}

test('resolveKey privilegie le champ metier', () => {
  assert.equal(resolveKey({ id: 42 }, 7, 'id'), 'k:42');
  assert.equal(resolveKey({ id: 'abc' }, 7, 'id'), 'k:abc');
});

test('resolveKey retombe sur l index absolu quand la cle est inexploitable', () => {
  assert.equal(resolveKey({ id: null }, 7, 'id'), 'i:7');
  assert.equal(resolveKey({ id: undefined }, 7, 'id'), 'i:7');
  assert.equal(resolveKey({ id: '' }, 7, 'id'), 'i:7');
  assert.equal(resolveKey({ other: 1 }, 7, 'id'), 'i:7');
  assert.equal(resolveKey({ id: 1 }, 7, null), 'i:7');
  assert.equal(resolveKey('scalaire', 7, 'id'), 'i:7');
  assert.equal(resolveKey(null, 7, 'id'), 'i:7');
});

test('resolveKey distingue id numerique et id chaine', () => {
  // Ne doivent pas collisionner avec la cle d'index : prefixes distincts.
  assert.notEqual(resolveKey({ id: 5 }, 0, 'id'), resolveKey({}, 5, 'id'));
});

test('mergeItems accumule sans muter les entrees', () => {
  const current = [{ key: 'k:1', data: { id: 1 } }];
  const frozen = Object.freeze(current.slice());
  const keys = new Set(['k:1']);

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
  assert.notEqual(result.items, frozen);
  assert.notEqual(result.keys, keys);
});

test('mergeItems ignore les doublons', () => {
  const first = resetItems({ incoming: [{ id: 1 }, { id: 2 }], offset: 0, itemKey: 'id' });
  const second = mergeItems({
    current: first.items,
    keys: first.keys,
    incoming: [{ id: 2 }, { id: 3 }],
    offset: 2,
    itemKey: 'id',
  });

  assert.equal(second.added, 1);
  assert.deepEqual(second.items.map(entry => entry.data.id), [1, 2, 3]);
});

test('planNextFetch refuse une collection sans limite', () => {
  for (const limit of [undefined, null, 0, -1, NaN, 'abc']) {
    const plan = planNextFetch({ limit, offset: 0, total: 100, loadedCount: 0 });
    assert.equal(plan.action, 'error', `limit=${String(limit)} doit etre refuse`);
    assert.match(plan.message, /limite/);
  }
});

test('planNextFetch avance d une page', () => {
  const plan = planNextFetch({ limit: 50, offset: 0, total: 500, loadedCount: 50 });
  assert.deepEqual(plan, { action: 'fetch', offset: 50, limit: 50, total: 500 });
});

test('planNextFetch s arrete en fin de collection', () => {
  assert.equal(planNextFetch({ limit: 50, offset: 450, total: 500, loadedCount: 500 }).action, 'end');
  assert.equal(planNextFetch({ limit: 50, offset: 0, total: 30, loadedCount: 30 }).action, 'end');
  assert.equal(planNextFetch({ limit: 50, offset: 0, total: 0, loadedCount: 0 }).action, 'end');
});

test('planNextFetch continue quand le total est inconnu', () => {
  const plan = planNextFetch({ limit: 50, offset: 0, total: null, loadedCount: 50 });
  assert.equal(plan.action, 'fetch');
  assert.equal(plan.total, null);
});

test('classifyIncoming distingue page demandee et changement amont', () => {
  assert.deepEqual(classifyIncoming({ pendingOffset: 50, currentOffset: 50 }), {
    mode: 'append',
    offset: 50,
  });
  assert.deepEqual(classifyIncoming({ pendingOffset: null, currentOffset: 0 }), {
    mode: 'reset',
    offset: 0,
  });
  // pendingOffset 0 est un offset valide, pas une absence de demande.
  assert.deepEqual(classifyIncoming({ pendingOffset: 0, currentOffset: 0 }), {
    mode: 'append',
    offset: 0,
  });
});

test('parsePaginatedSource lit le format collection:<uuid>', () => {
  assert.equal(parsePaginatedSource('collection:abc-123'), 'abc-123');
  assert.equal(parsePaginatedSource('tableView:abc-123'), null);
  assert.equal(parsePaginatedSource('collection:'), null);
  assert.equal(parsePaginatedSource('abc-123'), null);
  assert.equal(parsePaginatedSource(null), null);
  assert.equal(parsePaginatedSource(''), null);
});

test('parsePaginatedSource preserve un uuid contenant des deux-points', () => {
  assert.equal(parsePaginatedSource('collection:a:b'), 'a:b');
});

test('scroll complet sur 500 elements par pages de 50', () => {
  const source = createSource(500, 50);
  const { items, fetches, final } = drain(source);

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

test('total surestime : l absence d element nouveau arrete la boucle', () => {
  // Le serveur annonce 100 mais n'en sert que 60 : sans la garde `added === 0`,
  // la boucle demanderait indefiniment la meme page vide.
  const { items, final, fetches } = drain(createSource(60, 50, 100));
  assert.equal(items.length, 60);
  assert.equal(final.action, 'end');
  assert.ok(fetches <= 4, `la boucle doit converger vite, pas en ${fetches} requetes`);
});

test('total nul explicite : arret immediat', () => {
  const plan = planNextFetch({ limit: 50, offset: 0, total: 0, loadedCount: 0 });
  assert.equal(plan.action, 'end');
});

test('total null/undefined/vide : traite comme inconnu, pas comme zero', () => {
  for (const total of [null, undefined, '']) {
    const plan = planNextFetch({ limit: 50, offset: 0, total, loadedCount: 50 });
    assert.equal(plan.action, 'fetch', `total=${String(total)} doit etre traite comme inconnu`);
  }
});

test('pages qui se chevauchent : deduplication effective', () => {
  // Insertion concurrente cote base -> decalage des lignes, donc chevauchement.
  const first = resetItems({
    incoming: [{ id: 1 }, { id: 2 }, { id: 3 }],
    offset: 0,
    itemKey: 'id',
  });
  const second = mergeItems({
    current: first.items,
    keys: first.keys,
    incoming: [{ id: 3 }, { id: 4 }, { id: 5 }],
    offset: 3,
    itemKey: 'id',
  });

  assert.equal(second.added, 2);
  assert.deepEqual(second.items.map(e => e.data.id), [1, 2, 3, 4, 5]);
});

test('sans cle metier, des pages distinctes restent accumulables', () => {
  const source = createSource(150, 50);
  const { items } = drain(source, null);
  assert.equal(items.length, 150, 'le repli par index absolu doit rester unique entre pages');
});

test('changement de filtre amont : reset de l accumulateur', () => {
  const first = resetItems({ incoming: [{ id: 1 }, { id: 2 }], offset: 0, itemKey: 'id' });
  assert.equal(first.items.length, 2);

  const { mode } = classifyIncoming({ pendingOffset: null, currentOffset: 0 });
  assert.equal(mode, 'reset');

  const after = resetItems({ incoming: [{ id: 99 }], offset: 0, itemKey: 'id' });
  assert.equal(after.items.length, 1);
  assert.equal(after.items[0].data.id, 99);
});
