/**
 * Detection de l'approche du bas de liste.
 *
 * Strategie retenue apres mesure dans le Studio (repo de R&D MatthieuArzelPwC/
 * test-scroll) : `IntersectionObserver`, valide sur les trois montages WeWeb
 * possibles et sur le cas de la liste trop courte pour defiler.
 *
 *   le composant defile lui-meme      declenche, 3 echantillons
 *   un wrapper WeWeb defile           declenche, conteneur correctement identifie
 *   la page defile                    declenche
 *   liste trop courte pour defiler    declenche spontanement
 *
 * Trois echantillons par parcours, contre plusieurs dizaines par seconde pour une
 * ecoute du scroll en capture sur document. C'est ce qui a motive le choix.
 *
 * Point critique, et raison probable de l'abandon de cette API dans la version
 * precedente : le `root` d'un IntersectionObserver est fige a la souscription. Or
 * la liste demarre vide, donc aucun conteneur n'est encore scrollable, donc
 * l'observateur se calerait definitivement sur le viewport et le seuil ne
 * signifierait plus rien. L'observateur est donc reconstruit des que le conteneur
 * qui defile change d'identite.
 *
 * Ne connait ni la collection, ni l'offset, ni le total. Recoit un rappel, et
 * c'est tout.
 */

import { findScrollParent, distanceToBottom, describeNode } from './scrollParent.mjs';

const hasDom = () => typeof window !== 'undefined' && typeof document !== 'undefined';

/** Resout le conteneur qui defile reellement autour de `root`. */
function resolveScrollParent(root) {
  if (!hasDom() || !root) return null;
  return findScrollParent(root, {
    getStyle: element => window.getComputedStyle(element),
    stopAt: [document.body, document.documentElement],
  });
}

/**
 * Surveille la sentinelle et appelle `onReach` quand elle approche du bas.
 *
 * `enabled` est relu a chaque evaluation plutot que capture : le mode de
 * chargement peut changer sans remonter le capteur.
 *
 * Retourne une fonction d'arret, plus `refresh()` a appeler quand le contenu a
 * change de hauteur.
 */
export function createBottomSensor({ root, sentinel, margin = 300, hysteresis = 80, enabled, onReach, onDebug }) {
  const threshold = Math.max(0, Number(margin) || 0);
  const slack = Math.max(0, Number(hysteresis) || 0);
  const isEnabled = () => (typeof enabled === 'function' ? !!enabled() : enabled !== false);

  let observer = null;
  let observedParent = null;
  let frame = null;
  let armed = true;
  let stopped = false;

  const measure = parent => distanceToBottom(sentinel, parent, hasDom() ? window.innerHeight : 0);

  /**
   * Verrou avec hysteresis.
   *
   * Sans verrou, sejourner en bas de la liste declenche a chaque evenement. Sans
   * hysteresis, osciller d'un pixel autour du seuil declenche en rafale. Le
   * verrou ne se rouvre donc qu'apres une remontee franche.
   */
  const evaluate = parent => {
    const distance = measure(parent);
    if (distance === null) return;

    if (distance <= threshold) {
      if (!armed) return;
      armed = false;
      onDebug?.({ event: 'reach', distance: Math.round(distance) });
      onReach?.(Math.round(distance));
      return;
    }

    if (!armed && distance > threshold + slack) armed = true;
  };

  const build = () => {
    if (stopped || !hasDom() || !sentinel) return;

    const parent = resolveScrollParent(root);

    // Ne reconstruire que si le conteneur a reellement change : une
    // reconstruction systematique relancerait une observation initiale a chaque
    // evaluation.
    if (observer && parent === observedParent) {
      evaluate(parent);
      return;
    }

    if (observer) observer.disconnect();
    observedParent = parent;

    onDebug?.({
      event: 'observe',
      container: describeNode(parent, { isViewport: !parent }),
    });

    observer = new window.IntersectionObserver(
      entries => {
        if (stopped || !isEnabled()) return;
        // `isIntersecting` est ignore volontairement : le verrou raisonne en
        // distance, ce qui rend la decision independante du seuil de l'API.
        for (let index = 0; index < entries.length; index += 1) {
          void entries[index];
        }
        // Le conteneur peut etre devenu scrollable depuis la souscription :
        // l'observateur se reconstruit alors sur la bonne racine.
        if (resolveScrollParent(root) !== observedParent) {
          build();
          return;
        }
        evaluate(observedParent);
      },
      {
        root: parent || null,
        rootMargin: `0px 0px ${Math.round(threshold)}px 0px`,
        threshold: 0,
      }
    );

    observer.observe(sentinel);

    // Un IntersectionObserver livre toujours une observation initiale, mais le
    // chargement d'une liste trop courte pour defiler en depend entierement. Une
    // evaluation explicite rend ce cas independant de cette garantie ; le verrou
    // absorbe le doublon lorsque les deux surviennent.
    evaluate(observedParent);
  };

  /**
   * Replanifie une evaluation.
   *
   * Appele apres l'arrivee de donnees : une liste qui reste plus courte que la
   * zone visible ne produira aucun evenement, et le chargement doit pourtant
   * s'enchainer jusqu'a remplir l'ecran.
   */
  const refresh = () => {
    if (stopped || !hasDom() || frame !== null) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      if (stopped || !isEnabled()) return;
      build();
    });
  };

  const stop = () => {
    stopped = true;
    if (observer) observer.disconnect();
    observer = null;
    observedParent = null;
    if (hasDom() && frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    if (hasDom()) window.removeEventListener('resize', refresh);
  };

  if (hasDom() && sentinel && typeof window.IntersectionObserver === 'function') {
    window.addEventListener('resize', refresh, { passive: true });
    refresh();
  }

  return {
    refresh,
    stop,
    /** Rouvre le verrou : utilise lorsque la source change. */
    rearm() {
      armed = true;
    },
  };
}
