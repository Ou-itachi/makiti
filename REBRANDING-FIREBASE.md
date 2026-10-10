# Rebranding Bokki et projet Firebase

## État actuel

Le site public utilise la marque Bokki. Le projet Firebase auquel le site est
connecté conserve son identifiant technique historique `makiti-gn`, son bucket
`makiti-gn.firebasestorage.app` et son domaine Auth `makiti-gn.firebaseapp.com`.
Ces valeurs concordent entre `public/js/firebase-config.js`, le service worker
et `.firebaserc`. Elles ne sont pas des noms d'affichage : remplacer ces
chaînes par `bokki` sans créer et migrer vers un autre projet couperait
l'accès aux produits, commandes, images, comptes et Cloud Functions.

Firebase ne permet pas de renommer l'identifiant d'un projet existant. Pour
avoir des identifiants techniques Bokki, il faut créer un nouveau projet dans
la console Firebase et migrer les ressources avant de changer la configuration
du site.

## Migration nécessaire pour un nouveau projet

1. Créer le projet Bokki dans Firebase et y enregistrer une nouvelle application
   Web. Copier la configuration fournie par la console (dont `projectId`,
   `appId`, `storageBucket`, `apiKey`, `authDomain` et `messagingSenderId`).
2. Activer Firestore, Storage, Authentication, Cloud Functions, Cloud Messaging
   et App Check selon les services actuellement utilisés.
3. Déployer les règles et index du dépôt, puis migrer les données Firestore,
   fichiers Storage et comptes Auth. Vérifier les secrets et variables des
   Cloud Functions ainsi que les déclencheurs et tâches planifiées.
4. Mettre à jour ensemble `public/js/firebase-config.js`, la configuration
   Firebase dans `public/sw.js` et `.firebaserc`. Le nom du bucket doit être
   celui que la console a réellement créé.
5. Reconnecter `bokki.shop` au nouveau Hosting et vérifier commandes, suivi,
   demande de produit, images, notifications et accès admin avant de basculer
   le trafic. Garder l'ancien projet disponible pendant la période de retour
   arrière.

Ne pas changer ces identifiants dans le code avant la migration et les
vérifications : ce sont des identifiants d'infrastructure actifs.

## Sous-domaine `contact.bokki.shop`

Le dépôt ne peut pas créer la configuration DNS ni rattacher un domaine à
Firebase Hosting. Dans la console Firebase Hosting, ajouter
`contact.bokki.shop` comme domaine personnalisé, suivre la vérification TXT,
puis créer l'enregistrement DNS demandé par Firebase. Une fois le domaine
validé, configurer une redirection permanente vers
`https://bokki.shop/contact` dans le fournisseur DNS/CDN. Vérifier le HTTPS et
la redirection avant de communiquer le sous-domaine.

## Coordonnées et profils sociaux

Les anciens liens Instagram/TikTok et l'adresse e-mail à l'ancien nom ont été
retirés des pages publiques et des données structurées. Le site affiche le
téléphone et WhatsApp vérifiés. Ajouter les nouveaux profils sociaux et une
adresse e-mail Bokki lorsqu'ils seront confirmés, afin de ne pas publier des
liens inventés ou inactifs.
