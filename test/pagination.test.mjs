import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ERROR_CODES,
  describeError,
  readPagination,
  currentPage,
  pageCount,
  isLastPage,
  nextOffset,
} from '../src/pagination.mjs';

test('chaque code d erreur produit un message non vide', () => {
  for (const code of Object.values(ERROR_CODES)) {
    const error = describeError(code);
    assert.equal(error.code, code);
    assert.ok(error.message.length > 0);
  }
});

test('les details sont joints au message', () => {
  const error = describeError(ERROR_CODES.PAGINATION_UNAVAILABLE, 'id=abc');
  assert.match(error.message, /\(id=abc\)$/);
});

test('readPagination normalise des metadonnees coherentes', () => {
  assert.deepEqual(readPagination({ limit: 50, offset: 100, total: 500 }), {
    limit: 50,
    offset: 100,
    total: 500,
  });
});

test('readPagination accepte des nombres transmis en texte', () => {
  assert.deepEqual(readPagination({ limit: '50', offset: '0', total: '137' }), {
    limit: 50,
    offset: 0,
    total: 137,
  });
});

test('readPagination refuse une limite absente ou nulle', () => {
  // Sans limite, la pagination serveur n'est pas active : il n'y a rien a paginer.
  assert.equal(readPagination({ offset: 0, total: 10 }), null);
  assert.equal(readPagination({ limit: 0, offset: 0, total: 10 }), null);
  assert.equal(readPagination({ limit: -10, offset: 0, total: 10 }), null);
  assert.equal(readPagination({ limit: 2.5, offset: 0, total: 10 }), null);
});

test('readPagination refuse les booleens malgre la coercition numerique', () => {
  assert.equal(readPagination({ limit: true, offset: 0, total: 5 }), null);
  assert.equal(readPagination({ limit: 5, offset: false, total: 5 }), null);
});

test('readPagination refuse un offset ou un total invalide', () => {
  assert.equal(readPagination({ limit: 5, offset: -1, total: 10 }), null);
  assert.equal(readPagination({ limit: 5, offset: [], total: 10 }), null);
  assert.equal(readPagination({ limit: 5, offset: 0, total: null }), null);
  assert.equal(readPagination({ limit: 5, offset: 0, total: 'beaucoup' }), null);
});

test('readPagination refuse une entree absente', () => {
  assert.equal(readPagination(null), null);
  assert.equal(readPagination(undefined), null);
  assert.equal(readPagination('50'), null);
});

test('currentPage et pageCount suivent la formule du Paginator officiel', () => {
  assert.equal(currentPage({ offset: 0, limit: 50 }), 0);
  assert.equal(currentPage({ offset: 100, limit: 50 }), 2);
  assert.equal(pageCount({ total: 137, limit: 50 }), 3);
  assert.equal(pageCount({ total: 100, limit: 50 }), 2);
});

test('pageCount vaut au moins une page pour une collection vide', () => {
  assert.equal(pageCount({ total: 0, limit: 50 }), 1);
});

test('isLastPage applique le contrat offset plus limite', () => {
  assert.equal(isLastPage({ offset: 0, limit: 50, total: 500 }), false);
  assert.equal(isLastPage({ offset: 100, limit: 50, total: 137 }), true);
  assert.equal(isLastPage({ offset: 50, limit: 50, total: 100 }), true);
});

test('une collection vide est deja a sa derniere page', () => {
  assert.equal(isLastPage({ offset: 0, limit: 50, total: 0 }), true);
});

test('nextOffset avance d une limite', () => {
  assert.equal(nextOffset({ limit: 50, offset: 0, total: 500 }), 50);
  assert.equal(nextOffset({ limit: 12, offset: 0, total: 95 }), 12);
});

test('nextOffset retourne null a la fin', () => {
  assert.equal(nextOffset({ limit: 50, offset: 100, total: 137 }), null);
  assert.equal(nextOffset({ limit: 50, offset: 0, total: 0 }), null);
  assert.equal(nextOffset(null), null);
});

test('nextOffset part du dernier offset obtenu plutot que des metadonnees', () => {
  // Les metadonnees peuvent etre en retard d un cycle reactif sur les donnees.
  assert.equal(nextOffset({ limit: 50, offset: 0, total: 500 }, 150), 200);
});

test('un from invalide retombe sur l offset des metadonnees', () => {
  assert.equal(nextOffset({ limit: 50, offset: 100, total: 500 }, -5), 150);
  assert.equal(nextOffset({ limit: 50, offset: 100, total: 500 }, null), 150);
  assert.equal(nextOffset({ limit: 50, offset: 100, total: 500 }, 'abc'), 150);
});

test('la pagination 20 sur 95 enchaine 20 40 60 80 puis se termine', () => {
  const limit = 20;
  const total = 95;
  const offsets = [];
  let offset = 0;

  for (let guard = 0; guard < 10; guard += 1) {
    const next = nextOffset({ limit, offset, total }, offset);
    if (next === null) break;
    offsets.push(next);
    offset = next;
  }

  assert.deepEqual(offsets, [20, 40, 60, 80]);
  assert.equal(nextOffset({ limit, offset: 80, total }, 80), null);
});

test('une derniere page partielle termine sans requete superflue', () => {
  assert.equal(nextOffset({ limit: 50, offset: 50, total: 137 }, 50), 100);
  assert.equal(nextOffset({ limit: 50, offset: 100, total: 137 }, 100), null);
});
