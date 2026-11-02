# Faire connaître bokki.shop aux moteurs — guide pas à pas

À faire **une seule fois**, après la mise en ligne de la mise à jour n°2.
Durée : environ 15 minutes. Compte nécessaire : le compte Google qui gère
déjà Search Console pour bokki.shop.

Adresse du plan du site : **https://bokki.shop/sitemap.xml**
(il est fabriqué automatiquement : chaque produit ajouté dans l'admin y apparaît).

---

## 1. Google Search Console

Le site est **déjà vérifié** (balise `google-site-verification` dans
`public/index.html` : ne pas la retirer).

1. Ouvrir https://search.google.com/search-console et choisir la propriété **bokki.shop**.
   - Si seule la propriété `https://bokki.shop/` existe, c'est bon.
   - Mieux (facultatif) : ajouter une propriété **Domaine** `bokki.shop` (vérification
     par un enregistrement TXT chez le fournisseur du nom de domaine) pour couvrir
     aussi `www.` et `http://`.
2. Menu de gauche → **Sitemaps**.
3. Dans « Ajouter un sitemap », taper `sitemap.xml` puis **Envoyer**.
4. Attendre quelques heures, puis vérifier que l'état est **Réussite** et que le
   nombre d'URL découvertes correspond (environ 50 aujourd'hui).
5. Menu **Inspection de l'URL** → coller l'adresse d'une fiche produit
   (par exemple une adresse en `/produit/…` prise dans le sitemap) →
   **Tester l'URL en direct** → vérifier « L'URL est disponible pour Google »,
   puis **Demander une indexation**. Faire de même pour `https://bokki.shop/`
   et `https://bokki.shop/livraison`.
6. Menu **Pages** (indexation) : revenir dans 1 à 2 semaines. Les pages
   `/produit?id=…`, `/catalogue?q=…` et les pages privées sont **volontairement**
   exclues (noindex ou robots.txt) : ce n'est pas une erreur.

### Test des résultats enrichis (à faire une fois en ligne)

1. Ouvrir https://search.google.com/test/rich-results
2. Coller l'adresse d'une fiche produit, par exemple
   `https://bokki.shop/produit/lenovo-thinkpad-yoga-11e-uaq6` (elle a un avis client).
3. Attendu : **Extraits de produits** et **Fiches de marchand** valides, **Fils d'Ariane** valide.
   Avertissements possibles et normaux : « returnPolicy manquant » (la politique de
   retour n'est pas encore balisée, voir TODO), « priceValidUntil manquant ».
4. Tester aussi `https://bokki.shop/faq` (attendu : **FAQ** valide).

---

## 2. Bing Webmaster Tools (sert aussi à Copilot, DuckDuckGo, Ecosia, Yahoo)

1. Ouvrir https://www.bing.com/webmasters et se connecter (compte Microsoft ou Google).
2. Choisir **Importer depuis Google Search Console** (le plus simple : aucune
   balise à ajouter, le site et le sitemap sont repris automatiquement).
   - Sinon, « Ajouter un site manuellement » → méthode **Balise meta** → copier
     le code `msvalidate.01`, le mettre à la place de `CODE-BING` dans la ligne
     en commentaire de `public/index.html` (et retirer le commentaire), déployer,
     puis cliquer **Vérifier**.
3. Menu **Sitemaps** → **Soumettre un sitemap** → `https://bokki.shop/sitemap.xml`.
4. Menu **IndexNow** : rien à faire. Le site signale déjà lui-même ses pages :
   - à chaque déploiement (`firebase deploy`, étape postdeploy
     `scripts/indexnow.mjs`) ;
   - à chaque modification de produit dans l'admin (fonction `regenererPrerendu`,
     seulement les pages qui ont changé).
   La clé est le fichier `https://bokki.shop/d3e3dc8638908f59137e178aeb92412e.txt`.
   Après quelques jours, les envois apparaissent dans ce menu.

---

## 3. Vérifications rapides (après le déploiement)

| Adresse | Attendu |
|---|---|
| https://bokki.shop/robots.txt | contient `Sitemap: https://bokki.shop/sitemap.xml` |
| https://bokki.shop/sitemap.xml | liste des pages et des fiches `/produit/<nom>-<xxxx>` |
| https://bokki.shop/llms.txt | résumé de Bokki pour les assistants IA |
| https://bokki.shop/d3e3dc8638908f59137e178aeb92412e.txt | la clé IndexNow, seule |
| https://bokki.shop/produit/18D2WDbg6oo6gZht3sAs | redirection 301 vers l'adresse avec le nom |

Puis mesurer la vitesse en ligne : `tools/lighthouse.sh` (scores mobile, 2 passages par page).

---

## 4. Ensuite, chaque mois (5 minutes)

- Search Console → **Performances** : requêtes qui amènent des visiteurs
  (ex. « boutique en ligne Guinée », noms de produits).
- Search Console → **Pages** : nouvelles erreurs éventuelles.
- Bing → **Rapport de recherche** : même chose côté Bing.
