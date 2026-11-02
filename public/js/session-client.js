// Session client (refonte phase 6) : Google ou téléphone + code personnel.
// Firebase Auth garde la session sur l'appareil (persistance locale par
// défaut) jusqu'à « Se déconnecter ».
// NB : l'admin utilise la même instance Auth sur le même domaine ; un compte
// admin connecté est donc vu comme « connecté » sur la boutique (sans effet
// sur ses droits : profilClient et mesCommandesClient ne renvoient que les
// données de ce compte).
import { auth } from "./auth-client.js";
import { appelPublic, erreurReseau, identifiantAppareil } from "./fonctions.js";
import {
  onAuthStateChanged,
  signInWithCustomToken,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  browserPopupRedirectResolver,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

// Un code faux compte un essai : jamais rejoué automatiquement après un
// délai dépassé (seulement si le téléphone était hors connexion).
const identifierClient = appelPublic("identifierClient", { idempotente: false });
const profilClientAppel = appelPublic("profilClient");
const mesCommandesAppel = appelPublic("mesCommandesClient");
export { identifierClient };

// Indice de session pour les pages qui ne chargent pas Firebase Auth
// (cœurs des favoris) : uid du compte connecté, effacé à la déconnexion.
onAuthStateChanged(auth, (u) => {
  try {
    if (u) localStorage.setItem("bokki-session", u.uid);
    else {
      localStorage.removeItem("bokki-session");
      localStorage.removeItem("bokki-favoris");
      // Téléphone partagé : les commandes du compte ne restent pas affichées.
      const c = JSON.parse(localStorage.getItem("bokki-cache-commandes") || "null");
      if (c?.uid) localStorage.removeItem("bokki-cache-commandes");
    }
  } catch { /* stockage indisponible */ }
});

let premierEtat = null;
// Utilisateur connecté (ou null) une fois Firebase Auth initialisé.
// delaiMax : au-delà, on considère « non connecté » (réseau très lent).
export function clientCourant(delaiMax = 8000) {
  // Déjà connecté (y compris juste après une connexion sur cette page).
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  premierEtat ||= new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (u) => { stop(); resolve(u); }, () => resolve(null));
  });
  return Promise.race([premierEtat, new Promise((r) => setTimeout(() => r(auth.currentUser), delaiMax))]);
}

export function surChangementSession(fn) {
  return onAuthStateChanged(auth, fn);
}

export async function connexionJeton(jeton) {
  if (jeton) await signInWithCustomToken(auth, jeton);
}

// Téléphone + code. Renvoie l'état serveur : "connecte" | "reinitialise"
// (session ouverte) ou "nouveau" (aucun compte : créé à la 1re commande).
export async function connexionTelephone(telephone, code) {
  const { data } = await identifierClient({ telephone, code, appareil: identifiantAppareil() });
  if (data.jeton) await connexionJeton(data.jeton);
  return data.etat;
}

// Google : fenêtre surgissante ; si elle est bloquée (certains navigateurs
// mobiles, PWA iOS), redirection pleine page puis retour sur la même URL.
export async function connexionGoogle() {
  const fournisseur = new GoogleAuthProvider();
  fournisseur.setCustomParameters({ prompt: "select_account" });
  try {
    return await signInWithPopup(auth, fournisseur, browserPopupRedirectResolver);
  } catch (err) {
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"].includes(err?.code)) {
      try { sessionStorage.setItem("bokki-redirection-google", "1"); } catch { /* ignore */ }
      await signInWithRedirect(auth, fournisseur, browserPopupRedirectResolver);
      return null;
    }
    throw err;
  }
}

// À appeler au chargement des pages qui proposent Google (retour de
// redirection). Ne lève jamais. Sans redirection Google en cours, rien
// n'est chargé (le module Google pèse ≈ 40 Ko).
export async function resultatRedirection() {
  try {
    if (!sessionStorage.getItem("bokki-redirection-google")) return null;
    sessionStorage.removeItem("bokki-redirection-google");
  } catch { /* stockage indisponible : on vérifie quand même */ }
  try { return await getRedirectResult(auth, browserPopupRedirectResolver); } catch (err) { console.warn("Connexion Google :", err?.code || err); return null; }
}

export async function deconnexion() {
  await signOut(auth);
}

// avecParrainage : renvoie aussi le bloc parrainage (code créé côté serveur
// à la première demande, offre en cours, filleuls, crédit).
export async function profilClient(maj, { avecParrainage = false } = {}) {
  const { data } = await profilClientAppel({ ...(maj ? { maj } : {}), ...(avecParrainage ? { parrainage: true } : {}), appareil: identifiantAppareil() });
  return data;
}

export async function mesCommandesClient() {
  const { data } = await mesCommandesAppel({});
  return data.commandes || [];
}

// Message lisible pour une erreur de connexion.
export function messageConnexion(err) {
  const code = err?.code || "";
  if (code === "auth/popup-closed-by-user" || code === "auth/user-cancelled") return "";
  if (code === "auth/network-request-failed") return "Pas de connexion internet. Réessayez.";
  if (erreurReseau(err)) return "Le réseau est trop lent ou coupé. Vérifiez votre connexion puis réessayez.";
  if (code === "auth/operation-not-allowed" || code === "auth/configuration-not-found") return "La connexion Google n’est pas encore activée. Utilisez votre numéro et votre code.";
  if (code === "auth/unauthorized-domain") return "Connexion Google impossible depuis cette adresse.";
  if (code === "auth/invalid-custom-token" || code === "auth/custom-token-mismatch") return "Connexion impossible pour le moment. Réessayez plus tard.";
  if (code.startsWith("functions/")) return err.message || "Connexion impossible. Réessayez.";
  return err?.message || "Connexion impossible. Réessayez.";
}
