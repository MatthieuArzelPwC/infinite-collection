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
  /** Aucune page initiale observee : on ne doit pas demander d'offset suivant. */
  INITIALIZING: 'initializing',
  IDLE: 'idle',
  LOADING: 'loading',
  TIMED_OUT: 'timedOut',
  ENDED: 'ended',
  FAILED: 'failed',
};

/** Codes d'erreur, pour que chaque panne soit identifiable dans un workflow. */
export const ERROR_CODES = {
  NO_COLLECTION_SELECTED: 'NO_COLLECTION_SELECTED',
  COLLECTION_NOT_FOUND: 'COLLECTION_NOT_FOUND',
  COLLECTION_DATA_UNAVAILABLE: 'COLLECTION_DATA_UNAVAILABLE',
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
  DUPLICATE_PAGE: 'DUPLICATE_PAGE',
};

export const ERROR_MESSAGES = {
  [ERROR_CODES.NO_COLLECTION_SELECTED]:
    'Selectionnez une collection paginee dans la propriete Collection du composant.',
  [ERROR_CODES.COLLECTION_NOT_FOUND]:
    'La collection selectionnee est introuvable dans le runtime WeWeb.',
  [ERROR_CODES.COLLECTION_DATA_UNAVAILABLE]:
    'Les donnees de la collection selectionnee ne peuvent pas etre lues comme une liste.',
  [ERROR_CODES.API_UNAVAILABLE]:
    'La pagination native WeWeb est indisponible dans cette version.',
  [ERROR_CODES.PAGINATION_READ_FAILED]:
    'La lecture des informations de pagination de la collection a echoue.',
  [ERROR_CODES.NO_METADATA]:
    'La collection ne fournit pas d informations de pagination. Verifiez qu une limite est configuree.',
  [ERROR_CODES.INVALID_LIMIT]:
    'La collection doit avoir une limite entiere superieure a zero, configuree dans le studio WeWeb.',
  [ERROR_CODES.INVALID_OFFSET]: 'L offset de la collection est invalide.',
  [ERROR_CODES.INVALID_TOTAL]:
    'Le total de la collection est invalide. Une limite doit etre configuree pour que WeWeb calcule le total.',
  [ERROR_CODES.SET_OFFSET_FAILED]: 'La demande de page suivante a echoue.',
  [ERROR_CODES.FETCH_TIMEOUT]:
    'Le chargement de la page a depasse le delai autorise. Le composant reste en attente afin d eviter une pagination incoherente.',
  [ERROR_CODES.EMPTY_PAGE]: 'La collection a retourne une page vide avant la fin annoncee.',
  [ERROR_CODES.INCOMPLETE_PAGE]:
    'La page recue est plus courte qu annonce : toutes les lignes du total ne sont pas couvertes.',
  [ERROR_CODES.DUPLICATE_PAGE]:
    'La page recue ne contient aucun nouvel element, signe d une pagination incoherente.',
};

export function describeError(code, details) {
  const message = ERROR_MESSAGES[code] || 'Erreur de pagination inconnue.';
  return { ok: false, code, message: details ? `${message} (${details})` : message };
}

/* ------------------------------------------------------------------ *
 * Accumulation
 * ------------------------------------------------------------------ */

/**
 * Fusionne une page recue dans l'accumulateur.
 *
 * Avec une pagination par offset, la position absolue d'une ligne (offset + index dans
 * la page) l'identifie deja de maniere unique : la ligne a l'offset 50 position 3 est
 * la 53e, quelle que soit la forme des donnees. Aucune cle metier n'est donc requise,
 * et aucune n'est demandee a l'utilisateur.
 *
 * Cette position sert aussi de garde-fou : si la meme page est livree deux fois, ses
 * lignes portent les memes positions et ne sont pas dupliquees.
 *
 * Retourne de nouvelles references (jamais de mutation en place) pour que la
 * reactivite Vue se declenche.
 */
export function mergeItems({ current = [], keys, incoming = [], offset = 0 }) {
  const nextKeys = new Set(keys || []);
  const nextItems = current.slice();
  let added = 0;

  for (let i = 0; i < incoming.length; i += 1) {
    const position = offset + i;
    if (nextKeys.has(position)) continue;
    nextKeys.add(position);
    nextItems.push({ key: position, data: incoming[i] });
    added += 1;
  }

  return { items: nextItems, keys: nextKeys, added };
}

/** Construit l'accumulateur a partir d'une page unique (premier chargement ou reset). */
export function resetItems({ incoming = [], offset = 0 }) {
  return mergeItems({ current: [], keys: new Set(), incoming, offset });
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

/**
 * Vrai s'il reste des lignes a charger d'apres les metadonnees.
 *
 * Sert a decider l'affichage du declencheur manuel : il doit rester visible tant que
 * le total n'est pas couvert, independamment de l'etat interne du composant. Sans
 * cela, un refetch amont le ferait disparaitre alors qu'il reste des pages.
 */
export function hasMorePages(pagination) {
  const valid = validatePagination(pagination);
  if (!valid.ok) return false;
  return !isLastPage(valid);
}

/**
 * Hauteur de reserve d'un element, en pixels.
 *
 * Alimente `contain-intrinsic-size`. La mesure reelle est preferee des qu'au moins un
 * element a ete rendu ; la valeur par defaut ne sert qu'au premier rendu.
 */
export function resolveItemHeight({ measured, fallback = 80 }) {
  if (Number.isFinite(measured) && measured > 0) return Math.round(measured);
  if (Number.isFinite(fallback) && fallback > 0) return Math.round(fallback);
  return 80;
}

/**
 * Distance de declenchement, en pixels.
 *
 * Derivee de la hauteur visible du conteneur plutot que saisie a la main : une marge
 * fixe est soit inutile sur un grand conteneur, soit insuffisante sur un petit.
 * On precharge `screens` fois la hauteur visible, avec un plancher qui garantit le
 * declenchement meme dans un conteneur tres court.
 */
export function resolveTriggerDistance({ viewportHeight, itemHeight, screens = 1 }) {
  const safeScreens = Number.isFinite(screens) && screens > 0 ? screens : 1;
  const height = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 0;
  const item = Number.isFinite(itemHeight) && itemHeight > 0 ? itemHeight : 80;

  // Au moins deux elements d'avance, sinon le chargement arrive trop tard sur un
  // conteneur de la hauteur d'une seule ligne.
  const floor = item * 2;
  return Math.max(Math.round(height * safeScreens), floor, 100);
}

/* ------------------------------------------------------------------ *
 * Disponibilite de la collection
 * ------------------------------------------------------------------ */

/**
 * Determine si la page initiale d'une collection peut etre consideree comme resolue.
 *
 * Sans cette distinction, un premier rendu ou `data` vaut `[]` parce que la collection
 * n'a pas encore ete fetchee serait pris pour une page initiale vide, et le composant
 * demanderait aussitot l'offset suivant : la page 0 serait sautee.
 *
 * Les indicateurs WeWeb (`isFetching`, `isFetched`) sont lus defensivement : leur
 * presence n'est pas garantie selon la version du runtime.
 */
export function assessCollection(collection) {
  if (!collection || typeof collection !== 'object') {
    return { status: 'missing' };
  }

  if (collection.error) return { status: 'error', error: collection.error };
  if (collection.isFetching === true) return { status: 'loading' };

  const data = collection.data;
  if (!Array.isArray(data)) {
    // `isFetched === false` indique explicitement une collection pas encore chargee.
    if (collection.isFetched === false) return { status: 'loading' };
    if (data === null || data === undefined) return { status: 'loading' };
    return { status: 'invalid' };
  }

  // Donnees presentes : la collection a servi au moins une reponse.
  if (data.length > 0) return { status: 'ready', data };

  // Tableau vide : fiable seulement si WeWeb confirme que le fetch a eu lieu.
  if (collection.isFetched === true) return { status: 'ready', data };
  if (collection.isFetched === undefined && collection.isFetching === false) {
    return { status: 'ready', data };
  }

  return { status: 'loading' };
}

/* ------------------------------------------------------------------ *
 * Classification d'une page recue
 * ------------------------------------------------------------------ */

/**
 * Determine comment traiter une nouvelle valeur des donnees de la collection.
 *
 * La discrimination porte sur l'offset amont, pas sur la seule existence d'une
 * requete en cours : une reponse tardive, ou un refetch declenche par WeWeb,
 * ne doit jamais etre confondue avec un changement de filtre.
 */
export function classifyIncoming({ pendingOffset, currentOffset = 0, previousCount = 0, incomingCount = 0 }) {
  const hasPending = pendingOffset !== null && pendingOffset !== undefined;
  const offset = isNonNegativeInteger(currentOffset) ? Number(currentOffset) : 0;

  if (hasPending) {
    const expected = Number(pendingOffset);

    // Cas nominal : l'offset amont reflete la page demandee.
    if (offset === expected) return { mode: 'append', offset: expected };

    // WeWeb peut publier les donnees AVANT que getPaginationOptions() ne reflete le
    // nouvel offset. Refuser la page dans ce cas bloquait definitivement le composant :
    // le verrou n'etait jamais relache. On fait donc confiance a l'offset demande, qui
    // est celui que l'on vient d'appliquer.
    return { mode: 'append', offset: expected, offsetLagging: true };
  }

  if (offset === 0) return { mode: 'reset', offset: 0 };

  // Aucune page demandee, mais l'offset amont n'est pas a zero : un tiers pilote la
  // pagination (Paginator concomitant, workflow). On accumule sans purger.
  return { mode: 'append', offset };
}

/**
 * Classe une page accumulee pour decider de la suite.
 *
 * La couverture est evaluee avec le nombre d'elements REELLEMENT recus, pas avec la
 * limite configuree : a l'offset 100 avec limit=50 et total=137, recevoir 10 lignes
 * satisfait `offset + limit >= total` alors que seules 110 lignes sont couvertes.
 * C'est une page incomplete, pas une fin de collection.
 */
export function classifyPage({ incomingCount, added, pagination }) {
  const valid = validatePagination(pagination);

  if (!valid.ok) {
    // Sans metadonnees fiables, seule une page vide permet de conclure.
    if (incomingCount === 0) return { outcome: 'end' };
    if (added === 0) {
      return {
        outcome: 'error',
        code: ERROR_CODES.DUPLICATE_PAGE,
        message: ERROR_MESSAGES[ERROR_CODES.DUPLICATE_PAGE],
      };
    }
    return { outcome: 'continue' };
  }

  const { offset, total } = valid;
  const covered = offset + incomingCount;
  const claimsLastPage = isLastPage(valid);

  if (incomingCount === 0) {
    if (total === 0 || covered >= total) return { outcome: 'end' };
    return { outcome: 'error', code: ERROR_CODES.EMPTY_PAGE, message: ERROR_MESSAGES[ERROR_CODES.EMPTY_PAGE] };
  }

  if (added === 0) {
    return {
      outcome: 'error',
      code: ERROR_CODES.DUPLICATE_PAGE,
      message: ERROR_MESSAGES[ERROR_CODES.DUPLICATE_PAGE],
    };
  }

  if (covered >= total) return { outcome: 'end' };

  // La derniere page annoncee est arrivee mais ne couvre pas le total : la source est
  // incoherente. Le signaler evite de presenter une liste tronquee comme complete.
  if (claimsLastPage) {
    return {
      outcome: 'error',
      code: ERROR_CODES.INCOMPLETE_PAGE,
      message: `${ERROR_MESSAGES[ERROR_CODES.INCOMPLETE_PAGE]} (couvert=${covered}, total=${total})`,
    };
  }

  return { outcome: 'continue' };
}

/* ------------------------------------------------------------------ *
 * Machine a etats
 * ------------------------------------------------------------------ */

const TRANSITIONS = {
  // La page initiale doit etre observee avant tout chargement.
  [STATES.INITIALIZING]: [STATES.IDLE, STATES.ENDED, STATES.FAILED],
  [STATES.IDLE]: [STATES.LOADING, STATES.ENDED, STATES.FAILED],
  [STATES.LOADING]: [STATES.IDLE, STATES.TIMED_OUT, STATES.ENDED, STATES.FAILED],
  // Une reponse tardive peut encore resoudre une requete expiree.
  [STATES.TIMED_OUT]: [STATES.IDLE, STATES.ENDED, STATES.FAILED],
  // Terminaux, sauf reset legitime (changement de source ou de donnees initiales).
  [STATES.ENDED]: [STATES.INITIALIZING, STATES.IDLE],
  [STATES.FAILED]: [STATES.INITIALIZING, STATES.IDLE],
};

export function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

/** Seul `idle` autorise le declenchement d'un chargement. */
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
