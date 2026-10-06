/**
 * Detection du conteneur qui defile reellement.
 *
 * Dans WeWeb, le scroll peut appartenir au composant, a n'importe quel wrapper
 * ancetre, ou a la page. Les trois cas doivent fonctionner sans configuration.
 *
 * Module pur : toutes les dependances DOM sont injectees, donc testable sans
 * navigateur. Aucune reference a window, document ou wwLib.
 */

/** Valeurs de overflow-y qui creent un conteneur de defilement. */
export const SCROLLABLE_OVERFLOWS = ['auto', 'scroll', 'overlay'];

/**
 * Un element defile si son overflow l'autorise ET s'il a du contenu debordant.
 *
 * La tolerance de 1 px absorbe les arrondis sub-pixel des navigateurs : sans
 * elle, un element non scrollable peut paraitre scrollable sur un zoom non
 * entier.
 */
export function isScrollable(element, getStyle) {
  if (!element || typeof getStyle !== 'function') return false;

  const style = getStyle(element);
  if (!style || !SCROLLABLE_OVERFLOWS.includes(style.overflowY)) return false;

  const scrollHeight = Number(element.scrollHeight) || 0;
  const clientHeight = Number(element.clientHeight) || 0;
  return scrollHeight > clientHeight + 1;
}

/**
 * Remonte la chaine des parents et retourne le premier conteneur qui defile.
 *
 * Retourne null si aucun ancetre ne defile : l'appelant doit alors considerer
 * que le scroll appartient au viewport. On ne retourne pas directement le
 * viewport ici pour garder ce module independant de window.
 *
 * `stopAt` recoit les noeuds racine (body, documentElement) afin d'arreter la
 * remontee sans connaitre le document.
 */
export function findScrollParent(element, { getStyle, stopAt = [], maxDepth = 100 } = {}) {
  if (!element || typeof getStyle !== 'function') return null;

  const stopSet = new Set(stopAt.filter(Boolean));
  let current = element;
  let depth = 0;

  while (current && !stopSet.has(current) && depth < maxDepth) {
    if (isScrollable(current, getStyle)) return current;
    current = current.parentElement || null;
    depth += 1;
  }

  return null;
}

/**
 * Limite basse de la zone visible, en coordonnees viewport.
 *
 * C'est la frontiere a comparer au haut de la sentinelle. Avec un conteneur qui
 * defile, c'est le bas de sa boite ; sans conteneur, c'est le bas du viewport.
 */
export function bottomBoundary(scrollParent, viewportHeight) {
  if (!scrollParent || typeof scrollParent.getBoundingClientRect !== 'function') {
    return Number(viewportHeight) || 0;
  }
  return scrollParent.getBoundingClientRect().bottom;
}

/**
 * Distance entre le haut de la sentinelle et la limite basse.
 *
 * Negative ou nulle : la sentinelle a franchi la limite. Positive : il reste
 * cette distance a parcourir. `null` signifie mesure impossible, et doit etre
 * traite comme "ne pas declencher" plutot que comme zero.
 */
export function distanceToBottom(sentinel, scrollParent, viewportHeight) {
  if (!sentinel || typeof sentinel.getBoundingClientRect !== 'function') return null;
  return sentinel.getBoundingClientRect().top - bottomBoundary(scrollParent, viewportHeight);
}

/**
 * Decrit un noeud pour le HUD.
 *
 * Sert uniquement au diagnostic visuel dans le Studio : savoir quel conteneur a
 * ete retenu est la premiere information utile quand rien ne se declenche.
 */
export function describeNode(element, { isViewport = false } = {}) {
  if (isViewport || !element) return 'viewport';

  const tag = (element.tagName || 'node').toLowerCase();
  const rawClass = typeof element.className === 'string' ? element.className : '';
  const classes = rawClass.trim().split(/\s+/).filter(Boolean).slice(0, 3);
  const suffix = classes.length ? `.${classes.join('.')}` : '';
  return `${tag}${suffix}`;
}
