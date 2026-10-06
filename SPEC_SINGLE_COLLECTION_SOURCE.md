# Changement de specification - Source de collection unique

## Statut

Proposition de specification pour la prochaine iteration du composant.

Ce document ne constitue pas l'implementation. Il remplace le contrat actuel a deux proprietes :

- `Collection`, bindee sur `maCollection.data` ;
- `Source paginee`, selectionnant une seconde fois la meme collection.

## Decision

Le composant doit exposer une seule propriete de source :

```text
Collection
```

Cette propriete est un selecteur de collection WeWeb. Sa valeur est l'identifiant de la collection choisie.

A partir de cet identifiant unique, le composant doit retrouver :

- les donnees reactives de la collection ;
- la limite ;
- l'offset courant ;
- le total ;
- l'API permettant de modifier l'offset.

Les proprietes actuelles `items` et `paginatedSource` doivent disparaitre de l'interface publique du composant.

## Confirmation de faisabilite

### Selecteur de collection

WeWeb fournit un type de propriete `Collection`, utilise par une version officielle du Paginator :

```js
collectionId: {
  label: {
    en: 'Collection',
    fr: 'Collection',
  },
  type: 'Collection',
  options: {
    paginated: true,
  },
  defaultValue: null,
}
```

La valeur runtime est directement l'identifiant de collection. Cet identifiant peut etre passe aux API de pagination utilisees par le Paginator officiel :

```js
wwLib.wwCollection.getPaginationOptions(collectionId)
wwLib.wwCollection.setOffset(collectionId, offset)
```

### Lecture des donnees par identifiant

Les donnees de la collection peuvent etre retrouvees dans le store WeWeb :

```js
wwLib.$store.getters['data/getCollections'][collectionId]
```

L'objet obtenu contient notamment la page courante dans `data`. Cet acces est utilise dans des plugins officiels WeWeb et peut etre lu depuis un `computed` Vue pour conserver la reactivite.

Limite importante : ce getter appartient au store interne WeWeb et n'est pas documente comme API publique stable. Il doit donc etre isole derriere une seule fonction defensive et couvert par une erreur explicite.

### Niveau de support

| Capacite | Niveau de confiance |
|---|---|
| Propriete `type: 'Collection'` | Confirmee par un composant officiel WeWeb |
| Option `paginated: true` | Confirmee par le Paginator officiel historique |
| `getPaginationOptions(id)` | Confirmee par le Paginator officiel |
| `setOffset(id, offset)` | Confirmee par le Paginator officiel |
| Lecture de `data` via `data/getCollections[id]` | Confirmee par des plugins officiels, mais API interne |
| API publique `getCollectionById(id)` | Non trouvee, ne pas la supposer disponible |

## Pourquoi ce changement est souhaitable

Le contrat actuel demande a l'utilisateur de designer deux fois la meme collection :

1. binder `Collection` sur `maCollection.data` ;
2. selectionner la meme collection dans `Source paginee`.

Cette redondance presente plusieurs problemes :

- configuration inutilement complexe ;
- possibilite de selectionner deux collections differentes ;
- responsabilite de coherence reportee sur l'utilisateur ;
- auto-detection par egalite de reference fragile ;
- support ambigu des formes tableau et `{ data: [...] }` ;
- messages d'erreur difficiles a comprendre lorsqu'une seule des deux proprietes est correcte.

Une source unique apporte :

- un seul choix dans le Studio ;
- une source de verite unique ;
- aucune auto-detection ;
- aucune comparaison de references de tableaux ;
- un code plus direct pour lire la pagination ;
- des erreurs plus precises ;
- une documentation plus simple.

Ce choix est recommande tant que le composant reste exclusivement dedie aux collections WeWeb. Si le support des Table Views devient un besoin, une nouvelle specification devra envisager `PaginatedSource` et une strategie distincte de lecture des donnees.

## Nouveau contrat public

### Propriete `collectionId`

Nom interne recommande :

```text
collectionId
```

Configuration WeWeb cible :

```js
collectionId: {
  label: {
    en: 'Collection',
    fr: 'Collection',
  },
  type: 'Collection',
  options: {
    paginated: true,
  },
  defaultValue: null,
}
```

Comportement attendu :

- seules les collections paginees devraient etre proposees si l'option est respectee par le Studio ;
- aucune valeur par defaut implicite ne doit etre selectionnee ;
- une collection doit etre choisie explicitement ;
- la propriete ne doit pas etre bindable ;
- les Table Views ne sont pas supportees dans cette version.

### Proprietes conservees

- `itemElement` ;
- `itemKey` ;
- `estimatedItemHeight` ;
- `rootMargin`.

### Proprietes supprimees

- `items` ;
- `paginatedSource`.

La suppression de `items` signifie que le composant ne peut plus recevoir un tableau arbitraire. Ce comportement est volontaire : un tableau sans identifiant de collection ne permet pas de piloter la pagination native de maniere fiable.

## Source de verite runtime

### Identifiant

L'identifiant vient uniquement de :

```js
props.content.collectionId
```

Il ne doit plus exister :

- d'analyse de valeur `collection:<id>` ;
- d'auto-detection par egalite de reference ;
- de parcours des collections pour deviner la source ;
- de fallback par workflow.

### Objet collection reactif

Le composant doit centraliser l'acces au store dans une fonction ou un `computed` unique :

```js
const selectedCollection = computed(() => {
  const id = props.content.collectionId;
  if (!id) return null;

  return wwLib.$store?.getters?.['data/getCollections']?.[id] ?? null;
});
```

Le reste du composant ne doit pas acceder directement au getter.

### Donnees courantes

La page courante doit etre derivee de l'objet selectionne :

```js
const incomingItems = computed(() => {
  const data = selectedCollection.value?.data;
  return Array.isArray(data) ? data : [];
});
```

Si WeWeb fournit une fonction officielle de normalisation dans la version runtime cible, elle peut etre utilisee defensivement :

```js
wwLib.wwCollection.getCollectionData(selectedCollection.value)
```

Cette fonction ne doit pas etre supposee capable de retrouver une collection a partir de son ID. Le lookup par ID reste distinct.

### Pagination

Les metadonnees restent lues par l'API deja utilisee :

```js
wwLib.wwCollection.getPaginationOptions(collectionId)
```

Les pages suivantes restent demandees par :

```js
wwLib.wwCollection.setOffset(collectionId, nextOffset)
```

## Etats de disponibilite de la collection

Le passage a une source unique doit aussi resoudre le risque de saut de la page initiale.

Le composant ne doit pas confondre :

```text
collection absente du store
collection en cours de chargement
collection chargee et vide
collection chargee avec des donnees
collection en erreur
```

### Regle de demarrage

Le composant ne doit jamais demander l'offset suivant avant d'avoir observe la resolution de la page courante, en particulier la page initiale a l'offset zero.

L'implementation doit rechercher dans l'objet collection les indicateurs de chargement et d'erreur fournis par la version WeWeb cible. Leur forme exacte doit etre verifiee dans le Studio avant implementation definitive.

Si aucun indicateur fiable n'est disponible, le composant doit adopter un comportement conservateur :

- ne pas considerer le premier `[]` comme une page initiale chargee ;
- attendre une transition observable de la collection ou un signal de disponibilite avant de demander l'offset suivant ;
- ne jamais appeler `setOffset(limit)` uniquement parce que la sentinelle est visible au montage.

### Collection vide

Une collection est consideree comme reellement vide uniquement lorsque :

- la source existe ;
- la pagination est valide ;
- le chargement initial est termine ;
- `total === 0` ;
- les donnees sont vides.

Alors seulement, le composant peut emettre `reachEnd` sans demander de page suivante.

## Gestion d'un changement de collection

Un changement de `collectionId` constitue un changement complet de source.

Le composant doit :

1. invalider toute requete de l'ancienne collection ;
2. annuler ses timers ;
3. vider l'accumulateur et les cles ;
4. revenir a l'etat d'initialisation ;
5. attendre la page initiale de la nouvelle collection ;
6. ignorer toute reponse tardive appartenant a l'ancien identifiant.

Une generation locale doit etre associee a la source selectionnee :

```text
sourceGeneration
```

Elle est incrementee a chaque changement de `collectionId`. Les callbacks asynchrones et timeouts doivent verifier qu'ils appartiennent toujours a la generation active.

Limite : si WeWeb remplace les donnees globales sans exposer l'identite de la requete, la generation locale ne peut pas identifier parfaitement chaque reponse. Elle garantit toutefois qu'un callback interne de l'ancienne source ne modifie pas l'etat de la nouvelle.

## Erreurs attendues

### Codes conserves

- `API_UNAVAILABLE` ;
- `PAGINATION_READ_FAILED` ;
- `NO_METADATA` ;
- `INVALID_LIMIT` ;
- `INVALID_OFFSET` ;
- `INVALID_TOTAL` ;
- `SET_OFFSET_FAILED` ;
- `FETCH_TIMEOUT` ;
- `EMPTY_PAGE` ;
- `DUPLICATE_PAGE`.

### Codes a ajouter ou renommer

#### `NO_COLLECTION_SELECTED`

Aucune collection n'est selectionnee dans la propriete `Collection`.

Message propose :

```text
Selectionnez une collection paginee dans la propriete Collection du composant.
```

#### `COLLECTION_NOT_FOUND`

L'identifiant est renseigne mais aucune collection correspondante n'est presente dans le store WeWeb.

Message propose :

```text
La collection selectionnee est introuvable dans le runtime WeWeb.
```

#### `COLLECTION_DATA_UNAVAILABLE`

La collection existe mais sa donnee courante ne peut pas etre lue comme un tableau apres resolution du chargement.

### Code supprime

`NO_SOURCE` doit etre remplace par les erreurs plus precises ci-dessus.

## Fin de collection

La fin normale reste fondee sur le total, mais la coherence de la page recue doit etre verifiee avec sa taille reelle.

Pour une page recue a l'offset `offset` :

```text
offset + incomingCount >= total
```

signifie que toutes les lignes annoncees ont ete couvertes.

La limite configuree ne doit pas remplacer `incomingCount` pour valider la page effectivement recue.

Exemple anormal :

```text
offset = 100
limit = 50
total = 137
incomingCount = 10
```

`offset + limit >= total` est vrai, mais seulement 110 lignes ont ete couvertes. Le composant doit emettre une erreur de page incomplete, pas `reachEnd`.

Un nouveau code peut etre introduit :

```text
INCOMPLETE_PAGE
```

## Migration des composants existants

Ce changement modifie le contrat sauvegarde dans WeWeb. La migration doit etre explicite.

### Strategie recommandee

La nouvelle version introduit `collectionId` et retire `items` et `paginatedSource` de la configuration publique.

Dans le Studio, l'utilisateur doit selectionner une fois la collection dans la nouvelle propriete `Collection`.

### Migration automatique eventuelle

Une migration editor-only peut etre envisagee si `paginatedSource` contient deja :

```text
collection:<id>
```

Elle pourrait enregistrer `<id>` dans `collectionId` puis supprimer les anciennes valeurs.

Cette migration ne doit etre implementee que si WeWeb garantit le mecanisme de mise a jour du contenu pour les composants deja poses. A defaut, documenter une migration manuelle est plus sure.

### Compatibilite ascendante

Il n'est pas recommande de conserver durablement les deux contrats en parallele. Cela maintiendrait la redondance que cette specification cherche a supprimer.

Une compatibilite temporaire n'est justifiee que pour migrer des instances deja publiees. Elle doit avoir une date ou une version de suppression claire.

## Modifications attendues par fichier

### `ww-config.js`

- supprimer `items` ;
- supprimer `paginatedSource` ;
- ajouter `collectionId` avec `type: 'Collection'` ;
- ajouter `options.paginated: true` ;
- mettre `collectionId` en premier dans l'ordre des proprietes ;
- reecrire les aides pour indiquer qu'un seul choix est necessaire.

### `src/wwElement.vue`

- supprimer la normalisation de `props.content.items` ;
- supprimer `parsePaginatedSource` ;
- supprimer l'auto-detection par egalite de reference ;
- ajouter un `computed` de collection selectionnee par ID ;
- deriver `incomingItems` de `selectedCollection.data` ;
- utiliser `collectionId` pour toutes les API de pagination ;
- surveiller `collectionId` pour reinitialiser completement l'etat ;
- ajouter une generation de source ;
- distinguer chargement initial et collection vide ;
- conserver les erreurs explicites et le verrou au timeout ;
- utiliser `incomingCount` pour verifier la fin de la page recue.

### `src/logic.mjs`

- supprimer `parsePaginatedSource` si elle n'est plus utilisee ;
- ajouter les nouveaux codes d'erreur ;
- adapter la classification de fin pour utiliser `incomingCount` ;
- ajouter `INCOMPLETE_PAGE` si retenu ;
- conserver les cles typees, la validation et la machine a etats.

### `test/logic.test.mjs`

- supprimer les tests de `parsePaginatedSource` ;
- ajouter les tests de page incomplete ;
- verifier la fin avec `offset + incomingCount` ;
- conserver les tests de timeout, doublons et cles typees.

### Tests de composant

Ajouter des tests runtime avec un faux store WeWeb :

- collection non selectionnee ;
- ID selectionne mais absent du store ;
- collection presente et page initiale en chargement ;
- page initiale vide avec `total > 0` sans saut vers l'offset suivant ;
- collection reellement vide avec `total === 0` ;
- lecture reactive de `collection.data` ;
- chargement de la page suivante ;
- timeout puis reponse tardive ;
- changement de collection pendant une requete ;
- reponse tardive de l'ancienne collection ignoree ;
- page finale partielle coherente ;
- page finale trop courte classee `INCOMPLETE_PAGE`.

### `README.md`

- remplacer les instructions de binding par un selecteur unique ;
- supprimer toute mention de `Source paginee` ;
- supprimer l'auto-detection ;
- expliquer la dependance au store interne WeWeb ;
- documenter la migration des instances existantes ;
- ne pas proposer de fallback workflow comme solution supportee.

## Criteres d'acceptation

### Experience Studio

- une seule propriete `Collection` est visible pour choisir les donnees ;
- aucune liaison manuelle sur `maCollection.data` n'est necessaire ;
- aucune seconde selection de la meme collection n'est demandee ;
- une collection non paginee ne doit idealement pas etre proposee ;
- changer la selection remplace proprement la liste affichee.

### Runtime

- l'ID choisi pilote a la fois les donnees et la pagination ;
- aucune auto-detection par reference n'est executee ;
- la page initiale n'est jamais sautee ;
- une collection vide est distinguee d'une collection en chargement ;
- les pages s'accumulent sans remplacement ;
- une reponse tardive ne purge pas les pages accumulees ;
- une ancienne collection ne peut pas alimenter la nouvelle apres changement de source ;
- la fin est validee avec le nombre reel d'elements recus ;
- toute panne bloque le chargement et emet un code explicite.

### Verification technique

- tests unitaires reussis ;
- tests de composant reussis ;
- build WeWeb reussi ;
- validation dans le Studio avec une collection Supabase paginee ;
- validation du changement de collection dans le Studio ;
- verification qu'une mise a jour de `collection.data` reactive declenche bien le watcher.

## Risques et mesures de reduction

### Getter interne WeWeb

Risque : `data/getCollections` n'est pas documente comme API publique stable.

Mesures :

- isoler cet acces dans une seule fonction ;
- verifier la presence du getter et de la collection ;
- ne lire que `data` ;
- emettre une erreur explicite si le contrat change ;
- tester la version WeWeb cible avant publication ;
- surveiller l'apparition d'une API publique `getCollectionById` et migrer lorsqu'elle existe.

### Evolution vers les Table Views

Risque : `Collection` limite volontairement le composant aux collections.

Mesure : ne pas generaliser prematurement. Si ce besoin apparait, definir une V2 de la source basee sur `PaginatedSource`, avec des adaptateurs distincts pour `collection` et `tableView`.

### Migration des instances existantes

Risque : les composants deja places contiennent les anciennes proprietes.

Mesure : choisir avant implementation entre une migration editor-only verifiee et une migration manuelle documentee. Ne pas maintenir indefiniment deux chemins runtime.

## Sources de reference

- Documentation des proprietes de composant WeWeb : `https://developer.weweb.io/api/content-property.html`
- Paginator officiel actuel, propriete `PaginatedSource` : `https://github.com/weweb-assets/ww-paginator`
- Paginator officiel historique utilisant `type: 'Collection'` et `options.paginated: true` : `https://github.com/weweb-assets/ww-paginator/blob/56a33e904942a971fc4e8519b7d33509fc6f958e/ww-config.js`
- Runtime du Paginator historique utilisant directement l'ID : `https://github.com/weweb-assets/ww-paginator/blob/56a33e904942a971fc4e8519b7d33509fc6f958e/src/wwElement.vue`
- Plugins officiels WeWeb utilisant `data/getCollections` : `https://github.com/weweb-assets/`

## Definition de termine

Le changement est termine lorsque l'utilisateur configure le composant en choisissant exactement une collection, et que cet identifiant unique suffit a afficher, accumuler et paginer ses donnees sans binding redondant, auto-detection ou fallback silencieux.
