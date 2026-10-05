/**
 * Logique pure du composant, sans dependance a Vue ni a wwLib.
 *
 * Tout ce qui constitue une decision (cle d'un element, fusion d'une page, choix de
 * la page suivante, classification d'une page recue, transition d'etat) est isole ici
 * pour etre verifiable hors du studio WeWeb. Voir test/logic.test.mjs.
 */

/* ------------------------------------------------------------------ *
 * Etats
 * ------------------------------------------------------------------ */

export const STATES = {
  IDLE: 'idle',
  LOADING: 'loading',
  TIMED_OUT: 'timedOut',
  ENDED: 'ended',
  FAILED: 'failed',
};

/** Codes d'erreur, pour que chaque panne soit identifiable dans un workflow. */
export const ERROR_CODES = {
  NO_SOURCE: 'NO_SOURCE',
  API_UNAVAILABLE: 'API_UNAVAILABLE',
  PAGINATION_READ_FAILED: 'PAGINATION_READ_FAILED',
  NO_METADATA: 'NO_METADATA',
  INVALID_LIMIT: 'INVALID_LIMIT',
  INVALID_OFFSET: 'INVALID_OFFSET',
  INVALID_TOTAL: 'INVALID_TOTAL',
  SET_OFFSET_FAILED: 'SET_OFFSET_FAILED',
  FETCH_TIMEOUT: 'FETCH_TIMEOUT',
  EMPTY_PAGE: 'EMPTY_PAGE',
  DUPLICATE_PAGE: 'DUPLICATE_PAGE',
};

export const ERROR_MESSAGES = {
  [ERROR_CODES.NO_SOURCE]:
    'Impossible de paginer la collection. Renseignez une Source paginee valide et verifiez que la collection possede une limite.',
  [ERROR_CODES.API_UNAVAILABLE]:
    'La pagination native WeWeb est indisponible dans cette version. Pilotez la pagination par un workflow.',
  [ERROR_CODES.PAGINATION_READ_FAILED]:
    'La lecture des informations de pagination de la collection a echoue.',
  [ERROR_CODES.NO_METADATA]:
    'La collection ne fournit pas d informations de pagination. Verifiez que la Source paginee designe bien une collection.',
  [ERROR_CODES.INVALID_LIMIT]:
    'La collection doit avoir une limite entiere superieure a zero, configuree dans le studio WeWeb.',
  [ERROR_CODES.INVALID_OFFSET]: 'L offset de la collection est invalide.',
  [ERROR_CODES.INVALID_TOTAL]:
    'Le total de la collection est invalide. Une limite doit etre configuree pour que WeWeb calcule le total.',
  [ERROR_CODES.SET_OFFSET_FAILED]: 'La demande de page suivante a echoue.',
  [ERROR_CODES.FETCH_TIMEOUT]:
    'Le chargement de la page a depasse le delai autorise. Le composant reste en attente afin d eviter une pagination incoherente.',
  [ERROR_CODES.EMPTY_PAGE]: 'La collection a retourne une page vide avant la fin annoncee.',
  [ERROR_CODES.DUPLICATE_PAGE]:
    'La page recue ne contient aucun nouvel element. Verifiez la cle unique et la coherence de la pagination.',
};

export function describeError(code, details) {
  const message = ERROR_MESSAGES[code] || 'Erreur de pagination inconnue.';
  return { ok: false, code, message: details ? `${message} (${details})` : message };
}

/* ------------------------------------------------------------------ *
 * Cles de deduplication
 * ------------------------------------------------------------------ */

/**
 * Une cle metier doit etre scalaire. Un objet ou un tableau serait converti en
 * `[object Object]` : toutes les lignes partageraient alors la meme cle et seraient
 * silencieusement fusionnees en une seule.
 */
function isUsableKey(value) {
  if (value === undefined || value === null || value === '') return false;
  const type = typeof value;
  return type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint';
}

/**
 * Calcule la cle d'un element.
 *
 * Le type est inclus dans la cle : sans cela `5` et `"5"` produiraient la meme cle et
 * l'un des deux elements disparaitrait de la liste.
 *
 * Si la cle metier est absente ou non scalaire, on retombe sur l'index absolu
 * (offset + index dans la page), unique entre pages mais incapable de detecter un
 * meme element livre a deux offsets differents.
 */
export function resolveKey(item, absoluteIndex, itemKey) {
  if (itemKey && item !== null && typeof item === 'object') {
    const raw = item[itemKey];
    if (isUsableKey(raw)) {
      if (typeof raw === 'number' && !Number.isFinite(raw)) return `i:${absoluteIndex}`;
      return `k:${typeof raw}:${String(raw)}`;
    }
  }
  return `i:${absoluteIndex}`;
}

/* ------------------------------------------------------------------ *
 * Accumulation
 * ------------------------------------------------------------------ */

/**
 * Fusionne une page recue dans l'accumulateur, en ignorant les doublons.
 *
 * Retourne de nouvelles references (jamais de mutation en place) pour que la
 * reactivite Vue se declenche.
 */
export function mergeItems({ current = [], keys, incoming = [], offset = 0, itemKey }) {
  const nextKeys = new Set(keys || []);
  const nextItems = current.slice();
  let added = 0;

  for (let i = 0; i < incoming.length; i += 1) {
    const data = incoming[i];
    const key = resolveKey(data, offset + i, itemKey);
    if (nextKeys.has(key)) continue;
    nextKeys.add(key);
    nextItems.push({ key, data });
    added += 1;
  }

  return { items: nextItems, keys: nextKeys, added };
}

/** Construit l'accumulateur a partir d'une page unique (premier chargement ou reset). */
export function resetItems({ incoming = [], offset = 0, itemKey }) {
  return mergeItems({ current: [], keys: new Set(), incoming, offset, itemKey });
}

/* ------------------------------------------------------------------ *
 * Validation des metadonnees de pagination
 * ------------------------------------------------------------------ */

const isNonNegativeInteger = value =>
  value !== null && value !== undefined && value !== '' && Number.isInteger(Number(value)) && Number(value) >= 0;

/**
 * Valide les metadonnees renvoyees par WeWeb.
 *
 * La limite est determinante : cote plugin Supabase, `range()` et `count: 'exact'`
 * ne sont appliques que si une limite est definie. Sans limite il n'y a ni pagination
 * serveur ni total fiable.
 */
export function validatePagination(pagination) {
  if (!pagination || typeof pagination !== 'object') return describeError(ERROR_CODES.NO_METADATA);

  const { limit, offset, total } = pagination;

  if (!Number.isInteger(Number(limit)) || Number(limit) <= 0) {
    return describeError(ERROR_CODES.INVALID_LIMIT, `limit=${JSON.stringify(limit)}`);
  }
  if (!isNonNegativeInteger(offset)) {
    return describeError(ERROR_CODES.INVALID_OFFSET, `offset=${JSON.stringify(offset)}`);
  }
  if (!isNonNegativeInteger(total)) {
    return describeError(ERROR_CODES.INVALID_TOTAL, `total=${JSON.stringify(total)}`);
  }

  return { ok: true, limit: Number(limit), offset: Number(offset), total: Number(total) };
}

/* ------------------------------------------------------------------ *
 * Choix de la page suivante
 * ------------------------------------------------------------------ */

/**
 * Decide s'il faut demander la page suivante.
 *
 * La fin est determinee par l'offset et le total, jamais par le nombre d'elements
 * accumules : la deduplication peut rendre ce nombre inferieur au total, ce qui
 * ferait croire a tort qu'il reste des pages.
 */
export function planNextFetch(pagination) {
  const valid = validatePagination(pagination);
  if (!valid.ok) return { action: 'error', code: valid.code, message: valid.message };

  const { limit, offset, total } = valid;

  if (total === 0) return { action: 'end', total, offset, limit };

  const nextOffset = offset + limit;
  if (nextOffset >= total) return { action: 'end', total, offset, limit };

  return { action: 'fetch', offset: nextOffset, limit, total };
}

/** Vrai si l'offset courant designe la derniere page annoncee. */
export function isLastPage({ limit, offset, total }) {
  const valid = validatePagination({ limit, offset, total });
  if (!valid.ok) return false;
  if (valid.total === 0) return true;
  return valid.offset + valid.limit >= valid.total;
}

/* ------------------------------------------------------------------ *
 * Classification d'une page recue
 * ------------------------------------------------------------------ */

/**
 * Determine comment traiter une nouvelle valeur de `content.items`.
 *
 * La discrimination porte sur l'offset amont, pas sur la seule existence d'une
 * requete en cours : une reponse tardive, ou un refetch declenche par WeWeb,
 * ne doit jamais etre confondue avec un changement de filtre.
 *
 * - `append` : l'offset amont correspond a la page demandee.
 * - `reset`  : aucune page n'etait demandee et l'offset amont est revenu a zero,
 *              signe que la requete a change (filtre, tri, refetch).
 * - `ignore` : une page est attendue mais l'offset amont ne correspond pas encore ;
 *              l'integrer melangerait deux paginations.
 */
export function classifyIncoming({ pendingOffset, currentOffset = 0 }) {
  const hasPending = pendingOffset !== null && pendingOffset !== undefined;
  const offset = isNonNegativeInteger(currentOffset) ? Number(currentOffset) : 0;

  if (hasPending) {
    if (offset === Number(pendingOffset)) return { mode: 'append', offset };
    return { mode: 'ignore', offset };
  }

  if (offset === 0) return { mode: 'reset', offset: 0 };

  // Aucune page demandee, mais l'offset amont n'est pas a zero : un tiers pilote la
  // pagination (Paginator concomitant, workflow). On accumule sans purger.
  return { mode: 'append', offset };
}

/**
 * Classe une page accumulee pour decider de la suite.
 *
 * Distingue une fin normale d'une anomalie : dans le contexte vise, une page vide
 * avant la fin annoncee ou une page sans aucun element nouveau ne peut pas se
 * produire et trahit une incoherence (mauvaise cle, collision, reponse au mauvais
 * offset). La presenter comme une fin normale masquerait la cause.
 */
export function classifyPage({ incomingCount, added, pagination }) {
  const valid = validatePagination(pagination);
  const atEnd = valid.ok ? isLastPage(valid) : false;

  if (incomingCount === 0) {
    if (atEnd) return { outcome: 'end' };
    return { outcome: 'error', code: ERROR_CODES.EMPTY_PAGE, message: ERROR_MESSAGES[ERROR_CODES.EMPTY_PAGE] };
  }

  if (added === 0) {
    return {
      outcome: 'error',
      code: ERROR_CODES.DUPLICATE_PAGE,
      message: ERROR_MESSAGES[ERROR_CODES.DUPLICATE_PAGE],
    };
  }

  if (atEnd) return { outcome: 'end' };
  return { outcome: 'continue' };
}

/* ------------------------------------------------------------------ *
 * Source paginee
 * ------------------------------------------------------------------ */

/**
 * Extrait l'identifiant de collection d'une valeur `PaginatedSource`, de la forme
 * `"collection:<uuid>"`. Retourne `null` pour toute autre forme, y compris
 * `tableView:<id>` qui n'est pas gere par ce composant.
 */
export function parsePaginatedSource(value) {
  if (!value || typeof value !== 'string') return null;
  const separator = value.indexOf(':');
  if (separator === -1) return null;
  const type = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (type !== 'collection' || !id) return null;
  return id;
}

/* ------------------------------------------------------------------ *
 * Machine a etats
 * ------------------------------------------------------------------ */

const TRANSITIONS = {
  [STATES.IDLE]: [STATES.LOADING, STATES.ENDED, STATES.FAILED],
  [STATES.LOADING]: [STATES.IDLE, STATES.TIMED_OUT, STATES.ENDED, STATES.FAILED],
  // Une reponse tardive peut encore resoudre une requete expiree.
  [STATES.TIMED_OUT]: [STATES.IDLE, STATES.ENDED, STATES.FAILED],
  // Terminaux, sauf reset legitime (changement de source ou de donnees initiales).
  [STATES.ENDED]: [STATES.IDLE],
  [STATES.FAILED]: [STATES.IDLE],
};

export function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

/** Seuls ces etats autorisent le declenchement d'un chargement. */
export function canLoad(state) {
  return state === STATES.IDLE;
}

/**
 * Applique une transition. Retourne l'etat inchange si elle n'est pas autorisee,
 * afin qu'une transition illegale ne corrompe pas l'etat silencieusement.
 */
export function transition(from, to) {
  if (from === to) return { state: from, changed: false };
  if (!canTransition(from, to)) return { state: from, changed: false, rejected: true };
  return { state: to, changed: true };
}
