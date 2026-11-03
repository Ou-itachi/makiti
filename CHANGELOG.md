# Journal des changements — Bokki

Une courte note par mise à jour : ce qui change pour les clients et l'équipe.
Le détail technique est dans les commits (`git log`).

**Règle :** chaque mise en ligne ajoute ses lignes en haut, sous la date du jour.

---

## 2026-11-03

### Mise à jour n°4 — cartes, promotions, avis, bannière (pas encore en ligne)
- Retrait des cartes hologramme (mise à jour n°3) : le champ `hologramme` reste sur les anciens produits, il n'est plus lu.
- Nouvelle carte produit partout : badges, note, prix, boutons Panier et Commander. Produit à variantes : les deux boutons mènent à la fiche.
- Promotions depuis l'admin (prix, date de fin, prix promo par variante), prix vérifié par le serveur, panier remis au prix du moment.
- Meilleures ventes calculées chaque nuit sur 30 jours, seuil réglable dans Paramètres. « Sélection du moment » : épinglés, puis meilleures ventes, puis nouveautés.
- Note et nombre d'avis sur les produits ; section « Ils nous font confiance » sur l'accueil ; ville copiée de la commande sur les nouveaux avis.
- Catégories illustrées, flamme, reflet sur le prix promo.
- Bannière en 3 scènes en boucle (carte de la Guinée 3 s, la femme et la Nimba 2 s, la commande devant la ville 4 s), avec trois points et glissement du doigt.
- Ciel étoilé derrière les scènes 1 et 2 de la bannière.
- Tests locaux sur émulateur (`npm run emulateur`, `npm run emulateur:donnees`).

---

## 2026-11-02

### Mise à jour n°2 — référencement (pas encore en ligne)
- Fiches produit à une adresse avec leur nom (`/produit/<nom>-<xxxx>`), anciens liens redirigés ; vraies erreurs 404.
- Titres, descriptions et images de partage propres à chaque fiche ; textes alternatifs des photos.
- Données structurées : boutique (OnlineStore), produits avec prix, livraison gratuite à Conakry et vrais avis, fil d'Ariane, FAQ.
- Nouveau contenu : texte de présentation sur l'accueil, page « Livraison en Guinée », questions ajoutées à la FAQ et à « Comment ça marche », l'essentiel sur Bokki dans « À propos », rubrique « Conseils » (vide) avec modèle d'article.
- `/llms.txt` pour les assistants IA ; mêmes faits partout (source unique `tools/faits-bokki.json`).
- IndexNow (Bing…) à chaque déploiement et à chaque modification de produit ; guide `SOUMETTRE-SITEMAP.md`.

### Fiabilité et suivi (suggestions « niveau ingénieur »)
- Sauvegarde automatique quotidienne de Firestore, gardée 14 jours (planning Google Cloud).
- Journal des changements (ce fichier).
- Version de test avant mise en ligne (`npm run apercu`, puis `npm run publier-apercu`).
- Tests automatiques du parcours d'achat et de l'accessibilité avant chaque déploiement.
- Alerte e-mail à chaque erreur (site ou fonctions), au plus une par heure.
- Mesures anonymes : vitesse réelle chez les clients, entonnoir de vente, test A/B du bouton « Commander » — page admin « Statistiques ».
- Sécurité : blocage croissant du mot de passe, code provisoire pour « code oublié », limites par commande et par numéro, parrainage sur numéro vérifié.
- Vitesse : miniatures produit refaites en WebP (13,7 Mo → 1,1 Mo au total), avis sans SDK Firestore, moins de requêtes en double, photo HD seulement sur réseau rapide, polices dans la feuille principale, cache d'un an sur les photos.

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
