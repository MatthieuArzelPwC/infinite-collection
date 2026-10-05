/**
 * Logique pure du composant, sans dependance a Vue ni a wwLib.
 * Isolee ici pour etre testable hors du studio WeWeb (voir test/logic.test.mjs).
 */

/**
 * Calcule la cle d'un element.
 *
 * Si `itemKey` designe un champ exploitable, on l'utilise : la deduplication
 * resiste alors au rechargement d'une meme page et au chevauchement de deux pages.
 * Sinon on retombe sur l'index absolu dans la collection (offset + index local),
 * qui reste unique entre pages mais ne detecte pas un doublon livre a deux offsets
 * differents.
 */
export function resolveKey(item, absoluteIndex, itemKey) {
  if (itemKey && item !== null && typeof item === 'object') {
    const raw = item[itemKey];
    if (raw !== undefined && raw !== null && raw !== '') {
      return `k:${String(raw)}`;
    }
  }
  return `i:${absoluteIndex}`;
}

/**
 * Fusionne une page recue dans l'accumulateur, en ignorant les doublons.
 *
 * Retourne de nouvelles references (jamais de mutation en place) pour que la
 * reactivite Vue se declenche correctement.
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

/**
 * Construit l'accumulateur a partir d'une page unique (premier chargement ou reset).
 */
export function resetItems({ incoming = [], offset = 0, itemKey }) {
  return mergeItems({ current: [], keys: new Set(), incoming, offset, itemKey });
}

/**
 * Decide s'il faut demander la page suivante.
 *
 * - `error` : la collection n'a pas de limite. Cote plugin Supabase, `range()` et
 *   le `count: 'exact'` ne sont appliques que si `limit` est definie ; sans limite
 *   il n'y a ni pagination serveur ni total fiable, donc rien a paginer.
 * - `end`   : tout est charge.
 * - `fetch` : offset de la page suivante.
 */
export function planNextFetch({ limit, offset = 0, total, loadedCount = 0 }) {
  const safeLimit = Number(limit);
  if (!Number.isFinite(safeLimit) || safeLimit <= 0) {
    return {
      action: 'error',
      message:
        'La collection doit avoir une limite configuree dans le studio WeWeb pour etre paginee.',
    };
  }

  const safeOffset = Number.isFinite(Number(offset)) ? Number(offset) : 0;
  // `Number(null)` vaut 0 : il faut ecarter explicitement null/undefined/'' pour ne
  // pas confondre « total inconnu » et « total nul ».
  const hasTotal =
    total !== null && total !== undefined && total !== '' && Number.isFinite(Number(total)) && Number(total) >= 0;
  const safeTotal = hasTotal ? Number(total) : null;

  if (hasTotal && loadedCount >= safeTotal) return { action: 'end', total: safeTotal };

  const nextOffset = safeOffset + safeLimit;
  if (hasTotal && nextOffset >= safeTotal) return { action: 'end', total: safeTotal };

  return { action: 'fetch', offset: nextOffset, limit: safeLimit, total: hasTotal ? safeTotal : null };
}

/**
 * Determine comment traiter une nouvelle valeur de `content.items`.
 *
 * `append` quand la page avait ete demandee par le composant, `reset` sinon : un
 * changement de donnees non sollicite signifie que la requete amont a change
 * (filtre, tri, refetch) et que l'accumulateur n'est plus valide.
 */
export function classifyIncoming({ pendingOffset, currentOffset = 0 }) {
  if (pendingOffset === null || pendingOffset === undefined) {
    return { mode: 'reset', offset: currentOffset };
  }
  return { mode: 'append', offset: pendingOffset };
}

/**
 * Extrait l'identifiant de collection d'une valeur `PaginatedSource`,
 * de la forme `"collection:<uuid>"`.
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
