// Cloud Functions (europe-west1) : appels « publics » de la boutique, avec
// délai maximum, nouvelles tentatives et messages clairs en français.
// Ne charge que firebase-app + firebase-functions (pas Firestore ni Auth :
// voir firebase-appli.js).
import { app, EMULATOR, SUR_LOCALHOST } from "./firebase-appli.js";
import { getFunctions, connectFunctionsEmulator, httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";

export const functions = getFunctions(app, "europe-west1");
if (EMULATOR) {
  try { connectFunctionsEmulator(functions, "127.0.0.1", 5001); } catch (e) { console.warn("[Bokki] Émulateur Functions ignoré :", e); }
}

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
// Import dynamique : tant qu'App Check n'est pas requis, le module ne coûte
// rien au chargement des pages.
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
// App Check n'est JAMAIS initialisé au chargement d'une page : une fois
// actif, le SDK Firebase fait attendre TOUTES les requêtes (Firestore, Auth)
// jusqu'à obtention d'un jeton reCAPTCHA — mesuré à ~2 s sur fibre, et
// bloquant sur iPhone en réseau faible. Il est donc démarré à la demande,
// uniquement par appelPublic() ci-dessous, jamais sur l'admin.
const APP_CHECK_ACTIF = Boolean(APP_CHECK_SITE_KEY) && (!SUR_LOCALHOST || APP_CHECK_DEBUG);
// À passer à true EN MÊME TEMPS que EXIGER_APP_CHECK (functions/src/index.ts) :
// les appels attendront alors le jeton. Tant que c'est false, App Check
// démarre en arrière-plan après le chargement (statistiques de la console
// App Check) sans jamais retarder ni la page ni les appels.
const APP_CHECK_REQUIS = false;
let appCheckPret = null;
function activerAppCheck() {
  if (!APP_CHECK_ACTIF) return Promise.resolve();
  appCheckPret ||= (async () => {
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
  })();
  return appCheckPret;
}

// --- Erreurs réseau --------------------------------------------------------
// Le SDK renvoie « internal » (message « internal ») quand la requête n'a
// pas abouti (coupure), « unavailable » / « deadline-exceeded » quand le
// serveur ne répond pas à temps.
export function erreurReseau(err) {
  const c = err?.code || "";
  if (navigator.onLine === false) return true;
  return c === "functions/unavailable" || c === "functions/deadline-exceeded"
    || (c === "functions/internal" && /^internal$/i.test(err?.message || ""));
}
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
function attendreReseau(maxMs) {
  if (navigator.onLine !== false) return Promise.resolve();
  return Promise.race([attendre(maxMs), new Promise((r) => addEventListener("online", r, { once: true }))]);
}

// Fonction publique (commande, suivi, avis, demande, comptes) : à utiliser à
// la place de httpsCallable() sur les pages client.
//   idempotente : true si l'appel peut être rejoué sans risque (lectures,
//     commande avec identifiant unique) → réessayé jusqu'à 3 fois en cas de
//     coupure ou de délai dépassé. false (écritures) : réessayé seulement si
//     la requête n'a pas pu partir (téléphone hors connexion).
//   delai : délai maximum d'un essai (ms).
export function appelPublic(nom, { idempotente = true, delai = 25000, essais = 3 } = {}) {
  const appel = httpsCallable(functions, nom, { timeout: delai });
  if (APP_CHECK_ACTIF) {
    const demarrer = () => setTimeout(activerAppCheck, 1500);
    if (document.readyState === "complete") demarrer();
    else addEventListener("load", demarrer, { once: true });
  }
  const unEssai = async (data) => {
    if (APP_CHECK_REQUIS) await activerAppCheck();
    return appel(data);
  };
  const executer = async (data) => {
    let derniere;
    for (let i = 0; i < essais; i++) {
      if (i) await attendre(1000 * 2 ** (i - 1) + Math.random() * 500);
      const horsLigneAvant = navigator.onLine === false;
      if (horsLigneAvant) await attendreReseau(4000);
      try {
        return await unEssai(data);
      } catch (err) {
        derniere = err;
        if (!erreurReseau(err)) throw err;
        // Écriture non rejouable : seulement si rien n'a pu partir.
        if (!idempotente && !horsLigneAvant && navigator.onLine !== false) throw err;
      }
    }
    throw derniere;
  };
  // Réveille la fonction serveur (démarrage à froid de 2 à 5 s) pendant que
  // le client remplit le formulaire, pour que le vrai envoi soit immédiat.
  // Une seule fois par page ; réponse et erreurs ignorées.
  let prechauffee = false;
  executer.prechauffer = () => {
    if (prechauffee || navigator.onLine === false) return;
    prechauffee = true;
    unEssai({ prechauffage: true }).catch(() => undefined);
  };
  return executer;
}

// Récapitulatif d'une commande tout juste créée (renvoyé par creerCommande),
// pour afficher la page de confirmation sans attendre un second appel.
export function memoriserRecapCommande(recap) {
  try {
    sessionStorage.setItem(`bokki-recap-commande:${recap.id}`, JSON.stringify(recap));
  } catch { /* la confirmation recharge alors depuis le serveur */ }
}
export function lireRecapCommande(id) {
  try {
    return JSON.parse(sessionStorage.getItem(`bokki-recap-commande:${id}`) || "null");
  } catch {
    return null;
  }
}

// Message lisible pour une erreur de fonction publique. Côté public, le
// serveur ne renvoie "unauthenticated" que si le jeton App Check manque ou
// est invalide (page chargée avec un ancien script, reCAPTCHA bloqué) : un
// rechargement règle le premier cas, d'où le message.
export function messageErreurAppel(err, defaut) {
  if (err?.code === "functions/unauthenticated") {
    return "Vérification de sécurité impossible. Rechargez la page puis réessayez (désactivez votre bloqueur de pub si le problème continue).";
  }
  if (navigator.onLine === false) return "Pas de connexion internet. Vérifiez votre réseau puis réessayez.";
  if (erreurReseau(err)) return "Le réseau est trop lent ou coupé. Vérifiez votre connexion puis réessayez.";
  return err?.message || defaut;
}

// Identifiant aléatoire de cet appareil (navigateur), gardé dans
// localStorage « bokki-appareil » et JAMAIS effacé à la déconnexion. Envoyé
// avec chaque commande et à la connexion : le serveur s'en sert seulement
// pour refuser qu'un client se parraine lui-même depuis le même téléphone.
// Stockage indisponible : un identifiant par page (aucune erreur).
let appareilMemoire = null;
export function identifiantAppareil() {
  try {
    const existant = localStorage.getItem("bokki-appareil");
    if (existant && /^[a-z0-9-]{16,64}$/.test(existant)) return existant;
  } catch { /* stockage indisponible */ }
  if (!appareilMemoire) {
    if (crypto.randomUUID) appareilMemoire = crypto.randomUUID();
    else appareilMemoire = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  try { localStorage.setItem("bokki-appareil", appareilMemoire); } catch { /* ignore */ }
  return appareilMemoire;
}
