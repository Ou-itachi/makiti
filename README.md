# Bokki

Boutique en ligne basée à Conakry, en Guinée — paiement à la livraison uniquement, aucune passerelle de paiement. HTML/CSS/JS pur + Firebase (Firestore, Authentication, Storage, Hosting).

## Workflow Git

- `main` — branche de production, stable et vérifiée.
- `dev` — branche d'intégration, chaque fonctionnalité y est mergée après test.
- `feature/*` — une branche par fonctionnalité, créée depuis `dev`, mergée dans `dev` une fois terminée.

Flux : `feature/xxx` → `dev` (après vérification) → `main`.

## Architecture

```
public/                     racine servie par Firebase Hosting
  index.html                accueil / boutique
  produit.html               fiche produit (inclut la modale de commande)
  confirmation.html          reçu de commande + code de livraison
  suivi.html                 suivi de commande
  comment-ca-marche.html
  contact.html
  faq.html
  legal.html
  404.html
  demande-produit.html       "produit introuvable"
  admin/                     back-office (protégé par Firebase Auth)
    login.html
    dashboard.html
    commandes.html
    commande-detail.html
    produits.html
    fournisseurs.html
    fournisseur-detail.html
    livreurs.html
    parametres.html
    etiquettes-livraison.html
    demandes-produits.html
  css/
    base.css                 reset + éléments strictement universels
    client.css                composants communs aux pages client (header, footer, cards, modale...)
    admin.css                 composants communs aux pages admin (sidebar, tables, formulaires...)
    theme-jour.css             palette claire (mode jour, 6h–18h)
    theme-nuit.css              palette sombre (mode nuit, 18h–6h)
    pages/<page>.css           styles propres à chaque page (évite les collisions de classes entre pages)
  js/
    firebase-config.js        initialise l'app Firebase, exporte db / auth / storage
    scroll-reveal.js          animation d'apparition au scroll (partagée)
    admin/auth-guard.js       redirige vers login.html si l'admin n'est pas connecté
  assets/                    images (vide pour l'instant)

firebase.json, .firebaserc, firestore.rules, firestore.indexes.json, storage.rules
```

### Système de thème jour/nuit
Les deux maquettes de design (navy-or et noir-blanc) sont conservées et basculent automatiquement selon l'heure locale du navigateur : `theme-jour.css` (noir-blanc, plus lisible en plein soleil) de 6h à 18h, `theme-nuit.css` (navy/or/vert) le reste du temps. Un script inline bloquant, en tout premier dans le `<head>` de chaque page (avant les feuilles de style), pose l'attribut `data-theme` sur `<html>` pour éviter tout flash de mauvais thème au chargement. Pas de bouton de bascule manuel pour l'instant.

Les deux palettes utilisent exactement les mêmes noms de variables CSS (`--terre`, `--nuit`, `--or`, etc.), plus des variantes `--xxx-rgb` pour les usages `rgba()`, et un token sémantique `--on-terre` (couleur de texte lisible sur fond `--terre`/`--or`, qui diffère entre les deux thèmes).

### Sécurité Firestore
- `produits` : lecture publique, écriture admin uniquement.
- `commandes` : création publique (pas de compte client), lecture d'une commande précise (`get`) publique pour la page de suivi, mais aucune liste (`list`) publique de la collection — le code de livraison à 4 chiffres n'est donc jamais énumérable.
- `fournisseurs`, `paiementsFournisseurs`, `livreurs` : lecture et écriture réservées à l'admin authentifié (données financières sensibles).
- `demandesProduits` : création publique, lecture/traitement réservés à l'admin.

### État actuel
La structure de fichiers, le CSS et le HTML statique (adapté depuis les maquettes) sont en place. Le contenu dynamique (vraies requêtes Firestore pour produits/commandes, création de compte admin, logique de commande réelle) reste à connecter.

## Mettre en ligne avec une version de test

1. `npm run apercu` — publie le site sur une adresse temporaire
   (`https://makiti-gn--test-….web.app`, valable 7 jours). Le vrai site ne change pas.
2. Vérifier sur téléphone (accueil, une fiche, le panier).
3. `npm run publier-apercu` — met en ligne sur bokki.shop **exactement** la version vérifiée.

Les fonctions et Firestore sont partagés entre la version de test et le vrai site :
une commande passée sur l'adresse de test est une vraie commande.
Retour arrière : voir `ROLLBACK.md`.
