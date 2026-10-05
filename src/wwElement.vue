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
  parsePaginatedSource,
  canLoad,
  transition,
} from './logic.mjs';

// Delai au-dela duquel une page demandee est consideree comme en retard. Le verrou
// n'est PAS libere : une reponse tardive doit encore pouvoir etre integree, sans quoi
// elle serait prise pour un changement de filtre et effacerait les pages accumulees.
const FETCH_TIMEOUT_MS = 10000;

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

    // Offset de la page demandee, en attente de confirmation par un changement de
    // `content.items`. `null` = aucune page en vol.
    const pendingOffset = ref(null);
    const state = ref(STATES.IDLE);

    let fetchTimeout = null;
    let observer = null;
    let scrollTarget = null;
    let observerRetryTimer = null;

    const isEditing = computed(() => {
      /* wwEditor:start */
      return props.wwEditorState.editMode === wwLib.wwEditorHelper.EDIT_MODES.EDITION;
      /* wwEditor:end */
      // eslint-disable-next-line no-unreachable
      return false;
    });

    const itemKey = computed(() => {
      const raw = props.content.itemKey;
      return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
    });

    const incomingItems = computed(() => {
      const raw = props.content.items;
      if (Array.isArray(raw)) return raw;
      // Une collection non encore fetchee peut arriver sous forme d'objet { data: [...] }.
      if (raw && Array.isArray(raw.data)) return raw.data;
      return [];
    });

    const entries = computed(() =>
      accumulator.value.map((entry, index) => ({
        key: entry.key,
        data: entry.data,
        index,
      }))
    );

    const itemStyle = computed(() => {
      const height = Number(props.content.estimatedItemHeight);
      const safeHeight = Number.isFinite(height) && height > 0 ? height : 80;
      return { '--ic-item-height': `${safeHeight}px` };
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

    /**
     * Resout l'identifiant de la collection a paginer :
     *   1. propriete `Source paginee` ;
     *   2. auto-detection, en cherchant la collection dont `data` est la meme
     *      reference de tableau que celle bindee sur `Collection`.
     *
     * Retourne un resultat structure : une panne doit etre identifiable, pas
     * silencieusement convertie en absence de donnee.
     */
    const resolveCollection = () => {
      const raw = props.content.paginatedSource;
      if (typeof raw === 'string' && raw.length) {
        const id = parsePaginatedSource(raw);
        if (id) return { ok: true, id };
        return describeError(ERROR_CODES.NO_SOURCE, `source=${raw}`);
      }

      try {
        const collections = wwLib.$store?.getters?.['data/getCollections'];
        const target = props.content.items;
        if (collections && Array.isArray(target)) {
          for (const collection of Object.values(collections)) {
            if (collection && collection.data === target) return { ok: true, id: collection.id };
          }
        }
      } catch (error) {
        return describeError(ERROR_CODES.NO_SOURCE, error?.message || String(error));
      }

      return describeError(ERROR_CODES.NO_SOURCE);
    };

    const readPagination = collectionId => {
      const api = wwLib.wwCollection;
      if (!api || typeof api.getPaginationOptions !== 'function' || typeof api.setOffset !== 'function') {
        return describeError(ERROR_CODES.API_UNAVAILABLE);
      }

      let raw;
      try {
        raw = api.getPaginationOptions(collectionId);
      } catch (error) {
        return describeError(ERROR_CODES.PAGINATION_READ_FAILED, error?.message || String(error));
      }

      return validatePagination(raw);
    };

    /** Metadonnees courantes, ou `null` si indisponibles. Ne leve pas d'erreur. */
    const currentPagination = () => {
      const source = resolveCollection();
      if (!source.ok) return null;
      const pagination = readPagination(source.id);
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

    const safeRootMargin = () => {
      const margin = Number(props.content.rootMargin);
      return Number.isFinite(margin) && margin >= 0 ? margin : 300;
    };

    /** Vrai quand la sentinelle est visible, ou proche de l'etre. */
    const isSentinelNear = () => {
      if (!sentinel.value || !root.value) return false;
      const sentinelRect = sentinel.value.getBoundingClientRect();
      const rootRect = root.value.getBoundingClientRect();
      return sentinelRect.top <= rootRect.bottom + safeRootMargin();
    };

    const loadMore = () => {
      if (isEditing.value) return;
      if (!canLoad(state.value)) return;

      const source = resolveCollection();
      if (!source.ok) {
        fail(source.code);
        return;
      }

      const pagination = readPagination(source.id);
      if (!pagination.ok) {
        fail(pagination.code);
        return;
      }

      const plan = planNextFetch(pagination);

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

      clearFetchTimeout();
      fetchTimeout = setTimeout(() => {
        fetchTimeout = null;
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
        wwLib.wwCollection.setOffset(source.id, plan.offset);
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

    /* -------------------------------------------------------------- *
     * Reception des pages
     * -------------------------------------------------------------- */

    const applyReset = (incoming, offset) => {
      const result = resetItems({ incoming, offset, itemKey: itemKey.value });
      accumulator.value = result.items;
      keys.value = result.keys;
      pendingOffset.value = null;
      clearFetchTimeout();
      // Un reset legitime doit pouvoir repartir, y compris depuis `failed`.
      state.value = STATES.IDLE;
    };

    watch(
      incomingItems,
      incoming => {
        const pagination = currentPagination();
        const currentOffset = pagination ? pagination.offset : 0;

        const { mode, offset } = classifyIncoming({
          pendingOffset: pendingOffset.value,
          currentOffset,
        });

        // Une page attendue dont l'offset ne correspond pas encore : l'integrer
        // melangerait deux paginations.
        if (mode === 'ignore') return;

        if (mode === 'reset') {
          applyReset(incoming, offset);
        } else {
          const result = mergeItems({
            current: accumulator.value,
            keys: keys.value,
            incoming,
            offset,
            itemKey: itemKey.value,
          });
          accumulator.value = result.items;
          keys.value = result.keys;

          // La page attendue est arrivee : le verrou se libere, meme si le delai
          // avait expire entre-temps.
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
        }

        // La liste vient de grandir : si la sentinelle reste visible (page trop
        // courte pour remplir la zone de scroll), on enchaine immediatement.
        nextTick(() => {
          if (!canLoad(state.value)) return;
          if (isSentinelNear()) loadMore();
        });
      },
      { immediate: true }
    );

    // Un changement de cle invalide toutes les cles deja calculees.
    watch(itemKey, () => {
      applyReset(incomingItems.value, 0);
    });

    // Changer de source est un reset legitime : l'etat d'erreur de l'ancienne source
    // ne doit pas bloquer la nouvelle.
    watch(
      () => props.content.paginatedSource,
      () => {
        applyReset(incomingItems.value, 0);
      }
    );

    /* -------------------------------------------------------------- *
     * Detection de fin de liste
     * -------------------------------------------------------------- */

    const onScroll = () => {
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
      if (scrollTarget) {
        scrollTarget.removeEventListener('scroll', onScroll);
        scrollTarget = null;
      }
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

      if (typeof IntersectionObserver !== 'undefined') {
        observer = new IntersectionObserver(
          intersections => {
            if (intersections.some(intersection => intersection.isIntersecting)) loadMore();
          },
          {
            root: root.value,
            rootMargin: `0px 0px ${safeRootMargin()}px 0px`,
            threshold: 0,
          }
        );
        observer.observe(sentinel.value);
      }

      scrollTarget = root.value;
      scrollTarget.addEventListener('scroll', onScroll, { passive: true });

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
        wwLib.wwLog?.error?.(
          '[infinite-collection] impossible de brancher la detection de scroll : la racine du composant est introuvable.'
        );
        return;
      }
      observerRetryTimer = setTimeout(() => {
        observerRetryTimer = null;
        ensureObserver(attempt + 1);
      }, 50 * (attempt + 1));
    };

    watch(() => props.content.rootMargin, () => nextTick(() => ensureObserver()));

    onMounted(() => nextTick(() => ensureObserver()));

    onBeforeUnmount(() => {
      teardownWatchers();
      clearObserverRetry();
      clearFetchTimeout();
    });

    return {
      root,
      sentinel,
      entries,
      itemStyle,
      isEditing,
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
