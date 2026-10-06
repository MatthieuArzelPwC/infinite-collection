# Infinite collection — composant WeWeb

Affiche une collection WeWeb paginée et charge les pages suivantes à l'approche du bas de liste. Une seule propriété à renseigner : `Collection`.

## Faits mesurés

Deux mesures ont été faites dans le Studio avant d'écrire ce composant. Elles déterminent toute l'architecture et doivent être revérifiées si WeWeb change de comportement.

### WeWeb accumule lui-même les pages

Collection de 8342 lignes, limite 12, relevé avant puis après `setOffset(12)` :

| | page 1 | page 2 |
|---|---|---|
| `data.length` | 8342 | 8342 |
| lignes présentes | 12 | 24 |
| première présente | 0 | 0 |
| trous réels | 0 | 0 |

`data` est un tableau **pré-dimensionné au total**, rempli progressivement, dont **rien n'est jamais libéré**. L'accumulation est donc faite par WeWeb.

Conséquence : le composant ne tient aucun accumulateur. La liste affichée est une projection directe du store. Il n'y a ni suivi d'offset, ni génération de requête, ni classification des pages reçues — ces mécanismes n'existent que pour reconstituer une information que `data` porte déjà.

### `IntersectionObserver` est fiable sur les trois montages WeWeb

Mesuré dans le dépôt de R&D [`MatthieuArzelPwC/test-scroll`](https://github.com/MatthieuArzelPwC/test-scroll), qui compare trois stratégies de détection.

| Montage | Résultat |
|---|---|
| le composant défile lui-même | déclenche, 3 échantillons |
| un wrapper WeWeb défile | déclenche, conteneur correctement identifié |
| la page défile | déclenche |
| liste trop courte pour défiler | déclenche spontanément |

Trois échantillons par parcours, contre plusieurs dizaines par seconde pour une écoute du `scroll` en capture sur `document`.

## Contrat

- collection dédiée au composant, limite configurée dans WeWeb ;
- une seule instance consommatrice, pas de Paginator concomitant ;
- ordre serveur déterministe, filtres et données inchangés pendant le parcours.

## Configuration

1. Choisir une collection dans `Collection`.
2. Vérifier qu'elle a une limite (ex. 50) : c'est elle qui active la pagination serveur.
3. Fixer la hauteur du composant ou de son conteneur avec les styles WeWeb.
4. Déposer le contenu à répéter dans la Flexbox interne.

## Architecture

Frontières étanches : chaque module est corrigeable sans effet sur les autres.

| Fichier | Rôle | Dépendances |
|---|---|---|
| `src/rows.mjs` | projette `data` en lignes affichables | pure |
| `src/pagination.mjs` | décision d'offset, calquée sur le Paginator officiel | pure |
| `src/scrollParent.mjs` | trouve le conteneur qui défile | pure, DOM injecté |
| `src/bottomSensor.mjs` | `IntersectionObserver` auto-réparant | DOM |
| `src/collection.mjs` | **seul** fichier touchant `wwLib` | WeWeb |
| `src/wwElement.vue` | assemblage | Vue |

### État local

Une seule référence : `pendingOffset`, qui empêche d'émettre deux fois la même demande. Tout le reste est dérivé du store à la lecture.

Il n'y a ni machine à états, ni compteur de génération, ni délai d'attente. `setOffset` est traité comme un envoi sans retour, exactement comme dans le Paginator officiel : il ne renvoie ni promesse ni accusé de réception, et l'arrivée des données ne se constate que par la réactivité du store.

### Le capteur se reconstruit

La racine d'un `IntersectionObserver` est figée à la souscription. Or la liste démarre vide : aucun conteneur n'est encore scrollable, donc l'observateur se calerait définitivement sur le viewport et le seuil ne signifierait plus rien.

L'observateur est donc **détruit et recréé dès que le conteneur qui défile change d'identité**. C'est probablement ce point qui avait condamné cette API dans une version antérieure.

## Modes de chargement

### Automatique (par défaut)

Une page est demandée quand la sentinelle approche à moins de `Marge de déclenchement` du bas du conteneur qui défile réellement. Si la liste reste plus courte que la zone visible, le chargement s'enchaîne jusqu'à remplir l'écran.

Un verrou avec hystérésis empêche la rafale : il ne se rouvre qu'après une remontée franche au-delà du seuil.

### Manuel

Activer `Chargement manuel`. Un bouton apparaît après la dernière ligne ; le défilement ne déclenche aucune requête. L'événement `reachBottom` reste émis, ce qui permet de brancher un workflow sans attendre le clic.

## Pagination

L'identifiant sélectionné sert à lire les données via `$store.getters['data/getCollections'][id]`, les métadonnées via `getPaginationOptions(id)`, et à demander une page via `setOffset(id, offset)`.

Le getter du store n'est pas une API publique documentée. Son accès est confiné à `src/collection.mjs`.

L'offset demandé est **dérivé des données** : première position manquante, alignée sur une limite de page. Les métadonnées peuvent être en retard d'un cycle réactif sur les données, ce qui rend un offset mémorisé peu fiable.

La fin suit le contrat du Paginator officiel : plus aucune position manquante.

## Événements

| Nom | Charge utile | Quand |
|---|---|---|
| `reachBottom` | `distance`, `loaded`, `hasMore` | à la détection, avant la requête |
| `loadMore` | `offset`, `limit`, `total`, `page` | après `setOffset` |
| `reachEnd` | `total`, `loaded` | une fois par source, à la fin |
| `error` | `code`, `message` | panne de pagination |

Deux codes d'erreur seulement, le Paginator officiel n'en ayant aucun :

- `NO_COLLECTION_SELECTED`
- `PAGINATION_UNAVAILABLE` — collection absente du runtime, API indisponible, ou limite non configurée

Les lignes déjà affichées sont conservées en cas d'erreur. Une action `Reset` est exposée aux workflows.

## Performance

Les lignes restent montées. `content-visibility: auto` et une réserve de 80 px limitent le travail de rendu hors écran, mais ne réduisent ni le coût de montage ni la mémoire.

Une vraie virtualisation reste hors périmètre. L'architecture la rend greffable : seule la projection de `src/rows.mjs` et le `v-for` seraient concernés, sans toucher à la pagination.

## Développement

```bash
npm test          # 73 tests
npm run build
```

Aucune dépendance runtime.

### Règle de test

**Aucune assertion par expression régulière sur le texte source.** La version précédente en comptait 38 : elles figeaient l'implémentation et protégeaient quatre bugs, tout en laissant le runtime sans aucune couverture.

Les modules purs sont testés par leur comportement. `src/collection.mjs` est testé avec un faux `wwLib`, `src/bottomSensor.mjs` avec un faux DOM — y compris le scénario d'arrivée asynchrone des données.

### Diagnostic

`test.js` contient un script à coller dans la console du navigateur. Il relève la forme réelle de `collection.data` avant et après un changement de page, et vérifie les hypothèses ci-dessus sur une collection donnée.
