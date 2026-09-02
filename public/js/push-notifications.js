import { app, functions } from "./firebase-config.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";

// Clé VAPID publique du projet (Firebase Console > Project Settings >
// Cloud Messaging > Web configuration > Web Push certificates).
const VAPID_KEY = "BCikXPb7l5PFsrcXdYhQxLrFRUHpcOADJYnq_PXYAdk2EOCVV5cmTFtrB3ug6X8oEEg79bWPCIHa_rw-DxCvFEA";

const enregistrerTokenNotification = httpsCallable(functions, "enregistrerTokenNotification");

// Sur iOS, le Web Push n'existe que dans une PWA installée sur l'écran
// d'accueil (iOS 16.4+) — jamais dans un onglet Safari classique. Sans ça,
// Notification.requestPermission() peut exister mais getToken() échoue
// silencieusement ou la notification n'arrive jamais. On le détecte pour
// ne pas proposer un bouton qui ne peut pas fonctionner.
function pushUtilisableIci() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  if (isIOS && !isStandalone) return false;
  return "Notification" in window && "serviceWorker" in navigator;
}

// À appeler sur les pages liées à UNE commande précise (suivi, confirmation)
// avec le bouton "Activer les notifications" de cette page. N'affiche/active
// le bouton que si l'activation a une chance réelle de fonctionner.
// `code` = code de livraison de la commande : exigé par la Cloud Function
// enregistrerTokenNotification pour prouver que l'appelant est bien le client
// (le commandeId seul fuit via le lien de suivi public).
let dejaInitialise = false;
export async function initPushNotifications(orderId, code, button) {
  if (!orderId || !code || !button || dejaInitialise) return;
  dejaInitialise = true;

  if (!pushUtilisableIci()) {
    button.hidden = true;
    return;
  }

  let supported = true;
  try {
    const { isSupported } = await import("https://www.gstatic.com/firebasejs/11.0.2/firebase-messaging.js");
    supported = await isSupported();
  } catch (err) {
    console.error(err);
    supported = false;
  }
  if (!supported) {
    button.hidden = true;
    return;
  }

  if (Notification.permission === "denied") {
    button.hidden = true;
    return;
  }

  if (Notification.permission === "granted") {
    button.hidden = true;
    activerToken(orderId, code).catch((err) => console.error("Échec de l'enregistrement du jeton :", err));
    return;
  }

  button.hidden = false;
  button.addEventListener("click", async () => {
    button.disabled = true;
    const labelInitial = button.textContent;
    button.textContent = "Activation…";
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        button.textContent = "Notifications refusées";
        return;
      }
      await activerToken(orderId, code);
      button.textContent = "Notifications activées ✓";
    } catch (err) {
      console.error("Échec de l'activation des notifications :", err);
      button.disabled = false;
      button.textContent = labelInitial;
    }
  });
}

async function activerToken(orderId, code) {
  const { getMessaging, getToken, onMessage } = await import("https://www.gstatic.com/firebasejs/11.0.2/firebase-messaging.js");
  const registration = await navigator.serviceWorker.register("/sw.js");
  const messaging = getMessaging(app);
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) throw new Error("Aucun jeton de notification obtenu.");
  await enregistrerTokenNotification({ commandeId: orderId, code: String(code), token });

  // Le service worker n'affiche la notification système que quand l'onglet
  // n'a pas le focus — onglet ouvert et actif, on doit l'afficher nous-mêmes.
  onMessage(messaging, (payload) => {
    const titre = payload.notification?.title || "Bokki";
    const options = { body: payload.notification?.body, icon: "assets/bokki-192.png" };
    registration.showNotification(titre, options).catch((err) => console.error(err));
  });
}
