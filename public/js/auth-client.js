// Firebase Auth, sans le module « fenêtre Google » (popupRedirectResolver).
// getAuth() le charge d'office : ≈ 40 Ko d'iframes apis.google.com sur
// chaque page, même sans connexion Google. Ici il n'est passé qu'aux appels
// qui en ont besoin (session-client.js : connexion Google).
import { app, EMULATOR } from "./firebase-base.js";
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  connectAuthEmulator,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
});

if (EMULATOR) {
  try {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  } catch (e) {
    console.warn("[Bokki] Émulateur Auth ignoré :", e);
  }
}
