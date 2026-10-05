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
import { mergeItems, resetItems, planNextFetch, classifyIncoming, parsePaginatedSource } from './logic.mjs';

// Delai au-dela duquel on considere qu'un fetch demande n'aboutira pas, pour ne
// pas rester bloque indefiniment si la collection ne se met jamais a jour.
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

    // Offset demande par le composant, en attente de confirmation par un
    // changement de `content.items`. `null` = aucun fetch en cours.
    const pendingOffset = ref(null);
    const isExhausted = ref(false);
    let fetchTimeout = null;
    let observer = null;
    let scrollTarget = null;

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

    /**
     * Resout l'identifiant de la collection a paginer, par ordre de fiabilite
     * decroissante :
     *   1. la propriete `PaginatedSource` si elle est renseignee ;
     *   2. l'auto-detection : on cherche la collection dont `data` est la meme
     *      reference de tableau que celle bindee sur `items`.
     * Si les deux echouent, seul l'evenement `loadMore` est emis et la pagination
     * doit etre pilotee par un workflow.
     */
    const resolveCollectionId = () => {
      const explicit = parsePaginatedSource(props.content.paginatedSource);
      if (explicit) return explicit;

      try {
        const collections = wwLib.$store?.getters?.['data/getCollections'];
        if (!collections) return null;
        const target = props.content.items;
        if (!Array.isArray(target)) return null;

        for (const collection of Object.values(collections)) {
          if (collection && collection.data === target) return collection.id;
        }
      } catch (error) {
        wwLib.wwLog?.error?.('[infinite-collection] auto-detection de la collection impossible', error);
      }

      return null;
    };

    const readPagination = collectionId => {
      if (!collectionId) return null;
      try {
        return wwLib.wwCollection?.getPaginationOptions?.(collectionId) || null;
      } catch (error) {
        wwLib.wwLog?.error?.('[infinite-collection] lecture de la pagination impossible', error);
        return null;
      }
    };

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

    const onScroll = () => {
      if (isSentinelNear()) loadMore();
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

    const releaseLock = () => {
      pendingOffset.value = null;
      clearFetchTimeout();
    };

    const loadMore = () => {
      if (isEditing.value) return;
      if (pendingOffset.value !== null) return;
      if (isExhausted.value) return;

      const collectionId = resolveCollectionId();
      const pagination = readPagination(collectionId);

      // Sans acces a la pagination, on delegue au workflow via `loadMore`.
      if (!pagination) {
        emit('trigger-event', {
          name: 'loadMore',
          event: { offset: null, limit: null, total: null, page: null },
        });
        return;
      }

      const plan = planNextFetch({
        limit: pagination.limit,
        offset: pagination.offset,
        total: pagination.total,
        loadedCount: accumulator.value.length,
      });

      if (plan.action === 'error') {
        isExhausted.value = true;
        emit('trigger-event', { name: 'error', event: { message: plan.message } });
        return;
      }

      if (plan.action === 'end') {
        isExhausted.value = true;
        emit('trigger-event', {
          name: 'reachEnd',
          event: { total: plan.total, loaded: accumulator.value.length },
        });
        return;
      }

      pendingOffset.value = plan.offset;
      clearFetchTimeout();
      fetchTimeout = setTimeout(() => {
        pendingOffset.value = null;
        fetchTimeout = null;
      }, FETCH_TIMEOUT_MS);

      try {
        wwLib.wwCollection.setOffset(collectionId, plan.offset);
      } catch (error) {
        releaseLock();
        emit('trigger-event', {
          name: 'error',
          event: { message: `Impossible de paginer la collection : ${error?.message || error}` },
        });
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

    watch(
      incomingItems,
      incoming => {
        const collectionId = resolveCollectionId();
        const pagination = readPagination(collectionId);
        const currentOffset = pagination?.offset ?? 0;

        const { mode, offset } = classifyIncoming({
          pendingOffset: pendingOffset.value,
          currentOffset,
        });

        if (mode === 'reset') {
          const result = resetItems({ incoming, offset, itemKey: itemKey.value });
          accumulator.value = result.items;
          keys.value = result.keys;
          isExhausted.value = false;
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

          // Une page demandee qui n'apporte aucun element nouveau signifie que la
          // collection est epuisee, meme si `total` annoncait davantage.
          if (result.added === 0) {
            isExhausted.value = true;
            emit('trigger-event', {
              name: 'reachEnd',
              event: { total: pagination?.total ?? null, loaded: accumulator.value.length },
            });
          }
        }

        releaseLock();

        // La liste vient de grandir : si la sentinelle reste visible (page trop
        // courte pour remplir la zone de scroll), on enchaine immediatement.
        nextTick(() => {
          if (isExhausted.value || pendingOffset.value !== null) return;
          if (isSentinelNear()) loadMore();
        });
      },
      { immediate: true }
    );

    // Un changement de cle invalide toutes les cles deja calculees.
    watch(itemKey, () => {
      const result = resetItems({
        incoming: incomingItems.value,
        offset: 0,
        itemKey: itemKey.value,
      });
      accumulator.value = result.items;
      keys.value = result.keys;
      isExhausted.value = false;
      releaseLock();
    });

    /**
     * Branche la detection de fin de liste.
     *
     * `IntersectionObserver` est la voie normale. Un ecouteur `scroll` est ajoute en
     * repli : il couvre les environnements sans IntersectionObserver et sert de
     * filet si l'observer est cree avant que la mise en page soit calculee.
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
     * differee, parent masque au montage). On retente donc jusqu'a ce que le
     * branchement reussisse, plutot que d'abandonner silencieusement.
     */
    const ensureObserver = (attempt = 0) => {
      if (createObserver()) return;
      if (attempt >= 10) {
        wwLib.wwLog?.error?.(
          '[infinite-collection] impossible de brancher la detection de scroll : la racine du composant est introuvable.'
        );
        return;
      }
      setTimeout(() => ensureObserver(attempt + 1), 50 * (attempt + 1));
    };

    watch(() => props.content.rootMargin, () => nextTick(() => ensureObserver()));

    onMounted(() => nextTick(() => ensureObserver()));

    onBeforeUnmount(() => {
      teardownWatchers();
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
  /* Le navigateur saute la mise en page et le rendu des elements hors ecran tout
     en les conservant dans le DOM : pas de recyclage, donc pas de rupture de
     z-index, de sticky ou de :nth-child. */
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
