// Application Firebase seule (config + basculement émulateurs), SANS
// Firestore. Auth (auth-client.js), Functions (fonctions.js) et Messaging
// (push-notifications.js) n'ont besoin que de `app` : en important ce module
// plutôt que firebase-base.js, les pages commande / connexion / compte /
// suivi / confirmation ne téléchargent plus le SDK Firestore (≈ 440 Ko de
// JavaScript, 112 Ko compressés) ni n'ouvrent son cache IndexedDB au
// démarrage — lourd sur les Android d'entrée de gamme et en 2G.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";

const firebaseConfig = {
  projectId: "makiti-gn",
  appId: "1:356366688451:web:c4351a7c64f06a670e0276",
  storageBucket: "makiti-gn.firebasestorage.app",
  apiKey: "AIzaSyCHhy110KU7a9YUcqI2MOEuobodrhlUuTk",
  authDomain: "makiti-gn.firebaseapp.com",
  messagingSenderId: "356366688451",
};

// --- Basculement émulateurs (dev / QA uniquement) -----------------------------
// Actif si ?emulator=1 dans l'URL (mémorisé ensuite via localStorage), désactivé
// par ?emulator=0. STRICTEMENT limité à localhost / 127.0.0.1 : sur le domaine
// de production le paramètre est ignoré, sinon un lien piégé
// (bokki.shop/?emulator=1) pointerait le navigateur de la victime vers son
// propre 127.0.0.1:8080 et casserait le site jusqu'à nettoyage du localStorage.
// En mode émulateur on utilise le cache mémoire (pas le cache IndexedDB
// persistant) pour ne pas mélanger données émulateur et données de prod.
export const SUR_LOCALHOST = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
export const EMULATOR = (() => {
  try {
    if (!SUR_LOCALHOST) {
      localStorage.removeItem("bokki-emulator");
      return false;
    }
    const p = new URLSearchParams(location.search);
    if (p.get("emulator") === "0") {
      localStorage.removeItem("bokki-emulator");
      return false;
    }
    const on = p.get("emulator") === "1" || localStorage.getItem("bokki-emulator") === "1";
    if (on) localStorage.setItem("bokki-emulator", "1");
    return on;
  } catch {
    return false;
  }
})();

// Émulateurs : projet « demo-bokki ». Le préfixe demo- interdit tout accès
// aux vrais services Google, même par erreur (aucune donnée de production
// lue ni écrite pendant les tests).
if (EMULATOR) {
  firebaseConfig.projectId = "demo-bokki";
  firebaseConfig.storageBucket = "demo-bokki.appspot.com";
  firebaseConfig.authDomain = "demo-bokki.firebaseapp.com";
}
export const app = initializeApp(firebaseConfig);
