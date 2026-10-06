<template>
  <div ref="root" class="ic">
    <div v-for="entry in entries" :key="entry.key" class="ic__item">
      <wwLayoutItemContext is-repeat :index="entry.key" :data="entry.data">
        <wwElement v-bind="content.itemElement" :local-data="entry.data" />
      </wwLayoutItemContext>
    </div>

    <!-- wwEditor:start -->
    <div v-if="!entries.length" class="ic__placeholder">
      <wwElement v-bind="content.itemElement" />
    </div>
    <!-- wwEditor:end -->

    <button
      v-if="isManual"
      type="button"
      class="ic__more"
      :disabled="manualDisabled"
      @click="onManualLoad"
    >
      {{ manualButtonLabel }}
    </button>

    <div ref="sentinel" class="ic__sentinel" aria-hidden="true"></div>
  </div>
</template>

<script>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import {
  STATUS,
  ERROR_CODES,
  describeError,
  validatePagination,
  planNextFetch,
  applyPage,
  classifyPage,
} from './logic.mjs';

const FETCH_TIMEOUT_MS = 10000;
const OBSERVER_MARGIN = '300px';

export default {
  props: {
    content: { type: Object, required: true },
    uid: { type: String, required: true },
    /* wwEditor:start */
    wwEditorState: { type: Object, required: true },
    /* wwEditor:end */
  },
  emits: ['trigger-event'],
  setup(props, { emit }) {
    const root = ref(null);
    const sentinel = ref(null);
    const entries = ref([]);
    const status = ref(STATUS.INITIALIZING);
    const request = ref(null);
    const acceptedOffset = ref(null);

    let activeCollectionId = null;
    let generation = 0;
    let lastData = null;
    let fetchTimeout = null;
    let missingCollectionTimeout = null;
    let observer = null;

    const collectionId = computed(() => {
      const value = props.content.collectionId;
      return typeof value === 'string' && value ? value : null;
    });

    const isManual = computed(() => !!props.content.manualLoad);

    const selectedCollection = computed(() => {
      if (!collectionId.value) return null;
      try {
        return wwLib.$store?.getters?.['data/getCollections']?.[collectionId.value] ?? null;
      } catch (error) {
        console.error('[infinite-collection] lecture du store impossible', error);
        return null;
      }
    });

    const configuredLabel = computed(() => {
      const raw = props.content.manualLoadLabel;
      const value = raw && typeof raw === 'object' ? wwLib.wwLang.getText(raw) : raw;
      return typeof value === 'string' && value.trim() ? value : 'Charger la suite';
    });

    // Le bouton manuel est un outil de diagnostic : seule une requete deja en vol le
    // desactive. Une decision `ended` ne doit jamais empecher de tester setOffset().
    const manualDisabled = computed(() => !!request.value);
    const manualButtonLabel = computed(() => {
      if (request.value) return '...';
      return configuredLabel.value;
    });

    const clearFetchTimeout = () => {
      if (fetchTimeout !== null) clearTimeout(fetchTimeout);
      fetchTimeout = null;
    };

    const clearMissingCollectionTimeout = () => {
      if (missingCollectionTimeout !== null) clearTimeout(missingCollectionTimeout);
      missingCollectionTimeout = null;
    };

    const emitError = (code, details, { keepRequest = false } = {}) => {
      const error = describeError(code, details);
      if (!keepRequest) {
        request.value = null;
        clearFetchTimeout();
      }
      status.value = STATUS.FAILED;
      emit('trigger-event', { name: 'error', event: error });
    };

    const finish = total => {
      if (status.value === STATUS.ENDED) return;
      request.value = null;
      clearFetchTimeout();
      status.value = STATUS.ENDED;
      emit('trigger-event', {
        name: 'reachEnd',
        event: { total, loaded: entries.value.length },
      });
    };

    const readPagination = () => {
      if (!collectionId.value) return { ok: false, ...describeError(ERROR_CODES.NO_COLLECTION_SELECTED) };
      const api = wwLib.wwCollection;
      if (!api || typeof api.getPaginationOptions !== 'function' || typeof api.setOffset !== 'function') {
        return { ok: false, ...describeError(ERROR_CODES.API_UNAVAILABLE) };
      }
      try {
        return validatePagination(api.getPaginationOptions(collectionId.value));
      } catch (error) {
        return {
          ok: false,
          ...describeError(ERROR_CODES.PAGINATION_READ_FAILED, error?.message || String(error)),
        };
      }
    };

    const requestPage = offset => {
      if (request.value) return;
      if (!collectionId.value) {
        emitError(ERROR_CODES.NO_COLLECTION_SELECTED);
        return;
      }

      const pagination = readPagination();
      if (!pagination.ok) {
        emitError(pagination.code, pagination.message);
        return;
      }

      const currentGeneration = generation;
      request.value = { collectionId: collectionId.value, offset, generation: currentGeneration };
      status.value = STATUS.LOADING;
      clearFetchTimeout();
      fetchTimeout = setTimeout(() => {
        fetchTimeout = null;
        if (!request.value || request.value.generation !== currentGeneration) return;
        emitError(ERROR_CODES.FETCH_TIMEOUT, `offset=${offset}`, { keepRequest: true });
      }, FETCH_TIMEOUT_MS);

      try {
        wwLib.wwCollection.setOffset(collectionId.value, offset);
      } catch (error) {
        emitError(ERROR_CODES.SET_OFFSET_FAILED, error?.message || String(error));
        return;
      }

      emit('trigger-event', {
        name: 'loadMore',
        event: {
          offset,
          limit: pagination.limit,
          total: pagination.total,
          page: Math.floor(offset / pagination.limit) + 1,
        },
      });
    };

    const loadMore = () => {
      if (request.value || status.value === STATUS.ENDED) return;

      if (status.value === STATUS.INITIALIZING || entries.value.length === 0) {
        requestPage(0);
        return;
      }

      const pagination = readPagination();
      if (!pagination.ok) {
        emitError(pagination.code, pagination.message);
        return;
      }
      const plan = planNextFetch({
        ...pagination,
        // Les donnees peuvent devenir reactives avant les metadonnees WeWeb.
        offset: acceptedOffset.value ?? pagination.offset,
      });
      if (plan.action === 'error') {
        emitError(plan.code, plan.message);
      } else if (plan.action === 'end') {
        finish(plan.total);
      } else {
        requestPage(plan.offset);
      }
    };

    const onManualLoad = () => {
      if (request.value) return;

      const pagination = readPagination();
      if (!pagination.ok) {
        emitError(pagination.code, pagination.message);
        return;
      }

      // Premier clic sans page acceptee : demander explicitement la page zero.
      // Ensuite, avancer strictement d'une limite depuis le dernier offset accepte.
      // Ce chemin ne consulte pas `status`: le bouton sert precisement a tester la
      // capacite native de WeWeb a charger la page suivante.
      const nextOffset = acceptedOffset.value === null ? 0 : acceptedOffset.value + pagination.limit;
      console.info(
        '[infinite-collection] chargement manuel',
        `offset=${nextOffset}`,
        `limit=${pagination.limit}`,
        `total=${pagination.total}`,
        `affiches=${entries.value.length}`
      );
      status.value = STATUS.READY;
      requestPage(nextOffset);
    };

    const continueIfNeeded = () => {
      if (isManual.value || status.value !== STATUS.READY || request.value) return;
      // Reobserver la sentinelle force un nouveau calcul d'intersection apres que la
      // page a modifie la hauteur. Si elle reste visible, la page suivante s'enchaine.
      nextTick(setupObserver);
    };

    const processPage = (data, pagination, offset) => {
      const applied = applyPage(entries.value, data, offset);
      if (!applied.ok) {
        emitError(applied.code, `offset=${offset}, loaded=${entries.value.length}`);
        return;
      }

      entries.value = applied.items;
      acceptedOffset.value = offset;
      request.value = null;
      clearFetchTimeout();
      status.value = STATUS.READY;

      const verdict = classifyPage({
        incomingCount: data.length,
        offset,
        limit: pagination.limit,
        total: pagination.total,
      });
      if (verdict.outcome === 'error') emitError(verdict.code);
      else if (verdict.outcome === 'end') finish(pagination.total);
      else continueIfNeeded();
    };

    /** Un seul watcher gere atomiquement le changement de source et ses donnees. */
    watch(
      [
        collectionId,
        () => selectedCollection.value?.data,
        () => selectedCollection.value?.isFetching,
        () => selectedCollection.value?.isFetched,
        () => selectedCollection.value?.error,
      ],
      ([id, data, isFetching, isFetched, collectionError]) => {
        if (id !== activeCollectionId) {
          activeCollectionId = id;
          generation += 1;
          lastData = null;
          entries.value = [];
          acceptedOffset.value = null;
          request.value = null;
          clearFetchTimeout();
          clearMissingCollectionTimeout();
          status.value = STATUS.INITIALIZING;
        }

        if (!id) return;
        if (!selectedCollection.value) {
          if (missingCollectionTimeout === null) {
            const currentGeneration = generation;
            missingCollectionTimeout = setTimeout(() => {
              missingCollectionTimeout = null;
              if (generation !== currentGeneration || selectedCollection.value) return;
              emitError(ERROR_CODES.COLLECTION_NOT_FOUND, `id=${id}`);
            }, 3000);
          }
          return;
        }
        clearMissingCollectionTimeout();
        if (collectionError) {
          emitError(ERROR_CODES.COLLECTION_FETCH_FAILED, collectionError?.message || String(collectionError));
          return;
        }
        // WeWeb peut vider ou republier la page courante pendant le fetch. Ce n'est
        // pas encore la reponse : attendre la fin evite de classer cet etat transitoire
        // comme une page vide ou comme la page demandee.
        if (isFetching === true) return;
        if (!Array.isArray(data)) {
          if (data !== null && data !== undefined) emitError(ERROR_CODES.COLLECTION_DATA_UNAVAILABLE);
          return;
        }
        if (data === lastData) return;

        const pagination = readPagination();
        if (!pagination.ok) {
          if (isFetching === true || isFetched === false) return;
          emitError(pagination.code, pagination.message);
          return;
        }

        if (!request.value && data.length === 0 && pagination.total > 0 && isFetched !== true && isFetching !== false) {
          return;
        }

        // Une collection deja consultee peut rester sur une page avancee dans le
        // store. Repartir de zero avant de construire le nouvel accumulateur.
        if (!request.value && entries.value.length === 0 && pagination.offset !== 0) {
          requestPage(0);
          return;
        }

        lastData = data;
        const offset = request.value ? request.value.offset : pagination.offset;
        if (!request.value && offset !== 0) {
          emitError(ERROR_CODES.UNEXPECTED_OFFSET, `offset initial=${offset}`);
          return;
        }
        processPage(data, pagination, offset);
      },
      { immediate: true }
    );

    const setupObserver = () => {
      if (observer) observer.disconnect();
      observer = null;
      if (isManual.value || !sentinel.value || typeof IntersectionObserver === 'undefined') return;

      observer = new IntersectionObserver(
        intersections => {
          if (intersections.some(entry => entry.isIntersecting)) loadMore();
        },
        // `root: null` fonctionne aussi lorsque WeWeb porte le scroll sur un wrapper
        // parent : l'intersection tient compte du clipping de tous les ancetres.
        { root: null, rootMargin: `0px 0px ${OBSERVER_MARGIN} 0px`, threshold: 0 }
      );
      observer.observe(sentinel.value);
    };

    watch(isManual, () => nextTick(setupObserver));
    onMounted(() => nextTick(setupObserver));
    onBeforeUnmount(() => {
      if (observer) observer.disconnect();
      clearFetchTimeout();
      clearMissingCollectionTimeout();
      generation += 1;
    });

    return {
      root,
      sentinel,
      entries,
      isManual,
      manualDisabled,
      manualButtonLabel,
      onManualLoad,
    };
  },
};
</script>

<style scoped>
.ic {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
}

.ic__item {
  content-visibility: auto;
  contain-intrinsic-size: auto 80px;
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
  width: 100%;
  height: 1px;
}

/* wwEditor:start */
.ic__placeholder {
  width: 100%;
}
/* wwEditor:end */
</style>
