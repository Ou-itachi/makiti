import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app-check.js";
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
// par ?emulator=0. STRICTEMENT limité à localhost / 127.0.0.1 : sur le domaine
// de production le paramètre est ignoré, sinon un lien piégé
// (makiti.com/?emulator=1) pointerait le navigateur de la victime vers son
// propre 127.0.0.1:8080 et casserait le site jusqu'à nettoyage du localStorage.
// En mode émulateur on utilise le cache mémoire (pas le cache IndexedDB
// persistant) pour ne pas mélanger données émulateur et données de prod.
const EMULATOR = (() => {
  try {
    const surLocalhost = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
    if (!surLocalhost) {
      localStorage.removeItem("makiti-emulator");
      return false;
    }
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

// --- App Check (anti-abus des fonctions non authentifiées) --------------------
// creerCommande, creerAvis, enregistrerTokenNotification et l'écriture de
// demandesProduits sont ouverts au public (le client n'a pas de compte). App
// Check garantit que l'appel vient bien de CE site, pas d'un script.
//
// ACTIVATION (à faire par le propriétaire, sans redéploiement de code) :
//  1. Console Firebase > App Check > Enregistrer l'app web avec le
//     fournisseur "reCAPTCHA v3" — récupérer la clé de site.
//  2. Coller la clé ci-dessous dans APP_CHECK_SITE_KEY.
//  3. Console Firebase > App Check > APIs > "Cloud Functions" et "Cloud
//     Firestore" > passer en mode "Appliqué" (d'abord surveiller quelques
//     jours pour vérifier qu'aucun trafic légitime n'est bloqué).
// Tant que la clé est vide, App Check est simplement ignoré (comportement
// actuel).
const APP_CHECK_SITE_KEY = "";
if (APP_CHECK_SITE_KEY && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (e) {
    console.warn("[Makitti] App Check non initialisé :", e);
  }
}

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
