/** Logique pure de pagination, sans dependance a Vue ni a WeWeb. */

export const STATUS = {
  INITIALIZING: 'initializing',
  READY: 'ready',
  LOADING: 'loading',
  ENDED: 'ended',
  FAILED: 'failed',
};

export const ERROR_CODES = {
  NO_COLLECTION_SELECTED: 'NO_COLLECTION_SELECTED',
  COLLECTION_NOT_FOUND: 'COLLECTION_NOT_FOUND',
  COLLECTION_DATA_UNAVAILABLE: 'COLLECTION_DATA_UNAVAILABLE',
  COLLECTION_FETCH_FAILED: 'COLLECTION_FETCH_FAILED',
  API_UNAVAILABLE: 'API_UNAVAILABLE',
  PAGINATION_READ_FAILED: 'PAGINATION_READ_FAILED',
  NO_METADATA: 'NO_METADATA',
  INVALID_LIMIT: 'INVALID_LIMIT',
  INVALID_OFFSET: 'INVALID_OFFSET',
  INVALID_TOTAL: 'INVALID_TOTAL',
  SET_OFFSET_FAILED: 'SET_OFFSET_FAILED',
  FETCH_TIMEOUT: 'FETCH_TIMEOUT',
  EMPTY_PAGE: 'EMPTY_PAGE',
  INCOMPLETE_PAGE: 'INCOMPLETE_PAGE',
  UNEXPECTED_OFFSET: 'UNEXPECTED_OFFSET',
};

export const ERROR_MESSAGES = {
  [ERROR_CODES.NO_COLLECTION_SELECTED]: 'Selectionnez une collection paginee dans la propriete Collection.',
  [ERROR_CODES.COLLECTION_NOT_FOUND]: 'La collection selectionnee est introuvable dans le runtime WeWeb.',
  [ERROR_CODES.COLLECTION_DATA_UNAVAILABLE]: 'Les donnees de la collection ne sont pas une liste exploitable.',
  [ERROR_CODES.COLLECTION_FETCH_FAILED]: 'Le chargement de la collection a echoue.',
  [ERROR_CODES.API_UNAVAILABLE]: 'La pagination native WeWeb est indisponible dans cette version.',
  [ERROR_CODES.PAGINATION_READ_FAILED]: 'La lecture des informations de pagination a echoue.',
  [ERROR_CODES.NO_METADATA]: 'La collection ne fournit pas d informations de pagination.',
  [ERROR_CODES.INVALID_LIMIT]: 'La collection doit avoir une limite entiere superieure a zero.',
  [ERROR_CODES.INVALID_OFFSET]: 'L offset de la collection est invalide.',
  [ERROR_CODES.INVALID_TOTAL]: 'Le total de la collection est invalide.',
  [ERROR_CODES.SET_OFFSET_FAILED]: 'La demande de page a echoue.',
  [ERROR_CODES.FETCH_TIMEOUT]: 'Le chargement de la page a depasse le delai autorise.',
  [ERROR_CODES.EMPTY_PAGE]: 'La collection a retourne une page vide avant la fin annoncee.',
  [ERROR_CODES.INCOMPLETE_PAGE]: 'La derniere page ne couvre pas le total annonce.',
  [ERROR_CODES.UNEXPECTED_OFFSET]: 'La page recue ne suit pas les pages deja accumulees.',
};

export function describeError(code, details) {
  const base = ERROR_MESSAGES[code] || 'Erreur de pagination inconnue.';
  return { code, message: details ? `${base} (${details})` : base };
}

const isNonNegativeInteger = value =>
  value !== null &&
  value !== undefined &&
  value !== '' &&
  Number.isInteger(Number(value)) &&
  Number(value) >= 0;

export function validatePagination(pagination) {
  if (!pagination || typeof pagination !== 'object') {
    return { ok: false, ...describeError(ERROR_CODES.NO_METADATA) };
  }

  const { limit, offset, total } = pagination;
  if (!Number.isInteger(Number(limit)) || Number(limit) <= 0) {
    return { ok: false, ...describeError(ERROR_CODES.INVALID_LIMIT) };
  }
  if (!isNonNegativeInteger(offset)) {
    return { ok: false, ...describeError(ERROR_CODES.INVALID_OFFSET) };
  }
  if (!isNonNegativeInteger(total)) {
    return { ok: false, ...describeError(ERROR_CODES.INVALID_TOTAL) };
  }

  return { ok: true, limit: Number(limit), offset: Number(offset), total: Number(total) };
}

export function planNextFetch(pagination) {
  const valid = validatePagination(pagination);
  if (!valid.ok) return { action: 'error', code: valid.code, message: valid.message };

  const nextOffset = valid.offset + valid.limit;
  if (valid.total === 0 || nextOffset >= valid.total) {
    return { action: 'end', total: valid.total };
  }

  return { action: 'fetch', offset: nextOffset, limit: valid.limit, total: valid.total };
}

/**
 * Insere une page a sa position absolue.
 *
 * Le composant possede seul l'offset et charge les pages dans l'ordre. Un trou indique
 * donc une incoherence au lieu d'un scenario de compatibilite a deviner.
 */
export function applyPage(current = [], incoming = [], offset = 0) {
  if (!Array.isArray(incoming)) {
    return { ok: false, code: ERROR_CODES.COLLECTION_DATA_UNAVAILABLE };
  }
  if (!isNonNegativeInteger(offset) || Number(offset) > current.length) {
    return { ok: false, code: ERROR_CODES.UNEXPECTED_OFFSET };
  }

  const start = Number(offset);
  const prefix = current.slice(0, start);
  const page = incoming.map((data, index) => ({ key: start + index, data }));
  return { ok: true, items: [...prefix, ...page] };
}

/** Classe une page avec l'offset effectivement demande, jamais avec un offset stale. */
export function classifyPage({ incomingCount, offset, limit, total }) {
  const valid = validatePagination({ offset, limit, total });
  if (!valid.ok) return { outcome: 'error', code: valid.code };

  const covered = valid.offset + incomingCount;
  if (incomingCount === 0) {
    return valid.total === 0 || covered >= valid.total
      ? { outcome: 'end' }
      : { outcome: 'error', code: ERROR_CODES.EMPTY_PAGE };
  }
  if (covered >= valid.total) return { outcome: 'end' };
  if (valid.offset + valid.limit >= valid.total) {
    return { outcome: 'error', code: ERROR_CODES.INCOMPLETE_PAGE };
  }
  return { outcome: 'continue' };
}
