# Infinite collection — composant codé WeWeb

Affiche une collection WeWeb en scroll infini : le composant répète le contenu qu'on
glisse dedans et charge la page suivante quand on approche du bas de la liste.

La pagination reste celle de la collection native : la limite est configurée dans le
studio, le composant ne fait varier que l'offset, exactement comme le fait le
Paginator standard.

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

Sans limite : pas de `range()`, pas de `total` fiable, donc rien à paginer. Le
composant émet alors l'événement `error` avec un message explicite plutôt que de
tourner à vide.

Une valeur de 50 est un bon point de départ.

### 2. Binder la collection

Binder la propriété `Collection` sur `maCollection.data`.

### 3. Fixer la hauteur

Le composant n'a **pas** de propriété de hauteur : il utilise les propriétés de style
standard de WeWeb. Fixer par exemple `30vh` dans la section Style. C'est cette
hauteur qui crée la zone de défilement.

### 4. Glisser le contenu répété

Le composant contient une Flexbox. Y glisser la div ou le composant personnalisé à
répéter. Les données de l'élément courant sont accessibles au binding dans tout ce
qui est placé à l'intérieur.

### 5. Renseigner la clé unique

`Cle unique` (par défaut `id`) sert à dédupliquer les éléments entre deux pages. Si
aucun champ ne convient, laisser vide : l'index absolu sera utilisé, au prix d'une
déduplication moins fiable en cas de chevauchement de pages.

## Propriétés

| Propriété | Rôle | Défaut |
|---|---|---|
| `Collection` | Collection à répéter, bindée sur `maCollection.data` | `[]` |
| `Source paginee` | Collection à paginer. Vide = auto-détection | `null` |
| `Cle unique` | Champ identifiant un élément | `id` |
| `Hauteur estimee d un element` | Alimente `contain-intrinsic-size` | `80` |
| `Distance de declenchement` | Anticipation du chargement, en pixels | `300` |

## Événements

| Événement | Quand | Charge utile |
|---|---|---|
| `On load more` | Une page suivante est demandée | `offset`, `limit`, `total`, `page` |
| `On reach end` | Toute la collection est chargée | `total`, `loaded` |
| `On error` | Pagination impossible | `message` |

## Comment la pagination est pilotée

Le composant résout la collection à paginer dans cet ordre :

1. **Propriété `Source paginee`** si elle est renseignée.
2. **Auto-détection** : parmi les collections du projet, celle dont `data` est la même
   référence de tableau que celle bindée sur `Collection`.
3. **Repli workflow** : si les deux échouent, seul `On load more` est émis. Il suffit
   alors de câbler `On load more` → `Change variable offset` → `Fetch collection`,
   sans modifier le code.

Les niveaux 1 et 2 reposent sur `wwLib.wwCollection.setOffset()` et
`getPaginationOptions()`, utilisées en production par le Paginator WeWeb mais absentes
de la documentation publique. Le niveau 3 existe précisément pour ce risque.

## Accumulation des pages

`setOffset()` **remplace** la page courante : à l'offset 50, la collection contient les
éléments 50 à 99, et plus les 0 à 49. Le composant accumule donc les pages lui-même,
en dédupliquant par clé.

Conséquence : un changement de filtre ou de tri en amont remet l'accumulateur à zéro,
ce qui est le comportement attendu.

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
- **APIs internes.** Voir la section sur le pilotage de la pagination.
- **Si un total est surestimé** par le backend, le composant s'arrête dès qu'une page
  n'apporte aucun élément nouveau, au lieu de boucler.

## Développement

```bash
npm test     # logique de pagination et cohérence de la configuration
npm run build
```

Les tests ne sont pas embarqués dans le composant publié : le CLI WeWeb ne compile que
`src/wwElement.vue` et `ww-config.js`.

`src/logic.mjs` isole les décisions de pagination et de déduplication, sans dépendance
à Vue ni à `wwLib`, ce qui les rend testables hors du studio.

Le composant n'a **aucune dépendance runtime**.

## Validation dans le studio

1. Collection de 500 éléments ou plus, limite 50, hauteur 30vh.
2. Onglet Network : une seule requête par palier, avec un en-tête
   `Range: 50-99` puis `100-149`.
3. Les éléments s'accumulent (50 → 100 → 150) sans se remplacer.
4. Les données de l'élément sont bindables dans le contenu glissé.
5. Performance panel à 500 éléments : le temps de Layout doit rester faible grâce à
   `content-visibility`.

## Publication

1. Pousser ce dossier sur GitHub.
2. Dans le dashboard WeWeb, ajouter une `Source code` pointant vers ce dépôt.
3. Pour publier une mise à jour, incrémenter `version` dans `package.json`, pousser,
   puis sélectionner cette version dans le dashboard.
