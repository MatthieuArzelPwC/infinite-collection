/**
 * Frontiere WeWeb.
 *
 * Seul module du composant autorise a toucher `wwLib`. Si WeWeb modifie son store
 * interne ou ses API de pagination, ce fichier est le seul a reprendre.
 *
 * Deux surfaces sont utilisees :
 *
 * - `wwLib.wwCollection.getPaginationOptions(id)` et `setOffset(id, offset)`, les
 *   deux seules fonctions employees par le Paginator officiel ;
 * - `wwLib.$store.getters['data/getCollections'][id]` pour lire les donnees. Ce
 *   getter n'est pas une API publique documentee, d'ou son isolement ici.
 *
 * Aucune dependance a Vue : les lectures sont des fonctions appelees depuis des
 * `computed`, ce qui preserve la reactivite sans la creer.
 */

const api = () => (typeof wwLib !== 'undefined' ? wwLib : null);

/** Objet collection du store, ou null. */
export function readCollection(collectionId) {
  if (!collectionId) return null;
  const lib = api();
  if (!lib) return null;

  try {
    return lib.$store?.getters?.['data/getCollections']?.[collectionId] ?? null;
  } catch (error) {
    return null;
  }
}

/**
 * Metadonnees brutes de pagination.
 *
 * Retourne null en cas d'indisponibilite, sans distinguer les causes : une
 * collection absente, une API manquante ou une limite non configuree conduisent
 * toutes a la meme impossibilite de paginer.
 */
export function readPaginationOptions(collectionId) {
  if (!collectionId) return null;
  const lib = api();
  const collections = lib?.wwCollection;
  if (!collections || typeof collections.getPaginationOptions !== 'function') return null;

  try {
    return collections.getPaginationOptions(collectionId);
  } catch (error) {
    return null;
  }
}

/** Indique si la pagination native est utilisable dans ce runtime. */
export function canPaginate() {
  const collections = api()?.wwCollection;
  return (
    !!collections &&
    typeof collections.getPaginationOptions === 'function' &&
    typeof collections.setOffset === 'function'
  );
}

/**
 * Demande une page.
 *
 * `setOffset` est volontairement traite comme un envoi sans retour, exactement
 * comme dans le Paginator officiel : il ne renvoie ni promesse ni accuse de
 * reception. L'arrivee des donnees ne se constate que par la reactivite du store,
 * ce qui exclut tout suivi de requete fonde sur un delai d'attente.
 */
export function requestOffset(collectionId, offset) {
  const collections = api()?.wwCollection;
  if (!collections || typeof collections.setOffset !== 'function') return false;

  try {
    collections.setOffset(collectionId, offset);
    return true;
  } catch (error) {
    return false;
  }
}

/** Resout un texte multilingue WeWeb. */
export function translate(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return fallback;

  try {
    const text = api()?.wwLang?.getText?.(value);
    return typeof text === 'string' && text ? text : fallback;
  } catch (error) {
    return fallback;
  }
}
