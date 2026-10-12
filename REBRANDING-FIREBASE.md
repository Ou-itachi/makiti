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

La liste des projets accessible depuis l'environnement de déploiement ne
contient actuellement aucun projet Firebase nommé ou identifié `bokki` : le
site utilise toujours `makiti-gn`. Le bucket, le domaine Auth et le project ID
ne doivent donc pas être remplacés par des valeurs inventées. La marque visible
sur le site est déjà Bokki.

### Images des fiches produits

Le code des fiches ne choisit pas lui-même un bucket `makiti-gn` : il affiche
les URL complètes enregistrées dans les documents Firestore `produits/{id}`.
Les champs concernés sont `images`, `imagesSmall` et, pour les variantes,
`variantes[].image`. Ces URL contiennent actuellement le nom du bucket
historique, donc changer uniquement `storageBucket` dans le navigateur ne
redirigerait pas les photos vers un autre projet.

Lors d'une migration vers un projet Bokki, il faut copier les objets Storage
en conservant leurs chemins (par exemple `produits/{id}/...`), puis mettre à
jour les URL des champs ci-dessus avec les nouvelles URL de téléchargement du
bucket Bokki. Vérifier également les images des demandes de produits si elles
sont migrées. Ensuite, mettre à jour ensemble la configuration Firebase du
site et du service worker, les règles Storage et `.firebaserc`, puis contrôler
plusieurs fiches et leurs variantes avant de basculer le trafic. Les anciennes
URL peuvent continuer à fonctionner tant que l'ancien projet reste actif ;
elles ne sont toutefois pas des URL du nouveau bucket.

Le script `public/js/storage-namespace-migration.js` contient volontairement
les anciens noms de clés de stockage du navigateur. Il transfère le panier et
les préférences des anciens visiteurs vers les nouvelles clés `bokki-*`, puis
supprime les anciennes. Les enlever avant que la majorité des visiteurs soit
passée par cette migration ferait perdre leur panier local et leurs préférences.

## Migration nécessaire pour un nouveau projet

1. Créer le projet Bokki dans Firebase et y enregistrer une nouvelle application
   Web. Copier la configuration fournie par la console (dont `projectId`,
   `appId`, `storageBucket`, `apiKey`, `authDomain` et `messagingSenderId`).
   Le nom du bucket doit correspondre exactement à celui affiché dans Storage
   (il peut se terminer par `.firebasestorage.app` ou `.appspot.com`). Le
   domaine Auth est fourni par Authentication > Paramètres ; il faut aussi y
   autoriser `bokki.shop` et les domaines de test utilisés.
2. Activer Firestore, Storage, Authentication, Cloud Functions, Cloud Messaging
   et App Check selon les services actuellement utilisés.
3. Déployer les règles et index du dépôt, puis migrer les données Firestore,
   fichiers Storage et comptes Auth. Vérifier les secrets et variables des
   Cloud Functions ainsi que les déclencheurs et tâches planifiées.
4. Mettre à jour ensemble `public/js/firebase-config.js`, la configuration
   Firebase Messaging dans `public/sw.js` et `.firebaserc` avec les valeurs
   réellement fournies par le nouveau projet. Déployer ensuite les règles et
   fonctions sur le nouveau project ID.
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
