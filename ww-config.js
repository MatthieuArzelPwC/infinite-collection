// UUID de la Flexbox WeWeb utilisee comme element repete.
// Repris de pwc-mw/ww-virtual-flexbox (ww-config.js:71) qui l'utilise en production.
// A corriger au premier test dans le studio si l'element ne se materialise pas.
const WW_FLEXBOX_TYPE = 'b783dc65-d528-4f74-8c14-e27c934c39b1';

const itemsHelp =
  "La collection a repeter. Binder sur `maCollection.data`.\n\nLa collection DOIT avoir une limite configuree dans le studio (ex: 50) : c'est cette limite qui active la pagination serveur cote plugin.";

const itemKeyHelp =
  "Nom du champ qui identifie un element de maniere unique (ex: `id`), idealement la cle primaire. La valeur doit etre scalaire (texte, nombre, booleen), stable et unique dans toute la collection. Une cle objet ou absente fait retomber sur l'index absolu, dont la deduplication est moins fiable.";

const estimatedItemHeightHelp =
  "Hauteur approximative d'un element en pixels. Alimente `contain-intrinsic-size` pour que le navigateur dimensionne la barre de scroll sans calculer la mise en page des elements hors ecran. Une valeur approximative suffit.";

const rootMarginHelp =
  "Distance en pixels avant la fin de la liste a laquelle le chargement de la page suivante est declenche. Plus la valeur est elevee, plus le chargement est anticipe.";

export default {
  options: {
    displayAllowedValues: ['block', 'flex'],
  },
  editor: {
    label: {
      en: 'Infinite collection',
      fr: 'Collection infinie',
    },
    icon: 'list',
    bubble: {
      icon: 'list',
    },
    customStylePropertiesOrder: ['items'],
  },
  triggerEvents: [
    {
      name: 'loadMore',
      label: { en: 'On load more', fr: 'Au chargement de la page suivante' },
      event: { offset: 0, limit: 0, total: 0, page: 0 },
    },
    {
      name: 'reachEnd',
      label: { en: 'On reach end', fr: 'A la fin de la collection' },
      event: { total: 0, loaded: 0 },
    },
    {
      name: 'error',
      label: { en: 'On error', fr: 'En cas d erreur' },
      event: { code: '', message: '' },
    },
  ],
  properties: {
    items: {
      label: {
        en: 'Collection',
        fr: 'Collection',
      },
      type: 'Array',
      options: {
        item: {
          type: 'Object',
          defaultValue: {},
        },
      },
      bindable: 'repeatable',
      defaultValue: [],
      /* wwEditor:start */
      bindingValidation: {
        validations: [{ type: 'array' }, { type: 'object' }],
        tooltip: itemsHelp,
      },
      propertyHelp: {
        tooltip: itemsHelp,
      },
      /* wwEditor:end */
    },
    itemElement: {
      hidden: true,
      defaultValue: {
        isWwObject: true,
        type: WW_FLEXBOX_TYPE,
      },
    },
    paginatedSource: {
      label: {
        en: 'Paginated source',
        fr: 'Source paginee',
      },
      type: 'PaginatedSource',
      defaultValue: null,
      /* wwEditor:start */
      propertyHelp: {
        tooltip:
          "Collection a paginer. Recommande : la selectionner explicitement. Si ce champ reste vide, le composant tente de retrouver automatiquement la collection a partir du binding de `Collection`. Si aucune source n'est resolue, le composant s'arrete et emet l'evenement `On error`.",
      },
      /* wwEditor:end */
    },
    itemKey: {
      label: {
        en: 'Unique key',
        fr: 'Cle unique',
      },
      section: 'settings',
      type: 'Text',
      bindable: true,
      defaultValue: 'id',
      options: {
        placeholder: 'id',
      },
      /* wwEditor:start */
      bindingValidation: {
        type: 'string',
        tooltip: itemKeyHelp,
      },
      propertyHelp: {
        tooltip: itemKeyHelp,
      },
      /* wwEditor:end */
    },
    estimatedItemHeight: {
      label: {
        en: 'Estimated item height',
        fr: 'Hauteur estimee d un element',
      },
      section: 'settings',
      type: 'Number',
      bindable: true,
      defaultValue: 80,
      options: {
        min: 1,
        max: 2000,
        step: 1,
      },
      /* wwEditor:start */
      bindingValidation: {
        type: 'number',
        tooltip: estimatedItemHeightHelp,
      },
      propertyHelp: {
        tooltip: estimatedItemHeightHelp,
      },
      /* wwEditor:end */
    },
    rootMargin: {
      label: {
        en: 'Trigger distance',
        fr: 'Distance de declenchement',
      },
      section: 'settings',
      type: 'Number',
      bindable: true,
      defaultValue: 300,
      options: {
        min: 0,
        max: 3000,
        step: 50,
      },
      /* wwEditor:start */
      bindingValidation: {
        type: 'number',
        tooltip: rootMarginHelp,
      },
      propertyHelp: {
        tooltip: rootMarginHelp,
      },
      /* wwEditor:end */
    },
  },
};
