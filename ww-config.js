// UUID de la Flexbox WeWeb standard telle qu'elle est enregistree dans le projet.
// Les composants officiels utilisent le nom `ww-flexbox` ; l'identifiant est
// conserve ici parce qu'il est verifie fonctionnel dans le Studio cible.
const WW_FLEXBOX_TYPE = 'b783dc65-d528-4f74-8c14-e27c934c39b1';

const collectionHelp =
  "Collection a afficher et a paginer. Un seul choix suffit : le composant en lit les donnees, la limite, l'offset et le total.\n\nLa collection DOIT avoir une limite configuree (ex: 50) : c'est elle qui active la pagination serveur.";

const manualLoadHelp =
  "Affiche un bouton apres le dernier element pour charger la page suivante. En mode manuel, le defilement n'declenche aucune requete mais l'evenement 'A l approche du bas' reste emis.";

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
      name: 'reachBottom',
      label: { en: 'On reach bottom', fr: 'A l approche du bas' },
      event: { distance: 0, loaded: 0, hasMore: true },
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
    scrollMargin: {
      label: {
        en: 'Scroll margin (px)',
        fr: 'Marge de declenchement (px)',
      },
      section: 'settings',
      type: 'Number',
      options: { min: 0, max: 2000, step: 10 },
      defaultValue: 300,
      /* wwEditor:start */
      propertyHelp: {
        tooltip:
          "Distance au bas du conteneur a partir de laquelle la page suivante est demandee. Valeur mesuree comme fiable dans le Studio : 300.",
      },
      /* wwEditor:end */
    },
    debug: {
      label: {
        en: 'Debug logs',
        fr: 'Journaux de debogage',
      },
      section: 'settings',
      type: 'OnOff',
      defaultValue: false,
      /* wwEditor:start */
      propertyHelp: {
        tooltip:
          "Desactive par defaut : un capteur de defilement peut inonder la console d'une application publiee.",
      },
      /* wwEditor:end */
    },
  },
  /* wwEditor:start */
  actions: [
    {
      label: { en: 'Reset', fr: 'Reinitialiser' },
      action: 'reset',
      args: [],
    },
  ],
  /* wwEditor:end */
};
