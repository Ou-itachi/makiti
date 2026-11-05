# Bokki — Rapport d'analyse du côté client (pour la refonte UI)

> **Pour qui :** le designer qui va refaire toute l'interface publique de Bokki.
> **Ce qui est couvert :** le site public (`public/*.html`, `public/css/`, `public/js/`), hors back-office `public/admin/`.
> **Date de l'analyse :** 1er novembre 2026. Branche `dev`, commit `1dcf842`. Version du cache du service worker : `bokki-v42`.
> **Ce rapport ne modifie aucun fichier existant.**

---

## Sommaire

1. [Contexte métier en 30 secondes](#1-contexte-métier-en-30-secondes)
2. [Stack technique](#2-stack-technique)
3. [Pages et routes du parcours client](#3-pages-et-routes-du-parcours-client)
4. [Styles globaux : où sont définis couleurs, tailles, espacements, arrondis et ombres](#4-styles-globaux)
5. [Composants réutilisables](#5-composants-réutilisables)
6. [Données produit](#6-données-produit)
7. [Mode sombre](#7-mode-sombre)
8. [Parcours de commande et numéro de suivi](#8-parcours-de-commande-et-numéro-de-suivi)
9. [Responsive](#9-responsive)
10. [Problèmes constatés](#10-problèmes-constatés)
11. [Annexe : contraintes à respecter dans la nouvelle UI](#11-annexe--contraintes-à-respecter-dans-la-nouvelle-ui)

---

## 1. Contexte métier en 30 secondes

- **Bokki** (`bokki.shop`) est une boutique en ligne basée à Conakry, en Guinée.
- **Le client paie uniquement en espèces, à la livraison.** Il n'y a aucune passerelle de paiement et rien à payer à la commande. C'est l'argument principal du site, répété partout (« Zéro avance », « Paiement à la livraison »).
- **Il n'y a pas de compte client.** On commande avec son nom, son téléphone, sa région et son quartier. « Mes commandes » liste seulement les commandes passées depuis le navigateur utilisé.
- **Il n'y a pas de gestion de stock.** Tout produit publié peut être commandé.
- Un agent Bokki **rappelle le client par téléphone** pour confirmer chaque commande. Le livreur demande ensuite au client un **code de livraison** (4 ou 6 chiffres) pour valider la remise du colis.
- Les prix sont stockés en **GNF** (franc guinéen). Le site peut les afficher en EUR, XOF ou USD, à titre indicatif, selon le pays du visiteur.
- Le public cible utilise surtout un **mobile Android d'entrée de gamme**, souvent avec un **réseau lent**. Les commentaires du code mentionnent régulièrement les écrans de 360 à 380 px et la 2G/3G.

---

## 2. Stack technique

### 2.1 Framework et architecture

| Élément | Choix actuel | Fichier(s) |
|---|---|---|
| Framework front | **Aucun.** Site **multi-pages en HTML statique** et **JavaScript vanilla** (modules ES natifs `type="module"`, sans bundler ni étape de build). | `public/*.html`, `public/js/*.js` |
| Rendu dynamique | Chaînes de template JS injectées par `innerHTML` (cartes produit, lignes du panier, timeline…). | `js/produits-list.js`, `js/produit-detail.js`, `js/panier.js`, `js/suivi.js`… |
| Vue.js | **Vue 3.5.42**, vendorisé, utilisé **uniquement par l'admin**. Le site client n'utilise pas Vue. | `public/vendor/vue-3.5.42.esm-browser.prod.js` |
| Backend | **Firebase** : Firestore, Cloud Functions (appels `httpsCallable`), Storage, Auth (admin seulement), App Check (reCAPTCHA Enterprise). | `js/firebase-config.js`, `functions/src/index.ts` |
| SDK Firebase client | **11.0.2**, chargé depuis le CDN `https://www.gstatic.com/firebasejs/11.0.2/…` | `js/firebase-config.js` |
| Cloud Functions | TypeScript, `firebase-functions ^6.1.0`, `firebase-admin ^12.7.0`, région `europe-west1` | `functions/src/index.ts`, `functions/package.json` |
| Hébergement | Firebase Hosting, `cleanUrls: true`, donc `/produit` sert `produit.html` | `firebase.json` |
| PWA | Manifest et service worker (cache `bokki-v42`, mise en cache de la coquille), bannière « Installer Bokki » sur iOS | `public/manifest.json`, `public/sw.js`, `js/sw-register.js`, `js/ios-install-prompt.js` |
| Transitions | View Transitions API (glissement entre pages, sens inversé au retour arrière) | `css/base.css` (fin), `js/transition-pages.js` |
| Sécurité | CSP stricte : scripts limités à `self` et gstatic, polices limitées à `self` (**aucune police externe possible**), images limitées à `self`, `data:`, `blob:` et Firebase Storage | `firebase.json` → `headers` |

> **Conséquence pour la refonte :** il n'y a ni composants, ni système de templates, ni include. **Le header et le footer sont copiés-collés dans chacun des 14 fichiers HTML.** Toute nouvelle UI devra soit garder ce modèle, en mettant à jour 14 fichiers, soit introduire un mécanisme de partials, ce qui est une décision technique à prendre avec le développeur.

### 2.2 CSS

- **Pas de Tailwind, de Bootstrap ni de préprocesseur.** Tout le CSS est écrit à la main, souvent minifié sur une ligne par règle.
- **Il n'y a donc pas de fichier `tailwind.config`.** La « config » du design réside dans les **variables CSS** de `css/design-system.css` (voir §4).
- Ordre de chargement, **identique sur toutes les pages client** (la cascade compte, chaque fichier écrase le précédent) :

```
1. assets/fonts/fonts.css          @font-face (polices auto-hébergées)
2. css/base.css                    reset + règles partagées client/admin
3. css/client.css                  composants client « historiques » (ancien style)
4. css/theme-jour.css              anciennes variables du thème clair
5. css/theme-nuit.css              anciennes variables du thème sombre
6. css/pages/<NN-page>.css         styles propres à la page
7. assets/phosphor/phosphor-subset.css   police d'icônes
8. css/design-system.css?v=premium-20261101   ← DERNIER : jetons + surcharge « premium » de tout le reste
```

### 2.3 Icônes

- **Phosphor Icons**, sous forme de **police d'icônes réduite à un sous-ensemble local de 57 icônes**, en trois graisses : `ph` (regular), `ph-bold` et `ph-fill`.
  - Fichiers : `public/assets/phosphor/phosphor-subset.css`, `Phosphor.subset.woff2`, `Phosphor-Bold.subset.woff2`, `Phosphor-Fill.subset.woff2`.
  - Usage : `<i class="ph ph-shopping-cart"></i>`, `<i class="ph-bold ph-arrow-right"></i>`. La taille est presque toujours donnée en **style inline** (`style="font-size:18px"`).
  - Icônes disponibles : arrow-counter-clockwise, arrow-left, arrow-right, arrows-clockwise, bell, calendar, car, caret-down, caret-left, caret-right, chart-bar, chat-circle, check, clock, copy, cube, currency-circle-dollar, device-mobile, device-tablet, dots-three-vertical, export, eye, facebook-logo, file-text, gear-six, image, instagram-logo, laptop, lightning, list, lock-simple, magnifying-glass, map-pin, moon, note, package, pencil-simple, phone, plus, plus-square, shopping-cart, sign-out, sneaker, spinner, square, squares-four, storefront, sun, t-shirt, tag, television-simple, tiktok-logo, trash, truck, user, warning, whatsapp-logo.
  - **L'icône « fermer » (`ph-x`) n'est pas dans le sous-ensemble.** Elle est remplacée par le caractère `✕` (`design-system.css` §4).
  - **Ajouter une icône impose de régénérer le sous-ensemble de police.**
- Les **étoiles des avis** sont des caractères Unicode `★` et `☆`, pas des icônes.
- Le **logo** est un baobab en SVG inline, répété dans chaque page. Ses deux couleurs viennent des variables `--baobab-crown` et `--baobab-trunk` (`css/base.css`). Le mot-symbole « Bokki » utilise la police Fraunces 900, suivie d'un point doré (`.brand-word .dot`).

### 2.4 Polices

Toutes sont **auto-hébergées**, car la CSP interdit Google Fonts. Elles sont déclarées dans `public/assets/fonts/fonts.css`.

| Police | Graisses | Usage réel côté client |
|---|---|---|
| **Plus Jakarta Sans** (variable) | 400–800 | **Seule police du site client** : titres, texte, prix (en chiffres tabulaires). Préchargée sur l'accueil. |
| **Fraunces** | 900 | Uniquement le mot-symbole « Bokki » (sous-ensemble d'environ 15 glyphes, ~2 Ko). |
| Bebas Neue | 400 | **Inutilisée côté client** (héritage). Encore utilisée par l'admin. |
| Space Grotesk | 400–700 | **Inutilisée côté client**. Encore utilisée par l'admin. |
| JetBrains Mono | 500–700 | **Inutilisée côté client**. Encore utilisée par l'admin. |

Les variables typographiques sont définies dans `design-system.css` :

```css
--font-sans:'Plus Jakarta Sans',system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;
--font-display:var(--font-sans);   /* était Bebas Neue avant la refonte « premium » */
--font-num:var(--font-sans);       /* était JetBrains Mono */
--font-brand:'Fraunces',Georgia,'Times New Roman',serif;
```

---

## 3. Pages et routes du parcours client

### 3.1 Tableau des routes

Avec `cleanUrls`, `/faq` sert `faq.html`, et ainsi de suite. Règles de réécriture définies dans `firebase.json` : `/categorie/**` → `index.html`, et `/sitemap.xml` → Cloud Function `sitemap`.

| Route | Fichier | CSS spécifique | JS spécifique | Nav catégories | Footer |
|---|---|---|---|---|---|
| `/` | `public/index.html` | `pages/01-accueil-v2.css`, `pages/category-guides.css` | script inline (hero, révélations, compteurs, parallaxe), `js/produits-list.js` | oui | oui |
| `/categorie/<slug>` | `public/index.html` (réécriture) | idem | idem : la catégorie est lue dans l'URL | oui | oui |
| `/?q=<terme>` (recherche) | `public/index.html` | idem | idem : pré-remplit le champ de recherche | oui | oui |
| `/produit?id=<idFirestore>` | `public/produit.html` | `pages/02-fiche-produit.css`, `pages/temoignages.css` | script inline (galerie, quantité, onglets, modale), `js/produit-detail.js`, `js/order.js` | oui | oui |
| `/panier` | `public/panier.html` | `pages/13-panier.css` | `js/panier.js` | **non** | **non** (encart `support-contact`) |
| `/confirmation?id=<idCommande>` | `public/confirmation.html` | `pages/04-confirmation.css` | `js/confirmation.js` | **non** | **non** |
| `/suivi?id=<idCommande>` | `public/suivi.html` | `pages/05-suivi-commande.css` | `js/suivi.js` | **non** | **non** |
| `/mes-commandes` | `public/mes-commandes.html` | `pages/12-mes-commandes.css` | `js/mes-commandes.js` | **non** | **non** |
| `/demande-produit` (« Faire une demande ») | `public/demande-produit.html` | `pages/11-demande-produit.css` | `js/demande-produit.js`, script inline | oui | oui |
| `/comment-ca-marche` | `public/comment-ca-marche.html` | `pages/06-comment-ca-marche.css` | — | oui | oui |
| `/contact` | `public/contact.html` | `pages/07-contact.css` | — | oui | oui |
| `/a-propos` | `public/a-propos.html` | `pages/07-contact.css` (**partagé avec Contact**) | — | oui | oui |
| `/faq` | `public/faq.html` | `pages/08-faq.css` | script inline (accordéon, recherche, filtres) | oui | oui |
| `/legal` (mentions légales et CGV) | `public/legal.html` | `pages/09-legal.css` | script inline (sommaire actif) | oui | oui |
| `/temoignages` | `public/temoignages.html` | `pages/temoignages.css` | `js/temoignages.js` | oui | oui |
| toute URL inconnue | `public/404.html` | `pages/10-404.css` | script inline (recherche) | **non** | **non** |

Scripts communs à presque toutes les pages : `storage-namespace-migration.js`, `transition-pages.js` et le script inline de thème (dans `<head>`), puis `scroll-reveal.js`, `theme-toggle.js`, `nav-toggle.js` (seulement sur les pages qui ont une nav), `header-search.js` (sauf l'accueil), `panier-badge.js` (qui importe `reseau.js`), `sw-register.js` et `ios-install-prompt.js`.

> **Ce qui n'existe pas :**
> - **pas de page catégorie dédiée** : une catégorie est un **filtre de la grille de l'accueil** ;
> - **pas de page de résultats de recherche** : la recherche filtre la même grille ;
> - **pas de compte client**, de connexion ni de liste de favoris ;
> - **pas de page de paiement** (paiement à la livraison).

### 3.2 Détail page par page

#### Accueil — `public/index.html`
Ce qu'elle affiche, de haut en bas :
1. **Barre de progression du scroll** (`#scrollProgress`, 3 px en haut).
2. **Header** commun (§5.1) avec la nav des 9 catégories.
3. **Hero** (`section.hero`) : bloc sombre arrondi en deux colonnes. À gauche, eyebrow « Bokki · commande en ligne », titre h1 et sous-titre. À droite, un carrousel de 3 images (`assets/solaire.webp` deux fois, `assets/chaussures.webp`) avec fondu toutes les 5 s, des indicateurs `.hero-tab`, une parallaxe au scroll et un tracé « circuit » SVG décoratif. **Le hero n'a pas de bouton d'appel à l'action.**
4. **Puces de catégories** (`#catChips .cat-chip`) : « Tout » suivi des 9 catégories, chacune avec son icône Phosphor, dans une rangée défilante horizontalement.
5. **Section produits** (`#produits`) : titre « Sélection du moment », compteur `#prodCount`, barre de filtres `#filterBarClient` (affichée seulement quand une catégorie est active : des `<select>` par caractéristique, plus un filtre de prix min/max et un bouton « Réinitialiser »), **grille `#prodGrid`** de cartes produit (§5.4) précédée de 4 squelettes de chargement, et bouton « Voir plus de produits » (`#loadMoreWrap`).
6. **Bandeau « Vous ne trouvez pas ce que vous cherchez ? »** (`.nfb-band .not-found-banner`) avec le bouton « Faire une demande » vers `demande-produit.html`.
7. **Bloc éditorial SEO** (`.category-guides`) : un h2, un paragraphe et deux liens.
8. **Bande « avantages »** (`.zero-adv`), 3 colonnes avec compteurs animés : « 0 — Zéro avance », « 100 % — Paiement à la livraison », « 24–72H — Livraison suivie ».
9. **Footer** (§5.9).

Logique dans `js/produits-list.js` : chargement paginé depuis Firestore (12, 24 ou 48 produits selon la qualité du réseau), filtrage par catégorie, filtres et recherche, ajout rapide au panier, routes `/categorie/<slug>` gérées avec `history.pushState`, et balises SEO (title, meta, canonical) mises à jour selon la catégorie.

#### Fiche produit — `public/produit.html`
1. Header.
2. **Bandeau-titre** `.pf-hero` : « Zéro avance à la commande / Livraison gratuite ». C'est un texte statique, pas le nom du produit.
3. **Barre du haut** `.p-topbar` : bouton retour rond `.p-back` et fil d'Ariane `.crumb-row` (Accueil / Catégorie / Nom).
4. **Colonne unique centrée, de 460 px maximum, sur tous les écrans** (`.product-grid{display:block;max-width:460px}`) :
   - **Galerie** `.gal-main` : image carrée affichée en `object-fit:contain` sur fond blanc, badge « PAYEZ À LA LIVRAISON », deux flèches rondes centrées sous la photo et bouton « Voir en HD » (`.gal-hd`) en réseau lent. **Les miniatures existent dans le DOM mais sont masquées** (`.gal-thumbs{display:none}`).
   - Pastilles de couleur `.couleur-swatches`, si le produit a des variantes de couleur.
   - Note moyenne `.p-rating` (étoiles et « 4.6 sur 5 · 12 avis »), affichée seulement s'il y a des avis.
   - Catégorie `.p-cat`, titre `.p-title` (h1) et description `.p-desc`.
   - **Sélecteur de variantes** `#variantPicker` : pilules `.variant-pill` par dimension (Stockage, RAM, Taille, Pointure…). Une option impossible est barrée et marquée « indisponible ».
   - **Ligne prix et quantité** `.price-qty-row` : prix `.p-price` (« Dès … » si aucune variante n'est choisie) et stepper `.qty-control`.
   - **Onglets** `.p-tabs` en contrôle segmenté : « Caractéristiques » (lignes `.spec-row`) et « Livraison » (4 lignes statiques).
   - **Pastilles de confiance** `.trust-pill` : « Zéro avance », « Paiement à la livraison », « Livraison 24–72h ».
5. **Barre d'achat fixe en bas d'écran** `.order-bar` avec deux boutons : « Ajouter au panier » (`.cart-cta`, contour bleu) et « Commander » (`.order-cta`, vert plein). Les deux sont désactivés tant qu'une combinaison de variantes complète n'est pas choisie.
6. **Avis clients** `#reviewsSection` : 2 cartes `.t-card` puis « Voir les N autres avis ».
7. **Produits similaires** `#similarSection` : jusqu'à 6 cartes de la même catégorie. **Leur style diffère de l'accueil** (voir §10).
8. Footer.
9. **Modale de commande** `#orderOverlay .modal`, qui devient une feuille du bas sur mobile : récapitulatif du produit avec mini-stepper, formulaire (nom, téléphone, région, quartier, repère), note « Livraison gratuite », bloc total sombre, bouton « Confirmer ma commande » et deux notes en bas.

Logique : `js/produit-detail.js` (données, variantes, images adaptées au réseau, avis, produits similaires, SEO JSON-LD) et `js/order.js` (envoi de la commande). Un script inline gère la galerie, la quantité, les onglets et l'ouverture et la fermeture de la modale.

#### Panier — `public/panier.html`
1. Header sans nav.
2. **Bandeau-titre sombre** `.track-hero` : « Mon panier » / « Votre sélection, prête à commander. »
3. `.pn-wrap` (560 px maximum) :
   - **état vide** `#pnEmpty` : icône, texte et bouton « Découvrir la boutique » ;
   - **état rempli** `#pnContent` : lignes `.pn-line` (vignette, nom, variante, prix unitaire, stepper, poubelle, sous-total), « Vider le panier » (confirmation par `confirm()` natif), bloc total sombre `.total-row`, titre « Vos coordonnées de livraison », **formulaire** identique à celui de la modale, note « Aucun paiement… », bouton « Commander tout le panier » et lien « Continuer mes achats ».
4. Encart de contact `.support-contact`, à la place du footer.

Logique : `js/panier.js` et `js/panier-store.js`. Le panier est stocké en `localStorage`.

#### Confirmation — `public/confirmation.html`
`.wrap` (620 px maximum), centré :
1. Cercle vert animé avec une coche `.check-circle` et un anneau pulsant `.check-ring`, titre « Commande enregistrée ! ».
2. **Numéro de commande** `.order-num` : bloc sombre avec liseré pointillé doré, numéro du type `BK-2026-A1B2C3` et bouton « Copier le numéro ».
3. **Code de livraison** `.code-card` : carte en pointillés bleus, chiffres espacés `.code-digits`.
4. **Statut** `.status-card` : pastille `.status-pill`, délai estimé et **stepper horizontal en 4 étapes** `.steps` (Reçue → Confirmée → En livraison → Livrée).
5. **Récapitulatif** `.recap-card` : lignes `.recap-line` et total.
6. Encart vert `.deliv-card` « Rien à payer maintenant ».
7. Boutons `.actions` : « Suivre ma commande » (primaire), « Activer les notifications » (secondaire, si possible), « Voir toutes mes commandes » et « Retour à la boutique ».

#### Suivi de commande — `public/suivi.html`
1. Bandeau-titre `.track-hero` : « Où est mon colis ? ».
2. **Sans `?id=` dans l'URL**, seul un message s'affiche (`#trackEmpty`) : « Ouvrez le lien de suivi reçu… ou Mes commandes ». **Il n'y a aucun champ pour saisir un numéro de commande.**
3. **Avec `?id=` mais sans code mémorisé sur l'appareil**, un formulaire `#trackAccess` demande le code de livraison et le téléphone. Il est **entièrement stylé en inline**.
4. **Carte résultat** `.result-card`, qui remonte sur le bandeau (`margin-top` négatif) :
   - numéro et pastille de statut ;
   - **timeline verticale** `.timeline .tl-item` en 4 étapes, avec dates et pastille pulsante sur l'étape en cours ;
   - accordéon « Voir mon code de livraison » (`.code-reveal`) ;
   - lignes `.order-summary` et total ;
   - **formulaire d'avis** (5 étoiles et commentaire), affiché seulement si le statut est « livrée » ;
   - « Activer les notifications » et « Un problème avec cette commande ? Contactez-nous ».
5. Le suivi se rafraîchit automatiquement toutes les **2 minutes**.

#### Mes commandes — `public/mes-commandes.html`
- Bandeau-titre, onglets `.mc-tab` (« Toutes » et « En cours », avec compteurs), liste de cartes `.mc-card` (première image, nom, « +N articles », numéro, quantité, total, pastille de statut colorée, date) et état vide.
- **Seules les commandes passées depuis ce navigateur** apparaissent (`localStorage` `bokki-mes-commandes`, 50 au maximum).

#### « Faire une demande » — `public/demande-produit.html`
- Bandeau-titre `.dp-hero` : « Vous ne le trouvez pas ? On va vous le chercher. »
- Mise en page en deux colonnes `.dp-layout` (1,3fr / 1fr), qui s'empilent sous 860 px :
  - **formulaire** `.form-panel` : nom du produit, quantité (stepper), catégorie (select), **zone d'upload de photos** `.upload-zone` (5 au maximum, 5 Mo chacune, aperçus `.photo-thumb`), détails, nom et téléphone du client, bouton `.submit-btn`. Après l'envoi, le formulaire est remplacé par `.success-panel` ;
  - **panneau d'explication** `.info-panel` : étapes numérotées `.info-step` et note `.info-note`.
- Envoi par la Cloud Function `creerDemandeProduit`. Les photos vont dans Storage.

#### Comment ça marche — `public/comment-ca-marche.html`
Bandeau `.hiw-hero` centré, **bande de confiance** `.trust-band` (3 colonnes : « 0 GNF », « 100 % », « 24–72H »), section **zones couvertes** `#zones-couvertes` (texte, note `.zone-note`, grille de cartes `.zone-card` par ville avec délai) et encart `.order-steps-support`.

#### Contact — `public/contact.html`
Bandeau `.c-hero` et grille `.c-grid` de cartes `.c-card` : **Email** (classe `.phone` réutilisée, voir §10) et **Téléphone / WhatsApp** (deux numéros, +224 et +33). Le CSS prévoit aussi des cartes horaires et plan (`.hours-card`, `.map-card`) qui **ne sont plus utilisées dans le HTML**.

#### À propos — `public/a-propos.html`
Bandeau `.c-hero` et contenu éditorial `main.c-main` (900 px maximum, en style inline) organisé en `section > h2 + p`.

#### FAQ — `public/faq.html`
Bandeau `.f-search` avec un champ de recherche, puces de filtre `.cf-chip` (Toutes, Commande, Paiement, Livraison, Produits), groupes `.faq-group` et **accordéons** `.faq-item` / `.faq-q` / `.faq-a` (animation de `grid-template-rows`), puis bande d'aide `.help-band` avec boutons `.hbtn`. Un JSON-LD `FAQPage` sert au SEO.

#### Mentions légales et CGV — `public/legal.html`
Bandeau `.l-hero`, mise en page `.legal-layout` (sommaire collant `.toc` de 230 px et contenu `.legal-content`), sections numérotées, carte d'infos `.info-card` / `.info-row` et encart `.callout`.

#### Témoignages — `public/temoignages.html`
Bandeau `.t-hero` avec résumé `.t-summary` (note moyenne et nombre d'avis) et grille `.t-list` de cartes `.t-card` (étoiles, date, commentaire, avatar à initiales). Elle affiche les 100 derniers avis, tous produits confondus (`js/temoignages.js`).

#### 404 — `public/404.html`
Page **entièrement sombre** (`body` en `var(--nuit)`, header transparent). Elle contient un grand « 404 » dont le « 0 » est doré et cerclé, un titre, un texte, une recherche `.err-search`, les boutons « Retour à la boutique » et « Signaler ce lien », les puces de catégories `.qc-chip` et l'encart de contact.

---

## 4. Styles globaux

### 4.1 Où c'est défini

| Fichier | Rôle | Statut |
|---|---|---|
| `public/css/design-system.css` (783 lignes) | **Source de vérité actuelle.** Jetons de couleur, de rayon, d'ombre, d'espacement et de typographie pour les deux thèmes, puis surcharge harmonisée de tous les composants. Chargée en **dernier**. | Actif, ajouté par le commit `3865ced` (« Système de design premium »). |
| `public/css/client.css` (714 lignes) | Styles de base de tous les composants client, dans l'**ancien** langage visuel (Bebas, coins de 14 px, couleurs `--terre`/`--or`). | Actif, mais **largement écrasé** par `design-system.css`. |
| `public/css/pages/*.css` | Une feuille par page, qui **duplique** `body`, `.container`, `button`, `footer`, `.reveal`… | Actif, partiellement écrasé. |
| `public/css/theme-jour.css` / `theme-nuit.css` | Anciennes palettes (`--terre`, `--sable`, `--nuit`…). | **Entièrement redéfinies** par `design-system.css` côté client, donc **inutiles côté client** (encore utilisées par l'admin). |
| `public/css/base.css` | Reset, logo baobab, View Transitions, points de chargement. | Actif (partagé avec l'admin). |

### 4.2 Jetons communs (`design-system.css` §1)

```css
/* Typographie */
--fs-2xs:11px;  --fs-xs:12px;  --fs-sm:13.5px; --fs-md:15px;
--fs-lg:17px;   --fs-xl:20px;  --fs-2xl:clamp(22px,4.8vw,28px);
--fs-3xl:clamp(28px,6.4vw,46px);

/* Rayons */
--r-xs:8px; --r-sm:12px; --r-md:16px; --r-lg:20px; --r-xl:28px; --r-pill:999px;

/* Espacements (échelle de 4 px) */
--s-1:4px; --s-2:8px; --s-3:12px; --s-4:16px; --s-5:24px; --s-6:32px; --s-7:48px; --s-8:64px;

/* Contrôles et mise en page */
--ctl-h:52px;      /* hauteur des boutons et champs principaux */
--tap:44px;        /* cible tactile minimale */
--gutter:16px;     /* marge latérale sur mobile (24px à partir de 768px) */
--page-max:1240px; /* largeur max du contenu */
--ease:cubic-bezier(.2,.8,.2,1);
--dur:.18s;

/* Constantes */
--media-bg:#FFFFFF;   /* fond des photos produit, blanc dans LES DEUX thèmes */
--on-primary:#FFFFFF; --on-buy:#FFFFFF;
--gold:#E8A33D;       --gold-text:#F2C46B;  /* or lisible sur fond sombre */
```

> **Dans les faits, `--fs-*` et `--s-*` sont presque inutilisés.** Le CSS emploie des valeurs brutes : **31 tailles de police différentes**, de 8,5 px à 40 px, et une quinzaine de rayons différents (voir §10).

### 4.3 Couleurs sémantiques : thème jour (`:root[data-theme="jour"]`)

| Jeton | Valeur | Rôle |
|---|---|---|
| `--bg` | `#F5F6F8` | fond de page |
| `--surface` | `#FFFFFF` | cartes, panneaux |
| `--surface-2` | `#F0F2F5` | fond secondaire (recherche, onglets, steppers) |
| `--surface-3` | `#E7EAF0` | survol et squelettes |
| `--input-bg` | `#F8F9FB` | fond des champs |
| `--border` / `--border-strong` | `#E3E6EC` / `#CBD1DB` | bordures |
| `--text` / `--text-2` / `--text-3` | `#0B1220` / `#334155` / `#5B6475` | texte principal, secondaire, discret |
| `--primary` / `--primary-hover` | `#1D4ED8` / `#1E40AF` | **actions = bleu** |
| `--primary-soft` / `--primary-border` / `--primary-text` | `#EEF3FF` / `#BFD0FA` / `#1D4ED8` | états doux et actifs |
| `--focus` | `#2563EB` | contour de focus |
| `--buy` / `--buy-hover` | `#047857` / `#065F46` | **« Commander » = seule action verte** |
| `--success` / `--success-soft` / `--success-border` | `#047857` / `#ECFDF5` / `#A7F3D0` | encarts « rien à payer » |
| `--warning-text` / `--warning-soft` | `#B45309` / `#FFF7E6` | statut « en attente » |
| `--danger` / `--danger-soft` / `--danger-border` | `#DC2626` / `#FEF2F2` / `#FECACA` | erreurs |
| `--band` / `--band-2` / `--band-line` | `#0B1220` / `#14213D` / `rgba(255,255,255,.08)` | **bandes sombres** (hero, totaux, bandeaux de titre, footer) |
| `--header-bg` / `--header-glass` | `#FFFFFF` / `rgba(255,255,255,.82)` | header (effet verre dépoli à partir de 768 px) |

**Ombres (jour)**
```css
--sh-1:0 1px 2px rgba(15,23,42,.05),0 1px 3px rgba(15,23,42,.04);
--sh-2:0 6px 16px -6px rgba(15,23,42,.12),0 2px 4px rgba(15,23,42,.04);
--sh-3:0 18px 40px -16px rgba(15,23,42,.24),0 4px 10px -4px rgba(15,23,42,.06);
--sh-4:0 30px 70px -20px rgba(15,23,42,.38);
--sh-primary:0 6px 16px -6px rgba(29,78,216,.55);   /* sous les boutons bleus */
--sh-buy:0 6px 16px -6px rgba(4,120,87,.55);        /* sous le bouton Commander */
```

### 4.4 Couleurs sémantiques : thème nuit (`:root[data-theme="nuit"]`)

| Jeton | Valeur |
|---|---|
| `--bg` / `--surface` / `--surface-2` / `--surface-3` | `#0A0F1C` / `#121A2B` / `#18223A` / `#202C47` |
| `--input-bg` | `#0E1526` |
| `--border` / `--border-strong` | `#232E47` / `#34436A` |
| `--text` / `--text-2` / `--text-3` | `#EEF2F8` / `#C9D2E3` / `#9AA6BD` |
| `--primary` / `--primary-hover` / `--primary-text` | `#2563EB` / `#1D4ED8` / `#8AB4FF` |
| `--primary-soft` / `--primary-border` | `rgba(59,130,246,.14)` / `rgba(96,165,250,.42)` |
| `--focus` | `#60A5FA` |
| `--buy` / `--buy-hover` | `#047857` / `#065F46` (inchangé) |
| `--success` / `--warning-text` / `--danger` | `#34D399` / `#FBBF24` / `#F87171` |
| `--band` / `--band-2` | `#0D1424` / `#16233F` |
| `--header-bg` / `--header-glass` | `#0E1526` / `rgba(14,21,38,.82)` |
| Ombres `--sh-1` … `--sh-4` | noires, de `rgba(0,0,0,.35)` à `.8` |

### 4.5 Jetons « historiques » encore utilisés par `client.css` et les feuilles de page

`design-system.css` les redéfinit pour les rapprocher de la nouvelle palette. **Leurs noms ne correspondent plus à leur rôle** (voir §10) :

| Jeton | Jour | Nuit | Utilisé pour |
|---|---|---|---|
| `--terre` | `#0F172A` (bleu nuit) | `#E8A33D` (**or**) | anciens boutons, accents, prix |
| `--or` | `#E8A33D` | `#F2B84B` | étoiles, accents dorés |
| `--palme` | `#047857` | `#34D399` | vert « succès » |
| `--nuit` | `#0B1220` | `#070B14` | footer, bandeaux sombres |
| `--sable` / `--sable-d` | `#F5F6F8` / `#ECEEF2` | `#0A0F1C` / `#18223A` | fonds |
| `--white` | `#FFFFFF` | `#121A2B` (**sombre !**) | fond des cartes |
| `--ink` / `--muted` / `--line` | `#0B1220` / `#5B6475` / `#E3E6EC` | `#EEF2F8` / `#9AA6BD` / `#232E47` | texte et bordures |
| `--on-terre` | `#FFFFFF` | `#0B1220` | texte sur `--terre` |

Chaque couleur a aussi sa variante `--xxx-rgb` (ex. `--terre-rgb:15,23,42`) pour les usages en `rgba()`.

### 4.6 Couleurs codées en dur (hors jetons)

- Dégradés des bandes sombres : `radial-gradient(… #1C2D52 0%, var(--band) 58–60%)` dans `.hero`, `.zero-inner`, `.trust-inner`, `.help-inner`, `.total-row` et `.order-num` (`design-system.css` §8, §10, §16, §18).
- Bandeaux de titre : `rgba(37,99,235,.38)` et `rgba(232,163,61,.16)` (`design-system.css` §12).
- Eyebrows dorés : `rgba(232,163,61,.14)` et `.32`.
- Point vert du badge « À la livraison » : `#34D399`. Fond du badge : `rgba(11,18,32,.84)`.
- Logo : `#1F4D3A` (cime) et `#C1440E` (tronc) par défaut, `#E8A33D` et `#EFE0C8` sur fond sombre (`base.css`, `theme-nuit.css`, `client.css`).
- Ancienne couleur terracotta `rgba(193,68,14,…)` dans `.form-error` de `pages/02`, `05` et `11`. Elle est écrasée par `design-system.css`, mais reste dans le code.
- Bannière iOS : `#0B1220` et `#F2B84B`.
- Placeholders d'image : SVG en `data:` avec le fond `#16233D` et le texte `#93A4C3` (`js/produits-list.js`, `produit-detail.js`, `panier.js`, `suivi.js`, `confirmation.js`).
- `COULEUR_HEX` (`js/produit-categories.js`) : table qui associe un nom de couleur (« noir », « bleu marine », « rose gold »…) à une valeur hexadécimale, pour les pastilles de couleur.

### 4.7 Typographie actuelle (valeurs réelles)

| Élément | Taille et graisse |
|---|---|
| `body` | 15 px, interligne 1,55, Plus Jakarta Sans |
| H1 du hero de l'accueil | `clamp(25px,5.6vw,44px)` / 800, letter-spacing -.028em. Sous 700 px : `clamp(23px,6.6vw,28px)`, **mais `01-accueil-v2.css` impose aussi 20 px** (voir §10). |
| H1 des bandeaux de pages secondaires | `var(--fs-3xl)` = `clamp(28px,6.4vw,46px)` / 800 |
| Titre de section `.sec-head h2` | `clamp(20px,4.4vw,28px)` / 800 |
| Titre de la fiche produit `.p-title` | `clamp(23px,5.4vw,30px)` / 800 |
| Prix de la fiche `.p-price` | `clamp(24px,6.6vw,30px)` / 800, chiffres tabulaires |
| Nom sur une carte produit | 14 px / 600 (13,5 px sous 520 px), 2 lignes au maximum |
| Prix sur une carte produit | 17 px / 800 (15 px sous 520 px) |
| Eyebrows | 11–11,5 px / 700, majuscules, letter-spacing .06–.12em |
| Libellé de champ | 13,5 px / 600 |
| Champ de saisie | **16 px** (évite le zoom automatique d'iOS) |
| Boutons | 15 px / 700 (16 px pour « Confirmer ») |

---

## 5. Composants réutilisables

> Ce ne sont **pas** des composants au sens React ou Vue : ce sont des **motifs HTML et des classes CSS** répétés, parfois générés en JS. Les « props » ci-dessous désignent les variations par classe ou par attribut et les données injectées.

### 5.1 Header — `<header><div class="hdr-row">…`
- **HTML :** copié dans chacun des 14 fichiers `public/*.html`.
- **CSS :** `css/client.css` (bloc « EN-TÊTE CLIENT ») et `css/design-system.css` §5. Variante sombre dans `pages/10-404.css` et `design-system.css` §23.
- **Structure :** `a.logo` (SVG baobab et `.brand-word` « Bokki ») → `nav.mainnav` (9 liens catégorie `data-cat`, absente sur 5 pages) → `div.search[role=search]` (`#searchInput` et `button.search-go#searchGo`) → `div.hdr-actions` contenant 3 `.icon-btn` ronds de 44 px :
  - Panier (`a[href=panier.html]`, avec la pastille `#panierBadge.panier-badge` ; « 99+ » au-delà de 99) ;
  - Suivi (`a[href=suivi.html]`, **icône cloche `ph-bell`**) ;
  - Thème (`button[data-theme-toggle]`, icônes `.icon-sun` et `.icon-moon`).
- **Comportement :** `position:sticky; top:0; z-index:50`, effet verre dépoli à partir de 768 px.
- **JS :** `js/nav-toggle.js` (injecte le bouton ☰), `js/header-search.js` (redirige la recherche vers l'accueil), `js/panier-badge.js` (compteur), `js/theme-toggle.js`.
- **Variations :** le lien du logo vaut `#` sur l'accueil et `index.html` ailleurs ; les liens de la nav pointent vers `#produits` sur l'accueil et vers `index.html#produits` ailleurs.

### 5.2 Menu mobile — `button.nav-toggle` et `nav.mainnav.mobile-open`
- **JS :** `js/nav-toggle.js` crée le bouton ☰ (`ph-list`) en tête de `.hdr-row`, gère `aria-expanded`, et ferme le menu au clic sur un lien ou à l'extérieur.
- **CSS :** `client.css` (`@media(max-width:1180px)`) et `design-system.css` (`1181–1399px` et `max-width:1399px`).
- **Rendu :** un **tiroir déroulant** sous le header (`position:absolute; top:100%`), pleine largeur, liste verticale de liens séparés par des filets, avec 70 vh de hauteur maximale et un défilement.
- **Limites :** pas d'animation d'ouverture, pas de piège du focus, pas de fermeture par Échap, pas de fond assombri. Le menu ne contient **que les 9 catégories** : ni Suivi, ni FAQ, ni Contact.
- **Absent** des pages Panier, Confirmation, Suivi, Mes commandes et 404, qui n'ont pas de `nav.mainnav`.

### 5.3 Barre de recherche
- **Header :** `.search` (pilule de 46 px, `--surface-2`, anneau de focus bleu) et `.search-go` (rond bleu de 38 px).
- **Autres variantes, à unifier :** `.f-search` (FAQ), `.err-search` (404, sur fond sombre), `.search-card` (CSS prévu pour le suivi, **inutilisé**), `.filter-price` (filtre de prix).
- **Comportement :** sur l'accueil, filtre en direct par **nom** (sous-chaîne, insensible à la casse) sur les produits **déjà chargés**. Ailleurs, Entrée ou le bouton renvoient vers `index.html?q=…#produits`.

### 5.4 Carte produit
- **Générée en JS :** `cardHTML(p)` dans `public/js/produits-list.js` (accueil) et `similarCardHTML(p)` dans `public/js/produit-detail.js` (produits similaires). **Ce sont deux implémentations différentes.**
- **CSS :** `client.css` (`.card`, `.card-media`, `.card-body`, `.price`, `.price-old`, `.card-cart`, `#prodGrid .card…`), `pages/01-accueil-v2.css`, `pages/02-fiche-produit.css` et `design-system.css` §9.
- **Données affichées** (accueil) :

| Donnée | Source | Rendu |
|---|---|---|
| Image | `imagesSmall[0]` si `miniaturesEntieres`, sinon `images[0]`, sinon un placeholder | `.card-media img`, carré, `object-fit:contain`, fond blanc, `srcset` en réseau rapide |
| Badge | constant | `.cod-tag` « À LA LIVRAISON », pilule sombre avec un point vert |
| Nom | `infosGenerales.nom` | `h3`, 2 lignes au maximum |
| Prix | `caracteristiques.prixMin` (« Dès … ») ou `caracteristiques.prix` | `.price`, dans la devise affichée |
| Prix barré | `caracteristiques.prixBarre`, s'il est supérieur au prix | `.price-old` |
| Ajout rapide | — | `button.card-cart`, rond bleu de 42 px en bas à droite de la photo. Il devient vert avec une coche pendant 1,3 s. Pour un produit à variantes (`data-variantes="1"`), il renvoie vers la fiche. |

- **Interaction :** un clic sur la carte ouvre `produit.html?id=…`. La carte se soulève de 3 px au survol, seulement sur les appareils qui ont un survol.
- **Variante « similaires » :** affiche en plus `.card-cat` (catégorie) et un **bouton vert pleine largeur « Commander »** (`.order-btn`) à la place du rond panier.
- **Squelette :** `.card-skel` (`.sk-media`, `.sk-line.w60`, `.sk-line.w40`) avec un dégradé animé (shimmer).

### 5.5 Boutons (`design-system.css` §6)

| Rôle | Classes concernées | Style |
|---|---|---|
| **Primaire** (bleu) | `.btn-primary`, `.confirm-btn`, `.submit-btn`, `.bd-btn`, `.hbtn.primary`, `.nfb-btn`, `.copy-btn`, `.search-card button`, `.c-card.phone .cbtn` | fond `--primary`, texte blanc, 700, 15 px, **hauteur 52 px**, **rayon 14 px**, ombre `--sh-primary`, `scale(.985)` à l'appui |
| **Secondaire** (contour bleu) | `.btn-secondary`, `.contact-btn`, `.reviews-more-btn`, `.c-card.address .cbtn`, `.load-more button` | fond `--surface`, texte `--primary-text`, bordure de 1,5 px `--primary-border`, 52 px, rayon 14 px (pilule pour « Voir plus ») |
| **Achat** (vert) | `.order-cta` (fiche), `.order-btn` (cartes similaires), `.c-card.whatsapp .cbtn` | fond `--buy`, ombre `--sh-buy` |
| **Fantôme** (sur fond sombre) | `.btn-ghost`, `.hbtn.ghost` | blanc à 6 %, bordure blanche à 28 % |
| **Icône ronde** | `.icon-btn`, `.nav-toggle`, `.p-back`, `.modal-close`, `.gal-arrow`, `.card-cart`, `.search-go` | 38 à 44 px, rond |
| **Désactivé** | `[disabled]` | opacité .55, `cursor:not-allowed` |
| **Chargement** | `button.en-chargement` | le texte est remplacé par 3 points animés `.points-chargement` (`js/bouton-chargement.js`, `css/base.css`) |

> **Une dizaine de classes différentes produisent le même bouton primaire.** Il faut définir dans la nouvelle UI un vrai composant `Button` avec des variantes (`primary`, `secondary`, `buy`, `ghost`, `icon`) et des tailles.

### 5.6 Champs de formulaire (`design-system.css` §14)
- **Motif :** `.field > label + input|select|textarea (+ .hint)`. Le libellé obligatoire porte `<span class="req">*</span>` ; le libellé optionnel porte « (optionnel) » en style inline.
- **Champ :** hauteur minimale de 52 px, padding 13×15, bordure de 1,5 px `--border`, rayon de 12 px, fond `--input-bg` et **police de 16 px**. Au focus : bordure bleue, anneau de 4 px `rgba(primary,.14)`, fond `--surface`.
- **Select :** chevron SVG en `data:` (`#64748B`).
- **Grilles :** `.field-row` (2 colonnes, 1 sous 480 px) et `.field-row2` (2 colonnes, 1 sous 420 px).
- **Erreur :** `.form-error` (bloc rouge doux, au-dessus du formulaire). **Il n'y a pas d'erreur par champ** ni d'état `aria-invalid`.
- **Stepper de quantité** `.qty-control` : `− [n] +`. Le bouton `+` est plein bleu et le `−` est blanc. Il existe **4 tailles selon le contexte** : 40 px (défaut), 38 px (fiche), 34 px (panier) et 32 px (modale).
- **Upload :** `.upload-zone` (cadre en pointillés, icône, texte) et `.photo-previews .photo-thumb` (64 px, bouton `.rm`).
- **Étoiles :** `.stars-input .star-btn` (44 px, caractère ★, doré quand actif).
- **Formulaire de commande :** **deux copies** (modale `produit.html#orderForm` et `panier.html#pnForm`) avec les mêmes champs `#fname`, `#fphone`, `#fville` (8 régions), `#fquartier` et `#frepere`.

### 5.7 Puces, filtres et onglets (`design-system.css` §7)
- `.cat-chip` (accueil), `.cf-chip` (FAQ) et `.mc-tab` (Mes commandes) : pilules de 40 px, blanches avec bordure. Actives : bleu plein.
- `.qc-chip` (404, sur fond sombre).
- `.variant-pill` (fiche) : pilules de 42 px. Active : fond bleu doux et bordure bleue. Indisponible : barrée avec le tag « indisponible ».
- `.couleur-swatch` (fiche) : ronds de 34 px. Actif : anneau bleu. Repli texte `.couleur-swatch-fallback` si la couleur est inconnue.
- `.p-tabs .p-tab` (fiche) : contrôle segmenté.
- `.status-pill` avec les variantes `.st-attente` (ambre), `.st-transit` (bleu), `.st-livree` (vert) et `.st-retournee` (gris).
- `.trust-pill` (fiche) : pastilles vertes « Zéro avance » etc.
- `.badge.cod` / `.badge.stock` (galerie de la fiche). `.badge.stock` **n'est pas utilisé**.

### 5.8 Bannières et bandeaux
| Composant | Fichier(s) | Description |
|---|---|---|
| Hero de l'accueil `.hero` | `index.html`, `client.css`, `01-accueil-v2.css`, `design-system.css` §8 | bloc sombre arrondi (`--r-xl`) en deux colonnes, carrousel d'images et indicateurs `.hero-tab` |
| Bandeaux de titre des pages secondaires | `.track-hero` (panier, suivi, mes commandes), `.hiw-hero`, `.c-hero` (contact, à propos), `.f-hero`, `.l-hero`, `.t-hero`, `.dp-hero` | **7 classes pour le même motif** : fond `--band` avec halos bleu et or, eyebrow doré en pilule, H1 blanc 800, paragraphe blanc à 72 %. `design-system.css` §12 les unifie. |
| Bandes « avantages » `.zero-adv`, `.trust-band`, `.help-band` | `design-system.css` §10 | carte sombre arrondie de 3 colonnes avec chiffres dorés |
| Bandeau « produit introuvable » `.nfb-band .not-found-banner` | accueil | carte en dégradé bleu doux, icône et bouton « Faire une demande » |
| Encarts d'info `.modal-note`, `.deliv-card`, `.zone-note`, `.callout`, `.info-note` | `design-system.css` §13 | encarts verts doux (**5 classes pour 1 motif**) |
| Encart support `.support-contact` | `panier`, `suivi`, `confirmation`, `mes-commandes`, `404` | carte avec emails, téléphone et WhatsApp, qui remplace le footer |
| Bandeau réseau `.reseau-bandeau` | `js/reseau.js` | pilule fixe en bas de l'écran : « Connexion lente » ou « Hors connexion » |
| Bannière d'installation iOS `.ios-install-banner` | `js/ios-install-prompt.js`, `client.css` | carte sombre fixe en bas, avec 3 étapes |
| Avertissement de devise `#currencyDisclosure` | `js/currency-display.js` | petite ligne « conversion indicative », injectée avant le bouton de commande ou le footer |

### 5.9 Footer — `<footer>`
- **HTML :** copié dans 9 pages (absent de panier, suivi, confirmation, mes-commandes et 404).
- **CSS :** `client.css`, chaque `pages/*.css` (**redéfini 9 fois**) et `design-system.css` §11.
- **Structure :** `.foot-grid` sur 4 colonnes (1,6fr + 3×1fr ; 2 colonnes sous 760 px) :
  - `.foot-brand` : logo, emails, téléphone et 2 WhatsApp ;
  - `.foot-col` « Boutique » : 7 catégories (**Vêtements et Voitures manquent**) ;
  - `.foot-col` « Aide » : À propos (**présent sur 4 pages seulement**), Comment ça marche, FAQ, Contact, Témoignages ;
  - `.foot-col` « Informations » : Mentions légales, CGV, Zones couvertes.
- `.foot-bottom` : « © 2026 Bokki » et le tampon « ✓ Paiement à la livraison uniquement ».
- `.foot-social` est stylé, mais **aucun lien vers un réseau social n'est présent dans le HTML** (alors que les icônes facebook, instagram et tiktok sont dans le sous-ensemble Phosphor).

### 5.10 Modale de commande — `#orderOverlay .modal` (fiche produit uniquement)
- **CSS :** `client.css` (`.overlay`, `.modal`, `.modal-head`, `.modal-title`, `.recap`, `.total-row`, `.confirm-btn`, `.modal-note`) et `design-system.css` §16.
- **Desktop :** modale centrée de 460 px maximum, rayon de 28 px, fond assombri et flou.
- **≤ 560 px :** **feuille du bas** collée au bas de l'écran, rayon 24/24/0/0, poignée grise, animation de montée, 94 dvh de hauteur maximale.
- **Ouverture et fermeture :** `openOrderModal()` et `closeOrderModal()` en inline. **Pas de fermeture par Échap ni par clic sur le fond, et pas de piège du focus.**

### 5.11 Autres motifs
- **Fil d'Ariane** `.crumb-row` (fiche).
- **Galerie** `.gal-main`, `.gal-arrow`, `.gal-thumbs`, `.gal-hd`.
- **Ligne de caractéristique** `.spec-row` (libellé à gauche, valeur à droite).
- **Timeline verticale** `.timeline .tl-item` (`.done`, `.current`) dans le suivi, et **stepper horizontal** `.steps .step` (`.done`) dans la confirmation : **deux représentations de la même progression**.
- **Accordéons** `.faq-item` (FAQ), `.code-reveal` (suivi) et `details` natif (`.category-guide-grid`, prévu mais vide).
- **Carte d'avis** `.t-card` (fiche, témoignages).
- **Carte de commande** `.mc-card` et `.order-summary`.
- **Cartes de contact** `.c-card` (`.phone`, `.whatsapp`, `.address`).
- **Cartes de zone** `.zone-card` (`.full` = zone entièrement couverte).
- **Sommaire** `.toc` (mentions légales).
- **Animations d'apparition :** `.reveal`, `.reveal-scale`, `.reveal-x` avec `js/scroll-reveal.js`. **La logique est dupliquée** dans le script inline de `index.html`.
- **Barre de progression du scroll** `#scrollProgress` (dégradé bleu → or).

---

## 6. Données produit

### 6.1 D'où viennent les données

- **Base de données :** **Cloud Firestore**. Les pages lisent directement Firestore avec le SDK web : `getDocs` et `onSnapshot` sur la collection publique `produits`.
- **Images :** **Firebase Storage** (`firebasestorage.googleapis.com`), uploadées depuis l'admin. Chaque photo existe en version originale (HD) et en **miniature de 480 px**.
- **Écriture :** uniquement depuis le back-office (`public/js/admin/produits.js`), avec Vue.
- **Actions sensibles côté client :** passer une commande, suivre une commande, laisser un avis ou faire une demande produit passent par des **Cloud Functions** appelables (`creerCommande`, `obtenirSuiviCommande`, `creerAvis`, `creerDemandeProduit`, `enregistrerTokenNotification`) dans `functions/src/index.ts`.
- **Configuration des catégories** (quels champs, quelles variantes) : **fichier JS statique** `public/js/produit-categories.js` (`PRODUIT_CATEGORIES`), partagé entre l'admin et le client.
- **Il n'y a pas d'API REST** ni de fichier JSON de données.

### 6.2 Structure exacte d'un document `produits/{id}`

```js
{
  infosGenerales: {
    nom:         "iPhone 13 128 Go",        // string — titre
    categorie:   "Téléphones",              // une des 9 valeurs (libellé accentué)
    description: "Texte libre…\n\n…",       // string, multi-lignes ; peut contenir des « champs constants » ajoutés automatiquement (ex. chaussures)
    marque:      "Apple",                   // optionnel
    modele:      "A2482",                   // optionnel
    etat:        "Neuf",                    // "Neuf" | "Reconditionné" | "Occasion"
    garantie:    "3 mois"                   // optionnel
  },
  caracteristiques: {
    // Produit SANS variantes :
    prix:      4500000,                     // number, en GNF
    // Produit AVEC variantes (à la place de prix) :
    prixMin:   4500000,                     // plus petit prix des variantes → « Dès … »
    prixBarre: 5200000,                     // OPTIONNEL : lu par la carte produit, MAIS AUCUN champ admin ne permet de le saisir aujourd'hui
    // Champs propres à la catégorie (voir 6.4), ex. téléphones :
    ram:      "8 Go",
    reseau:   "5G",
    batterie: "5000 mAh",
    // Dimensions de variante, dénormalisées en TABLEAU pour les filtres :
    stockage: ["128 Go", "256 Go"],
    couleur:  ["Noir", "Bleu"]
  },
  images:       ["https://firebasestorage…/photo.jpg", …],      // photos HD, la 1re = photo principale
  imagesSmall:  ["https://firebasestorage…/photo-480.webp", …], // miniatures 480 px, même ordre
  imageWidths:  [1600, 1200, …],                                 // largeur réelle de chaque HD (pour srcset)
  miniaturesEntieres: true,      // true = les miniatures montrent la photo entière (pas recadrée en carré)
  dateCreation:     Timestamp,   // tri du catalogue (plus récent d'abord)
  dateModification: Timestamp
}
```

**Sous-collection `produits/{id}/variantes/{varianteId}`** (une variante = une combinaison avec **son propre prix**) :

```js
{
  libelle:   "128 Go · Noir",                  // affiché dans le récap, le panier et les commandes
  options:   { stockage: "128 Go", couleur: "Noir" },
  prix:      4500000,                          // GNF
  reference: "IP13-128-NR",                    // interne
  image:     "https://…/noir.jpg" | null       // photo spécifique à la couleur (change la photo principale)
}
```

**Sous-collection `produits/{id}/interne/achat`** : prix d'achat et marge, **réservés à l'admin** et jamais lisibles par le client.

**Ancien schéma « plat »**, encore lu en repli par le client et jamais migré : `nom`, `categorie`, `description` et `prixVente` à la racine du document.

### 6.3 Ce qui n'existe PAS dans les données

- **Stock et quantité disponible :** supprimés volontairement (« toujours commandable »). Les classes `.p-stock`, `.badge.stock` et l'état `.out` sont du CSS mort.
- **Promotion ou pourcentage de remise :** seul `prixBarre` est prévu, et il n'est pas saisissable dans l'admin.
- **Slug d'URL produit :** l'URL utilise l'ID Firestore (`/produit?id=Xy7…`).
- **Sous-catégories, tags, marques navigables, note stockée sur le produit :** absents. La note est **calculée côté client** à partir des 50 derniers documents `avis`.
- **Frais de livraison :** toujours 0 (`fraisLivraison: 0`).

### 6.4 Catégories et champs (`public/js/produit-categories.js`)

| Catégorie (slug URL) | Champs « essentiels » (filtres côté client) | Champs « secondaires » (affichés) | Dimensions de variantes |
|---|---|---|---|
| Téléphones (`telephones`) | stockage, couleur, ram, réseau (4G/5G) | batterie, caméra, écran | stockage, couleur, ram |
| Ordinateurs (`ordinateurs`) | ram, stockage, type (Portable/Bureau) | type de stockage, processeur, écran, tactile, couleur, OS | ram, stockage |
| Tablettes (`tablettes`) | stockage, couleur, ram | écran, batterie, connectivité | stockage, couleur, ram |
| Télévisions (`televisions`) | taille, résolution (HD…8K), Smart TV | — | taille |
| Électronique (`electronique`) | — | type d'appareil, puissance, autres | aucune |
| Énergie (`energie`) | — | type d'équipement, puissance, autres | aucune |
| Vêtements (`vetements`) | taille, couleur | matière, genre | taille, couleur |
| Chaussures (`chaussures`) | pointure, couleur | matière, type ; + 3 textes constants (semelle, doublure, entretien) | pointure, couleur |
| Voitures (`voitures`) | année, kilométrage, carburant, boîte | couleur, portes, places | aucune (exemplaire unique) |

> La correspondance slug ↔ libellé est **dupliquée** dans `CATEGORY_LABEL` (`produits-list.js`), `CATEGORY_SLUG` (`produit-detail.js`) et dans le HTML (`data-cat` de la nav, des puces, du footer et de la 404). **Les icônes de catégorie ne sont définies que dans le HTML**, et « Électronique » comme « Énergie » utilisent toutes deux `ph-lightning` sur l'accueil.

### 6.5 Autres collections lues ou écrites par le client

| Collection | Accès client | Champs utiles pour l'UI |
|---|---|---|
| `avis` | lecture publique (fiche : 50 par produit ; témoignages : 100 au total) | `produitId`, `note` (1–5), `commentaire`, `clientNom`, `dateCreation` |
| `commandes` | **aucune lecture directe** ; tout passe par `obtenirSuiviCommande` | voir §8.4 |
| `demandesProduits` | création par la fonction `creerDemandeProduit` | `nom`, `quantite`, `categorie`, `description`, `photos[]`, `clientNom`, `clientTel` |
| `zones` | lecture serveur uniquement | `ville`, `delai` (texte affiché comme « Livraison estimée : … ») |

### 6.6 Prix et devise
- Les prix sont toujours stockés en **GNF entiers**.
- `public/js/currency-display.js` détecte le pays avec `ipwho.is` et récupère les taux avec `open.er-api.com`, avec un cache de 24 h en `localStorage`. Il convertit ensuite l'**affichage** : FR → EUR, SN → XOF, US → USD, GN ou inconnu → GNF.
- Le formatage passe par `Intl.NumberFormat('fr-FR', {style:'currency'})`, par exemple « 4 500 000 GNF » ou « 487,50 € ».
- Chaque prix est rendu en `<span data-currency-gnf="4500000">…</span>` pour pouvoir être reconverti à la volée.

---

## 7. Mode sombre

### 7.1 Mécanisme actuel
1. **Attribut sur `<html>` :** `data-theme="jour"` (clair) ou `data-theme="nuit"` (sombre).
2. **Script inline bloquant**, placé en haut du `<head>` de **chaque page**, avant les feuilles de style, pour éviter un flash du mauvais thème :
   ```js
   var theme = localStorage.getItem('bokki-theme') || 'jour';
   document.documentElement.setAttribute('data-theme', theme);
   ```
   → **Le thème par défaut est toujours clair.** La préférence système (`prefers-color-scheme`) **n'est pas prise en compte**.
3. **Bouton de bascule** `button[data-theme-toggle]` dans le header (soleil ou lune), géré par `public/js/theme-toggle.js`. Il bascule l'attribut et enregistre `bokki-theme` en `localStorage`.
4. **Jetons :** `design-system.css` §2 (jour) et §3 (nuit) redéfinissent toutes les variables sous `:root[data-theme="…"]`, avec `color-scheme: light|dark` pour les contrôles natifs.
5. **Visibilité soleil/lune :** gérée **à la fois** en CSS (`client.css` : `:root[data-theme="nuit"] .icon-btn .icon-sun{display:block}`) et en JS (`theme-toggle.js` pose `style.display`). C'est redondant.

### 7.2 Particularités visuelles
- Les **bandes sombres** (hero, avantages, bandeaux de titre, totaux, numéro de commande, footer) restent **sombres dans les deux thèmes**.
- Le **fond des photos produit** reste **blanc dans les deux thèmes** (`--media-bg:#FFFFFF`), pour que les produits détourés restent lisibles.
- Le **logo** change de couleurs dans le header en thème nuit (`theme-nuit.css`).
- La **404** est toujours sombre.

### 7.3 Incohérences à connaître
- Le `README.md` décrit un **ancien système automatique selon l'heure** (jour de 6 h à 18 h, nuit le reste du temps) « sans bouton de bascule ». **Ce n'est plus vrai** : le basculement est manuel et le thème clair est le défaut.
- `theme-jour.css` et `theme-nuit.css` sont chargés sur chaque page client, mais **chacune de leurs variables est écrasée** par `design-system.css`. Ils ne servent plus qu'à l'admin.
- En thème nuit, les jetons historiques prennent des valeurs contre-intuitives : `--terre` devient **or** et `--white` devient **bleu nuit**. Tout le CSS ancien qui s'en sert change donc de sens selon le thème (voir §10).

---

## 8. Parcours de commande et numéro de suivi

### 8.1 Vue d'ensemble

```
Accueil / Catégorie / Recherche
   │  clic carte                       clic rond panier (produit sans variante)
   ▼                                       │
Fiche produit ───── « Ajouter au panier » ─┤──► localStorage « bokki-panier » ──► pastille du header
   │                                       │
   │ « Commander »                          ▼
   ▼                                   /panier : lignes, quantités, total
Modale « Finaliser ma commande »            │ formulaire de livraison
(1 seul produit, quantité, variante)        │ « Commander tout le panier »
   │ « Confirmer ma commande »              │
   └──────────────┬─────────────────────────┘
                  ▼
     Cloud Function creerCommande  (recalcule tous les prix côté serveur)
                  │  renvoie { id, numero, codeLivraison, statut, articles, montantTotal, delaiEstime }
                  ▼
     /confirmation?id=<id>  (numéro + code + statut + récap)
                  │
                  ▼
     /suivi?id=<id>  (timeline, code, avis une fois livrée) ◄── /mes-commandes (liste locale)
```

### 8.2 Étapes détaillées

**1. Choix du produit** (`produit.html` et `js/produit-detail.js`)
- S'il a des variantes, le client doit choisir **toutes** les dimensions (pilules et pastilles de couleur). Tant que la combinaison n'est pas complète, le prix affiché est « Dès [min] » et **les deux boutons sont désactivés**, sans message explicatif.
- Le choix d'une couleur peut changer la photo principale (`variante.image`).
- La quantité se règle avec le stepper de la fiche.

**2a. Ajouter au panier**
- Depuis la fiche (`.cart-cta`) : enregistre `{produitId, varianteId, varianteLibelle, nom, image (miniature), prixUnitaire, quantite}` dans `localStorage["bokki-panier"]` (`js/panier-store.js`). Le bouton devient vert, « Ajouté au panier », pendant 1,6 s. **Il n'y a ni toast, ni mini-panier, ni lien vers le panier.**
- Depuis une carte de l'accueil (`.card-cart`) : même enregistrement avec une quantité de 1, uniquement pour un produit sans variantes.
- La même combinaison produit et variante cumule la quantité au lieu de créer une nouvelle ligne.
- La pastille du header se met à jour, y compris entre onglets.

**2b. Commander directement** (achat rapide, depuis la fiche)
- « Commander » ouvre la modale. La quantité de la fiche est reportée dans le **stepper de la modale**, qui est un compteur séparé.
- Le formulaire comprend : nom complet\*, téléphone\*, région\* (liste fixe : Conakry, Boké, Faranah, Kankan, Kindia, Labé, Mamou, Nzérékoré), quartier\* (champ texte) et point de repère (optionnel).
- Le serveur est « réveillé » dès l'appui sur « Commander » ou le premier focus dans le formulaire, pour éviter un démarrage à froid de 2 à 5 s (`js/order.js`).

**3. Panier** (`panier.html` et `js/panier.js`)
- On peut modifier les quantités (à 0, la ligne disparaît), retirer une ligne ou vider le panier.
- Le total est calculé localement, à titre indicatif.
- Le formulaire est identique à celui de la modale, avec le bouton « Commander tout le panier ».

**4. Envoi** (`creerCommande`, `functions/src/index.ts`)
- Données envoyées : `{articles:[{produitId, varianteId, quantite}], clientNom, clientTel, ville, quartier, repere}`.
- Le serveur **revérifie chaque produit et chaque variante et recalcule tous les prix**, puis calcule `montantTotal`.
- Il lit le délai estimé dans `zones` selon la région, avec « 3 jours » comme valeur par défaut.
- Il génère le **numéro de commande** et le **code de livraison** (§8.3), puis écrit la commande avec le statut `nouvelle`.
- Pendant l'envoi, le bouton affiche 3 points animés (`js/bouton-chargement.js`). En cas d'erreur, un message apparaît dans `.form-error`.
- Après le succès, le panier est vidé (parcours panier). La commande est mémorisée localement (`mes-commandes-store.js`) et le récapitulatif est gardé en `sessionStorage` pour un affichage instantané. Le navigateur est redirigé vers `confirmation.html?id=<id>`.

**5. Confirmation** (`confirmation.html` et `js/confirmation.js`)
- La page affiche immédiatement le récapitulatif renvoyé par le serveur, puis le rafraîchit avec `obtenirSuiviCommande`.
- Elle montre : numéro (copiable), code de livraison, statut et stepper en 4 étapes, articles, total, délai estimé et le bouton « Activer les notifications » (push web, `js/push-notifications.js`).
- Si le code ou le téléphone ne sont pas connus localement, la page redirige vers le suivi.

**6. Confirmation téléphonique** (hors site)
- Un agent appelle le client et passe la commande au statut `confirmee` dans l'admin. Le prix peut être renégocié (`en_negociation`, `prixConvenu`).

**7. Livraison**
- Le livreur demande le **code de livraison** au client. Sa validation fait passer la commande en `livree`.

**8. Avis**
- Une fois la commande `livree`, la page de suivi affiche « Notez votre commande » (1 à 5 étoiles et un commentaire). L'avis est envoyé par `creerAvis` et devient visible sur la fiche produit et sur la page Témoignages.

### 8.3 Numéro de commande et code de livraison

| | Numéro de commande | Code de livraison |
|---|---|---|
| Format | **`BK-{année}-{6 derniers caractères de l'ID Firestore, en majuscules}`**, par ex. `BK-2026-A1B2C3` | **4 chiffres** (ou **6**, selon le réglage admin `parametres/livraison.longueurCode`), par ex. `0473` |
| Génération | `numeroDepuisId()` dans `functions/src/index.ts` (~l. 310). Il est dérivé de l'ID, donc unique sans compteur. | `genererCodeChiffres()` avec `crypto.randomInt`. L'unicité **parmi les commandes actives** est garantie par un document `codesActifs/{code}`, libéré quand la commande n'est plus active. |
| Rôle | Référence humaine (téléphone, SAV, étiquettes) | **Secret** : prouve que c'est bien le client qui reçoit le colis, et sert de « mot de passe » pour voir le suivi et laisser un avis |
| Où il s'affiche | confirmation, suivi, mes commandes | confirmation (en grand), suivi (accordéon masqué) |

**Comment le suivi est sécurisé.** Ce point compte pour l'UX :
- La lecture directe de `commandes` est interdite. Le client appelle `obtenirSuiviCommande({commandeId, code, telephone})`, et le serveur vérifie que **le code et le téléphone correspondent**.
- L'URL de suivi contient l'**ID Firestore** (`suivi?id=…`), **pas** le numéro `BK-…`. **On ne peut pas suivre une commande en tapant seulement son numéro.**
- Le navigateur qui a passé la commande retient l'ID et le code (`localStorage` `bokki-mes-commandes`), ainsi que le téléphone (`sessionStorage`, effacé à la fermeture de l'onglet).
- Sur un autre appareil, ou après fermeture de l'onglet, la page demande **le code de livraison et le téléphone**, et seulement si l'URL contient déjà `?id=`.
- Le suivi n'est pas en temps réel : il se rafraîchit toutes les **2 minutes**. Le client peut aussi activer les **notifications push** web.

### 8.4 Statuts de commande et affichage

| Statut (`statut`) | Libellé affiché (pastille) | Étape de la timeline | Classe de couleur (Mes commandes) |
|---|---|---|---|
| `nouvelle` | NOUVELLE — EN ATTENTE | Reçue | `st-attente` (ambre) |
| `confirmee` | CONFIRMÉE | Confirmée par téléphone | `st-transit` |
| `en_negociation` | EN NÉGOCIATION | Confirmée | `st-transit` |
| `non_joignable` | (statut admin, compté « en cours ») | — | — |
| `en_livraison` | EN LIVRAISON | En livraison | `st-transit` (bleu) |
| `livree` | LIVRÉE | Livrée (+ date) | `st-livree` (vert) |
| `retournee` | RETOURNÉE | En livraison (**l'étape reste affichée comme « en livraison »**) | `st-retournee` (gris) |

Seules les dates de **création** et de **livraison** sont enregistrées. Les étapes intermédiaires franchies affichent « Terminé » au lieu d'une date.

Données de suivi renvoyées au client : `numero`, `codeLivraison`, `statut`, `articles[] {produitId, varianteId, nom, image, varianteLibelle, quantite, prixUnitaire, prixInitial}`, `montantTotal`, `prixConvenu`, `delaiEstime`, `dateCreation`, `dateLivraison` et `avisSoumis {note, commentaire}`.

---

## 9. Responsive

### 9.1 Approche
- **Desktop-first** dans `client.css` et les feuilles de page (`max-width`), **mobile-first** dans `design-system.css` (`min-width:768px`). Les deux approches cohabitent.
- `<meta name="viewport" content="width=device-width, initial-scale=1.0">` est présent sur toutes les pages.
- **22 breakpoints différents** sont utilisés. Nombre d'occurrences :

| Breakpoint | Occurrences | Principaux usages |
|---|---|---|
| `max 380px` | 3 | header sur 3 lignes, zones sur 1 colonne |
| `max 420px` | 3 | barre d'achat, `.field-row2` |
| `max 480px` | 2 | `.field-row` sur 1 colonne |
| `max 520px` | 5 | cartes produit compactes, en-tête de section empilé |
| `max 560px` | 1 | **modale → feuille du bas** |
| `min 600px` | 1 | padding de la carte du suivi |
| `max 620px` | 1 | **recherche du header sur sa propre ligne** |
| `max 640px` | 1 | guides de catégories |
| `max 700px` | **16** | **breakpoint mobile principal** : grille de 2 colonnes, hero compact, puces, titres |
| `min 760px` / `max 760px` | 1 / 8 | footer sur 2 colonnes, bandeau « introuvable » en ligne |
| `min 768px` | 8 | header en verre dépoli, gouttière de 24 px, bandeaux plus hauts |
| `max 800px` | 1 | `.bd-grid` (mort) |
| `max 820px` / `min 821px` | 9 / 3 | **hero empilé**, bandes « avantages » sur 1 colonne, zones |
| `max 860px` | 5 | mentions légales (sommaire), formulaire de demande sur 1 colonne |
| `max 900px` | 4 | contact sur 1 colonne |
| `max 980px` | 3 | grille de 3 colonnes |
| `max 1180px` / `min 1181px` | 2 / 1 | grille de 4 colonnes, nav → ☰ |
| `max 1399px` / `min 1400px` | 2 / 1 | **nav → ☰** (seuil réel), recherche de 300 px au maximum |

### 9.2 Ce qui change sur mobile

**Header**
- **≥ 1400 px :** logo, nav des 9 catégories, recherche et 3 boutons ronds sur **une seule ligne**.
- **< 1400 px :** la nav est masquée et remplacée par le bouton **☰** (tiroir déroulant). Le logo est poussé à droite du ☰.
- **≤ 620 px :** le header passe sur **2 lignes** : ☰, logo et les 3 boutons, puis la **recherche en pleine largeur**.
- **≤ 380 px :** **3 lignes** (☰ et logo / 3 boutons alignés à droite / recherche). Le commentaire du code dit « retour à 2 lignes », ce qui est faux (voir §10).
- Il n'y a **pas de barre de navigation fixe en bas** (tab bar). Pourtant, le site se présente comme une PWA « comme une app ».

**Accueil**
- Grille produits : **5 colonnes** → 4 (≤ 1180 px) → 3 (≤ 980 px) → **2 colonnes** (≤ 700 px), avec un espacement de 10 à 12 px et des marges latérales réduites à 8–12 px.
- Hero : 2 colonnes → **empilé** (≤ 820 px), avec le texte au-dessus et une bande d'image de 132 px de haut.
- Puces de catégories : rangée **défilante horizontalement**, sans barre de défilement visible.
- Barre de filtres : retour à la ligne (`flex-wrap`), selects à 16 px.
- Bande « avantages » : 3 colonnes → 1 colonne séparée par des filets.
- Footer : 4 colonnes → 2.

**Fiche produit**
- **Identique sur tous les écrans** : colonne centrée de 460 px maximum. Sur desktop, la page ressemble donc à une page mobile au milieu de l'écran.
- **Barre d'achat fixe en bas** sur tous les écrans, avec la zone sûre iPhone (`env(safe-area-inset-bottom)`) ; `body` reçoit un `padding-bottom` de 80 à 84 px.
- La modale de commande devient une **feuille du bas** sous 560 px.

**Pages secondaires**
- Bandeaux de titre : padding de 40 px sur mobile, 60 px à partir de 768 px.
- Formulaires : grilles de 2 champs qui passent à 1 colonne (≤ 480 et 420 px).
- Mentions légales : sommaire collant → bloc statique en haut (≤ 860 px).
- « Faire une demande » : 2 colonnes → 1 (≤ 860 px).
- Contact : 2 colonnes → 1 (≤ 900 px).
- Témoignages : 3 colonnes → 2 → 1.

**Règles tactiles déjà présentes** (à conserver)
- Cibles d'au moins 44 px (`--tap`) sur la plupart des boutons-icônes.
- Champs à 16 px pour éviter le zoom automatique d'iOS.
- Effets de survol limités aux appareils qui en ont (`@media(hover:hover)`).
- `overscroll-behavior` pour supprimer l'effet élastique en mode PWA.
- Suppression du flash gris au tap (`-webkit-tap-highlight-color:transparent`).
- `prefers-reduced-motion` respecté pour la plupart des animations.

**Adaptation au réseau** (spécificité importante du produit)
- `public/js/reseau.js` classe la connexion en `lent`, `moyen` ou `rapide` (`navigator.connection` et mode économie de données).
- En connexion lente : 12 produits par page au lieu de 48, miniatures de 480 px, HD chargée seulement à la demande via « Voir en HD », et bandeau « Connexion lente ».

---

## 10. Problèmes constatés

Classés par thème. Les chemins de fichiers sont relatifs à `public/`.

### 10.1 Architecture CSS : trois couches qui se contredisent
1. **Le même composant est stylé 3 à 5 fois.** Exemple avec `.btn-primary` : `client.css` (survol), `pages/04-confirmation.css`, `pages/10-404.css`, `pages/12-mes-commandes.css`, `pages/13-panier.css`, puis `design-system.css`, qui écrase tout avec des listes de sélecteurs longues et parfois `#prodGrid .card`. Le rendu final dépend de l'ordre de chargement et de la spécificité. **Il est difficile de savoir quelle règle s'applique.**
2. **Le code de base est dupliqué dans chaque `pages/*.css`** : `body{…}`, `button{…}`, `.container{…}`, `a:focus-visible`, `footer`, `.foot-grid`, `.foot-col`, `.foot-bottom`, `.reveal`, `.marquee`, `.status-pill`, `.form-error`… Avec des **valeurs divergentes** : `.container` fait 900 px dans `08-faq.css` et 1240 px ailleurs ; le footer de `11-demande-produit.css` utilise `--muted` et `--terre` au lieu du blanc et de l'or.
3. **Du code mort chargé partout :** `theme-jour.css` et `theme-nuit.css` (écrasés), `.marquee`, `.disp`, `.bd-*`, `.backdrop`, `.search-card`, `.search-tabs`, `.stab`, `.hours-card`, `.map-card`, `.map-pin`, `.badge.stock`, `.p-stock`, `.gal-dots`, `.foot-social`, `.category-guide-grid`, `.gal-thumbs` (rendu puis masqué)…
4. **Les noms des jetons historiques sont trompeurs** : `--terre` (terre) vaut bleu nuit en jour et **or** en nuit, `--white` vaut **bleu foncé** en nuit, `--sable` est le fond de page, `--nuit` est une couleur de bande. Tout ce qui s'écrit `color:var(--terre)` change de teinte d'un thème à l'autre.
5. **Les jetons existent mais ne sont pas utilisés** : `--fs-*` et `--s-*` sont quasi absents. On trouve **31 tailles de police** différentes (8,5 ; 9 ; 9,5 ; 10 ; 10,5 ; 11 ; 11,5 ; 12 ; 12,5 ; 13 ; 13,5 ; 14 ; 14,5 ; 15 ; 15,5 ; 16 ; 16,5 ; 17 ; 18 ; 19 ; 20 ; 21 ; 22 ; 24 ; 26 ; 28 ; 30 ; 34 ; 36 ; 38 ; 40 px) et **une quinzaine de rayons** (2, 3, 5, 8, 9, 10, 11, 12, 13, 14, 16, 20, 22, 24, 26, 28 px, plus 999 px), dont 34 occurrences de 14 px codées en dur.
6. **Couleurs codées en dur** hors jetons : voir §4.6 (`#1C2D52`, `#34D399`, `rgba(232,163,61,…)`, terracotta `rgba(193,68,14,…)`, `#0B1220`…).
7. **Styles inline nombreux** : de 6 à 24 attributs `style="…"` par page (`produit.html` : 24, `suivi.html` : 23, `faq.html` : 21). Ils portent surtout sur la taille des icônes, mais aussi sur des mises en page complètes : le formulaire `#trackAccess` du suivi, le bloc « Merci pour votre avis », la largeur de `a-propos.html`, et un `<style>[hidden]{…}</style>` au milieu du `<body>` de `suivi.html`.
8. **Deux versions du point d'arrêt mobile pour le même élément** :
   - Le hero de l'accueil sous 700 px : `01-accueil-v2.css` impose un h1 de 20 px et un paragraphe de **11 px**, tandis que `design-system.css` impose `clamp(23px,…)` et 13,5 px. C'est `design-system.css`, chargé en dernier, qui gagne. La règle de la page est inutile mais trompeuse.
   - `.container.products` : 8 px de marge dans `01-accueil-v2.css` contre 12 px dans `design-system.css`.
   - `.cat-chip` : 38 px contre 40 px de hauteur.

### 10.2 HTML et JS : duplication et couplage
9. **Le header et le footer sont copiés-collés dans 14 fichiers**, avec des différences involontaires :
   - **5 pages n'ont ni nav catégories, ni bouton ☰, ni footer** (`panier`, `suivi`, `confirmation`, `mes-commandes`, `404`). Sur ces pages, l'utilisateur mobile n'a **aucun accès aux catégories** ni aux pages d'aide, à part le logo.
   - Le lien « À propos » dans le footer n'apparaît que sur 4 pages (`index`, `a-propos`, `contact`, `faq`).
   - La colonne « Boutique » du footer omet **Vêtements et Voitures**.
   - `demande-produit.html` n'a pas de `#scrollProgress`.
10. **Le formulaire de commande est dupliqué** : modale de `produit.html` (géré par `js/order.js`) et `panier.html` (géré par `js/panier.js`). Mêmes champs, mais deux scripts, deux jeux de classes (`.modal .form` et `.pn-form`) et **un comportement différent** : le champ `#fquartier` a `required` dans le panier, **mais pas dans la modale** (le contrôle n'y est fait qu'en JS).
11. **Fiche produit très couplée au HTML** : gestionnaires `onclick="changeQty()"`, `openOrderModal()`, `setTab()`, `prevImg()`… et variables globales partagées entre le script inline et les modules (`window.qty`, `window.modalQty`, `window.modalUnit`, `window.modalVarianteId`, `window.images`…). **Deux compteurs de quantité** coexistent (fiche et modale).
12. **Deux implémentations de la carte produit** (`cardHTML` dans `produits-list.js` et `similarCardHTML` dans `produit-detail.js`), avec des rendus différents (voir 10.4).
13. **La correspondance slug ↔ catégorie existe en 4 endroits** (`CATEGORY_LABEL`, `CATEGORY_SLUG`, `PRODUIT_CATEGORIES`, attributs `data-cat` du HTML). Les icônes de catégorie ne vivent que dans le HTML.
14. **La logique d'animation est dupliquée** : `js/scroll-reveal.js` et le script inline de `index.html`, qui réimplémente la barre de progression et les révélations.
15. **Le placeholder d'image est dupliqué** en 5 SVG `data:` légèrement différents.
16. **Le JS réécrit le contenu au chargement** : `produits-list.js` remplace le H1 du hero (« Bokki, votre site pour commander en ligne » devient « Bokki, boutique en ligne en Guinée ») juste après l'affichage, ce qui produit un **changement de texte visible**. Il cherche aussi `#category-guides-title` et `#pageStructuredData`, **qui n'existent pas** dans `index.html` : le texte SEO par catégorie ne s'affiche donc jamais.
17. **Le vouvoiement et le tutoiement sont mélangés** dans les messages : « recharge la page », « Choisis une combinaison » (`order.js`), « Choisis une note », « Impossible d'enregistrer ton avis » (`suivi.js`), alors que tout le reste du site vouvoie.

### 10.3 Navigation et parcours
18. **Les liens de catégorie hors de l'accueil ne filtrent pas.** Sur les autres pages, la nav, le footer, les puces de la 404 et le fil d'Ariane de la fiche pointent vers `index.html#produits` avec un `data-cat`. Or le gestionnaire qui lit `data-cat` n'existe que sur l'accueil. **Cliquer « Téléphones » depuis une fiche produit ouvre donc l'accueil non filtré.** Les vraies URL `/categorie/<slug>` existent mais ne sont pas utilisées dans les liens.
19. **La recherche est limitée** : elle porte uniquement sur le **nom**, et uniquement sur les produits **déjà chargés** (12 à 48 selon le réseau). Il n'y a ni recherche serveur, ni suggestions, ni page de résultats, ni tolérance aux accents ou aux fautes. Un produit non encore chargé est introuvable tant qu'on n'a pas cliqué « Voir plus ».
20. **Le suivi de commande est inaccessible sans le lien** : l'icône **cloche** du header (qui évoque des notifications, pas un suivi) mène à `suivi.html` sans `?id=`. La page n'affiche alors qu'un message, **sans champ pour saisir un numéro `BK-…`**. Le client qui a changé de téléphone, ou qui a fermé l'onglet sans garder le lien, ne peut pas suivre sa commande en autonomie.
21. **Pas de retour visuel fort après « Ajouter au panier »** : seul le bouton change pendant 1,6 s. Il n'y a ni toast, ni animation de la pastille, ni raccourci « Voir le panier ».
22. **Les boutons désactivés ne s'expliquent pas** : sur la fiche, « Ajouter au panier » et « Commander » restent grisés tant que toutes les variantes ne sont pas choisies, sans message du type « Choisissez une taille ».
23. **« Vider le panier »** utilise `confirm()`, la boîte de dialogue native du navigateur, qui ne respecte pas le style de la marque.
24. **La modale n'est pas complète en accessibilité** : pas de fermeture par Échap ni par clic sur le fond, pas de piège du focus, et le focus n'est pas rendu au bouton d'origine. Le menu ☰ a les mêmes manques.
25. **Statut « retournée » mal représenté** : la timeline le place sur l'étape « En livraison », sans état visuel spécifique.

### 10.4 Incohérences visuelles et de contenu
26. **Les cartes produit sont incohérentes** :
    - Accueil : fond gris clair, sans bordure, **rond bleu « panier »**, sans catégorie affichée.
    - « Produits similaires » sur la fiche : carte blanche bordée, **catégorie affichée**, **gros bouton vert « Commander »**. Cela viole la règle du design system (« Commander = seule action verte, sur la fiche »), et le bouton mène en fait à la fiche, pas à la commande.
27. **Des messages se contredisent sur la livraison** :
    - « **Livraison gratuite** » (bandeau de la fiche et modale) contre « Frais de livraison : **Calculés au quartier** » (onglet « Livraison » de la même fiche).
    - « 24–72 h » (fiche, accueil, comment ça marche) contre « **3 jours** », le délai par défaut du serveur affiché sur la confirmation.
    - La page « Zones couvertes » liste des villes avec « 72H · SUR DEMANDE », alors que le formulaire propose les 8 régions sans distinction.
28. **Le bandeau `.pf-hero` remplace le titre de la fiche** par un slogan (« Zéro avance à la commande / Livraison gratuite »), qui apparaît **au-dessus** du fil d'Ariane et de la photo. Sur mobile, il repousse le produit sous la ligne de flottaison.
29. **La fiche produit reste à 460 px sur desktop** : beaucoup d'espace vide, miniatures masquées, flèches de galerie superposées au bas de la photo (elles peuvent cacher le produit).
30. **Des classes sont mal nommées** : sur `contact.html`, la carte **Email** utilise `.c-card.phone` (son icône est `chat-circle`). `a-propos.html` charge `pages/07-contact.css`. Le panier, le suivi et Mes commandes réutilisent `.track-hero`.
31. **La même progression a deux représentations** : stepper horizontal (confirmation) et timeline verticale (suivi).
32. **Il y a 5 classes pour l'encart vert** (`.modal-note`, `.deliv-card`, `.zone-note`, `.callout`, `.info-note`), **7 pour le bandeau de titre** et **une dizaine pour le bouton primaire**.
33. **Des icônes sont en double ou mal choisies** : « Électronique » et « Énergie » partagent `ph-lightning` sur l'accueil (la 404 utilise `ph-sun` pour Énergie). La cloche sert au suivi. Les étoiles sont des caractères Unicode.
34. **Les réseaux sociaux ont un style prévu mais sont absents du footer.** Seuls des liens WhatsApp sont présents, et uniquement dans le texte.
35. **Le texte est parfois trop petit sur mobile** : plusieurs tailles de 9,5 à 11 px subsistent (`.price small`, `.cod-tag`, `.mc-date`, `.hint`, `.vp-tag` à 8,5 px). Certaines sont relevées par `design-system.css`, mais pas toutes.

### 10.5 Composants mal adaptés au mobile
36. **Header à 380 px** : 3 lignes (☰ et logo / boutons / recherche), soit environ 170 px de hauteur collante. Le commentaire du code dit « retour à 2 lignes ». Sur les petits Android, cela laisse peu de place au contenu, d'autant que le header est `sticky`.
37. **Le menu ☰ n'apparaît qu'à partir des pages qui ont une nav**, et il ne contient que les catégories, sans liens Panier, Suivi, Mes commandes, FAQ ou Contact.
38. **Il n'y a pas de barre de navigation en bas**, alors que la PWA s'installe en mode `standalone` (pas de bouton retour du navigateur sur iOS). Le bouton retour n'existe que sur la fiche (`.p-back`).
39. **La barre d'achat fixe de la fiche** cache environ 80 px de contenu. Elle est compensée par `body:has(.order-bar)`, mais les sections « Avis » et « Similaires » passent dessous pendant le défilement.
40. **Le carrousel du hero** est en `object-fit:cover`, ce qui recadre l'image dans une bande de 132 px de haut sur mobile (la règle « photo entière » ne s'applique qu'aux produits). Il change toutes les 5 s, même hors écran.
41. **La rangée de puces de catégories** défile horizontalement sans aucun indicateur de défilement (pas de dégradé, pas de flèche). Sur un petit écran, l'utilisateur voit 3 ou 4 puces et peut ne pas deviner les autres.
42. **Le filtre de prix** contient deux champs `number` de 92 px dans une pilule, ce qui est étroit pour des montants en GNF à 7 chiffres.
43. **`html, body { overflow-x:hidden; height:100% }`** (`base.css` et `client.css`) peut perturber `position:sticky` et le défilement sur certains navigateurs mobiles. C'est à vérifier lors de la refonte.

### 10.6 Maintenance et performance
44. **Le cache est invalidé à la main** : `?v=premium-20261101`, `?v=reseau-20261012`, `?v=currency-20261010` et `CACHE_VERSION = "bokki-v42"` dans `sw.js` doivent être modifiés manuellement à chaque livraison.
45. **Polices inutilisées côté client** : Bebas Neue, Space Grotesk et JetBrains Mono sont déclarées dans `fonts.css`. Elles ne sont pas téléchargées tant qu'elles ne sont pas utilisées, mais elles brouillent la lecture du code.
46. **Le README est obsolète** : thème automatique selon l'heure, liste de fichiers, « contenu dynamique à connecter »…

---

## 11. Annexe : contraintes à respecter dans la nouvelle UI

Ces contraintes viennent du code, des commentaires et des choix métier explicites. Elles sont à garder sauf décision contraire :

- **Photos produit toujours entières** (`object-fit:contain`) sur **fond blanc**, y compris en thème sombre. Les photos sont souvent détourées par l'admin.
- **Le « paiement à la livraison / zéro avance » doit rester visible** à chaque étape : carte produit, fiche, panier, modale, confirmation.
- **Une seule action d'achat colorée** (« Commander », vert). Les autres actions sont dans la couleur primaire.
- **Champs à 16 px minimum** (iOS) et **cibles tactiles d'au moins 44 px**.
- **Budget réseau faible** : vignettes de 480 px, chargement paginé, pas de police ni de script externe (CSP), squelettes de chargement, état « connexion lente ». **Aucune police ne peut venir de Google Fonts** : elles doivent être déposées dans `public/assets/fonts/`.
- **Icônes** : le sous-ensemble Phosphor doit être régénéré pour chaque nouvelle icône (ou bien changer d'approche, par exemple avec un sprite SVG).
- **`prefers-reduced-motion`** : toutes les animations doivent pouvoir être coupées.
- **Zones sûres** (`env(safe-area-inset-*)`) pour les éléments fixés en bas (barre d'achat, bannières, toasts) : le site est utilisé en PWA.
- **Pas de compte client** : l'historique est stocké localement. Le suivi exige l'ID de commande, le code et le téléphone (contrainte de sécurité côté serveur).
- **Formulaire de commande** : nom, téléphone, région (8 valeurs fixes), quartier (texte libre), repère (optionnel). Le serveur recalcule les prix ; le total affiché côté client est indicatif.
- **9 catégories fixes**, avec les slugs `telephones`, `ordinateurs`, `tablettes`, `televisions`, `electronique`, `energie`, `vetements`, `chaussures` et `voitures`. Les URL `/categorie/<slug>` sont indexées par Google : à conserver.
- **Devise** : chaque montant doit pouvoir être reconverti à la volée (`data-currency-gnf`).
- **Les View Transitions** gardent le header immobile entre les pages (`view-transition-name:entete`).
