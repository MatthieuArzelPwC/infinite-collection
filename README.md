# Infinite collection - composant WeWeb

Affiche et accumule les pages d'une collection WeWeb paginee. Le composant utilise une seule source, choisie dans la propriete `Collection`.

## Contrat

- collection dediee au composant ;
- une seule instance consommatrice ;
- aucun Paginator concomitant ;
- limite configuree dans WeWeb ;
- ordre serveur fixe et deterministe ;
- filtres et donnees inchanges pendant le parcours.

## Configuration

1. Choisir une collection dans `Collection`.
2. Configurer sa limite dans WeWeb, par exemple 50.
3. Fixer la hauteur du composant avec les styles standard WeWeb.
4. Deposer le contenu a repeter dans la Flexbox interne.
5. Choisir le mode de chargement.

## Modes de chargement

### Manuel

`Chargement manuel` est actif par defaut. Le bouton est rendu apres le dernier element de la collection et son libelle est configurable.

- Seul un clic demande une page.
- Le scroll ne charge rien.
- Pendant une requete, le bouton reste present mais est desactive.
- Apres un timeout, la requete reste verrouillee pour ne pas sauter de page.
- Le bouton de debug n'est jamais masque ou desactive par une decision de fin interne.
- Chaque clic avance exactement d'une limite depuis le dernier offset accepte et appelle `setOffset`.

### Automatique

Desactiver `Chargement manuel`. Le bouton disparait et le composant ecoute les evenements de scroll en capture afin de fonctionner que le scroll appartienne au composant, a un wrapper WeWeb ou a la page.

- Une seule requete peut etre en vol.
- Une nouvelle page est demandee quand la sentinelle approche a moins de 300 px du bas du conteneur qui defile reellement.
- Si la liste reste trop courte apres une page, le composant enchaine jusqu'a remplir la zone visible ou atteindre la fin.

## Pagination

L'identifiant selectionne sert a :

- lire la page courante via `$store.getters['data/getCollections'][id]` ;
- lire `limit`, `offset` et `total` avec `getPaginationOptions(id)` ;
- demander une page avec `setOffset(id, offset)`.

Le store est une API interne WeWeb. Son acces est isole dans un seul `computed`.

Les pages sont placees par position absolue. Le composant refuse les trous et ne tente pas de cohabiter avec un Paginator ou un workflow pilotant le meme offset.

## Evenements

### `loadMore`

Emis apres l'appel a `setOffset` avec `offset`, `limit`, `total` et `page`.

### `reachEnd`

Emis une seule fois lorsque le total est couvert. Charge utile : `total`, `loaded`.

### `error`

Charge utile : `code`, `message`. Les lignes deja affichees sont conservees.

Codes principaux :

- `NO_COLLECTION_SELECTED`
- `COLLECTION_NOT_FOUND`
- `COLLECTION_DATA_UNAVAILABLE`
- `COLLECTION_FETCH_FAILED`
- `API_UNAVAILABLE`
- `PAGINATION_READ_FAILED`
- `NO_METADATA`
- `INVALID_LIMIT`
- `INVALID_OFFSET`
- `INVALID_TOTAL`
- `SET_OFFSET_FAILED`
- `FETCH_TIMEOUT`
- `EMPTY_PAGE`
- `INCOMPLETE_PAGE`
- `UNEXPECTED_OFFSET`

## Performance

Les elements restent montes. `content-visibility: auto` et une reserve de 80 px limitent le travail de rendu hors ecran. Une vraie virtualisation reste hors perimetre de cette version.

## Developpement

```bash
npm test
npm run build
```

Le composant ne possede aucune dependance runtime.
