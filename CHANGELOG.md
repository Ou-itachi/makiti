# Journal des changements — Bokki

Une courte note par mise à jour : ce qui change pour les clients et l'équipe.
Le détail technique est dans les commits (`git log`).

**Règle :** chaque mise en ligne ajoute ses lignes en haut, sous la date du jour.

---

## 2026-11-02

### Fiabilité et suivi (suggestions « niveau ingénieur »)
- Sauvegarde automatique quotidienne de Firestore, gardée 14 jours (planning Google Cloud).
- Journal des changements (ce fichier).

### Mise à jour n°1
- Nouvelle bannière d'accueil (bleu nuit, carte de la Guinée animée, Nimba, cliente détourée, mini-scène « Elle commande »).
- Barre d'état de l'appli installée en bleu nuit.
- Affichage instantané : accueil, catégories et fiches produit pré-rendus (Slow 3G : accueil 13,8 s → 5,4 s, fiche 12,8 s → 5,3 s). Adresses `/produit/<id>`, anciens liens `?id=` conservés.
- Pré-rendu refait automatiquement environ 1 minute après une modification de produit dans l'admin.

### Boutique
- Avis clients sur l'accueil et dans le suivi après livraison.
- Garantie de 2 à 14 jours selon le produit.
- Paiement à la livraison en espèces ou Orange Money.
- Parrainage (5 % filleul / 5 % parrain, plafonds, contrôles anti-triche).
- Statut « En préparation ».
- Tunnel de commande simplifié : prénom, ville libre (frais par ville ou « à confirmer »), indicatif pays, numéro pré-rempli.
- Connexion par numéro + mot de passe à 4 chiffres (Face ID / empreinte désactivé).
- Bouton « Installer » (Android direct, guide sur iPhone).
- Navigation plus fluide, transitions en fondu, section « Nos engagements ».

### Admin
- Cartes du tableau de bord cliquables vers les commandes filtrées ; cloche des notifications.
- Bouton WhatsApp du client, saisie des frais « à confirmer », frais par zone modifiables.

## 2026-11-01
- Refonte complète du design client (accueil, catalogue, fiche, panier, commande en 2 étapes, suivi, comptes clients).
- Performance : Firebase chargé à la demande, affichage immédiat, mode hors ligne, commandes et formulaires sans perte quand le réseau coupe.
- Photos produit affichées en entier (plus de recadrage).
- Serveur de test local (`npm run local`).

## 2026-10
- Détourage automatique des photos produit dans l'admin (facultatif, ne bloque jamais l'enregistrement).
- Fonctions passées à Node.js 22 ; admin plus rapide sur réseau lent ; App Check préparé.
- Affichage des prix selon le pays ; numéro WhatsApp France ; SEO de la marque Bokki.

## 2026-09
- Lancement sur bokki.shop : rebranding Makiti → Bokki (logo baobab), SEO (meta, sitemap, JSON-LD, Search Console).
- Admin installable, page « Marges », notifications push « nouvelle commande », bouton « client non joignable ».
- Mentions légales, coordonnées, procédure de retour arrière (`ROLLBACK.md`).
- Bloc « Vous ne trouvez pas ? » (demande de produit).

## 2026-08
- Première version : produits Firestore, admin Vue 3, commandes réelles avec code de livraison sécurisé et suivi en temps réel.
- Livraison Standard / Premium calculée côté serveur, zones de livraison, avis clients, négociation de prix, thème jour/nuit, panier.
