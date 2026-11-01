// Session client (refonte phase 6) : Google ou téléphone + code personnel.
// Firebase Auth garde la session sur l'appareil (persistance locale par
// défaut) jusqu'à « Se déconnecter ».
// NB : l'admin utilise la même instance Auth sur le même domaine ; un compte
// admin connecté est donc vu comme « connecté » sur la boutique (sans effet
// sur ses droits : profilClient et mesCommandesClient ne renvoient que les
// données de ce compte).
import { auth, appelPublic } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signInWithCustomToken,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

const identifierClient = appelPublic("identifierClient");
const profilClientAppel = appelPublic("profilClient");
const mesCommandesAppel = appelPublic("mesCommandesClient");
export { identifierClient };

let premierEtat = null;
// Utilisateur connecté (ou null) une fois Firebase Auth initialisé.
// delaiMax : au-delà, on considère « non connecté » (réseau très lent).
export function clientCourant(delaiMax = 8000) {
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
  const { data } = await identifierClient({ telephone, code });
  if (data.jeton) await connexionJeton(data.jeton);
  return data.etat;
}

// Google : fenêtre surgissante ; si elle est bloquée (certains navigateurs
// mobiles, PWA iOS), redirection pleine page puis retour sur la même URL.
export async function connexionGoogle() {
  const fournisseur = new GoogleAuthProvider();
  fournisseur.setCustomParameters({ prompt: "select_account" });
  try {
    return await signInWithPopup(auth, fournisseur);
  } catch (err) {
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"].includes(err?.code)) {
      await signInWithRedirect(auth, fournisseur);
      return null;
    }
    throw err;
  }
}

// À appeler au chargement des pages qui proposent Google (retour de
// redirection). Ne lève jamais.
export async function resultatRedirection() {
  try { return await getRedirectResult(auth); } catch (err) { console.warn("Connexion Google :", err?.code || err); return null; }
}

export async function deconnexion() {
  await signOut(auth);
}

export async function profilClient(maj) {
  const { data } = await profilClientAppel(maj ? { maj } : {});
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
  if (code === "auth/operation-not-allowed" || code === "auth/configuration-not-found") return "La connexion Google n’est pas encore activée. Utilisez votre numéro et votre code.";
  if (code === "auth/unauthorized-domain") return "Connexion Google impossible depuis cette adresse.";
  if (code === "auth/invalid-custom-token" || code === "auth/custom-token-mismatch") return "Connexion impossible pour le moment. Réessayez plus tard.";
  if (code.startsWith("functions/")) return err.message || "Connexion impossible. Réessayez.";
  return err?.message || "Connexion impossible. Réessayez.";
}
