// UUID de la Flexbox WeWeb utilisee comme element repete.
// Repris de pwc-mw/ww-virtual-flexbox (ww-config.js:71) qui l'utilise en production.
// A corriger au premier test dans le studio si l'element ne se materialise pas.
const WW_FLEXBOX_TYPE = 'b783dc65-d528-4f74-8c14-e27c934c39b1';

const collectionHelp =
  "Collection a afficher et a paginer. Un seul choix suffit : le composant en lit les donnees, la limite, l'offset et le total.\n\nLa collection DOIT avoir une limite configuree (ex: 50) : c'est elle qui active la pagination serveur.";

const manualLoadHelp =
  "Affiche un bouton apres le dernier element pour charger la page suivante. En mode manuel, le defilement ne declenche aucune requete.";

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
    manualLoad: {
      label: {
        en: 'Manual load',
        fr: 'Chargement manuel',
      },
      section: 'settings',
      type: 'OnOff',
      bindable: true,
      defaultValue: true,
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
  },
};
