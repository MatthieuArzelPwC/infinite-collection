import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBottomSensor } from '../src/bottomSensor.mjs';

/**
 * Faux DOM minimal.
 *
 * Permet de verifier le comportement du capteur sans navigateur, en particulier le
 * scenario qui a motive le correctif : la liste demarre vide, donc aucun conteneur
 * n'est scrollable au montage, et l'observateur doit se reconstruire sur la bonne
 * racine quand les donnees arrivent.
 */
function createEnvironment({ viewportHeight = 800 } = {}) {
  const observers = [];
  let frames = [];

  const makeNode = ({ tag = 'div', overflowY = 'visible', scrollHeight = 400, clientHeight = 400, top = 0, bottom = 400, parent = null } = {}) => ({
    tagName: tag.toUpperCase(),
    className: '',
    overflowY,
    scrollHeight,
    clientHeight,
    parentElement: parent,
    rect: { top, bottom },
    getBoundingClientRect() {
      return this.rect;
    },
  });

  const body = makeNode({ tag: 'body' });
  const documentElement = makeNode({ tag: 'html' });

  const previous = {
    window: globalThis.window,
    document: globalThis.document,
  };

  globalThis.window = {
    innerHeight: viewportHeight,
    getComputedStyle: element => ({ overflowY: element.overflowY }),
    IntersectionObserver: class {
      constructor(callback, options) {
        this.callback = callback;
        this.options = options;
        this.targets = [];
        this.disconnected = false;
        observers.push(this);
      }
      observe(target) {
        this.targets.push(target);
      }
      disconnect() {
        this.disconnected = true;
      }
      /** Simule une notification du navigateur. */
      fire() {
        this.callback([{ target: this.targets[0], isIntersecting: true }], this);
      }
    },
    requestAnimationFrame(callback) {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame() {},
    addEventListener() {},
    removeEventListener() {},
  };

  globalThis.document = { body, documentElement };

  return {
    makeNode,
    body,
    observers,
    /** Execute les rappels d'animation en attente. */
    flush() {
      const pending = frames;
      frames = [];
      for (const callback of pending) callback();
    },
    get active() {
      return observers.filter(observer => !observer.disconnected);
    },
    restore() {
      if (previous.window === undefined) delete globalThis.window;
      else globalThis.window = previous.window;
      if (previous.document === undefined) delete globalThis.document;
      else globalThis.document = previous.document;
    },
  };
}

test('le capteur declenche quand la sentinelle franchit le seuil', () => {
  const env = createEnvironment();
  try {
    const wrapper = env.makeNode({ overflowY: 'auto', scrollHeight: 2000, clientHeight: 400, bottom: 400, parent: env.body });
    const root = env.makeNode({ parent: wrapper });
    const sentinel = env.makeNode({ top: 1500, parent: root });

    const reached = [];
    const sensor = createBottomSensor({
      root,
      sentinel,
      margin: 300,
      enabled: () => true,
      onReach: distance => reached.push(distance),
    });

    env.flush();
    assert.deepEqual(reached, [], 'trop loin du bas pour declencher');

    sentinel.rect = { top: 650, bottom: 651 };
    env.active[0].fire();
    assert.deepEqual(reached, [250]);

    sensor.stop();
  } finally {
    env.restore();
  }
});

test('sejourner en bas ne declenche qu une fois', () => {
  const env = createEnvironment();
  try {
    const wrapper = env.makeNode({ overflowY: 'auto', scrollHeight: 2000, clientHeight: 400, bottom: 400, parent: env.body });
    const root = env.makeNode({ parent: wrapper });
    const sentinel = env.makeNode({ top: 500, parent: root });

    const reached = [];
    const sensor = createBottomSensor({ root, sentinel, margin: 300, enabled: () => true, onReach: d => reached.push(d) });
    env.flush();

    assert.equal(reached.length, 1);
    for (const top of [480, 450, 400, 350]) {
      sentinel.rect = { top, bottom: top + 1 };
      env.active[0].fire();
    }
    assert.equal(reached.length, 1, 'le verrou bloque les declenchements suivants');

    sensor.stop();
  } finally {
    env.restore();
  }
});

test('l hysteresis empeche la rafale autour du seuil', () => {
  const env = createEnvironment();
  try {
    const wrapper = env.makeNode({ overflowY: 'auto', scrollHeight: 2000, clientHeight: 400, bottom: 400, parent: env.body });
    const root = env.makeNode({ parent: wrapper });
    const sentinel = env.makeNode({ top: 690, parent: root });

    const reached = [];
    const sensor = createBottomSensor({
      root,
      sentinel,
      margin: 300,
      hysteresis: 80,
      enabled: () => true,
      onReach: d => reached.push(d),
    });
    env.flush();
    assert.equal(reached.length, 1);

    // Juste au-dela du seuil mais dans la zone morte : pas de rearmement.
    sentinel.rect = { top: 710, bottom: 711 };
    env.active[0].fire();
    sentinel.rect = { top: 695, bottom: 696 };
    env.active[0].fire();
    assert.equal(reached.length, 1);

    // Remontee franche puis nouvelle approche.
    sentinel.rect = { top: 800, bottom: 801 };
    env.active[0].fire();
    sentinel.rect = { top: 600, bottom: 601 };
    env.active[0].fire();
    assert.equal(reached.length, 2);

    sensor.stop();
  } finally {
    env.restore();
  }
});

test('une liste trop courte pour defiler declenche sans evenement de scroll', () => {
  const env = createEnvironment();
  try {
    // Aucun conteneur scrollable : la liste tient dans la zone visible.
    const root = env.makeNode({ parent: env.body });
    const sentinel = env.makeNode({ top: 120, parent: root });

    const reached = [];
    const sensor = createBottomSensor({ root, sentinel, margin: 300, enabled: () => true, onReach: d => reached.push(d) });

    env.flush();
    assert.equal(reached.length, 1, 'sans ce declenchement spontane, rien ne chargerait jamais');

    sensor.stop();
  } finally {
    env.restore();
  }
});

test('l observateur se reconstruit quand le conteneur devient scrollable', () => {
  const env = createEnvironment();
  try {
    // Montage sur une liste vide : le wrapper ne deborde pas encore, donc la
    // racine retenue est le viewport.
    const wrapper = env.makeNode({ overflowY: 'auto', scrollHeight: 400, clientHeight: 400, bottom: 400, parent: env.body });
    const root = env.makeNode({ parent: wrapper });
    const sentinel = env.makeNode({ top: 2000, parent: root });

    const sensor = createBottomSensor({ root, sentinel, margin: 300, enabled: () => true, onReach: () => {} });
    env.flush();

    assert.equal(env.active.length, 1);
    assert.equal(env.active[0].options.root, null, 'aucun conteneur scrollable au montage');

    // Les donnees arrivent : le wrapper deborde desormais.
    wrapper.scrollHeight = 3000;
    env.active[0].fire();

    const active = env.active;
    assert.equal(active.length, 1, 'l ancien observateur a ete detruit');
    assert.equal(active[0].options.root, wrapper, 'la racine suit le conteneur reel');

    sensor.stop();
  } finally {
    env.restore();
  }
});

test('un conteneur inchange ne provoque aucune reconstruction', () => {
  const env = createEnvironment();
  try {
    const wrapper = env.makeNode({ overflowY: 'auto', scrollHeight: 2000, clientHeight: 400, bottom: 400, parent: env.body });
    const root = env.makeNode({ parent: wrapper });
    const sentinel = env.makeNode({ top: 1500, parent: root });

    const sensor = createBottomSensor({ root, sentinel, margin: 300, enabled: () => true, onReach: () => {} });
    env.flush();
    const created = env.observers.length;

    for (let i = 0; i < 5; i += 1) env.active[0].fire();
    assert.equal(env.observers.length, created, 'aucun observateur superflu');

    sensor.stop();
  } finally {
    env.restore();
  }
});

test('un capteur desactive ne declenche pas', () => {
  const env = createEnvironment();
  try {
    const root = env.makeNode({ parent: env.body });
    const sentinel = env.makeNode({ top: 100, parent: root });

    const reached = [];
    const sensor = createBottomSensor({ root, sentinel, margin: 300, enabled: () => false, onReach: d => reached.push(d) });

    env.flush();
    assert.deepEqual(reached, []);

    sensor.stop();
  } finally {
    env.restore();
  }
});

test('l etat active est relu a chaque evaluation', () => {
  const env = createEnvironment();
  try {
    const wrapper = env.makeNode({ overflowY: 'auto', scrollHeight: 2000, clientHeight: 400, bottom: 400, parent: env.body });
    const root = env.makeNode({ parent: wrapper });
    const sentinel = env.makeNode({ top: 1500, parent: root });

    let active = false;
    const reached = [];
    const sensor = createBottomSensor({
      root,
      sentinel,
      margin: 300,
      enabled: () => active,
      onReach: d => reached.push(d),
    });
    env.flush();
    assert.deepEqual(reached, []);

    // La fin de collection peut etre atteinte puis invalidee par un changement de
    // source : le capteur ne doit pas rester inerte.
    active = true;
    sentinel.rect = { top: 500, bottom: 501 };
    sensor.refresh();
    env.flush();
    assert.equal(reached.length, 1);

    sensor.stop();
  } finally {
    env.restore();
  }
});

test('rearm rouvre le verrou apres un changement de source', () => {
  const env = createEnvironment();
  try {
    const root = env.makeNode({ parent: env.body });
    const sentinel = env.makeNode({ top: 100, parent: root });

    const reached = [];
    const sensor = createBottomSensor({ root, sentinel, margin: 300, enabled: () => true, onReach: d => reached.push(d) });
    env.flush();
    assert.equal(reached.length, 1);

    sensor.rearm();
    sensor.refresh();
    env.flush();
    assert.equal(reached.length, 2);

    sensor.stop();
  } finally {
    env.restore();
  }
});

test('stop neutralise toute notification ulterieure', () => {
  const env = createEnvironment();
  try {
    const wrapper = env.makeNode({ overflowY: 'auto', scrollHeight: 2000, clientHeight: 400, bottom: 400, parent: env.body });
    const root = env.makeNode({ parent: wrapper });
    const sentinel = env.makeNode({ top: 1500, parent: root });

    const reached = [];
    const sensor = createBottomSensor({ root, sentinel, margin: 300, enabled: () => true, onReach: d => reached.push(d) });
    env.flush();

    const observer = env.observers[env.observers.length - 1];
    sensor.stop();

    sentinel.rect = { top: 500, bottom: 501 };
    observer.fire();
    assert.deepEqual(reached, []);
    assert.equal(observer.disconnected, true);
  } finally {
    env.restore();
  }
});

test('le capteur reste inerte sans DOM', () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  delete globalThis.window;
  delete globalThis.document;

  try {
    const reached = [];
    const sensor = createBottomSensor({ root: null, sentinel: null, onReach: d => reached.push(d) });
    sensor.refresh();
    sensor.stop();
    assert.deepEqual(reached, []);
  } finally {
    if (previousWindow !== undefined) globalThis.window = previousWindow;
    if (previousDocument !== undefined) globalThis.document = previousDocument;
  }
});
