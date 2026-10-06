import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  STATUS,
  ERROR_CODES,
  describeError,
  validatePagination,
  planNextFetch,
  applyPage,
  classifyPage,
} from '../src/logic.mjs';

test('les statuts restent limites au cycle utile', () => {
  assert.deepEqual(Object.values(STATUS), ['initializing', 'ready', 'loading', 'ended', 'failed']);
});

test('chaque code d erreur produit un message', () => {
  for (const code of Object.values(ERROR_CODES)) {
    assert.equal(describeError(code).code, code);
    assert.ok(describeError(code).message.length > 0);
  }
});

test('validatePagination accepte des entiers coherents', () => {
  assert.deepEqual(validatePagination({ limit: 50, offset: 100, total: 500 }), {
    ok: true,
    limit: 50,
    offset: 100,
    total: 500,
  });
});

test('validatePagination refuse les metadonnees invalides', () => {
  assert.equal(validatePagination(null).code, ERROR_CODES.NO_METADATA);
  assert.equal(validatePagination({ limit: 0, offset: 0, total: 10 }).code, ERROR_CODES.INVALID_LIMIT);
  assert.equal(validatePagination({ limit: 5, offset: -1, total: 10 }).code, ERROR_CODES.INVALID_OFFSET);
  assert.equal(validatePagination({ limit: 5, offset: 0, total: null }).code, ERROR_CODES.INVALID_TOTAL);
  assert.equal(validatePagination({ limit: 2.5, offset: 0, total: 10 }).code, ERROR_CODES.INVALID_LIMIT);
});

test('planNextFetch demande l offset suivant', () => {
  assert.deepEqual(planNextFetch({ limit: 50, offset: 0, total: 500 }), {
    action: 'fetch',
    offset: 50,
    limit: 50,
    total: 500,
  });
});

test('une collection affichee 12 sur 95 demande l offset 12', () => {
  assert.deepEqual(planNextFetch({ limit: 12, offset: 0, total: 95 }), {
    action: 'fetch',
    offset: 12,
    limit: 12,
    total: 95,
  });
});

test('planNextFetch termine sans requete superflue', () => {
  assert.deepEqual(planNextFetch({ limit: 50, offset: 100, total: 137 }), {
    action: 'end',
    total: 137,
  });
  assert.equal(planNextFetch({ limit: 50, offset: 0, total: 0 }).action, 'end');
});

test('applyPage accumule les pages sequentielles', () => {
  const first = applyPage([], [{ id: 1 }, { id: 2 }], 0);
  const second = applyPage(first.items, [{ id: 3 }, { id: 4 }], 2);
  assert.equal(second.ok, true);
  assert.deepEqual(second.items.map(entry => entry.data.id), [1, 2, 3, 4]);
  assert.deepEqual(second.items.map(entry => entry.key), [0, 1, 2, 3]);
});

test('applyPage remplace proprement une page au meme offset', () => {
  const first = applyPage([], [{ id: 1 }, { id: 2 }], 0);
  const replaced = applyPage(first.items, [{ id: 10 }, { id: 20 }], 0);
  assert.deepEqual(replaced.items.map(entry => entry.data.id), [10, 20]);
});

test('applyPage refuse un trou entre les pages', () => {
  const result = applyPage([{ key: 0, data: { id: 1 } }], [{ id: 3 }], 2);
  assert.equal(result.ok, false);
  assert.equal(result.code, ERROR_CODES.UNEXPECTED_OFFSET);
});

test('classifyPage continue sur une page intermediaire', () => {
  assert.deepEqual(classifyPage({ incomingCount: 50, offset: 50, limit: 50, total: 500 }), {
    outcome: 'continue',
  });
});

test('classifyPage termine avec la taille reellement recue', () => {
  assert.deepEqual(classifyPage({ incomingCount: 37, offset: 100, limit: 50, total: 137 }), {
    outcome: 'end',
  });
});

test('classifyPage refuse une derniere page trop courte', () => {
  const result = classifyPage({ incomingCount: 10, offset: 100, limit: 50, total: 137 });
  assert.equal(result.outcome, 'error');
  assert.equal(result.code, ERROR_CODES.INCOMPLETE_PAGE);
});

test('classifyPage refuse une page vide avant la fin', () => {
  const result = classifyPage({ incomingCount: 0, offset: 50, limit: 50, total: 500 });
  assert.equal(result.code, ERROR_CODES.EMPTY_PAGE);
});

test('classifyPage accepte une collection vide', () => {
  assert.deepEqual(classifyPage({ incomingCount: 0, offset: 0, limit: 50, total: 0 }), {
    outcome: 'end',
  });
});

test('scroll logique complet sur 5000 elements', () => {
  const total = 5000;
  const limit = 50;
  let items = [];
  for (let offset = 0; offset < total; offset += limit) {
    const page = Array.from({ length: Math.min(limit, total - offset) }, (_, index) => ({ id: offset + index }));
    const applied = applyPage(items, page, offset);
    assert.equal(applied.ok, true);
    items = applied.items;
  }
  assert.equal(items.length, total);
});
