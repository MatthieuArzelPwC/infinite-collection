<template>
  <div ref="root" class="ic">
    <div
      v-for="entry in entries"
      :key="entry.key"
      class="ic__item"
      :style="itemStyle"
    >
      <wwLayoutItemContext is-repeat :index="entry.index" :data="entry.data">
        <wwElement v-bind="content.itemElement" :local-data="entry.data" />
      </wwLayoutItemContext>
    </div>

    <!-- wwEditor:start -->
    <div v-if="!entries.length" class="ic__placeholder">
      <wwElement v-bind="content.itemElement" />
    </div>
    <!-- wwEditor:end -->

    <button
      v-if="showManualTrigger"
      type="button"
      class="ic__more"
      :disabled="isBusy"
      @click="onManualLoad"
    >
      {{ isBusy ? busyLabel : manualLabel }}
    </button>

    <div ref="sentinel" class="ic__sentinel" aria-hidden="true"></div>
  </div>
</template>

<script>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import {
  STATES,
  ERROR_CODES,
  describeError,
  mergeItems,
  resetItems,
  validatePagination,
  planNextFetch,
  classifyIncoming,
  classifyPage,
  assessCollection,
  resolveItemHeight,
  resolveTriggerDistance,
  canLoad,
  transition,
} from './logic.mjs';

// Delai au-dela duquel une page demandee est consideree comme en retard. Le verrou
// n'est PAS libere : une reponse tardive doit encore pouvoir etre integree, sans quoi
// elle serait prise pour un changement de filtre et effacerait les pages accumulees.
const FETCH_TIMEOUT_MS = 10000;

// Une collection peut n'apparaitre dans le store qu'apres le montage du composant.
// On patiente avant de conclure qu'un identifiant est obsolete.
const COLLECTION_LOOKUP_GRACE_MS = 3000;

// Hauteur de reserve avant toute mesure reelle. Sert uniquement au premier rendu.
const DEFAULT_ITEM_HEIGHT = 80;

const PREFIX = '[infinite-collection]';

/**
 * Journalisation directe via `console`.
 *
 * `wwLib.wwLog` n'existe dans aucun composant officiel WeWeb : l'appeler en optionnel
 * (`wwLib.wwLog?.error?.()`) avalait silencieusement toutes les traces, y compris celles
 * destinees au diagnostic.
 */
const log = (...args) => console.info(PREFIX, ...args);
const logError = (...args) => console.error(PREFIX, ...args);

export default {
  props: {
    content: { type: Object, required: true },
    uid: { type: String, required: true },
    wwElementState: { type: Object, required: true },
    /* wwEditor:start */
    wwEditorState: { type: Object, required: true },
    /* wwEditor:end */
  },
  emits: ['trigger-event'],
  setup(props, { emit }) {
    const root = ref(null);
    const sentinel = ref(null);

    const accumulator = ref([]);
    const keys = ref(new Set());

    // Offset de la page demandee, en attente de confirmation par un changement des
    // donnees de la collection. `null` = aucune page en vol.
    const pendingOffset = ref(null);
    const state = ref(STATES.INITIALIZING);

    // Incrementee a chaque changement de collection : un callback asynchrone de
    // l'ancienne source ne doit pas modifier l'etat de la nouvelle.
    const sourceGeneration = ref(0);

    let fetchTimeout = null;
    let observer = null;
    let resizeObserver = null;
    let itemResizeObserver = null;
    // Element qui defile reellement : la racine du composant, un ancetre, ou la page.
    let scrollTarget = null;
    let scrollListenerTarget = null;
    let observerRetryTimer = null;
    // Instant du premier constat d'absence de la collection dans le store.
    let missingSince = null;
    let lookupTimer = null;

    /* -------------------------------------------------------------- *
     * Proprietes derivees
     * -------------------------------------------------------------- */

    const collectionId = computed(() => {
      const raw = props.content.collectionId;
      return typeof raw === 'string' && raw.length ? raw : null;
    });

    const isManual = computed(() => !!props.content.manualLoad);

    const manualLabel = computed(() => {
      const raw = props.content.manualLoadLabel;
      const resolved = typeof raw === 'object' && raw !== null ? wwLib.wwLang.getText(raw) : raw;
      return typeof resolved === 'string' && resolved.trim() ? resolved : 'Charger la suite';
    });

    const busyLabel = computed(() => '...');

    const isBusy = computed(() => state.value === STATES.LOADING);

    /**
     * Acces unique au store WeWeb.
     *
     * `data/getCollections` est une API interne, non documentee comme stable : tout le
     * composant passe par ici pour qu'un changement de contrat n'ait qu'un seul point
     * d'impact.
     */
    const selectedCollection = computed(() => {
      const id = collectionId.value;
      if (!id) return null;
      try {
        return wwLib.$store?.getters?.['data/getCollections']?.[id] ?? null;
      } catch (error) {
        logError('lecture du store impossible', error);
        return null;
      }
    });

    const collectionStatus = computed(() => assessCollection(selectedCollection.value));

    const incomingItems = computed(() => {
      const assessment = collectionStatus.value;
      return assessment.status === 'ready' ? assessment.data : [];
    });

    const entries = computed(() =>
      accumulator.value.map((entry, index) => ({
        key: entry.key,
        data: entry.data,
        index,
      }))
    );

    // Hauteur reelle d'un element, mesuree apres le premier rendu. Evite de demander
    // a l'utilisateur une estimation qu'il ne peut que deviner.
    const measuredItemHeight = ref(null);

    const itemHeight = computed(() =>
      resolveItemHeight({ measured: measuredItemHeight.value, fallback: DEFAULT_ITEM_HEIGHT })
    );

    const itemStyle = computed(() => ({ '--ic-item-height': `${itemHeight.value}px` }));

    const preloadScreens = computed(() => {
      const raw = Number(props.content.preloadScreens);
      return Number.isFinite(raw) && raw > 0 ? raw : 1;
    });

    /**
     * Visibilite du declencheur manuel.
     *
     * Regle : visible PAR DEFAUT, masque uniquement sur preuve que la collection est
     * entierement chargee.
     *
     * Les versions precedentes conditionnaient l'affichage a des metadonnees valides et
     * a un etat interne precis. Resultat : la moindre anomalie (total absent, limite
     * nulle, refetch en cours) faisait disparaitre le bouton, privant l'utilisateur du
     * seul moyen de progresser et de declencher un message d'erreur. Un controle ne doit
     * pas dependre d'un diagnostic qui peut echouer.
     */
    const showManualTrigger = computed(() => {
      if (!isManual.value) return false;

      // Seule preuve acceptable de fin : la collection a ete entierement parcourue.
      // On s'appuie sur l'etat, qui est reactif, et non sur une lecture directe des
      // metadonnees : `getPaginationOptions()` est un appel de fonction hors du systeme
      // reactif de Vue, dont le resultat serait mis en cache au premier rendu — donc
      // avant que la collection soit chargee — et jamais reevalue.
      return state.value !== STATES.ENDED;
    });

    /* -------------------------------------------------------------- *
     * Etat et erreurs
     * -------------------------------------------------------------- */

    const goTo = next => {
      const result = transition(state.value, next);
      if (result.changed) state.value = result.state;
      return result.changed;
    };

    /**
     * Emet une erreur et bloque les chargements suivants.
     *
     * Les elements deja accumules sont conserves : une panne de pagination ne doit
     * pas faire disparaitre ce que l'utilisateur voit.
     */
    const fail = (code, details) => {
      const error = describeError(code, details);
      if (!goTo(STATES.FAILED)) return;
      emit('trigger-event', { name: 'error', event: { code: error.code, message: error.message } });
    };

    const finish = total => {
      if (!goTo(STATES.ENDED)) return;
      emit('trigger-event', {
        name: 'reachEnd',
        event: { total: total ?? null, loaded: accumulator.value.length },
      });
    };

    /* -------------------------------------------------------------- *
     * Acces a la pagination WeWeb
     * -------------------------------------------------------------- */

    const readPagination = () => {
      const id = collectionId.value;
      if (!id) return describeError(ERROR_CODES.NO_COLLECTION_SELECTED);

      const api = wwLib.wwCollection;
      if (!api || typeof api.getPaginationOptions !== 'function' || typeof api.setOffset !== 'function') {
        return describeError(ERROR_CODES.API_UNAVAILABLE);
      }

      let raw;
      try {
        raw = api.getPaginationOptions(id);
      } catch (error) {
        return describeError(ERROR_CODES.PAGINATION_READ_FAILED, error?.message || String(error));
      }

      return validatePagination(raw);
    };

    /** Metadonnees courantes, ou `null` si indisponibles. N'emet pas d'erreur. */
    const currentPagination = () => {
      const pagination = readPagination();
      return pagination.ok ? pagination : null;
    };

    /* -------------------------------------------------------------- *
     * Chargement
     * -------------------------------------------------------------- */

    const clearFetchTimeout = () => {
      if (fetchTimeout === null) return;
      clearTimeout(fetchTimeout);
      fetchTimeout = null;
    };

    const clearLookupTimer = () => {
      if (lookupTimer === null) return;
      clearTimeout(lookupTimer);
      lookupTimer = null;
    };

    /**
     * Trouve l'element qui defile reellement.
     *
     * WeWeb applique la hauteur definie dans le studio a un wrapper parent, pas
     * toujours a la racine du composant. Si l'on observe la mauvaise racine,
     * l'IntersectionObserver ne se declenche jamais et le defilement reste sans effet.
     * On remonte donc jusqu'au premier ancetre qui defile vraiment.
     */
    const findScrollContainer = () => {
      const start = root.value;
      if (!start) return null;

      const isScrollable = element => {
        if (!element || element === document.body || element === document.documentElement) return false;
        const style = window.getComputedStyle(element);
        const overflowY = style.overflowY;
        if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') return false;
        return element.scrollHeight > element.clientHeight + 1;
      };

      if (isScrollable(start)) return start;

      let node = start.parentElement;
      let depth = 0;
      while (node && depth < 10) {
        if (isScrollable(node)) return node;
        node = node.parentElement;
        depth += 1;
      }

      // Aucun ancetre ne defile : la page entiere fait office de conteneur.
      return null;
    };

    /** Hauteur visible du conteneur de defilement. */
    const viewportHeight = () => {
      const container = scrollTarget || findScrollContainer();
      if (container) return container.clientHeight;
      if (root.value) {
        const height = root.value.clientHeight;
        if (height > 0) return height;
      }
      return typeof window !== 'undefined' ? window.innerHeight : 0;
    };

    /** Distance de declenchement, derivee de la hauteur visible. */
    const triggerDistance = () =>
      resolveTriggerDistance({
        viewportHeight: viewportHeight(),
        itemHeight: itemHeight.value,
        screens: preloadScreens.value,
      });

    /** Vrai quand la sentinelle est visible, ou proche de l'etre. */
    const isSentinelNear = () => {
      if (!sentinel.value) return false;
      const sentinelRect = sentinel.value.getBoundingClientRect();
      const container = scrollTarget || findScrollContainer();
      const bottom = container
        ? container.getBoundingClientRect().bottom
        : typeof window !== 'undefined'
          ? window.innerHeight
          : 0;
      return sentinelRect.top <= bottom + triggerDistance();
    };

    const loadMore = () => {
      if (!canLoad(state.value)) return;

      const id = collectionId.value;
      if (!id) {
        fail(ERROR_CODES.NO_COLLECTION_SELECTED);
        return;
      }

      const pagination = readPagination();
      if (!pagination.ok) {
        fail(pagination.code);
        return;
      }

      const plan = planNextFetch(pagination);

      // Trace de diagnostic : rend visible dans la console ce que WeWeb annonce et ce
      // que le composant decide, sans avoir a instrumenter le code.
      log(
        `limit=${pagination.limit} offset=${pagination.offset} total=${pagination.total}`,
        `affiches=${accumulator.value.length} -> ${plan.action}`,
        plan.offset !== undefined ? `offset=${plan.offset}` : ''
      );

      if (plan.action === 'error') {
        fail(plan.code);
        return;
      }

      if (plan.action === 'end') {
        finish(plan.total);
        return;
      }

      if (!goTo(STATES.LOADING)) return;
      pendingOffset.value = plan.offset;

      const generation = sourceGeneration.value;

      clearFetchTimeout();
      fetchTimeout = setTimeout(() => {
        fetchTimeout = null;
        // Un timeout de l'ancienne source ne doit pas affecter la nouvelle.
        if (generation !== sourceGeneration.value) return;
        // Le verrou et `pendingOffset` sont volontairement conserves : une reponse
        // tardive correspondant a cet offset doit encore pouvoir etre accumulee.
        if (state.value !== STATES.LOADING) return;
        if (!goTo(STATES.TIMED_OUT)) return;
        emit('trigger-event', {
          name: 'error',
          event: {
            code: ERROR_CODES.FETCH_TIMEOUT,
            message: describeError(ERROR_CODES.FETCH_TIMEOUT, `offset=${plan.offset}`).message,
          },
        });
      }, FETCH_TIMEOUT_MS);

      try {
        wwLib.wwCollection.setOffset(id, plan.offset);
      } catch (error) {
        clearFetchTimeout();
        pendingOffset.value = null;
        state.value = STATES.IDLE;
        fail(ERROR_CODES.SET_OFFSET_FAILED, error?.message || String(error));
        return;
      }

      emit('trigger-event', {
        name: 'loadMore',
        event: {
          offset: plan.offset,
          limit: plan.limit,
          total: plan.total,
          page: Math.floor(plan.offset / plan.limit) + 1,
        },
      });
    };

    /**
     * Chargement declenche par l'utilisateur.
     *
     * Un clic explicite doit TOUJOURS produire un effet : soit une requete, soit une
     * erreur exploitable. Un declencheur visible mais inerte est la pire des pannes,
     * puisqu'elle ne laisse aucune trace a diagnostiquer.
     *
     * Les etats transitoires sont donc forces : `initializing` signifie que la page
     * initiale n'a pas ete observee, et `loading`/`timedOut` qu'une requete precedente
     * n'a jamais ete confirmee. Dans les deux cas, l'utilisateur demande explicitement
     * a avancer : on relache le verrou plutot que de l'ignorer.
     */
    const onManualLoad = () => {
      if (state.value === STATES.LOADING || state.value === STATES.TIMED_OUT) {
        logError(
          `requete precedente non confirmee (offset=${pendingOffset.value}) : deverrouillage sur action utilisateur.`
        );
        pendingOffset.value = null;
        clearFetchTimeout();
        state.value = STATES.IDLE;
      }

      if (state.value === STATES.INITIALIZING) {
        state.value = STATES.IDLE;
      }

      if (!canLoad(state.value)) {
        // Seuls `ended` et `failed` arrivent ici, et le bouton est alors masque.
        logError(`chargement impossible dans l etat "${state.value}".`);
        return;
      }

      loadMore();
    };

    /** Enchaine si la liste ne remplit pas encore la zone de defilement. */
    const continueIfNeeded = () => {
      if (isManual.value) return;
      nextTick(() => {
        if (!canLoad(state.value)) return;
        if (isSentinelNear()) loadMore();
      });
    };

    /**
     * Mesure la hauteur reelle d'un element rendu.
     *
     * Remplace l'estimation saisie a la main : l'utilisateur ne peut que deviner, alors
     * que le navigateur connait la valeur exacte des qu'un element existe.
     */
    const measureItemHeight = () => {
      if (!root.value) return;
      const first = root.value.querySelector('.ic__item');
      if (!first) return;
      const height = first.getBoundingClientRect().height;
      if (!Number.isFinite(height) || height <= 0) return;
      // On ne reagit qu'aux variations significatives, pour eviter de recalculer la
      // reserve a chaque pixel.
      if (measuredItemHeight.value === null || Math.abs(measuredItemHeight.value - height) > 2) {
        measuredItemHeight.value = height;
      }
    };

    /** Observe le premier element pour suivre les variations de hauteur. */
    const observeItemHeight = () => {
      if (itemResizeObserver) {
        itemResizeObserver.disconnect();
        itemResizeObserver = null;
      }
      if (typeof ResizeObserver === 'undefined' || !root.value) return;
      const first = root.value.querySelector('.ic__item');
      if (!first) return;
      itemResizeObserver = new ResizeObserver(() => measureItemHeight());
      itemResizeObserver.observe(first);
    };

    /* -------------------------------------------------------------- *
     * Reception des pages
     * -------------------------------------------------------------- */

    const resetAll = (incoming, offset) => {
      const result = resetItems({ incoming, offset });
      accumulator.value = result.items;
      keys.value = result.keys;
      pendingOffset.value = null;
      clearFetchTimeout();
      // Un reset legitime doit pouvoir repartir, y compris depuis `failed`.
      state.value = STATES.IDLE;
    };

    watch(
      [incomingItems, collectionStatus],
      () => {
        const assessment = collectionStatus.value;

        // Aucune collection choisie : rien a faire, et surtout pas d'erreur tant que
        // l'utilisateur n'a pas fini de configurer le composant.
        if (!collectionId.value) {
          state.value = STATES.INITIALIZING;
          return;
        }

        // Tant que la page initiale n'est pas resolue, ne rien demander : interpreter
        // un `[]` de collection non fetchee comme une page vide ferait sauter la
        // page 0 en demandant immediatement l'offset suivant.
        if (assessment.status === 'loading') {
          if (state.value === STATES.LOADING || state.value === STATES.TIMED_OUT) return;
          state.value = STATES.INITIALIZING;
          return;
        }

        // Un identifiant renseigne mais absent du store signale une selection
        // obsolete (collection supprimee ou renommee), distincte d'un chargement.
        if (assessment.status === 'missing') {
          state.value = STATES.INITIALIZING;
          if (missingSince === null) missingSince = Date.now();

          if (Date.now() - missingSince >= COLLECTION_LOOKUP_GRACE_MS) {
            fail(ERROR_CODES.COLLECTION_NOT_FOUND, `id=${collectionId.value}`);
            return;
          }

          // Rien ne garantit une nouvelle notification du store : on reverifie nous
          // memes a l'expiration du delai de grace.
          if (lookupTimer === null) {
            const generation = sourceGeneration.value;
            lookupTimer = setTimeout(() => {
              lookupTimer = null;
              if (generation !== sourceGeneration.value) return;
              if (collectionStatus.value.status !== 'missing') return;
              fail(ERROR_CODES.COLLECTION_NOT_FOUND, `id=${collectionId.value}`);
            }, COLLECTION_LOOKUP_GRACE_MS);
          }
          return;
        }

        missingSince = null;
        clearLookupTimer();

        if (assessment.status === 'invalid') {
          fail(ERROR_CODES.COLLECTION_DATA_UNAVAILABLE);
          return;
        }

        if (assessment.status === 'error') {
          fail(
            ERROR_CODES.PAGINATION_READ_FAILED,
            assessment.error?.message || 'la collection est en erreur'
          );
          return;
        }

        const incoming = assessment.data;
        const pagination = currentPagination();
        const currentOffset = pagination ? pagination.offset : 0;

        const { mode, offset } = classifyIncoming({
          pendingOffset: pendingOffset.value,
          currentOffset,
        });

        if (mode === 'reset') {
          const reset = resetItems({ incoming, offset });
          accumulator.value = reset.items;
          keys.value = reset.keys;
          pendingOffset.value = null;
          clearFetchTimeout();
          state.value = STATES.IDLE;

          // Collection reellement vide : inutile de demander une page suivante.
          if (pagination && pagination.total === 0) {
            finish(0);
            return;
          }

          const verdict = classifyPage({
            incomingCount: incoming.length,
            added: reset.added,
            pagination,
          });
          if (verdict.outcome === 'end') {
            finish(pagination ? pagination.total : null);
            return;
          }
          if (verdict.outcome === 'error') {
            fail(verdict.code);
            return;
          }

          continueIfNeeded();
          return;
        }

        const result = mergeItems({
          current: accumulator.value,
          keys: keys.value,
          incoming,
          offset,
        });
        accumulator.value = result.items;
        keys.value = result.keys;

        // La page attendue est arrivee : le verrou se libere, meme si le delai avait
        // expire entre-temps.
        pendingOffset.value = null;
        clearFetchTimeout();
        if (state.value === STATES.LOADING || state.value === STATES.TIMED_OUT) {
          state.value = STATES.IDLE;
        }

        const verdict = classifyPage({
          incomingCount: incoming.length,
          added: result.added,
          pagination,
        });

        if (verdict.outcome === 'error') {
          fail(verdict.code);
          return;
        }
        if (verdict.outcome === 'end') {
          finish(pagination ? pagination.total : null);
          return;
        }

        continueIfNeeded();
      },
      { immediate: true, deep: false }
    );

    // La liste a change : mesurer la hauteur reelle d'un element et rebrancher la
    // detection de defilement si le conteneur vient d'apparaitre.
    watch(
      entries,
      () => {
        nextTick(() => {
          measureItemHeight();
          observeItemHeight();
          // Le conteneur de defilement n'existe parfois qu'une fois la liste assez
          // longue pour deborder : il faut alors rebrancher la detection.
          if (!isManual.value && !scrollTarget && findScrollContainer()) ensureObserver();
        });
      },
      { flush: 'post' }
    );

    // Changer de collection est un changement complet de source.
    watch(collectionId, () => {
      sourceGeneration.value += 1;
      clearFetchTimeout();
      clearLookupTimer();
      missingSince = null;
      accumulator.value = [];
      keys.value = new Set();
      pendingOffset.value = null;
      state.value = STATES.INITIALIZING;
    });

    /* -------------------------------------------------------------- *
     * Detection de fin de liste
     * -------------------------------------------------------------- */

    const onScroll = () => {
      if (isManual.value) return;
      if (isSentinelNear()) loadMore();
    };

    const clearObserverRetry = () => {
      if (observerRetryTimer === null) return;
      clearTimeout(observerRetryTimer);
      observerRetryTimer = null;
    };

    const teardownWatchers = () => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (scrollListenerTarget) {
        scrollListenerTarget.removeEventListener('scroll', onScroll);
        scrollListenerTarget = null;
      }
      scrollTarget = null;
    };

    /**
     * Branche la detection de fin de liste.
     *
     * `IntersectionObserver` est la voie normale. Un ecouteur `scroll` passif est
     * ajoute en repli : il couvre les environnements sans IntersectionObserver et
     * sert de filet si l'observer est cree avant que la mise en page soit calculee.
     */
    const createObserver = () => {
      teardownWatchers();
      if (!sentinel.value || !root.value) return false;
      if (isManual.value) return true;

      const container = findScrollContainer();
      scrollTarget = container;

      if (typeof IntersectionObserver !== 'undefined') {
        observer = new IntersectionObserver(
          intersections => {
            if (intersections.some(intersection => intersection.isIntersecting)) loadMore();
          },
          {
            // `root: null` observe par rapport a la fenetre : c'est le comportement
            // correct quand aucun ancetre ne defile.
            root: container,
            rootMargin: `0px 0px ${triggerDistance()}px 0px`,
            threshold: 0,
          }
        );
        observer.observe(sentinel.value);
      }

      // L'ecouteur de defilement doit etre pose sur l'element qui defile vraiment,
      // ou sur la fenetre a defaut.
      const scrollSource = container || (typeof window !== 'undefined' ? window : null);
      if (scrollSource) {
        scrollSource.addEventListener('scroll', onScroll, { passive: true });
        scrollListenerTarget = scrollSource;
      }

      // Une variation de hauteur du conteneur change la distance de declenchement.
      if (typeof ResizeObserver !== 'undefined' && container) {
        resizeObserver = new ResizeObserver(() => {
          if (!canLoad(state.value)) return;
          if (isSentinelNear()) loadMore();
        });
        resizeObserver.observe(container);
      }

      return true;
    };

    /**
     * Les refs peuvent ne pas etre disponibles au premier `nextTick` (hydratation
     * differee, parent masque au montage). On retente donc, plutot que d'abandonner
     * silencieusement et de ne jamais rien charger.
     */
    const ensureObserver = (attempt = 0) => {
      clearObserverRetry();
      if (createObserver()) return;
      if (attempt >= 10) {
        logError('impossible de brancher la detection de scroll : la racine du composant est introuvable.');
        return;
      }
      observerRetryTimer = setTimeout(() => {
        observerRetryTimer = null;
        ensureObserver(attempt + 1);
      }, 50 * (attempt + 1));
    };

    watch([preloadScreens, isManual], () => nextTick(() => ensureObserver()));

    onMounted(() => {
      // Trace d'amorcage : permet de voir immediatement si la collection est resolue,
      // ce que WeWeb annonce comme pagination, et si le declencheur sera visible.
      const pagination = currentPagination();
      log(
        `monte | collection=${collectionId.value || 'AUCUNE'}`,
        `| statut=${collectionStatus.value.status}`,
        `| pagination=${pagination ? `limit=${pagination.limit} offset=${pagination.offset} total=${pagination.total}` : 'INDISPONIBLE'}`,
        `| mode=${isManual.value ? 'manuel' : 'defilement'}`
      );

      nextTick(() => ensureObserver());
    });

    onBeforeUnmount(() => {
      teardownWatchers();
      if (itemResizeObserver) {
        itemResizeObserver.disconnect();
        itemResizeObserver = null;
      }
      clearObserverRetry();
      clearFetchTimeout();
      clearLookupTimer();
    });

    return {
      root,
      sentinel,
      entries,
      itemStyle,
      showManualTrigger,
      manualLabel,
      busyLabel,
      isBusy,
      onManualLoad,
    };
  },
};
</script>

<style scoped>
.ic {
  /* Pas de hauteur : elle est fixee dans le studio via les proprietes standard. */
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
}

.ic__item {
  /* Le navigateur saute la mise en page et le rendu des elements hors ecran tout en
     les conservant dans le DOM : pas de recyclage, donc pas de rupture de z-index,
     de sticky ou de :nth-child. */
  content-visibility: auto;
  contain-intrinsic-size: auto var(--ic-item-height, 80px);
}

.ic__more {
  display: block;
  width: 100%;
  padding: 12px;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  text-align: center;
  text-decoration: underline;
  cursor: pointer;
}

.ic__more:disabled {
  cursor: default;
  opacity: 0.6;
  text-decoration: none;
}

.ic__sentinel {
  /* Hauteur non nulle : un element de 0px n'est pas fiablement observe. */
  width: 100%;
  height: 1px;
  flex: 0 0 auto;
}

/* wwEditor:start */
.ic__placeholder {
  width: 100%;
}
/* wwEditor:end */
</style>
