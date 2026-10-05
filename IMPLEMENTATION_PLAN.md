# Plan d'implementation - Infinite Collection V1

## Objectif

Fiabiliser le composant autour d'un unique chemin de pagination WeWeb, avec des erreurs explicites plutot que des mecanismes de repli partiellement fonctionnels.

Le composant cible le contexte suivant :

- une collection WeWeb dediee au composant ;
- une seule instance consommatrice de cette collection ;
- aucun Paginator concomitant ;
- filtres et tris fixes pendant la navigation ;
- donnees non modifiees pendant la navigation ;
- ordre serveur deterministe ;
- cle metier unique et stable ;
- collection paginee avec une limite et un total fiables.

## Principes retenus

1. Supprimer le fallback de pagination pilote par workflow.
2. Conserver la source paginee explicite comme chemin principal.
3. Conserver eventuellement l'auto-detection comme commodite.
4. Arreter explicitement le composant si la pagination ne peut pas etre resolue.
5. Ne jamais liberer automatiquement le verrou d'une requete au timeout.
6. Utiliser le total WeWeb comme source principale pour determiner la fin.
7. Traiter une page entierement dupliquee comme une anomalie, pas comme une fin normale.
8. Reporter la virtualisation reelle a une V2.

---

## 1. Formaliser le contrat de pagination

### Fichiers concernes

- `src/wwElement.vue`
- `src/logic.mjs`
- `ww-config.js`
- `README.md`

### Comportement attendu

La source est resolue dans cet ordre :

1. propriete `Source paginee` ;
2. auto-detection a partir du binding de `Collection` ;
3. erreur bloquante si aucune source n'est trouvee.

Une pagination valide doit fournir :

- un identifiant de collection ;
- une API `getPaginationOptions()` disponible ;
- une API `setOffset()` disponible ;
- une limite entiere strictement positive ;
- un offset entier positif ou nul ;
- un total entier positif ou nul.

### Decisions

- Ne plus emettre `loadMore` avec des valeurs `null`.
- Ne plus documenter de workflow `Change variable offset` comme fallback.
- En cas de source ou pagination invalide, emettre `error` et bloquer les nouveaux chargements.
- Continuer a emettre `loadMore` comme notification apres une demande native reussie.

---

## 2. Supprimer le fallback workflow

### Fichier concerne

- `src/wwElement.vue`

### Zone actuelle

La branche executee lorsque `readPagination()` renvoie `null`.

### Modification

Remplacer le comportement actuel :

```text
pagination introuvable
-> emission de loadMore avec offset/limit/total/page a null
```

par :

```text
pagination introuvable
-> passage dans un etat bloque
-> emission de error
-> aucune modification d'offset
-> aucune nouvelle tentative automatique au scroll
```

### Message utilisateur propose

```text
Impossible de paginer la collection. Renseignez une Source paginee valide et verifiez que la collection possede une limite.
```

### Criteres d'acceptation

- Aucun evenement `loadMore` n'est emis si la source est introuvable.
- Les evenements de scroll suivants ne provoquent pas de nouvelle tentative.
- Une seule erreur est emise pour une meme panne.
- Les pages deja accumulees restent affichees.

---

## 3. Rendre les erreurs de pagination explicites

### Fichier concerne

- `src/wwElement.vue`

### Cas a distinguer

- source paginee introuvable ;
- type de source non supporte ;
- `wwLib.wwCollection.getPaginationOptions` indisponible ;
- exception pendant la lecture de la pagination ;
- metadonnees de pagination absentes ;
- limite absente ou invalide ;
- offset invalide ;
- total absent ou invalide ;
- `wwLib.wwCollection.setOffset` indisponible ;
- exception pendant `setOffset` ;
- timeout de chargement ;
- page vide avant la fin annoncee ;
- page non vide entierement dupliquee avant la fin annoncee.

### Approche

Eviter que `readPagination()` transforme silencieusement toutes les erreurs en `null`.

Retourner un resultat structure ou laisser remonter une erreur controlee permettant d'emettre un message precis.

Exemple conceptuel :

```js
{
  ok: false,
  code: 'PAGINATION_UNAVAILABLE',
  message: '...'
}
```

### Criteres d'acceptation

- Chaque panne produit un message exploitable dans le workflow `On error`.
- Aucune panne technique n'est presentee comme une fin normale de collection.
- Les erreurs ne provoquent pas la suppression des elements deja affiches.

---

## 4. Corriger la gestion du timeout

### Fichier concerne

- `src/wwElement.vue`

### Probleme actuel

Apres dix secondes, `pendingOffset` est remis a `null`. Une reponse tardive est alors classee comme un reset et peut remplacer toutes les pages accumulees.

### Comportement cible

Au timeout :

1. conserver `pendingOffset` ;
2. conserver le verrou de chargement ;
3. marquer la requete comme expiree ;
4. emettre une seule erreur ;
5. ne pas relancer automatiquement une autre page ;
6. accepter encore une eventuelle reponse tardive correspondant a l'offset attendu ;
7. liberer le verrou normalement si cette reponse arrive.

### Message propose

```text
Le chargement de la page a l'offset {offset} a depasse 10 secondes. Le composant reste en attente afin d'eviter une pagination incoherente.
```

### Etat supplementaire

Ajouter un etat explicite, par exemple :

```js
const hasTimedOut = ref(false);
```

Cet etat evite d'utiliser `pendingOffset` pour representer simultanement :

- l'existence d'une requete ;
- son expiration ;
- l'autorisation de relancer.

### Reinitialisation

`hasTimedOut` doit etre remis a `false` :

- au demarrage d'une nouvelle requete ;
- a la reception de la reponse attendue ;
- lors d'un reset legitime des donnees ;
- lors du demontage.

### Criteres d'acceptation

- Une reponse arrivant apres dix secondes est encore ajoutee a l'accumulateur.
- Aucun offset suivant n'est demande tant que la requete expiree n'est pas resolue.
- L'erreur de timeout n'est emise qu'une fois.
- Le timeout ne supprime ni ne remplace les pages precedentes.

---

## 5. Utiliser le total comme autorite de fin

### Fichiers concernes

- `src/logic.mjs`
- `src/wwElement.vue`

### Regle principale

Avec un total fiable, la fin normale doit etre determinee par :

```text
offset courant + taille de la page >= total
```

ou, avant une nouvelle demande :

```text
offset suivant >= total
```

Le nombre d'elements uniques accumules ne doit pas etre la seule autorite, car la deduplication peut rendre ce nombre different du total.

### Revision de `planNextFetch`

Valider strictement :

- `limit` : entier superieur a zero ;
- `offset` : entier superieur ou egal a zero ;
- `total` : entier superieur ou egal a zero.

Determiner la page suivante a partir de l'offset courant et de la limite.

Ne pas utiliser uniquement `loadedCount >= total` pour prouver que la pagination est terminee.

### Criteres d'acceptation

- Une collection de 137 elements avec une limite de 50 effectue trois pages.
- Aucun quatrieme fetch n'est effectue.
- Une collection vide ne declenche aucune pagination supplementaire.
- La fin normale emet `reachEnd` une seule fois.

---

## 6. Distinguer fin normale et page anormale

### Fichier concerne

- `src/wwElement.vue`

### Cas A : page recue normalement

```text
incoming.length > 0
added > 0
```

Action :

- ajouter les elements ;
- poursuivre ou terminer selon l'offset, la taille de page et le total.

### Cas B : page vide a la fin annoncee

```text
incoming.length === 0
```

Action :

- emettre `reachEnd` ;
- bloquer les nouvelles demandes.

### Cas C : page vide avant la fin annoncee

```text
incoming.length === 0
```

Action :

- emettre `error` ;
- arreter la pagination ;
- conserver les elements deja charges.

Message propose :

```text
La collection a retourne une page vide avant la fin annoncee.
```

### Cas D : page non vide entierement dupliquee

```text
incoming.length > 0
added === 0
```

Action :

- ne pas emettre `reachEnd` ;
- emettre `error` ;
- arreter la pagination ;
- conserver les elements deja charges.

Message propose :

```text
La page recue ne contient aucun nouvel element. Verifiez la cle unique et la coherence de la pagination.
```

### Justification

Dans le contexte prevu, une page entierement dupliquee ne doit jamais se produire. Elle indique probablement :

- une mauvaise cle unique ;
- une collision de cles ;
- une reponse correspondant au mauvais offset ;
- une incoherence de la collection.

Elle ne constitue pas une preuve que toute la collection a ete chargee.

---

## 7. Renforcer les cles de deduplication

### Fichiers concernes

- `src/logic.mjs`
- `test/logic.test.mjs`
- `README.md`

### Probleme

La conversion actuelle avec `String(raw)` fait collisionner :

- `5` et `"5"` ;
- plusieurs objets convertis en `"[object Object]"`.

### Modification

Inclure le type dans la cle calculee.

Exemples :

```text
number:5
string:5
boolean:true
```

Refuser ou ignorer comme cle metier les valeurs non scalaires telles que les objets et tableaux.

Si la cle est absente ou inexploitable, continuer a utiliser l'index absolu comme fallback local.

### Documentation

Preciser que `Cle unique` doit referencer :

- une valeur scalaire ;
- stable ;
- unique dans toute la collection ;
- idealement une cle primaire Supabase.

### Criteres d'acceptation

- `5` et `"5"` produisent deux cles differentes.
- Deux objets ne produisent pas silencieusement la meme cle metier.
- Les UUID, chaines et identifiants numeriques restent supportes.

---

## 8. Securiser l'etat bloque

### Fichier concerne

- `src/wwElement.vue`

### Objectif

Eviter d'utiliser `isExhausted` pour representer a la fois :

- une fin normale ;
- une erreur ;
- un timeout ;
- une configuration invalide.

### Approche

Introduire un etat interne explicite ou plusieurs indicateurs simples :

```text
idle
loading
ended
failed
```

L'implementation peut rester minimale, mais les transitions doivent etre explicites.

### Transitions attendues

```text
idle -> loading
loading -> idle
loading -> timed-out
loading -> ended
loading -> failed
idle -> ended
```

Une reponse tardive peut permettre :

```text
timed-out -> idle
timed-out -> ended
```

### Reinitialisation

Une modification legitime de la source ou des donnees initiales doit permettre de repartir proprement, sans conserver un etat d'erreur provenant de l'ancienne source.

---

## 9. Nettoyer les timers de l'observer

### Fichier concerne

- `src/wwElement.vue`

### Modification

- conserver les identifiants des timers crees par `ensureObserver()` ;
- annuler ces timers lors du demontage ;
- annuler une chaine precedente avant d'en creer une nouvelle apres un changement de `rootMargin`.

### Criteres d'acceptation

- aucun retry ne s'execute apres le demontage ;
- plusieurs changements rapides de `rootMargin` ne creent pas plusieurs chaines concurrentes ;
- aucun message d'erreur tardif n'est ecrit apres destruction du composant.

---

## 10. Completer les tests unitaires

### Fichier concerne

- `test/logic.test.mjs`

### Tests a ajouter

- limite fractionnaire refusee ;
- limite negative refusee ;
- offset negatif refuse ;
- offset fractionnaire refuse ;
- total invalide refuse ;
- distinction entre identifiant numerique et chaine ;
- rejet d'une cle objet ;
- derniere page partielle avec total fiable ;
- decision de fin fondee sur l'offset et le total ;
- page non vide entierement dupliquee classee comme anomalie ;
- page vide avant le total classee comme anomalie.

### Test existant a corriger

Renommer ou reecrire :

```text
resolveKey distingue id numerique et id chaine
```

Le test doit reellement comparer :

```js
resolveKey({ id: 5 }, ...)
resolveKey({ id: '5' }, ...)
```

---

## 11. Ajouter des tests de composant

### Fichier concerne

Creer un test dedie au comportement Vue/WeWeb, selon l'outillage compatible avec le CLI existant.

### Scenarios prioritaires

- source paginee introuvable ;
- pagination absente ;
- limite invalide ;
- succes de `setOffset()` ;
- exception de `setOffset()` ;
- aucun fallback workflow ;
- timeout sans liberation du verrou ;
- reponse recue apres timeout ;
- page vide avant le total ;
- page entierement dupliquee ;
- `reachEnd` emis une seule fois ;
- demontage pendant un timeout ;
- demontage pendant un retry d'observer.

### Doubles necessaires

Mocker :

- `wwLib.wwCollection.getPaginationOptions` ;
- `wwLib.wwCollection.setOffset` ;
- `wwLib.$store` ;
- `IntersectionObserver` ;
- les timers ;
- l'emission `trigger-event`.

---

## 12. Aligner la documentation

### Fichiers concernes

- `README.md`
- `ww-config.js`

### Supprimer

- la presentation du workflow comme fallback de pagination ;
- l'affirmation selon laquelle une page sans nouvel element constitue automatiquement une fin normale ;
- toute promesse laissant penser que les APIs internes disposent d'un fallback equivalent.

### Ajouter

Les prerequis de production :

- collection dediee au composant ;
- `Source paginee` explicitement renseignee de preference ;
- limite configuree ;
- total disponible ;
- ordre serveur fixe et deterministe ;
- cle metier unique ;
- filtres et tris inchanges pendant la navigation ;
- donnees non modifiees pendant la navigation.

### Documenter les evenements

`loadMore` :

- notification emise apres une demande native reussie ;
- ne pilote pas lui-meme la pagination.

`reachEnd` :

- uniquement pour une fin normale determinee a partir de la pagination.

`error` :

- source invalide ;
- pagination invalide ;
- timeout ;
- reponse incoherente ;
- echec WeWeb.

### Documenter le timeout

Preciser qu'apres expiration :

- une erreur est emise ;
- aucune autre page n'est demandee ;
- une reponse tardive peut encore etre integree ;
- les donnees deja affichees sont conservees.

---

## 13. Validation dans WeWeb Studio

### Scenario nominal

- collection Supabase d'au moins 500 lignes ;
- limite de 50 ;
- source paginee explicitement selectionnee ;
- cle primaire utilisee comme cle unique ;
- hauteur fixe du composant ;
- tri stable incluant une colonne unique.

### Verifications

- offsets successifs : 0, 50, 100, 150 ;
- une seule requete par palier ;
- accumulation : 50, 100, 150 ;
- aucun remplacement des pages precedentes ;
- un seul evenement `reachEnd` ;
- aucun evenement `error` ;
- aucune requete apres la fin.

### Scenarios d'erreur

- retirer la source paginee ;
- retirer la limite ;
- simuler un echec de pagination ;
- simuler une reponse de plus de dix secondes ;
- configurer une cle non unique.

Pour chaque scenario :

- l'erreur doit etre visible ;
- aucune boucle de requetes ne doit apparaitre ;
- les elements deja charges doivent rester affiches.

---

## 14. Validation des performances V1

### Objectif

Valider le choix `content-visibility` sans pretendre a une virtualisation reelle.

### Mesures

Tester avec le veritable contenu WeWeb repete a :

- 500 elements ;
- 1 000 elements ;
- 2 500 elements ;
- 5 000 elements si necessaire.

Mesurer :

- fluidite du scroll ;
- memoire ;
- nombre de noeuds DOM ;
- temps de scripting ;
- temps de layout ;
- cout de montage des `wwElement`.

### Decision V2

Declencher l'etude d'une virtualisation reelle si :

- le scroll devient visiblement instable ;
- la memoire devient excessive ;
- le montage des composants domine les performances ;
- le volume metier depasse regulierement quelques milliers d'elements.

---

## Hors perimetre V1

- pagination par curseur Supabase ;
- virtualisation reelle et recyclage des lignes ;
- partage d'une collection avec plusieurs composants ;
- utilisation concomitante d'un Paginator ;
- changement dynamique de filtre ou de tri pendant le chargement ;
- gestion de donnees modifiees pendant la navigation ;
- retry automatique apres timeout ;
- requetes Supabase directes depuis le composant.

---

## Ordre d'implementation

1. Supprimer le fallback workflow.
2. Formaliser et valider les metadonnees de pagination.
3. Separer les etats de fin, erreur, chargement et timeout.
4. Corriger le comportement du timeout.
5. Faire du total l'autorite de fin.
6. Distinguer page vide, page dupliquee et fin normale.
7. Renforcer les cles de deduplication.
8. Nettoyer les timers de l'observer.
9. Completer les tests unitaires.
10. Ajouter les tests de composant.
11. Mettre a jour `README.md` et `ww-config.js`.
12. Valider le comportement dans WeWeb Studio.
13. Effectuer le test de performance V1.

---

## Definition de termine

La modification est terminee lorsque :

- le composant ne possede plus de fallback workflow ;
- toute source invalide produit une erreur explicite ;
- un timeout ne libere plus le verrou ;
- une reponse tardive ne remplace pas l'accumulateur ;
- la fin normale repose sur le total et les offsets ;
- une page entierement dupliquee produit une erreur ;
- les cles numeriques et textuelles ne collisionnent plus ;
- tous les timers sont nettoyes au demontage ;
- les tests unitaires et de composant passent ;
- le build WeWeb reussit ;
- le scenario nominal est valide dans le Studio ;
- la documentation correspond exactement au comportement livre.
