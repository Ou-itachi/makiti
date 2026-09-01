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

// Service worker "de base" : condition technique nécessaire à l'installation
// sur écran d'accueil, pas un système hors-ligne complet.
//
// Stratégie de cache STRICTEMENT sélective (voir ticket) :
//   - ressources statiques (CSS/JS/images/icônes/polices) : cache-first,
//     rafraîchies en tâche de fond à chaque visite ;
//   - documents HTML (navigation) : réseau en priorité, cache uniquement en
//     repli hors connexion — pour ne jamais garder une mise en page périmée
//     trop longtemps quand on est en ligne ;
//   - tout le reste (Firestore, Firebase Auth, Cloud Functions, requêtes
//     POST) : jamais intercepté, va toujours directement au réseau.
// Prix et stock ne sont JAMAIS dans le HTML/CSS/JS mis en cache — ils sont
// lus en direct depuis Firestore par le JS après affichage de la page, et
// Firestore/Cloud Functions sont sur d'autres domaines (googleapis.com,
// cloudfunctions.net) donc de toute façon jamais interceptés ci-dessous.
// Le filtre par extension est une seconde barrière explicite et volontaire :
// même si une route de données same-origin apparaissait un jour (rewrite
// Hosting vers une Cloud Function, par ex.), elle ne matcherait aucune de
// ces extensions et ne serait donc jamais mise en cache par erreur.
const CACHE_VERSION = "makiti-v8";
const STATIC_EXTENSIONS = /\.(css|js|png|jpe?g|svg|webp|gif|ico|woff2?|ttf|json)$/i;

const SHELL_FILES = [
  "/",
  "/index.html",
  "/manifest.json",
  "/css/base.css",
  "/css/client.css",
  "/css/theme-jour.css",
  "/css/theme-nuit.css",
  "/assets/fonts/fonts.css",
  "/assets/phosphor/phosphor-subset.css",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function repondreEnCachePuisReseau(request) {
  return caches.match(request).then((cached) => {
    const network = fetch(request)
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

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigation (chargement/rechargement d'une page HTML) : jamais de
  // prix/stock dedans (chargés par le JS après coup), donc pas besoin
  // d'attendre le réseau à tout prix pour garder la mise en page à jour.
  // Réseau prioritaire mais borné à 2,5s (typique sur une connexion mobile
  // lente/à l'ouverture de l'app installée sur écran d'accueil) : passé ce
  // délai, on affiche le cache tout de suite pendant que la réponse réseau,
  // une fois arrivée, continue de rafraîchir le cache en arrière-plan pour
  // la prochaine visite. Hors connexion, l'accueil sert de dernier recours
  // si cette page précise n'a encore jamais été visitée en ligne.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const networkPromise = fetch(request).then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
          }
          return response;
        });

        const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 2500));
        const fast = await Promise.race([networkPromise, timeout]).catch(() => null);
        if (fast) return fast;

        const cached = await caches.match(request);
        if (cached) return cached;

        return networkPromise.catch(() => caches.match("/index.html"));
      })()
    );
    return;
  }

  if (!STATIC_EXTENSIONS.test(url.pathname)) return;

  event.respondWith(repondreEnCachePuisReseau(request));
});
