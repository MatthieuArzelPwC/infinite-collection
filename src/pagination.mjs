/**
 * Decision de pagination, sans etat ni dependance.
 *
 * Calque exact du Paginator officiel WeWeb, qui ne conserve lui-meme aucun etat :
 * tout est derive de `getPaginationOptions()` a chaque evaluation.
 *
 *   currentPage = floor(offset / limit)
 *   nbPage      = ceil(total / limit)
 *   derniere    = offset + limit >= total
 *
 * Ne connait ni Vue, ni WeWeb, ni le DOM.
 */

export const ERROR_CODES = {
  NO_COLLECTION_SELECTED: 'NO_COLLECTION_SELECTED',
  PAGINATION_UNAVAILABLE: 'PAGINATION_UNAVAILABLE',
};

export const ERROR_MESSAGES = {
  [ERROR_CODES.NO_COLLECTION_SELECTED]:
    'Selectionnez une collection paginee dans la propriete Collection.',
  [ERROR_CODES.PAGINATION_UNAVAILABLE]:
    'La pagination de la collection est illisible : collection absente du runtime, API WeWeb indisponible, ou limite non configuree.',
};

export function describeError(code, details) {
  const base = ERROR_MESSAGES[code] || 'Erreur de pagination inconnue.';
  return { code, message: details ? `${base} (${details})` : base };
}

const toInteger = value => {
  if (value === null || value === undefined || value === '') return null;
  // `Number` est trop permissif pour une metadonnee : `true` vaut 1 et `[]` vaut
  // 0, ce qui transformerait une valeur manifestement invalide en pagination
  // plausible.
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
};

/**
 * Normalise les metadonnees WeWeb.
 *
 * `limit` doit etre strictement positive : c'est elle qui atteste que la
 * pagination serveur est active. `offset` et `total` doivent etre des entiers
 * non negatifs. Tout le reste est illisible, sans nuance : une metadonnee
 * douteuse ne doit pas produire une pagination approximative.
 */
export function readPagination(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const limit = toInteger(raw.limit);
  const offset = toInteger(raw.offset);
  const total = toInteger(raw.total);

  if (limit === null || limit <= 0) return null;
  if (offset === null || offset < 0) return null;
  if (total === null || total < 0) return null;

  return { limit, offset, total };
}

/** Index de page courante, 0-base, comme dans le Paginator. */
export function currentPage({ offset, limit }) {
  if (!limit) return 0;
  return Math.floor(offset / limit);
}

/** Nombre total de pages, minimum 1 pour une collection vide. */
export function pageCount({ total, limit }) {
  if (!limit) return 1;
  return Math.max(1, Math.ceil(total / limit));
}

/**
 * Le contrat de fin du Paginator officiel : la page courante est la derniere
 * lorsque `offset + limit >= total`.
 *
 * La longueur du tableau expose par le store n'entre jamais dans ce calcul : il
 * peut etre creux, transforme, ou republie par WeWeb.
 */
export function isLastPage({ offset, limit, total }) {
  if (total === 0) return true;
  return offset + limit >= total;
}

/**
 * Offset de la page suivante, ou null s'il n'y en a pas.
 *
 * `from` permet de partir du dernier offset reellement obtenu plutot que des
 * metadonnees, qui peuvent etre en retard d'un cycle reactif.
 */
export function nextOffset(pagination, from = null) {
  if (!pagination) return null;

  const base = toInteger(from);
  const offset = base === null || base < 0 ? pagination.offset : base;

  if (isLastPage({ ...pagination, offset })) return null;
  return offset + pagination.limit;
}
