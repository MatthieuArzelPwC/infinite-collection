// UUID de la Flexbox WeWeb utilisee comme element repete.
// Repris de pwc-mw/ww-virtual-flexbox (ww-config.js:71) qui l'utilise en production.
// A corriger au premier test dans le studio si l'element ne se materialise pas.
const WW_FLEXBOX_TYPE = 'b783dc65-d528-4f74-8c14-e27c934c39b1';

const collectionHelp =
  "Collection a afficher et a paginer. Un seul choix suffit : le composant en lit les donnees, la limite, l'offset et le total.\n\nLa collection DOIT avoir une limite configuree (ex: 50) : c'est elle qui active la pagination serveur.";

const itemKeyHelp =
  "Nom du champ qui identifie un element de maniere unique (ex: `id`), idealement la cle primaire. La valeur doit etre scalaire (texte, nombre, booleen), stable et unique dans toute la collection. Une cle objet ou absente fait retomber sur l'index absolu, dont la deduplication est moins fiable.";

const preloadScreensHelp =
  "Quantite de contenu a precharger, exprimee en hauteurs de zone visible.\n\n1 = charger la page suivante lorsqu'il reste environ un ecran de contenu sous le point de defilement. Augmenter pour anticiper davantage, au prix de requetes plus precoces.\n\nLa distance en pixels est calculee automatiquement a partir de la hauteur reelle du composant : il n'y a pas de valeur en pixels a saisir.";

const manualLoadHelp =
  "Affiche un lien cliquable en fin de liste pour charger la page suivante a la demande, au lieu de la charger automatiquement au defilement.\n\nUtile pour diagnostiquer la pagination, ou lorsque le defilement automatique n'est pas souhaite.";

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
    collectionId: {
      label: {
        en: 'Collection',
        fr: 'Collection',
      },
      section: 'settings',
      type: 'Collection',
      options: {
        paginated: true,
      },
      defaultValue: null,
      /* wwEditor:start */
      propertyHelp: {
        tooltip: collectionHelp,
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
    manualLoad: {
      label: {
        en: 'Manual load',
        fr: 'Chargement manuel',
      },
      section: 'settings',
      type: 'OnOff',
      bindable: true,
      defaultValue: false,
      /* wwEditor:start */
      bindingValidation: {
        type: 'boolean',
        tooltip: manualLoadHelp,
      },
      propertyHelp: {
        tooltip: manualLoadHelp,
      },
      /* wwEditor:end */
    },
    manualLoadLabel: {
      label: {
        en: 'Manual load label',
        fr: 'Libelle du chargement manuel',
      },
      section: 'settings',
      type: 'Text',
      bindable: true,
      multiLang: true,
      defaultValue: { en: 'Load more', fr: 'Charger la suite' },
      hidden: content => !content.manualLoad,
      /* wwEditor:start */
      bindingValidation: {
        type: 'string',
        tooltip: 'Texte du lien de chargement manuel.',
      },
      /* wwEditor:end */
    },
    preloadScreens: {
      label: {
        en: 'Preload (screens)',
        fr: 'Prechargement (ecrans)',
      },
      section: 'settings',
      type: 'Number',
      bindable: true,
      defaultValue: 1,
      options: {
        min: 0.25,
        max: 5,
        step: 0.25,
      },
      hidden: content => !!content.manualLoad,
      /* wwEditor:start */
      bindingValidation: {
        type: 'number',
        tooltip: preloadScreensHelp,
      },
      propertyHelp: {
        tooltip: preloadScreensHelp,
      },
      /* wwEditor:end */
    },
  },
};
