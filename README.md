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

La propriété `Source paginee` devrait être renseignée explicitement : l'auto-détection
n'est qu'une commodité.

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

### 2. Binder la collection

Binder la propriété `Collection` sur `maCollection.data`.

### 3. Renseigner la source paginée

Sélectionner la collection dans `Source paginee`. Si le champ reste vide, le composant
tente de la retrouver via le binding de `Collection` ; s'il échoue, il s'arrête avec le
code `NO_SOURCE`.

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
| `Collection` | Collection à répéter, bindée sur `maCollection.data` | `[]` |
| `Source paginee` | Collection à paginer. À renseigner de préférence | `null` |
| `Cle unique` | Champ scalaire identifiant un élément | `id` |
| `Hauteur estimee d un element` | Alimente `contain-intrinsic-size` | `80` |
| `Distance de declenchement` | Anticipation du chargement, en pixels | `300` |

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
| `NO_SOURCE` | ni `Source paginee` ni auto-détection n'ont abouti |
| `API_UNAVAILABLE` | la pagination native WeWeb est absente de cette version |
| `PAGINATION_READ_FAILED` | exception à la lecture des métadonnées |
| `NO_METADATA` | la collection ne fournit pas d'informations de pagination |
| `INVALID_LIMIT` | limite absente, nulle, négative ou fractionnaire |
| `INVALID_OFFSET` | offset négatif ou fractionnaire |
| `INVALID_TOTAL` | total absent ou invalide — généralement une limite manquante |
| `SET_OFFSET_FAILED` | la demande de page suivante a échoué |
| `FETCH_TIMEOUT` | la page n'est pas arrivée dans le délai imparti |
| `EMPTY_PAGE` | page vide reçue **avant** la fin annoncée |
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

Le composant résout la collection à paginer dans cet ordre :

1. propriété `Source paginee` ;
2. auto-détection : parmi les collections du projet, celle dont `data` est la même
   référence de tableau que celle bindée sur `Collection` ;
3. échec : `error` avec le code `NO_SOURCE`, et arrêt.

La pagination repose sur `wwLib.wwCollection.setOffset()` et `getPaginationOptions()`,
utilisées en production par le Paginator WeWeb mais **absentes de la documentation
publique**.

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

`Hauteur estimee d un element` n'a pas besoin d'être exacte : elle sert à dimensionner
la barre de défilement avant que les éléments soient rendus.

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
idle ──→ loading ──→ idle        réponse reçue
                 ──→ timedOut    délai dépassé, verrou conservé
                 ──→ ended       fin de collection
                 ──→ failed      anomalie
timedOut ──→ idle | ended        réponse tardive intégrée
ended | failed ──→ idle          reset légitime uniquement
```

Seul `idle` autorise un nouveau chargement. Un changement de `Cle unique` ou de
`Source paginee` constitue un reset légitime et débloque un état terminal.

## Validation dans le studio

### Scénario nominal

Collection Supabase de 500 lignes ou plus, limite 50, `Source paginee` sélectionnée,
clé primaire en `Cle unique`, hauteur 30vh, tri incluant une colonne unique.

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

## Publication

1. Pousser ce dossier sur GitHub.
2. Dans le dashboard WeWeb, ajouter une `Source code` pointant vers ce dépôt.
3. Pour publier une mise à jour, incrémenter `version` dans `package.json`, pousser,
   puis sélectionner cette version dans le dashboard.
