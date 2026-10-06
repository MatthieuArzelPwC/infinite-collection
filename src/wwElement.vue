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
    let scrollTarget = null;
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

    const itemKey = computed(() => {
      const raw = props.content.itemKey;
      return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
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
        wwLib.wwLog?.error?.('[infinite-collection] lecture du store impossible', error);
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

    const itemStyle = computed(() => {
      const height = Number(props.content.estimatedItemHeight);
      const safeHeight = Number.isFinite(height) && height > 0 ? height : 80;
      return { '--ic-item-height': `${safeHeight}px` };
    });

    /** Le lien manuel n'a de sens que s'il reste quelque chose a charger. */
    const showManualTrigger = computed(() => {
      if (!isManual.value) return false;
      return state.value === STATES.IDLE || state.value === STATES.LOADING;
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

    const onManualLoad = () => {
      if (!canLoad(state.value)) return;
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

    /* -------------------------------------------------------------- *
     * Reception des pages
     * -------------------------------------------------------------- */

    const resetAll = (incoming, offset) => {
      const result = resetItems({ incoming, offset, itemKey: itemKey.value });
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

        // Une page attendue dont l'offset ne correspond pas encore : l'integrer
        // melangerait deux paginations.
        if (mode === 'ignore') return;

        if (mode === 'reset') {
          const reset = resetItems({ incoming, offset, itemKey: itemKey.value });
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
          itemKey: itemKey.value,
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

    // Un changement de cle invalide toutes les cles deja calculees.
    watch(itemKey, () => {
      resetAll(incomingItems.value, 0);
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
      if (isManual.value) return true;

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

    watch([() => props.content.rootMargin, isManual], () => nextTick(() => ensureObserver()));

    onMounted(() => nextTick(() => ensureObserver()));

    onBeforeUnmount(() => {
      teardownWatchers();
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
