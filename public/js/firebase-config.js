import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getStorage, connectStorageEmulator } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";
import { getFunctions, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";

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
// par ?emulator=0. AUCUN effet en production : les visiteurs n'ont jamais ce
// paramètre. En mode émulateur on utilise le cache mémoire (pas le cache
// IndexedDB persistant) pour ne pas mélanger les données émulateur avec des
// données de prod restées en cache.
const EMULATOR = (() => {
  try {
    const p = new URLSearchParams(location.search);
    if (p.get("emulator") === "0") {
      localStorage.removeItem("makiti-emulator");
      return false;
    }
    const on = p.get("emulator") === "1" || localStorage.getItem("makiti-emulator") === "1";
    if (on) localStorage.setItem("makiti-emulator", "1");
    return on;
  } catch {
    return false;
  }
})();

export const app = initializeApp(firebaseConfig);

// Cache local persistant (IndexedDB) en prod : au relancement de l'app (PWA
// installée notamment), onSnapshot() résout instantanément depuis ce cache
// pendant que Firestore reconcilie en arrière-plan. persistentMultipleTabManager :
// site + admin peuvent être ouverts dans plusieurs onglets.
export const db = initializeFirestore(app, {
  localCache: EMULATOR
    ? memoryLocalCache()
    : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
export const auth = getAuth(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, "europe-west1");

if (EMULATOR) {
  try {
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectStorageEmulator(storage, "127.0.0.1", 9199);
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
    console.info("[Makitti] Émulateurs Firebase connectés (QA).");
  } catch (e) {
    console.warn("[Makitti] Basculement émulateur ignoré :", e);
  }
}
