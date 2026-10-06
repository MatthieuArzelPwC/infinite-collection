<template>
  <div ref="root" class="ic">
    <div v-for="row in rows" :key="row.key" class="ic__item">
      <wwLayoutItemContext is-repeat :index="row.key" :data="row.data">
        <wwElement v-bind="content.itemElement" :local-data="row.data" />
      </wwLayoutItemContext>
    </div>

    <!-- wwEditor:start -->
    <div v-if="!rows.length" class="ic__placeholder">
      <wwElement v-bind="content.itemElement" />
    </div>
    <!-- wwEditor:end -->

    <button v-if="showManualButton" type="button" class="ic__more" :disabled="isLoading" @click="loadNext('manuel')">
      {{ manualLabel }}
    </button>

    <div ref="sentinel" class="ic__sentinel" aria-hidden="true"></div>
  </div>
</template>

<script>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';

import { project, loadedCount, nextPageOffset } from './rows.mjs';
import { ERROR_CODES, describeError, readPagination, currentPage } from './pagination.mjs';
import { readCollection, readPaginationOptions, canPaginate, requestOffset, translate } from './collection.mjs';
import { createBottomSensor } from './bottomSensor.mjs';

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

    /**
     * Etat local reduit a une seule reference.
     *
     * WeWeb maintient lui-meme l'accumulation des pages dans `collection.data` :
     * un tableau de la taille du total, rempli progressivement, dont rien n'est
     * libere. La liste affichee est donc une projection du store, et non une copie
     * a resynchroniser. `pendingOffset` ne sert qu'a ne pas emettre deux fois la
     * meme demande.
     */
    const pendingOffset = ref(null);

    let sensor = null;
    let endedFor = null;

    const collectionId = computed(() => {
      const value = props.content.collectionId;
      return typeof value === 'string' && value ? value : null;
    });

    const isManual = computed(() => !!props.content.manualLoad);

    /** Unique point d'acces au store, conformement a la frontiere du module. */
    const collection = computed(() => readCollection(collectionId.value));
    const data = computed(() => {
      const value = collection.value?.data;
      return Array.isArray(value) ? value : null;
    });
    const pagination = computed(() => readPagination(readPaginationOptions(collectionId.value)));

    const rows = computed(() => project(data.value));
    const loaded = computed(() => loadedCount(data.value));

    /**
     * `isFetching` sert uniquement a eviter une demande concurrente et a afficher
     * un etat. Il n'identifie aucune page : la position de chaque ligne est portee
     * par son index. Si la propriete devenait indisponible, `pendingOffset` suffit,
     * et aucun verrou ne peut rester bloque definitivement.
     */
    const isLoading = computed(() => collection.value?.isFetching === true || pendingOffset.value !== null);

    /** Offset de la prochaine page manquante, derive des donnees. */
    const nextOffset = computed(() => {
      if (!pagination.value) return null;
      return nextPageOffset(data.value, pagination.value.limit);
    });

    const hasMore = computed(() => nextOffset.value !== null);

    const showManualButton = computed(() => isManual.value && (hasMore.value || isLoading.value));

    const manualLabel = computed(() =>
      isLoading.value ? '...' : translate(props.content.manualLoadLabel, 'Charger la suite')
    );

    const debug = (event, detail) => {
      if (!props.content.debug) return;
      console.info('[infinite-collection]', event, detail ?? '');
    };

    const fail = (code, details) => {
      pendingOffset.value = null;
      emit('trigger-event', { name: 'error', event: describeError(code, details) });
    };

    /** Demande une page. Seul chemin de pagination du composant. */
    const loadNext = origin => {
      if (isLoading.value) return;

      if (!collectionId.value) {
        fail(ERROR_CODES.NO_COLLECTION_SELECTED);
        return;
      }
      if (!canPaginate() || !pagination.value) {
        fail(ERROR_CODES.PAGINATION_UNAVAILABLE, `id=${collectionId.value}`);
        return;
      }

      const target = nextOffset.value;
      if (target === null) return;

      pendingOffset.value = target;
      debug('demande de page', { origine: origin, offset: target, limit: pagination.value.limit });

      if (!requestOffset(collectionId.value, target)) {
        fail(ERROR_CODES.PAGINATION_UNAVAILABLE, `setOffset refuse a l offset ${target}`);
        return;
      }

      emit('trigger-event', {
        name: 'loadMore',
        event: {
          offset: target,
          limit: pagination.value.limit,
          total: pagination.value.total,
          page: currentPage({ offset: target, limit: pagination.value.limit }) + 1,
        },
      });
    };

    const onReach = distance => {
      emit('trigger-event', {
        name: 'reachBottom',
        event: { distance, loaded: loaded.value, hasMore: hasMore.value },
      });
      // Le mode manuel conserve le declencheur comme point d'accroche pour un
      // workflow, mais ne lance aucune requete de lui-meme.
      if (!isManual.value) loadNext('scroll');
    };

    const reset = () => {
      pendingOffset.value = null;
      endedFor = null;
      sensor?.rearm();
      nextTick(() => sensor?.refresh());
    };

    /** Un changement de source repart d'un etat neuf. */
    watch(collectionId, id => {
      debug('source', { collectionId: id });
      reset();
    });

    /**
     * Unique watcher de donnees.
     *
     * `data` etant deja l'accumulateur, ce watcher n'a aucune fusion a operer :
     * republication, reponse tardive ou page dupliquee sont absorbees par la
     * projection, sans effet de bord.
     */
    watch(
      [data, () => collection.value?.error],
      ([rowsData, error]) => {
        if (error) {
          fail(ERROR_CODES.PAGINATION_UNAVAILABLE, String(error?.message || error));
          return;
        }
        if (!rowsData) return;

        // La demande en vol est consideree servie des que la frontiere de
        // chargement a depasse l'offset demande.
        if (pendingOffset.value !== null && nextOffset.value !== pendingOffset.value) {
          pendingOffset.value = null;
        }

        if (!hasMore.value) {
          const total = pagination.value?.total ?? loaded.value;
          // Emis une seule fois par source : le verrou est porte par
          // l'identifiant, donc un changement de collection le libere.
          if (endedFor !== collectionId.value) {
            endedFor = collectionId.value;
            debug('fin de collection', { total, charge: loaded.value });
            emit('trigger-event', { name: 'reachEnd', event: { total, loaded: loaded.value } });
          }
          return;
        }

        endedFor = null;
        debug('lignes projetees', { charge: loaded.value, prochainOffset: nextOffset.value });

        // Une liste plus courte que la zone visible ne produira aucun evenement de
        // defilement : il faut enchainer explicitement jusqu'a remplir l'ecran.
        nextTick(() => sensor?.refresh());
      },
      { immediate: true }
    );

    onMounted(() => {
      nextTick(() => {
        sensor = createBottomSensor({
          root: root.value,
          sentinel: sentinel.value,
          margin: Number(props.content.scrollMargin) || 300,
          enabled: () => hasMore.value,
          onReach,
          onDebug: details => debug(details.event, details),
        });
      });
    });

    onBeforeUnmount(() => {
      sensor?.stop();
      sensor = null;
    });

    return {
      root,
      sentinel,
      rows,
      isLoading,
      isManual,
      showManualButton,
      manualLabel,
      loadNext,
      reset,
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
