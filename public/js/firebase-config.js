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
// par ?emulator=0. STRICTEMENT limité à localhost / 127.0.0.1 : sur le domaine
// de production le paramètre est ignoré, sinon un lien piégé
// (bokki.shop/?emulator=1) pointerait le navigateur de la victime vers son
// propre 127.0.0.1:8080 et casserait le site jusqu'à nettoyage du localStorage.
// En mode émulateur on utilise le cache mémoire (pas le cache IndexedDB
// persistant) pour ne pas mélanger données émulateur et données de prod.
const SUR_LOCALHOST = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
const EMULATOR = (() => {
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

export const app = initializeApp(firebaseConfig);

// --- App Check (anti-abus des fonctions non authentifiées) --------------------
// creerCommande, creerAvis, enregistrerTokenNotification et l'écriture de
// demandesProduits sont ouverts au public (le client n'a pas de compte). App
// Check garantit que l'appel vient bien de CE site, pas d'un script.
//
// ACTIVATION (après création de la clé de site reCAPTCHA Enterprise dans
// Google Cloud Fraud Defense et enregistrement de cette clé dans Firebase
// Console > App Check > Apps) :
//  1. Coller la clé de site publique ci-dessous dans APP_CHECK_SITE_KEY.
//  2. Déployer le site, puis surveiller App Check > APIs quelques jours.
//  3. N'appliquer Firestore qu'après validation du trafic légitime.
// La clé secrète ne doit jamais être placée dans ce fichier.
// Tant que la clé est vide, App Check est simplement ignoré (comportement
// actuel). Import dynamique (pas de `import` statique en haut de fichier) :
// tant que la clé n'est pas activée, ce module ne coûte ni requête réseau
// ni temps de parsing sur AUCUNE page — un `import` statique, lui, aurait
// téléchargé firebase-app-check.js sur chaque visite (accueil, contact,
// FAQ…) même totalement inutilisé.
//
// En local, App Check reste désactivé par défaut. Pour tester les fonctions
// alors que EXIGER_APP_CHECK = true (functions/src/index.ts), ouvrir une fois
// la page avec ?appcheck=1 (mémorisé, ?appcheck=0 pour désactiver) : le SDK
// affiche un debug token dans la console, à enregistrer dans Firebase Console
// > App Check > Apps > Gérer les jetons de débogage.
const APP_CHECK_SITE_KEY = "6LfGeugtAAAAANXRklw96Gt8VCAAee-AfD05ZyMZ";
const APP_CHECK_DEBUG = (() => {
  if (!SUR_LOCALHOST) return false;
  try {
    const p = new URLSearchParams(location.search);
    if (p.get("appcheck") === "0") localStorage.removeItem("bokki-appcheck-debug");
    if (p.get("appcheck") === "1") localStorage.setItem("bokki-appcheck-debug", "1");
    return localStorage.getItem("bokki-appcheck-debug") === "1";
  } catch {
    return false;
  }
})();
if (APP_CHECK_SITE_KEY && (!SUR_LOCALHOST || APP_CHECK_DEBUG)) {
  try {
    if (APP_CHECK_DEBUG) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import(
      "https://www.gstatic.com/firebasejs/11.0.2/firebase-app-check.js"
    );
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (e) {
    console.warn("[Bokki] App Check non initialisé :", e);
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

// Message lisible pour une erreur de fonction publique. Côté public, le
// serveur ne renvoie "unauthenticated" que si le jeton App Check manque ou
// est invalide (page chargée avec un ancien script, reCAPTCHA bloqué) : un
// rechargement règle le premier cas, d'où le message.
export function messageErreurAppel(err, defaut) {
  if (err?.code === "functions/unauthenticated") {
    return "Vérification de sécurité impossible. Recharge la page puis réessaie (désactive ton bloqueur de pub si le problème continue).";
  }
  return err?.message || defaut;
}

if (EMULATOR) {
  try {
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectStorageEmulator(storage, "127.0.0.1", 9199);
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
    console.info("[Bokki] Émulateurs Firebase connectés (QA).");
  } catch (e) {
    console.warn("[Bokki] Basculement émulateur ignoré :", e);
  }
}
