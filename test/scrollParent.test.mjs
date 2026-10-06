import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SCROLLABLE_OVERFLOWS,
  isScrollable,
  findScrollParent,
  bottomBoundary,
  distanceToBottom,
  describeNode,
} from '../src/scrollParent.mjs';

function node({
  tag = 'div',
  overflowY = 'visible',
  scrollHeight = 100,
  clientHeight = 100,
  top = 0,
  bottom = 100,
  className = '',
  parent = null,
} = {}) {
  return {
    tagName: tag.toUpperCase(),
    className,
    scrollHeight,
    clientHeight,
    parentElement: parent,
    __overflowY: overflowY,
    getBoundingClientRect: () => ({ top, bottom }),
  };
}

const getStyle = element => ({ overflowY: element.__overflowY });

test('un overflow scrollable sans debordement ne defile pas', () => {
  assert.equal(isScrollable(node({ overflowY: 'auto', scrollHeight: 100, clientHeight: 100 }), getStyle), false);
});

test('un debordement sans overflow scrollable ne defile pas', () => {
  assert.equal(isScrollable(node({ overflowY: 'visible', scrollHeight: 500, clientHeight: 100 }), getStyle), false);
});

test('overflow scrollable et debordement reel defilent', () => {
  for (const overflowY of SCROLLABLE_OVERFLOWS) {
    assert.equal(isScrollable(node({ overflowY, scrollHeight: 500, clientHeight: 100 }), getStyle), true, overflowY);
  }
});

test('un debordement de un pixel est absorbe par la tolerance sub-pixel', () => {
  assert.equal(isScrollable(node({ overflowY: 'auto', scrollHeight: 101, clientHeight: 100 }), getStyle), false);
  assert.equal(isScrollable(node({ overflowY: 'auto', scrollHeight: 102, clientHeight: 100 }), getStyle), true);
});

test('findScrollParent retient le conteneur scrollable le plus proche', () => {
  const outer = node({ tag: 'section', overflowY: 'scroll', scrollHeight: 900, clientHeight: 300 });
  const middle = node({ overflowY: 'auto', scrollHeight: 600, clientHeight: 200, parent: outer });
  const inner = node({ overflowY: 'visible', parent: middle });

  assert.equal(findScrollParent(inner, { getStyle }), middle);
});

test('findScrollParent retourne le composant quand c est lui qui defile', () => {
  const root = node({ overflowY: 'auto', scrollHeight: 800, clientHeight: 400 });
  assert.equal(findScrollParent(root, { getStyle }), root);
});

test('findScrollParent retourne null quand le scroll appartient a la page', () => {
  const body = node({ tag: 'body' });
  const wrapper = node({ overflowY: 'visible', parent: body });
  const root = node({ overflowY: 'hidden', parent: wrapper });

  assert.equal(findScrollParent(root, { getStyle, stopAt: [body] }), null);
});

test('une liste encore vide ne designe aucun conteneur scrollable', () => {
  // Cas du montage : sans donnees, aucun debordement, donc le capteur doit se
  // rabattre sur le viewport puis se reconstruire a l arrivee des lignes.
  const wrapper = node({ overflowY: 'auto', scrollHeight: 400, clientHeight: 400 });
  const root = node({ overflowY: 'visible', parent: wrapper });

  assert.equal(findScrollParent(root, { getStyle }), null);

  // Les lignes arrivent : le meme wrapper devient scrollable.
  wrapper.scrollHeight = 2000;
  assert.equal(findScrollParent(root, { getStyle }), wrapper);
});

test('findScrollParent resiste a une chaine de parents circulaire', () => {
  const a = node({ overflowY: 'visible' });
  const b = node({ overflowY: 'visible', parent: a });
  a.parentElement = b;

  assert.equal(findScrollParent(b, { getStyle, maxDepth: 10 }), null);
});

test('bottomBoundary suit le conteneur quand il existe, le viewport sinon', () => {
  assert.equal(bottomBoundary(node({ bottom: 640 }), 900), 640);
  assert.equal(bottomBoundary(null, 900), 900);
});

test('distanceToBottom est positive avant le seuil et negative apres', () => {
  const container = node({ bottom: 600 });
  assert.equal(distanceToBottom(node({ top: 1200 }), container, 900), 600);
  assert.equal(distanceToBottom(node({ top: 450 }), container, 900), -150);
});

test('distanceToBottom signale une mesure impossible au lieu de retourner zero', () => {
  assert.equal(distanceToBottom(null, node({ bottom: 600 }), 900), null);
});

test('describeNode produit une etiquette lisible', () => {
  assert.equal(describeNode(node({ tag: 'section', className: 'ww-flexbox list' })), 'section.ww-flexbox.list');
  assert.equal(describeNode(node({ tag: 'div', className: '   ' })), 'div');
  assert.equal(describeNode(null), 'viewport');
  assert.equal(describeNode(node({ tag: 'div' }), { isViewport: true }), 'viewport');
});
