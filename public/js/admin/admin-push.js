// Notifications push de l'équipe Bokki (« nouvelle commande » et autres).
// Même pile que côté client (push-notifications.js) : le service worker sw.js
// sert déjà de récepteur FCM en arrière-plan. Ici, l'admin active/désactive
// depuis Paramètres > Notifications ; le jeton part vers enregistrerTokenAdmin
// (Cloud Function, SDK Admin — admins/{uid} est fermé côté client).
import { app, functions } from "../firebase-config.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";

// Clé VAPID publique du projet (identique à push-notifications.js) :
// Firebase Console > Paramètres > Cloud Messaging > Certificats Web Push.
const VAPID_KEY =
  "BCikXPb7l5PFsrcXdYhQxLrFRUHpcOADJYnq_PXYAdk2EOCVV5cmTFtrB3ug6X8oEEg79bWPCIHa_rw-DxCvFEA";

const enregistrerTokenAdmin = httpsCallable(functions, "enregistrerTokenAdmin");
const supprimerTokenAdmin = httpsCallable(functions, "supprimerTokenAdmin");

// Jeton actif sur CET appareil. admins/{uid} n'étant pas lisible côté client,
// c'est le seul moyen de savoir si « ce téléphone » est déjà abonné.
const LS_KEY = "bokki-admin-push-token";

// iOS : le Web Push n'existe que dans une PWA installée sur l'écran d'accueil
// (iOS 16.4+), jamais dans un onglet Safari. Ailleurs, il faut juste l'API
// Notification + un service worker.
function pushUtilisableIci() {
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone =
    window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
  if (isIOS && !isStandalone) return false;
  return "Notification" in window && "serviceWorker" in navigator;
}

export function pushDisponible() {
  return pushUtilisableIci();
}

// "indisponible" | "bloque" | "actif" | "inactif"
export function pushEtat() {
  if (!pushUtilisableIci()) return "indisponible";
  if (Notification.permission === "denied") return "bloque";
  if (Notification.permission === "granted" && localStorage.getItem(LS_KEY)) return "actif";
  return "inactif";
}

async function obtenirToken() {
  const { getMessaging, getToken, onMessage } = await import(
    "https://www.gstatic.com/firebasejs/11.0.2/firebase-messaging.js"
  );
  const registration = await navigator.serviceWorker.register("/sw.js");
  const messaging = getMessaging(app);
  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration,
  });
  if (!token) throw new Error("Aucun jeton de notification obtenu.");

  // Onglet admin ouvert et actif : le SW n'affiche pas la notification
  // système, on la montre nous-mêmes.
  onMessage(messaging, (payload) => {
    const titre = payload.notification?.title || "Bokki";
    registration
      .showNotification(titre, {
        body: payload.notification?.body,
        icon: "/assets/bokki-192.png",
      })
      .catch((err) => console.error(err));
  });

  return token;
}

export async function activerPush() {
  if (!pushUtilisableIci()) throw new Error("indisponible");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("refuse");
  const token = await obtenirToken();
  await enregistrerTokenAdmin({ token });
  localStorage.setItem(LS_KEY, token);
  return "actif";
}

export async function desactiverPush() {
  const token = localStorage.getItem(LS_KEY);
  if (token) {
    try {
      await supprimerTokenAdmin({ token });
    } catch (err) {
      console.error("Retrait du jeton push admin échoué :", err);
    }
  }
  localStorage.removeItem(LS_KEY);
  return "inactif";
}

// À appeler au chargement des pages admin quand l'admin a déjà activé : le
// jeton FCM peut tourner (rotation navigateur, réinstallation PWA). On ne
// réécrit en base QUE s'il a changé, pour ne pas générer d'écriture inutile
// sur admins/{uid} à chaque page.
export async function rafraichirPushSilencieux() {
  if (pushEtat() !== "actif") return;
  try {
    const token = await obtenirToken();
    if (token && token !== localStorage.getItem(LS_KEY)) {
      await enregistrerTokenAdmin({ token });
      localStorage.setItem(LS_KEY, token);
    }
  } catch (err) {
    console.error("Rafraîchissement du jeton push admin échoué :", err);
  }
}
