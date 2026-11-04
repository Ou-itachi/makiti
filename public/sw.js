// Firebase Cloud Messaging (notifications push) : ce même service worker,
// déjà enregistré pour l'installation PWA, sert aussi de récepteur des
// notifications reçues quand l'onglet n'a pas le focus — un onglet ne peut
// avoir qu'UN SEUL service worker actif par scope, donc on ne peut pas
// enregistrer un firebase-messaging-sw.js séparé en plus de celui-ci. Les
// scripts "compat" (pas modulaires) sont nécessaires ici : importScripts()
// n'existe que pour ce format côté service worker classique. La config
// Firebase n'est pas un secret (déjà publique dans js/firebase-config.js).
importScripts("https://www.gstatic.com/firebasejs/11.0.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.0.2/firebase-messaging-compat.js");

firebase.initializeApp({
  projectId: "makiti-gn",
  appId: "1:356366688451:web:c4351a7c64f06a670e0276",
  storageBucket: "makiti-gn.firebasestorage.app",
  apiKey: "AIzaSyCHhy110KU7a9YUcqI2MOEuobodrhlUuTk",
  authDomain: "makiti-gn.firebaseapp.com",
  messagingSenderId: "356366688451",
});
// firebase.messaging() enregistre lui-même l'écoute des notifications reçues
// en arrière-plan (affichage système) et leur clic (ouverture de
// webpush.fcmOptions.link) — aucun code supplémentaire requis ici.
firebase.messaging();

// Service worker : installation PWA + site utilisable en réseau faible et
// hors connexion (réseau guinéen : 2G/3G lente, coupures fréquentes).
//
// Stratégies :
//   - pages HTML (navigation) : la copie en cache s'affiche AUSSITÔT, et la
//     version du réseau la remplace en arrière-plan pour la visite suivante
//     (avant : jusqu'à 2,5 s d'attente du réseau à chaque page). Page jamais
//     vue : réseau, et hors connexion l'accueil en dernier recours ;
//   - fichiers du site (JS, manifest) : cache d'abord, revalidés en
//     arrière-plan (304 si inchangés) ;
//   - fichiers versionnés (?v=…, ex. bokki.css?v=refonte-N, icons.svg?v=2)
//     et /assets/ (polices, images, icônes) : cache d'abord, SANS
//     revalidation. Avant, chaque page vue renvoyait 6 à 8 requêtes de
//     revalidation pour ces seuls fichiers (CSS, polices, icônes, photo de
//     l'accueil) : en 2G/3G, autant d'allers-retours en file avec les
//     photos et les données. Ils changent d'URL (?v=) ou de CACHE_VERSION
//     quand on les modifie : penser à incrémenter CACHE_VERSION après toute
//     retouche d'un fichier de /assets/ ;
//   - SDK Firebase (www.gstatic.com/firebasejs/<version>/) : cache d'abord,
//     sans revalidation (l'URL contient la version : contenu immuable) ;
//   - photos produits déjà vues (firebasestorage.googleapis.com) : cache
//     d'abord, plafonné aux MAX_PHOTOS plus récentes ;
//   - tout le reste (Firestore, Auth, Cloud Functions, POST) : jamais
//     intercepté — les données fraîches viennent toujours du réseau, et
//     leur dernière version est gardée par js/donnees.js.
// Les pages HTML ne contiennent jamais de prix ni de stock (chargés par le
// JS), et sont mises en cache SANS leurs paramètres (?q=…, ?id=…).
const CACHE_VERSION = "bokki-v94";
const CACHE_SDK = "bokki-sdk-11.0.2";
const CACHE_PHOTOS = "bokki-photos-v1";
const MAX_PHOTOS = 60;
const STATIC_EXTENSIONS = /\.(css|js|png|jpe?g|svg|webp|gif|ico|woff2?|ttf|json)$/i;

// Strict nécessaire à l'ouverture hors connexion. Les pages de l'admin et
// leurs feuilles ne sont plus préchargées chez chaque client (elles se
// mettent en cache à la première visite de l'admin).
const SHELL_FILES = [
  "/",
  "/catalogue",
  "/produit",
  "/panier",
  "/js/storage-namespace-migration.js",
  "/js/transition-pages.js",
  "/js/mesures.js",
  "/manifest.json",
  "/css/bokki.css?v=refonte-30",
  "/assets/icons.svg?v=2",
  "/assets/fonts/plus-jakarta-sans-var.woff2",
  "/assets/fonts/fraunces-900.woff2",
  "/assets/bokki-192.png",
];
// Scripts de l'accueil, du catalogue, de la fiche et du panier (≈ 46 Ko
// compressés) : mis en cache dès l'installation, pour que la 1re fiche
// ouverte depuis l'accueil (ou hors connexion) n'attende pas le réseau.
// Un échec ici ne bloque pas l'installation (simple cache d'avance).
const SCRIPTS_PAGES = [
  "accueil", "banniere", "carte-produit", "catalogue", "commande-acces", "commande-store",
  "currency-display", "donnees", "favoris", "fiche-produit", "header-search",
  "ios-install-prompt", "panier-badge", "panier-store", "panier",
  "produit-categories", "promo", "recemment", "recherche-suggestions", "recherche-texte",
  "reseau", "retour-haut", "seo-structured-data", "suivi-pub", "sw-register",
  "theme-toggle", "toast",
].map((n) => `/js/${n}.js`);
const CACHES_GARDES = [CACHE_VERSION, CACHE_SDK, CACHE_PHOTOS];

// cache: "no-cache" : à l'installation d'une nouvelle version, on ne reprend
// pas une vieille copie du cache HTTP du navigateur (/assets/ y est gardé
// 7 jours) — elle resterait ensuite servie sans revalidation (voir plus haut).
const fraiche = (url) => new Request(url, { cache: "no-cache" });

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(SHELL_FILES.map(fraiche)).then(() => cache.addAll(SCRIPTS_PAGES.map(fraiche)).catch(() => undefined))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !CACHES_GARDES.includes(k)).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function repondreEnCachePuisReseau(request) {
  return caches.match(request).then((cached) => {
    // cache: "no-cache" : revalidation auprès du serveur (304 si inchangé),
    // jamais l'ancienne copie du cache HTTP du navigateur.
    const network = fetch(request, { cache: "no-cache" })
      .then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => cached);
    return cached || network;
  });
}

// Cache d'abord, réseau sinon (contenu immuable : SDK versionné, photos).
async function cacheDabord(request, nomCache, plafond) {
  const cache = await caches.open(nomCache);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // Photos Storage : réponses « opaques » (pas d'en-tête CORS), status 0.
  if (response && (response.ok || response.type === "opaque")) {
    await cache.put(request, response.clone());
    if (plafond) {
      const cles = await cache.keys();
      for (const k of cles.slice(0, Math.max(0, cles.length - plafond))) await cache.delete(k);
    }
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Mesures anonymes (js/mesures.js) : envoyées en quittant la page. Sans
  // respondWith, Chrome abandonne la requête quand la page disparaît ; le
  // service worker la porte donc lui-même jusqu'au serveur.
  if (request.method === "POST" && request.url.endsWith("/api/collecte")) {
    event.respondWith(fetch(request).catch(() => new Response(null, { status: 204 })));
    return;
  }
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // NB : le service worker ne peut contacter que les domaines du
  // connect-src de la CSP (firebase.json) — www.gstatic.com y figure.
  if (url.origin === "https://www.gstatic.com" && url.pathname.startsWith("/firebasejs/11.0.2/")) {
    // En cas d'échec (réseau, politique de sécurité), on laisse le
    // navigateur charger le script lui-même plutôt que de casser la page.
    event.respondWith(cacheDabord(request, CACHE_SDK).catch(() => fetch(request)));
    return;
  }
  if (url.origin === "https://firebasestorage.googleapis.com" && request.destination === "image") {
    event.respondWith(cacheDabord(request, CACHE_PHOTOS, MAX_PHOTOS).catch(() => Response.error()));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    const cleCache = url.origin + url.pathname;
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        const reseau = fetch(request).then((response) => {
          if (response && response.ok) cache.put(cleCache, response.clone());
          return response;
        });
        const cached = await cache.match(cleCache);
        if (cached) {
          // Mise à jour en arrière-plan (la page s'affiche déjà).
          event.waitUntil(reseau.catch(() => undefined));
          return cached;
        }
        try {
          return await reseau;
        } catch {
          // Fiche ou catégorie jamais ouverte hors ligne : la page modèle
          // (elle lit l'identifiant dans l'adresse et les produits déjà vus).
          const modele = url.pathname.startsWith("/produit/") ? "/produit" : url.pathname.startsWith("/categorie/") ? "/catalogue" : null;
          return (modele && (await caches.match(modele))) || (await caches.match("/index.html")) || (await caches.match("/")) || Response.error();
        }
      })()
    );
    return;
  }

  if (!STATIC_EXTENSIONS.test(url.pathname)) return;

  // Versionné ou /assets/ : pas de revalidation (voir l'en-tête du fichier).
  if (url.searchParams.has("v") || url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheDabord(request, CACHE_VERSION).catch(() => fetch(request)));
    return;
  }
  event.respondWith(repondreEnCachePuisReseau(request));
});
