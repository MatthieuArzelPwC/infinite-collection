/**
 * Projection des lignes publiees par WeWeb.
 *
 * Mesure effectuee dans le Studio sur une collection de 8342 lignes paginee par
 * 12, avant puis apres `setOffset(12)` :
 *
 *   length          8342 -> 8342     pre-dimensionne au total, constant
 *   nbPresents        12 ->   24     cumul, et non remplacement
 *   premierPresent     0 ->    0     les lignes deja obtenues sont conservees
 *   nbTrousReels       0 ->    0     positions vides explicites, pas de trous
 *
 * WeWeb maintient donc lui-meme l'accumulation : `data` est un tableau de la
 * taille du total, rempli progressivement, dont rien n'est jamais libere.
 *
 * Le composant n'a par consequent aucun accumulateur a tenir. Dupliquer ces
 * lignes dans un etat local creerait une seconde source de verite a resynchroniser,
 * et c'est precisement ce que fait cette version : rien. La liste affichee est une
 * projection directe du store, recalculee par Vue a chaque publication.
 *
 * Module pur : ne connait ni Vue, ni WeWeb, ni le DOM.
 */

/**
 * Entrees reellement chargees, dans l'ordre des positions.
 *
 * La cle est la position absolue dans la collection, ce qui garantit la stabilite
 * du rendu : une ligne conserve son identite meme si les pages arrivent dans le
 * desordre.
 *
 * La boucle est indexee a dessein. La mesure montre des positions vides explicites
 * plutot que des trous reels, mais `forEach`, `map` et `filter` sauteraient
 * silencieusement un tableau creux, et le cout d'une boucle est nul.
 */
export function project(data) {
  if (!Array.isArray(data)) return [];

  const rows = [];
  for (let index = 0; index < data.length; index += 1) {
    const value = data[index];
    if (value === null || value === undefined) continue;
    rows.push({ key: index, data: value });
  }
  return rows;
}

/** Nombre de lignes effectivement chargees. */
export function loadedCount(data) {
  if (!Array.isArray(data)) return 0;

  let count = 0;
  for (let index = 0; index < data.length; index += 1) {
    const value = data[index];
    if (value !== null && value !== undefined) count += 1;
  }
  return count;
}

/**
 * Position de la premiere ligne manquante, ou null si tout est charge.
 *
 * WeWeb remplissant les positions dans l'ordre, cette frontiere indique ou reprend
 * le chargement. Elle est derivee des donnees et non memorisee, ce qui la rend
 * immune au retard d'un cycle reactif des metadonnees sur les donnees.
 */
export function firstMissingIndex(data) {
  if (!Array.isArray(data)) return 0;

  for (let index = 0; index < data.length; index += 1) {
    const value = data[index];
    if (value === null || value === undefined) return index;
  }
  return null;
}

/**
 * Offset de la page a demander pour poursuivre le chargement.
 *
 * Aligne la frontiere sur une limite de page : WeWeb n'accepte que des offsets
 * multiples de la limite.
 */
export function nextPageOffset(data, limit) {
  const size = Number(limit);
  if (!Number.isInteger(size) || size <= 0) return null;

  const missing = firstMissingIndex(data);
  if (missing === null) return null;

  return Math.floor(missing / size) * size;
}
