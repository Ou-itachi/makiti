# Journal des changements — Bokki

Une courte note par mise à jour : ce qui change pour les clients et l'équipe.
Le détail technique est dans les commits (`git log`).

**Règle :** chaque mise en ligne ajoute ses lignes en haut, sous la date du jour.

---

## 2026-11-05

### Mise à jour n°8 — versements, localisation et finitions (en ligne le 5 novembre 2026)
- « Effectuer un versement » : menu, tableau de bord et Commandes. Le montant est déduit de l'argent disponible, validé par un admin et corrigeable.
- « Journal de versement » : les reçus restent affichés, avec « en attente de… », jusqu'à ce que les 3 admins aient supprimé. Le montant reste déduit.
- Tableau de bord : la carte « Argent disponible » remplace « Marge du mois ».
- Onglet « Localisation » pour les admins : chaque point du jour avec son heure, itinéraire Google Maps et coordonnées exactes.
- Bouton « Envoyer ma position » : un appui envoie un point daté, de 8 h à 19 h 30, et plus tard pendant une livraison.
- Bouton « Tout va bien » pendant la livraison. Après une heure sans geste, la page envoie la position et pose la question. Sans réponse 15 minutes plus tard, les admins sont alertés : ne répond pas, immobile ou position non reçue.
- Alertes à 12 h et à 19 h 30, colis non rendu signalé le lendemain, relance des admins si une alerte n'est pas prise en 15 minutes, et position enregistrée à chaque changement de statut.
- SOS : l'alerte part à la fin de l'appui long. « Annuler » ramène seulement à l'application, l'alerte reste envoyée.
- Corrections d'interface et de sécurité : erreurs affichées près des champs, fenêtres fermées par Échap, zoom réactivé, zones tactiles et pré-rendu.
- Tests sur émulateur : `npm run test:maj8` et `npm run test:corrections`.

## 2026-11-04

### Mise à jour n°7 — paiements et reçus (en ligne le 4 novembre 2026)
- Reçu automatique et numéroté à chaque paiement, en PDF, avec une fiche mensuelle imprimable. Nouvel onglet « Versements fournisseurs ».
- Supprimer un reçu ne change jamais un montant dû ni un reste à payer. Une ligne courte reste au journal.
- Listes de contrôle obligatoires avant « Confirmer » et « En préparation ».
- Sélection multiple et suppression dans la Corbeille, les Incidents et SOS, les Enregistrements et les reçus. SOS en cours et vidéos gardées protégés.
- Chaque compte se connecte uniquement par son espace.
- Pages admin et livreur plus légères, vidéo plus légère, même transition entre pages que le site.
- Tests sur émulateur : `npm run test:maj7`.

### Mise à jour n°6 — livraisons complètes (en ligne le 4 novembre 2026)
- Confirmer impose « Je livre moi-même » ou « Assigner ». Statuts en lecture seule dans Commandes, actions courtes, annulation avec raison, « Corriger le statut » réservé au détail.
- « Ma livraison » pour un livreur et pour un admin qui livre : code saisi sur place, 5 essais puis blocage, problèmes avec raison, suivi client en temps réel, action gardée hors réseau.
- Historique avec détail et carte, création et fiche de livreur, désactivation immédiate, tarif par course, paiements, argent reçu, tableau du livreur, journal d'activité, fin de journée, badge « À vérifier ».
- Sécurité de celui qui livre : position, caméra envoyée par morceaux, SOS, alertes 30 minutes et 18 h 30, pages Incidents et SOS et Enregistrements, suppression à 7 jours sauf « Gardé ».
- Tests sur émulateur : `npm run test:maj6`.

### Mise à jour n°5 — attribution d'un livreur (en ligne)
- Confirmer une commande oblige à choisir son livreur en touchant son prénom, avec une note et une notification facultatives.
- Nouvelle rubrique « Mes livraisons » dans l'admin, sur ordinateur et sur téléphone. Un compte livreur ne voit qu'elle.
- Nouveaux statuts « Endommagée » (photo et commentaire) et « Annulée par le client » (raison). Retournée demande une raison.
- Statut, attribution et historique passent uniquement par le serveur, qui contrôle les transitions et note qui, quand et pourquoi.
- Action gardée sur le téléphone en cas de coupure, envoyée une seule fois au retour du réseau.
- Suivi client rafraîchi toutes les 30 s, messages clairs pour les nouveaux statuts.
- Tests sur émulateur : `npm run test:maj5`.

---

## 2026-11-03

### Mise à jour n°4 — cartes, promotions, avis, bannière (en ligne)
- Retrait des cartes hologramme (mise à jour n°3) : le champ `hologramme` reste sur les anciens produits, il n'est plus lu.
- Nouvelle carte produit partout : badges, note, prix, boutons Panier et Commander. Produit à variantes : les deux boutons mènent à la fiche.
- Promotions depuis l'admin (prix, date de fin, prix promo par variante), prix vérifié par le serveur, panier remis au prix du moment.
- Meilleures ventes calculées chaque nuit sur 30 jours, seuil réglable dans Paramètres. « Sélection du moment » : épinglés, puis meilleures ventes, puis nouveautés.
- Note et nombre d'avis sur les produits ; section « Ils nous font confiance » sur l'accueil ; ville copiée de la commande sur les nouveaux avis.
- Catégories illustrées, flamme, reflet sur le prix promo.
- Bannière en 3 scènes en boucle (carte de la Guinée 3 s, la femme et la Nimba 2 s, la commande devant la ville 4 s), avec trois points et glissement du doigt.
- Ciel étoilé derrière les scènes 1 et 2 de la bannière.
- Finitions : squelettes de chargement, états vides et erreurs avec bouton pour repartir, toasts du panier et des favoris, partage WhatsApp, galerie au doigt et zoom, suggestions et recherche tolérante aux fautes, recherches récentes, « Récemment consultés », invitation à installer une seule fois après 2 visites, bouton retour en haut.
- Mesure des ventes GA4 et Meta Pixel prête, inactive tant que les identifiants ne sont pas renseignés (`public/js/suivi-pub.js`).
- Tests locaux sur émulateur (`npm run emulateur`, `npm run emulateur:donnees`).

---

## 2026-11-02

### Mise à jour n°2 — référencement (en ligne)
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
