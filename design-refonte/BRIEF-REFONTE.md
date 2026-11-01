# Bokki — Brief de refonte du site client

> Pour : Claude Code. Ce dossier contient la nouvelle interface validée par le propriétaire de Bokki.
> Il complète `rapport-design-client.md` (état actuel du code), à relire pour les contraintes techniques.
> **Travailler phase par phase (§6). Ne pas tout faire d'un coup. Ne pas toucher à l'admin (`public/admin/`).**

## 1. Contenu du dossier

| Élément | Rôle |
|---|---|
| `assets/bokki.css` | **Le nouveau système de design** (jetons + composants). Il devient la seule feuille de style du site client. |
| `maquettes/*.html` | Maquettes validées, une par page. Ce sont des **références visuelles**, pas du code à copier tel quel : elles contiennent une syntaxe de prototypage (`<x-dc>`, `<sc-for>`, `{{…}}`, `support.js`) à ignorer. Les `{{…}}` désignent des données dynamiques. |
| `assets/hero-ville.png` | Image provisoire de la bannière (femme + ville). **Basse définition, à remplacer** par l'image finale du propriétaire. |
| `assets/clim.png`, `tv.png`, `cafe.png`, `laptop.png` | Photos produit **provisoires** pour les maquettes. Sur le site, utiliser les vraies images Firestore/Storage. |

Les textes entre crochets (`[À préciser]`, `[date]`, `[Prénom]`, `[Note]`…) sont des données à brancher ou des contenus que le propriétaire fournira.

## 2. Correspondance maquettes → pages

| Maquette | Page actuelle | Notes |
|---|---|---|
| `Main.html` (mobile) + `Web.html` (ordinateur) | `index.html` | **Une seule page responsive** : `Main.html` montre le rendu téléphone, `Web.html` le rendu ordinateur. |
| `Catalogue.html` | `index.html` filtré, `/categorie/<slug>`, `/?q=` | Garder les URL `/categorie/<slug>` (indexées). Tous les liens de catégorie doivent pointer vers ces URL. |
| `Produit.html` | `produit.html` | Deux colonnes sur ordinateur. Barre d'achat collante en bas sur mobile. Cartes « similaires » identiques à celles de l'accueil. |
| `Panier.html` | `panier.html` | Le formulaire de livraison **quitte** le panier : le bouton « Commander » mène à l'étape 1. |
| `Identification.html` | **nouvelle** (`/commande/identification` ou équivalent) | Étape 1 de la commande. **Remplace la modale de commande** de la fiche produit. |
| `Commande.html` | **nouvelle** (`/commande/livraison`) | Étape 2 : nom, région (8 valeurs), quartier, repère. Un seul formulaire pour le panier et l'achat direct. |
| `Confirmation.html` | `confirmation.html` | |
| `Suivi.html` | `suivi.html` | Nouveau formulaire : numéro BK + code de livraison + téléphone (voir §5). |
| `MesCommandes.html` | `mes-commandes.html` | |
| `Connexion.html` | **nouvelle** | Google ou téléphone + code personnel à 4 chiffres. |
| `Compte.html` | **nouvelle** | Commandes, réductions, coordonnées. Le bloc parrainage est **dessiné mais pas à coder maintenant** (phase 7). |
| `Demande.html` | `demande-produit.html` | |
| `CommentCaMarche.html` | `comment-ca-marche.html` | Section `#zones` = zones couvertes. |
| `Contact.html`, `Faq.html`, `APropos.html`, `Legal.html`, `Temoignages.html` | pages existantes du même nom | |
| `Erreur404.html` | `404.html` | |

## 3. Décisions de design (validées)

- **Couleurs** : bleu nuit `#0A1235` (header, bandeaux, footer) ; **bleu `#1D4ED8` pour toutes les actions, y compris « Commander »** ; **vert `#047857` réservé à tout ce qui concerne le paiement et la livraison gratuite** (badges, « Rien à payer maintenant ») ; or `#E8A33D` pour le point du logo et les accents. Toutes les valeurs sont dans `:root` de `bokki.css`.
- **Logo** : le baobab actuel est conservé (couleurs claires sur fond bleu nuit, voir les maquettes).
- **Polices** : Plus Jakarta Sans (texte) et Fraunces 900 (mot « Bokki »). Les maquettes les chargent depuis Google Fonts, mais **la CSP du site interdit les polices externes** : garder les fichiers auto-hébergés de `public/assets/fonts/`.
- **Icônes** : les maquettes utilisent des SVG en trait. Ils peuvent remplacer la police Phosphor (sprite SVG recommandé) ou être retrouvés dans le sous-ensemble Phosphor.
- **Navigation** : même header et même footer sur **toutes** les pages (y compris panier, suivi, confirmation, 404). Sur mobile (< 900 px), barre d'onglets en bas : Accueil, Catégories, Panier, Compte. Sur ordinateur, catégories dans le header.
- **Bannière d'accueil** : pleine largeur, collée au header. Sur ordinateur, l'image se fond dans le bleu nuit (dégradés sur les bords), sans carte. La statue Nimba est un SVG placé à gauche de l'image (à supprimer si l'image finale l'intègre déjà).
- **Mode sombre** : le bouton a quitté le header ; il est dans « Mon compte ». Les jetons sombres restent à définir (reprendre ceux de l'actuel `design-system.css` en les adaptant).
- **Livraison** : « Gratuite à Conakry ; autres régions : frais selon la région, annoncés avant la livraison ». Ce message doit être identique partout.

## 4. Architecture front

- `bokki.css` remplace `client.css`, `theme-jour.css`, `theme-nuit.css`, `design-system.css` et les feuilles `css/pages/*.css` côté client. **Ne pas supprimer les fichiers utilisés par l'admin.**
- Header, footer et barre d'onglets : sortir des 14 copies. Proposer au propriétaire la solution la plus simple (petite étape de build qui assemble des partials, ou génération côté Firebase) avant de l'appliquer.
- Garder : View Transitions, service worker (incrémenter `CACHE_VERSION`), adaptation au réseau lent, `data-currency-gnf` sur chaque prix, photos en `object-fit: contain` sur fond blanc, champs à 16 px, cibles tactiles ≥ 44 px, `prefers-reduced-motion`, zones sûres (`env(safe-area-inset-*)`) pour la barre d'onglets et la barre d'achat.

## 5. Changements côté serveur nécessaires

1. **Comptes clients** (Firebase Auth) :
   - **Google** (connexion Google uniquement, pas d'email/mot de passe).
   - **Téléphone + code personnel à 4 chiffres** : création automatique du compte à la première commande. Code stocké **haché**, jamais en clair. **Blocage après 5 essais ratés** pendant un délai. Refuser les codes trop simples (`0000`, `1234`, `1111`…). « Code oublié » : réinitialisation par un agent depuis l'admin pour commencer.
   - Rattacher les commandes au compte (champ `uid`) et préremplir les coordonnées.
   - Un client déjà connecté saute l'étape 1 et arrive à l'étape 2 préremplie.
   - **La commande sans compte Google reste possible** via téléphone + code.
2. **Suivi par numéro BK** : nouvelle fonction (ou évolution de `obtenirSuiviCommande`) qui retrouve une commande avec `numero` + `code` + `telephone`, sans l'ID Firestore.
3. **Frais de livraison hors Conakry** : aujourd'hui `fraisLivraison` vaut toujours 0. Ajouter une table de frais par région (montants à fournir par le propriétaire) et l'afficher dans le récap.
4. **Code de livraison** : décision en attente du propriétaire pour passer à 6 chiffres (éviter la confusion avec le code personnel à 4 chiffres).
5. **Parrainage** : phase 7, règles en attente (montants, récompense seulement après livraison et paiement, une récompense par téléphone/adresse, montant réduit visible pour le livreur et dans l'admin).

## 6. Ordre de travail

Chaque phase = une branche ou un commit testable. Demander validation au propriétaire entre chaque phase.

1. **Fondations** : intégrer `bokki.css`, header, footer, barre d'onglets partagés ; retirer les anciennes feuilles côté client.
2. **Accueil et catalogue** (catégories, recherche, filtres).
3. **Fiche produit, panier, commande en 2 étapes** (sans comptes : étape 1 = téléphone seul en attendant la phase 6).
4. **Confirmation, suivi (avec recherche par numéro BK), mes commandes.**
5. **Pages d'information** : demande, comment ça marche, contact, FAQ, à propos, mentions légales, témoignages, 404.
6. **Comptes** : Google + téléphone/code, connexion, mon compte, préremplissage.
7. **Parrainage et réductions** (plus tard, après décision du propriétaire).
