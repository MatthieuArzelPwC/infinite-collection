import assert from 'node:assert/strict';
import { test } from 'node:test';

import { project, loadedCount, firstMissingIndex, nextPageOffset } from '../src/rows.mjs';

/**
 * Reproduit la forme exacte publiee par WeWeb, telle que mesuree dans le Studio
 * sur une collection de 8342 lignes paginee par 12 :
 *
 *   tableau pre-dimensionne au total, positions non chargees a null, cumul des
 *   pages sans liberation des precedentes.
 */
function wewebData({ total, limit, pagesLoaded }) {
  const data = new Array(total).fill(null);
  for (let page = 0; page < pagesLoaded; page += 1) {
    const start = page * limit;
    for (let index = start; index < start + limit && index < total; index += 1) {
      data[index] = { id: index };
    }
  }
  return data;
}

test('la forme mesuree dans le Studio est reproduite fidelement', () => {
  const premiere = wewebData({ total: 8342, limit: 12, pagesLoaded: 1 });
  assert.equal(premiere.length, 8342, 'pre-dimensionne au total');
  assert.equal(loadedCount(premiere), 12);

  const seconde = wewebData({ total: 8342, limit: 12, pagesLoaded: 2 });
  assert.equal(seconde.length, 8342, 'length constant entre les pages');
  assert.equal(loadedCount(seconde), 24, 'cumul et non remplacement');
  assert.ok(seconde[0], 'la premiere page n est jamais liberee');
});

test('project ne retient que les lignes chargees', () => {
  const data = wewebData({ total: 100, limit: 12, pagesLoaded: 1 });
  const rows = project(data);

  assert.equal(rows.length, 12);
  assert.deepEqual(
    rows.map(row => row.key),
    Array.from({ length: 12 }, (_, index) => index)
  );
});

test('la cle est la position absolue dans la collection', () => {
  const data = new Array(50).fill(null);
  data[20] = { id: 20 };
  data[21] = { id: 21 };

  const rows = project(data);
  assert.deepEqual(
    rows.map(row => row.key),
    [20, 21]
  );
  // La cle ne doit pas etre l'index de la liste affichee, sinon une ligne
  // changerait d'identite quand une page anterieure arrive.
  assert.equal(rows[0].data.id, 20);
});

test('project suit la progression des pages', () => {
  for (const pages of [1, 2, 5]) {
    const data = wewebData({ total: 8342, limit: 12, pagesLoaded: pages });
    assert.equal(project(data).length, pages * 12);
  }
});

test('project est stable : deux appels sur la meme donnee donnent le meme resultat', () => {
  const data = wewebData({ total: 100, limit: 12, pagesLoaded: 2 });
  assert.deepEqual(project(data), project(data));
});

test('une republication a l identique ne change pas la projection', () => {
  // WeWeb publie un nouveau tableau a chaque reponse : la projection doit
  // dependre du contenu, pas de l identite du tableau.
  const premier = wewebData({ total: 100, limit: 12, pagesLoaded: 2 });
  const second = wewebData({ total: 100, limit: 12, pagesLoaded: 2 });
  assert.notEqual(premier, second);
  assert.deepEqual(project(premier), project(second));
});

test('project tolere un tableau creux', () => {
  const sparse = [];
  sparse[3] = { id: 3 };
  sparse[4] = { id: 4 };
  assert.equal(0 in sparse, false, 'forEach et map sauteraient ces positions');

  assert.deepEqual(
    project(sparse).map(row => row.key),
    [3, 4]
  );
});

test('project tolere une valeur absente ou non tableau', () => {
  assert.deepEqual(project(null), []);
  assert.deepEqual(project(undefined), []);
  assert.deepEqual(project({ data: [] }), []);
  assert.deepEqual(project([]), []);
});

test('loadedCount compte les positions remplies', () => {
  assert.equal(loadedCount(wewebData({ total: 8342, limit: 12, pagesLoaded: 2 })), 24);
  assert.equal(loadedCount(new Array(50).fill(null)), 0);
  assert.equal(loadedCount(null), 0);
});

test('firstMissingIndex designe la frontiere de chargement', () => {
  const data = wewebData({ total: 100, limit: 12, pagesLoaded: 1 });
  assert.equal(firstMissingIndex(data), 12);

  const deux = wewebData({ total: 100, limit: 12, pagesLoaded: 2 });
  assert.equal(firstMissingIndex(deux), 24);
});

test('firstMissingIndex retourne null quand tout est charge', () => {
  const data = wewebData({ total: 24, limit: 12, pagesLoaded: 2 });
  assert.equal(firstMissingIndex(data), null);
});

test('une collection vide n a aucune ligne manquante', () => {
  assert.equal(firstMissingIndex([]), null);
});

test('nextPageOffset aligne la frontiere sur une limite de page', () => {
  const data = wewebData({ total: 8342, limit: 12, pagesLoaded: 1 });
  assert.equal(nextPageOffset(data, 12), 12);

  const deux = wewebData({ total: 8342, limit: 12, pagesLoaded: 2 });
  assert.equal(nextPageOffset(deux, 12), 24);
});

test('nextPageOffset reprend la premiere page incomplete', () => {
  // Une page partiellement remplie doit etre redemandee a son debut, et non a la
  // position exacte du trou : WeWeb n accepte que des offsets multiples.
  const data = new Array(100).fill(null);
  for (let index = 0; index < 20; index += 1) data[index] = { id: index };

  assert.equal(firstMissingIndex(data), 20);
  assert.equal(nextPageOffset(data, 12), 12);
});

test('nextPageOffset retourne null a la fin de la collection', () => {
  const data = wewebData({ total: 24, limit: 12, pagesLoaded: 2 });
  assert.equal(nextPageOffset(data, 12), null);
  assert.equal(nextPageOffset([], 12), null);
});

test('nextPageOffset refuse une limite invalide', () => {
  const data = wewebData({ total: 100, limit: 12, pagesLoaded: 1 });
  assert.equal(nextPageOffset(data, 0), null);
  assert.equal(nextPageOffset(data, -12), null);
  assert.equal(nextPageOffset(data, 2.5), null);
  assert.equal(nextPageOffset(data, null), null);
});

test('un parcours complet de 8342 lignes se termine sans trou', () => {
  const total = 8342;
  const limit = 12;
  const data = new Array(total).fill(null);
  const offsets = [];

  for (let guard = 0; guard < 1000; guard += 1) {
    const offset = nextPageOffset(data, limit);
    if (offset === null) break;
    offsets.push(offset);
    for (let index = offset; index < offset + limit && index < total; index += 1) {
      data[index] = { id: index };
    }
  }

  assert.equal(loadedCount(data), total);
  assert.equal(nextPageOffset(data, limit), null);
  assert.equal(offsets.length, Math.ceil(total / limit));
  assert.deepEqual(offsets.slice(0, 3), [0, 12, 24]);
  assert.equal(project(data).length, total);
});

test('une derniere page partielle termine le parcours', () => {
  // 8342 n est pas un multiple de 12 : la derniere page ne contient que 2 lignes.
  const data = wewebData({ total: 8342, limit: 12, pagesLoaded: 695 });
  assert.equal(loadedCount(data), 8340);
  assert.equal(nextPageOffset(data, 12), 8340);

  const complet = wewebData({ total: 8342, limit: 12, pagesLoaded: 696 });
  assert.equal(loadedCount(complet), 8342);
  assert.equal(nextPageOffset(complet, 12), null);
});
