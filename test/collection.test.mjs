import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  readCollection,
  readPaginationOptions,
  canPaginate,
  requestOffset,
  translate,
} from '../src/collection.mjs';

/**
 * Faux runtime WeWeb.
 *
 * Reproduit la seule surface utilisee par le composant : le getter interne du
 * store pour les donnees, et les deux fonctions de pagination employees par le
 * Paginator officiel.
 */
function fakeWwLib({ collections = {}, pagination = {}, lang = 'fr', throwOn = {} } = {}) {
  const calls = [];

  return {
    calls,
    lib: {
      $store: {
        getters: {
          get 'data/getCollections'() {
            if (throwOn.store) throw new Error('store indisponible');
            return collections;
          },
        },
      },
      wwCollection: {
        getPaginationOptions(id) {
          if (throwOn.getPaginationOptions) throw new Error('lecture impossible');
          return pagination[id] ?? null;
        },
        setOffset(id, offset) {
          if (throwOn.setOffset) throw new Error('offset refuse');
          calls.push({ id, offset });
        },
      },
      wwLang: {
        getText(value) {
          if (throwOn.getText) throw new Error('traduction impossible');
          return value?.[lang];
        },
      },
    },
  };
}

/** Installe le faux runtime en global le temps d'une assertion. */
function withWwLib(lib, run) {
  const previous = globalThis.wwLib;
  globalThis.wwLib = lib;
  try {
    return run();
  } finally {
    if (previous === undefined) delete globalThis.wwLib;
    else globalThis.wwLib = previous;
  }
}

test('readCollection retourne la collection demandee', () => {
  const { lib } = fakeWwLib({ collections: { abc: { data: [{ id: 1 }] } } });
  withWwLib(lib, () => {
    assert.deepEqual(readCollection('abc'), { data: [{ id: 1 }] });
  });
});

test('readCollection retourne null sans identifiant ou sans correspondance', () => {
  const { lib } = fakeWwLib({ collections: { abc: {} } });
  withWwLib(lib, () => {
    assert.equal(readCollection(null), null);
    assert.equal(readCollection(''), null);
    assert.equal(readCollection('introuvable'), null);
  });
});

test('readCollection absorbe une rupture du store interne', () => {
  // Le getter n'est pas une API publique : une evolution WeWeb ne doit pas faire
  // remonter d'exception dans le rendu.
  const { lib } = fakeWwLib({ throwOn: { store: true } });
  withWwLib(lib, () => {
    assert.equal(readCollection('abc'), null);
  });
});

test('readCollection retourne null hors runtime WeWeb', () => {
  const previous = globalThis.wwLib;
  delete globalThis.wwLib;
  try {
    assert.equal(readCollection('abc'), null);
  } finally {
    if (previous !== undefined) globalThis.wwLib = previous;
  }
});

test('readPaginationOptions relaie les metadonnees brutes', () => {
  const { lib } = fakeWwLib({ pagination: { abc: { limit: 50, offset: 0, total: 500 } } });
  withWwLib(lib, () => {
    assert.deepEqual(readPaginationOptions('abc'), { limit: 50, offset: 0, total: 500 });
  });
});

test('readPaginationOptions absorbe une lecture en echec', () => {
  const { lib } = fakeWwLib({ throwOn: { getPaginationOptions: true } });
  withWwLib(lib, () => {
    assert.equal(readPaginationOptions('abc'), null);
  });
});

test('canPaginate exige les deux fonctions du Paginator officiel', () => {
  const { lib } = fakeWwLib();
  withWwLib(lib, () => {
    assert.equal(canPaginate(), true);
  });

  withWwLib({ wwCollection: { getPaginationOptions: () => null } }, () => {
    assert.equal(canPaginate(), false);
  });

  withWwLib({}, () => {
    assert.equal(canPaginate(), false);
  });
});

test('requestOffset transmet la demande et confirme', () => {
  const { lib, calls } = fakeWwLib();
  withWwLib(lib, () => {
    assert.equal(requestOffset('abc', 50), true);
  });
  assert.deepEqual(calls, [{ id: 'abc', offset: 50 }]);
});

test('requestOffset signale un echec sans lever', () => {
  const { lib } = fakeWwLib({ throwOn: { setOffset: true } });
  withWwLib(lib, () => {
    assert.equal(requestOffset('abc', 50), false);
  });

  withWwLib({}, () => {
    assert.equal(requestOffset('abc', 50), false);
  });
});

test('translate resout un texte multilingue', () => {
  const { lib } = fakeWwLib({ lang: 'fr' });
  withWwLib(lib, () => {
    assert.equal(translate({ en: 'Load more', fr: 'Charger la suite' }, 'defaut'), 'Charger la suite');
  });
});

test('translate accepte une chaine deja resolue', () => {
  assert.equal(translate('Charger', 'defaut'), 'Charger');
});

test('translate retombe sur le defaut quand la langue manque', () => {
  const { lib } = fakeWwLib({ lang: 'de' });
  withWwLib(lib, () => {
    assert.equal(translate({ en: 'Load more', fr: 'Charger la suite' }, 'defaut'), 'defaut');
  });
});

test('translate retombe sur le defaut en cas d echec ou de valeur vide', () => {
  const { lib } = fakeWwLib({ throwOn: { getText: true } });
  withWwLib(lib, () => {
    assert.equal(translate({ fr: 'Charger' }, 'defaut'), 'defaut');
  });

  assert.equal(translate(null, 'defaut'), 'defaut');
  assert.equal(translate(undefined, 'defaut'), 'defaut');
});
