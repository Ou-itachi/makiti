// Socle Firebase minimal : application + Firestore, rien d'autre.
// Les pages qui n'ont besoin que de Firestore importent ce module ; Auth,
// Storage et Functions (firebase-config.js, fonctions.js) ne sont
// téléchargés que par les pages qui s'en servent.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

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

// Cache local persistant (IndexedDB) en prod : au relancement de l'app (PWA
// installée notamment), onSnapshot() résout instantanément depuis ce cache
// pendant que Firestore reconcilie en arrière-plan, et les dernières données
// vues restent lisibles hors connexion. persistentMultipleTabManager :
// site + admin peuvent être ouverts dans plusieurs onglets.
export const db = initializeFirestore(app, {
  localCache: EMULATOR
    ? memoryLocalCache()
    : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

if (EMULATOR) {
  try {
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    console.info("[Bokki] Émulateurs Firebase connectés (QA).");
  } catch (e) {
    console.warn("[Bokki] Basculement émulateur ignoré :", e);
  }
}
