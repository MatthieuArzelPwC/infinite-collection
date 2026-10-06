/**
 * Diagnostic de la pagination d'une collection WeWeb.
 *
 * A coller dans la console du navigateur, sur une page ou le composant
 * infinite-collection n'est PAS pose : il consommerait setOffset en parallele et
 * faussererait les releves.
 *
 * Objectif : determiner comment WeWeb publie `collection.data` apres un passage a
 * la page suivante. Deux hypotheses s'opposent, et elles conduisent a deux
 * implementations incompatibles de l'accumulateur.
 *
 *   positions absolues   data = [ vide x12, {12}, {13}, ... ]  -> length 24
 *   remplacement simple  data = [ {12}, {13}, ... ]            -> length 12
 *
 * Dans le premier cas, l'index porte la position et l'accumulation est une simple
 * projection, sans suivi d'offset ni generation de requete. Dans le second, il
 * faut memoriser l'offset demande pour savoir ou ranger la page recue.
 */

(async () => {
  const ID = '940b1a98-4217-49b5-89b0-cd24953ef137';
  const LIMITE_ATTENDUE = 12;
  const TOTAL_ATTENDU = 95;

  const ligne = texte => console.log(`%c${texte}`, 'font-weight:bold');

  // --- Verifications prealables ---------------------------------------------

  if (typeof wwLib === 'undefined') {
    console.error('wwLib absent : executer ce script dans l onglet de la page WeWeb, pas dans celui de l editeur.');
    return;
  }

  const toutes = (() => {
    try {
      return wwLib.$store.getters['data/getCollections'] || {};
    } catch (error) {
      console.error('Lecture du store impossible :', error);
      return null;
    }
  })();

  if (!toutes) return;

  if (!toutes[ID]) {
    // Une collection de portee page n'existe pas dans le store d'une autre page.
    // C'est le piege du test sur page vide.
    console.error(`Collection ${ID} absente du store de cette page.`);
    ligne('Collections disponibles ici :');
    console.table(
      Object.entries(toutes).map(([id, c]) => ({
        id,
        name: c?.name ?? null,
        lignes: Array.isArray(c?.data) ? c.data.length : null,
      }))
    );
    console.log(
      'Si la collection est de portee page, executer le script sur la page qui la declare, ou y ajouter un element qui la consomme.'
    );
    return;
  }

  const collection = () => wwLib.$store.getters['data/getCollections'][ID];
  const metadonnees = () => {
    try {
      return wwLib.wwCollection.getPaginationOptions(ID);
    } catch (error) {
      return { erreur: String(error?.message || error) };
    }
  };

  // --- Releve ----------------------------------------------------------------

  const releve = etape => {
    const c = collection();
    const d = c?.data;
    const tableau = Array.isArray(d) ? d : null;

    const presents = [];
    const trousReels = [];
    const videsExplicites = [];

    if (tableau) {
      for (let i = 0; i < tableau.length; i += 1) {
        // Un trou reel (`i in arr` faux) est saute par forEach, map et filter.
        // Un vide explicite (null) ne l'est pas. La distinction change le code.
        if (!(i in tableau)) {
          trousReels.push(i);
          continue;
        }
        const valeur = tableau[i];
        if (valeur === null || valeur === undefined) videsExplicites.push(i);
        else presents.push(i);
      }
    }

    const resultat = {
      etape,
      pagination: JSON.stringify(metadonnees()),
      estTableau: !!tableau,
      length: tableau ? tableau.length : null,
      nbPresents: presents.length,
      premierPresent: presents.length ? presents[0] : null,
      dernierPresent: presents.length ? presents[presents.length - 1] : null,
      nbVidesExplicites: videsExplicites.length,
      nbTrousReels: trousReels.length,
      indexZeroDefini: tableau ? 0 in tableau : null,
      isFetching: c?.isFetching,
      isFetched: c?.isFetched,
      error: c?.error ?? null,
      cles: c ? Object.keys(c).join(', ') : null,
      refData: d,
    };

    const { refData, ...affichable } = resultat;
    console.table(affichable);
    return resultat;
  };

  /**
   * Attend la reponse plutot que de supposer un delai.
   *
   * Sort des que la reference de `data` change ou que `isFetching` retombe, ce qui
   * evite a la fois de mesurer trop tot et d'attendre inutilement.
   */
  const attendreReponse = async (refInitiale, maxMs = 8000) => {
    const debut = Date.now();
    let fetchingVu = false;

    while (Date.now() - debut < maxMs) {
      const c = collection();
      if (c?.isFetching === true) fetchingVu = true;
      const change = c?.data !== refInitiale;
      const termine = fetchingVu && c?.isFetching !== true;
      if (change && (termine || Date.now() - debut > 1200)) {
        return { attenduMs: Date.now() - debut, fetchingVu, refChangee: true };
      }
      await new Promise(r => setTimeout(r, 100));
    }

    return { attenduMs: Date.now() - debut, fetchingVu, refChangee: collection()?.data !== refInitiale };
  };

  // --- Deroule ---------------------------------------------------------------

  ligne('ETAPE 1 — etat initial');
  const avant = releve('page 1 (offset 0)');

  const meta = metadonnees();
  if (meta?.limit !== LIMITE_ATTENDUE || meta?.total !== TOTAL_ATTENDU) {
    console.warn(
      `Metadonnees inattendues : limit=${meta?.limit} total=${meta?.total} (attendu ${LIMITE_ATTENDUE} et ${TOTAL_ATTENDU}). Le verdict reste valable mais les chiffres attendus changent.`
    );
  }
  if (avant.pagination && meta?.offset !== 0) {
    console.warn(`La collection est deja a l offset ${meta?.offset}. Pour un test propre : wwLib.wwCollection.setOffset('${ID}', 0)`);
  }

  ligne(`ETAPE 2 — setOffset(${LIMITE_ATTENDUE})`);
  wwLib.wwCollection.setOffset(ID, LIMITE_ATTENDUE);

  await new Promise(r => setTimeout(r, 250));
  const pendant = releve('pendant le fetch (+250ms)');

  const attente = await attendreReponse(avant.refData);
  ligne(`ETAPE 3 — etat final (apres ${attente.attenduMs}ms)`);
  const apres = releve(`page 2 (offset ${LIMITE_ATTENDUE})`);

  // --- Verdict ---------------------------------------------------------------

  ligne('VERDICT');

  const v1 = (() => {
    if (!apres.estTableau) return 'INDETERMINE — data n est pas un tableau';
    if (apres.premierPresent === LIMITE_ATTENDUE && apres.length === LIMITE_ATTENDUE * 2) {
      return 'POSITIONS ABSOLUES — data[12..23] remplis, data[0..11] liberes. L accumulateur par projection est correct.';
    }
    if (apres.length === TOTAL_ATTENDU) {
      return 'TAILLE DU TOTAL — data couvre toute la collection. Positions absolues confirmees, total lisible depuis data.';
    }
    if (apres.premierPresent === 0 && apres.nbPresents === LIMITE_ATTENDUE) {
      return 'REMPLACEMENT SIMPLE — data ne contient que la page courante. L accumulateur doit decaler par l offset demande.';
    }
    return `AUTRE — length=${apres.length}, premierPresent=${apres.premierPresent}, nbPresents=${apres.nbPresents}`;
  })();

  console.log('V1 forme de data   :', v1);
  console.log(
    'V2 tableau creux   :',
    apres.nbTrousReels > 0
      ? `OUI — ${apres.nbTrousReels} trous reels. Boucle for indexee obligatoire, forEach les sauterait.`
      : 'NON — positions vides explicites, iteration classique possible.'
  );
  console.log(
    'V3 reference data  :',
    apres.refData === avant.refData ? 'MUTEE — meme tableau modifie en place' : 'REMPLACEE — nouveau tableau publie'
  );
  console.log(
    'V4 indicateurs     :',
    `isFetching vu pendant le fetch : ${attente.fetchingVu ? 'OUI' : 'NON'}, final isFetching=${apres.isFetching}, isFetched=${apres.isFetched}`
  );
  console.log('V5 cles collection :', apres.cles);

  window.__diag = { avant, pendant, apres, attente };
  console.log(`Detail brut dans window.__diag. Pour revenir a la page 1 : wwLib.wwCollection.setOffset('${ID}', 0)`);
})();
