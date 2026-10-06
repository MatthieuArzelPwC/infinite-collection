# Infinite collection — composant codé WeWeb

Affiche une collection WeWeb en scroll infini : le composant répète le contenu qu'on
glisse dedans et charge la page suivante quand on approche du bas de la liste.

La pagination reste celle de la collection native : la limite est configurée dans le
studio, le composant ne fait varier que l'offset, exactement comme le fait le
Paginator standard.

## Prérequis de production

Le composant est conçu pour ce contexte précis. S'en écarter peut produire une
pagination incohérente.

- une collection **dédiée** au composant ;
- une **seule** instance consommatrice de cette collection ;
- **aucun Paginator** branché sur la même collection ;
- une **limite** configurée sur la collection (ex. 50) ;
- un **total** disponible — fourni par WeWeb dès qu'une limite existe ;
- un **ordre serveur déterministe**, incluant une colonne unique dans le tri ;
- une **clé métier scalaire, stable et unique** sur toute la collection ;
- filtres et tris **inchangés** pendant le défilement ;
- données **non modifiées** pendant le défilement.

Une **seule** propriété désigne la source : `Collection`. Aucun binding manuel sur
`maCollection.data` n'est nécessaire.

## Installation

Prérequis : Node.js 18 ou plus récent.

```bash
npm install
npm run serve
```

Dans WeWeb :

1. Ouvrir le projet, puis `Dev` > `Open Dev Editor`.
2. Dans le Dev Editor, `Dev` > `Element` > `Add local Element`, port `8080`.
3. Glisser `Collection infinie` sur la page.

Le serveur utilise HTTPS. Ouvrir `https://localhost:8080` une première fois pour
accepter le certificat local.

## Configuration dans le studio

### 1. La collection doit avoir une limite

C'est la condition déterminante. Dans le plugin Supabase, la pagination serveur et le
comptage ne sont appliqués que si une limite est définie :

```js
.select(fields, { count: collection.limit ? 'exact' : null })
if (collection.limit) {
  query.range(collection.offset, collection.offset + collection.limit - 1);
}
```

Sans limite : pas de `range()`, pas de `total`. Le composant s'arrête alors et émet
`error` avec le code `INVALID_LIMIT`, plutôt que de tourner à vide.

Une valeur de 50 est un bon point de départ.

### 2. Sélectionner la collection

Choisir la collection dans la propriété `Collection` (onglet Settings). Cet unique
identifiant sert à la fois à lire les données et à piloter la pagination.

Seules les collections paginées sont proposées. Si aucune n'est sélectionnée, le
composant reste inerte sans émettre d'erreur — il attend d'être configuré.

### 4. Fixer la hauteur

Le composant n'a **pas** de propriété de hauteur : il utilise les propriétés de style
standard de WeWeb. Fixer par exemple `30vh` dans la section Style. C'est cette hauteur
qui crée la zone de défilement.

### 5. Glisser le contenu répété

Le composant contient une Flexbox. Y glisser la div ou le composant personnalisé à
répéter. Les données de l'élément courant sont accessibles au binding dans tout ce qui
est placé à l'intérieur.

### 6. Renseigner la clé unique

`Cle unique` (par défaut `id`) sert à dédupliquer les éléments entre deux pages. La
valeur doit être **scalaire** : un objet ou un tableau serait converti en
`[object Object]`, toutes les lignes partageraient la même clé et seraient fusionnées
en une seule. Dans ce cas le composant retombe sur l'index absolu.

Le type fait partie de la clé : `5` (nombre) et `"5"` (texte) ne collisionnent pas.

## Propriétés

| Propriété | Rôle | Défaut |
|---|---|---|
| `Collection` | Collection à afficher et paginer — source unique | `null` |
| `Cle unique` | Champ scalaire identifiant un élément | `id` |
| `Chargement manuel` | Lien cliquable au lieu du défilement automatique | `false` |
| `Libelle du chargement manuel` | Texte du lien, si mode manuel | `Charger la suite` |
| `Prechargement (ecrans)` | Anticipation, en hauteurs de zone visible | `1` |

### Chargement manuel

Avec `Chargement manuel` activé, un lien apparaît en fin de liste et la page suivante
n'est chargée qu'au clic. Le défilement ne déclenche plus rien, et
`Prechargement (ecrans)` est masqué.

Le lien reste visible **tant que le total n'est pas couvert**, indépendamment de l'état
interne : un refetch de la collection ne le fait pas disparaître alors qu'il reste des
pages à charger.

Utile pour diagnostiquer la pagination : chaque clic correspond à exactement une
requête, ce qui rend l'observation dans l'onglet Network sans ambiguïté.

## Événements

### `On load more`

Notification émise **après** une demande de page native réussie. Elle ne pilote pas la
pagination : le composant l'a déjà déclenchée.

Charge utile : `offset`, `limit`, `total`, `page`.

### `On reach end`

Fin normale, déterminée par l'offset et le total (`offset + limit >= total`).

Charge utile : `total`, `loaded`.

### `On error`

Charge utile : `code`, `message`.

| Code | Cause |
|---|---|
| `NO_COLLECTION_SELECTED` | aucune collection choisie dans `Collection` |
| `COLLECTION_NOT_FOUND` | identifiant renseigné mais absent du runtime WeWeb |
| `COLLECTION_DATA_UNAVAILABLE` | les données ne sont pas une liste exploitable |
| `API_UNAVAILABLE` | la pagination native WeWeb est absente de cette version |
| `PAGINATION_READ_FAILED` | exception à la lecture des métadonnées |
| `NO_METADATA` | la collection ne fournit pas d'informations de pagination |
| `INVALID_LIMIT` | limite absente, nulle, négative ou fractionnaire |
| `INVALID_OFFSET` | offset négatif ou fractionnaire |
| `INVALID_TOTAL` | total absent ou invalide — généralement une limite manquante |
| `SET_OFFSET_FAILED` | la demande de page suivante a échoué |
| `FETCH_TIMEOUT` | la page n'est pas arrivée dans le délai imparti |
| `EMPTY_PAGE` | page vide reçue alors que le total annonçait des lignes |
| `INCOMPLETE_PAGE` | la dernière page ne couvre pas le total annoncé |
| `DUPLICATE_PAGE` | page reçue sans aucun élément nouveau |

Dans tous les cas, **les éléments déjà affichés sont conservés** : une panne de
pagination ne fait pas disparaître ce que l'utilisateur voit.

## Comportement en cas d'anomalie

### Page vide avant la fin annoncée (`EMPTY_PAGE`)

Le total promettait davantage. Signale une incohérence côté source, pas une fin.

### Page sans élément nouveau (`DUPLICATE_PAGE`)

Dans le contexte prévu, cela ne peut pas se produire. Les causes probables :

- clé unique mal choisie ou non unique ;
- collision de clés ;
- réponse correspondant au mauvais offset ;
- données modifiées pendant le défilement.

Ce n'est **pas** une preuve que toute la collection est chargée, et c'est pourquoi le
composant émet `error` au lieu de `reachEnd`.

### Délai dépassé (`FETCH_TIMEOUT`)

Après 10 secondes sans réponse :

- une erreur est émise, une seule fois ;
- aucune autre page n'est demandée ;
- **le verrou est conservé** : une réponse tardive portant l'offset attendu est encore
  intégrée normalement ;
- les données déjà affichées sont conservées.

Le verrou est volontairement maintenu. Le relâcher ferait classer la réponse tardive
comme un changement de filtre, et toutes les pages accumulées seraient remplacées par
la dernière reçue.

## Comment la pagination est pilotée

L'identifiant choisi dans `Collection` sert à tout :

- les données, lues dans le store WeWeb ;
- la limite, l'offset et le total, via `getPaginationOptions(id)` ;
- la demande de page suivante, via `setOffset(id, offset)`.

Il n'y a plus d'auto-détection par égalité de référence, ni de seconde propriété à
renseigner.

### Dépendance aux APIs internes

Trois mécanismes ne sont pas documentés comme API publique stable :

| Mécanisme | Attesté par |
|---|---|
| `type: 'Collection'` + `options.paginated` | Paginator officiel WeWeb |
| `getPaginationOptions(id)` / `setOffset(id, offset)` | Paginator officiel WeWeb |
| `$store.getters['data/getCollections'][id]` | plugins officiels WeWeb |

La lecture du store est isolée dans un `computed` unique (`selectedCollection`) : si le
contrat WeWeb change, il n'y a qu'un point à corriger, et le composant émet
`COLLECTION_NOT_FOUND` au lieu d'échouer silencieusement.

### Si ces APIs cessent de fonctionner

Un repli par workflow a existé puis a été retiré volontairement, pour que le prototype
teste le mécanisme principal sans masquer ses pannes. Pour le réintroduire :

1. dans `loadMore()`, remplacer le `fail(...)` de la branche sans pagination par une
   émission de `loadMore` avec `offset: null` ;
2. dans le studio, câbler `On load more` → `Change variable offset` →
   `Fetch collection` ;
3. binder le paramètre d'offset de la collection sur cette variable.

## Accumulation des pages

`setOffset()` **remplace** la page courante : à l'offset 50, la collection contient les
éléments 50 à 99, et plus les 0 à 49. Le composant accumule donc les pages lui-même, en
dédupliquant par clé.

Une page reçue n'est accumulée que si l'offset de la collection correspond à celui
demandé. L'accumulateur n'est purgé que lorsqu'aucune page n'était attendue et que
l'offset amont est revenu à zéro — signe d'un changement de filtre ou de tri.

## Performance

Les éléments déjà chargés ne sont jamais retirés du DOM. Chacun porte :

```css
content-visibility: auto;
contain-intrinsic-size: auto var(--ic-item-height);
```

Le navigateur saute la mise en page et le rendu des éléments hors écran tout en les
conservant dans le DOM. Pas de recyclage, donc aucune rupture de `z-index`, de
`position: sticky`, de `:nth-child`, ni des dropdowns — ce sont les pathologies
classiques des listes virtualisées.

Cette approche tient confortablement l'ordre de grandeur visé (quelques milliers
d'éléments). Au-delà, une virtualisation réelle deviendrait pertinente, au prix des
effets de bord ci-dessus.

La hauteur de réserve est **mesurée** sur le premier élément rendu, puis suivie par un
`ResizeObserver`. Aucune estimation n'est demandée : le navigateur connaît la valeur
exacte dès qu'un élément existe.

De même, la distance de déclenchement est **dérivée** de la hauteur visible du
conteneur. `Prechargement (ecrans)` s'exprime en nombre de hauteurs d'écran : `1`
signifie « charger quand il reste environ un écran de contenu ». Un plancher garantit le
déclenchement sur un conteneur très court (une hauteur de 100px reste fonctionnelle).

## Conteneur de défilement

Le composant ne fixe aucune hauteur : elle vient des propriétés de style du studio. Mais
WeWeb applique parfois cette hauteur à un **wrapper parent** plutôt qu'à la racine du
composant. Dans ce cas, c'est ce parent qui défile.

Le composant remonte donc la hiérarchie pour trouver le premier ancêtre réellement
défilant (`overflow-y` défilable **et** contenu plus haut que la zone visible), et y
attache l'`IntersectionObserver` ainsi que l'écouteur de défilement. Si aucun ancêtre ne
défile, c'est la fenêtre qui est observée.

Si le défilement ne déclenche rien, activer `Chargement manuel` : le lien fonctionne
indépendamment de la détection du conteneur et permet d'isoler le problème.

## Limites connues

- **La collection doit avoir une limite.** Sans elle, pas de pagination serveur.
- **Un `COUNT(*)` exact est émis à chaque page** par le plugin Supabase
  (`count: 'exact'`). Sur une table volumineuse, c'est le coût dominant de chaque
  requête, pas le `range()`. Comportement du plugin, non modifiable depuis le
  composant.
- **APIs internes non documentées.** Voir ci-dessus.
- **Aucun retry automatique** après un dépassement de délai.

## Développement

```bash
npm test       # logique de pagination et cohérence configuration/composant
npm run build
```

Les tests ne sont pas embarqués dans le composant publié : le CLI WeWeb ne compile que
`src/wwElement.vue` et `ww-config.js` (voir `prebuild.js`).

`src/logic.mjs` isole toutes les décisions — clés, fusion, choix de la page suivante,
classification des pages reçues, machine à états — sans dépendance à Vue ni à `wwLib`,
ce qui les rend vérifiables hors du studio.

Le composant n'a **aucune dépendance runtime**.

### Machine à états

```
initializing ──→ idle            page initiale observée
idle ──→ loading ──→ idle        réponse reçue
                 ──→ timedOut    délai dépassé, verrou conservé
                 ──→ ended       fin de collection
                 ──→ failed      anomalie
timedOut ──→ idle | ended        réponse tardive intégrée
ended | failed ──→ idle          reset légitime uniquement
```

Seul `idle` autorise un nouveau chargement. `initializing` protège la page initiale :
sans cet état, un tableau vide renvoyé par une collection pas encore fetchée serait pris
pour une page 0 vide, et le composant demanderait aussitôt l'offset suivant — la
première page serait sautée.

Un changement de `Cle unique` ou de `Collection` constitue un reset légitime et
débloque un état terminal. Chaque changement de collection incrémente une génération
interne : un timer ou un callback de l'ancienne source ne peut plus modifier l'état de
la nouvelle.

## Validation dans le studio

### Scénario nominal

Collection Supabase de 500 lignes ou plus, limite 50, sélectionnée dans `Collection`,
clé primaire en `Cle unique`, hauteur 30vh, tri incluant une colonne unique.

Commencer avec `Chargement manuel` activé : un clic doit produire exactement une
requête. Une fois ce comportement confirmé, désactiver le mode manuel pour vérifier le
déclenchement au défilement.

À vérifier :

- offsets successifs 0, 50, 100, 150 ;
- onglet Network : une seule requête par palier, en-tête `Range: 50-99` puis
  `100-149` ;
- accumulation 50 → 100 → 150, sans remplacement ;
- un seul `reachEnd`, aucun `error` ;
- aucune requête après la fin.

### Scénarios d'erreur

Retirer la source paginée ; retirer la limite ; configurer une clé non unique.

Pour chacun : l'erreur doit être visible avec son code, aucune boucle de requêtes ne
doit apparaître, et les éléments déjà chargés doivent rester affichés.

### Performance

Mesurer à 500, 1 000, 2 500 puis 5 000 éléments : fluidité du défilement, mémoire,
nombre de nœuds DOM, temps de scripting et de layout, coût de montage des `wwElement`.

Déclencher l'étude d'une virtualisation réelle si le défilement devient instable, si la
mémoire devient excessive, ou si le montage des composants domine le profil.

## Migration depuis la version à deux propriétés

Les versions antérieures demandaient de binder `Collection` sur `maCollection.data`
**et** de sélectionner la même collection dans `Source paginee`. Ces deux propriétés
ont été supprimées.

Sur une instance déjà posée dans le studio : sélectionner la collection dans la nouvelle
propriété `Collection`. Les anciennes valeurs sont ignorées.

Aucune migration automatique n'est effectuée : elle supposerait un mécanisme de mise à
jour du contenu des composants déjà publiés que WeWeb ne garantit pas.

## Publication

1. Pousser ce dossier sur GitHub.
2. Dans le dashboard WeWeb, ajouter une `Source code` pointant vers ce dépôt.
3. Pour publier une mise à jour, incrémenter `version` dans `package.json`, pousser,
   puis sélectionner cette version dans le dashboard.
