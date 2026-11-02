// Commande sans perte. Si le réseau coupe à « Confirmer ma commande », la
// commande reste sur le téléphone (localStorage) et part toute seule au
// retour du réseau — depuis n'importe quelle page du site.
// Chaque commande porte un identifiant unique (idEnvoi) : le serveur
// (creerCommande) ne l'enregistre jamais deux fois, même si un envoi
// « perdu » avait en fait abouti.
import { appelPublic, erreurReseau, memoriserRecapCommande } from "./fonctions.js";
import { ajouterCommande } from "./mes-commandes-store.js";

const CLE = "bokki-commande-attente";
const creerCommande = appelPublic("creerCommande", { idempotente: true, delai: 30000, essais: 3 });
// Réveil de la fonction serveur pendant que le client remplit le formulaire.
export const prechaufferCommande = () => creerCommande.prechauffer?.();

export function nouvelIdEnvoi() {
  if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
  const o = crypto.getRandomValues(new Uint8Array(16));
  return [...o].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function lireAttente() {
  try { return JSON.parse(localStorage.getItem(CLE) || "null"); } catch { return null; }
}
function ecrire(e) {
  try {
    if (e) localStorage.setItem(CLE, JSON.stringify(e));
    else localStorage.removeItem(CLE);
  } catch { /* stockage indisponible : l'envoi direct reste possible */ }
}
// envoi : { idEnvoi, donnees (pour creerCommande), source ("panier"|"direct"),
//           tel, coordonnees, date }
export function mettreEnAttente(envoi) {
  ecrire({ ...envoi, date: envoi.date || Date.now() });
}
export function retirerAttente() {
  ecrire(null);
}

// Après succès : session, « Mes commandes », panier, récapitulatif.
async function finaliser(e, recap) {
  if (recap.jetonConnexion) {
    try {
      const { connexionJeton } = await import("./session-client.js");
      await connexionJeton(recap.jetonConnexion);
    } catch (err) { console.warn("Session non ouverte :", err); }
  }
  try {
    const { memoriserCoordonnees, terminerCommande } = await import("./commande-store.js");
    if (e.coordonnees) memoriserCoordonnees(e.coordonnees);
    terminerCommande();
  } catch { /* préremplissage seulement */ }
  ajouterCommande(recap.id, recap.codeLivraison, e.tel, recap.numero);
  memoriserRecapCommande(recap);
  if (e.source === "panier") {
    const { viderPanier } = await import("./panier-store.js");
    viderPanier();
  }
  retirerAttente();
}

let enCours = null;
// Envoie la commande en attente. Résultat :
//   { etat: "envoyee", recap }   commande enregistrée ;
//   { etat: "attente" }          réseau toujours indisponible (gardée) ;
//   { etat: "refusee", erreur }  refus du serveur (retirée, à corriger) ;
//   { etat: "aucune" }.
export function envoyerAttente() {
  enCours ||= (async () => {
    const e = lireAttente();
    if (!e) return { etat: "aucune" };
    const tenter = async () => {
      try {
        const { data } = await creerCommande({ ...e.donnees, idEnvoi: e.idEnvoi });
        await finaliser(e, data);
        dispatchEvent(new CustomEvent("bokki:commande-envoyee", { detail: data }));
        return { etat: "envoyee", recap: data };
      } catch (err) {
        if (erreurReseau(err)) return { etat: "attente", erreur: err };
        retirerAttente();
        dispatchEvent(new CustomEvent("bokki:commande-refusee", { detail: err }));
        return { etat: "refusee", erreur: err };
      }
    };
    // Plusieurs onglets ouverts : un seul envoie à la fois.
    if (navigator.locks?.request) return navigator.locks.request("bokki-commande-attente", tenter);
    return tenter();
  })().finally(() => { enCours = null; });
  return enCours;
}

// --- Surveillance sur toutes les pages (chargée par panier-badge.js) -------
let bandeau = null;
function afficher(html, duree) {
  if (!document.body) return;
  if (!bandeau) {
    bandeau = document.createElement("div");
    bandeau.className = "reseau-bandeau attente-bandeau";
    bandeau.setAttribute("role", "status");
    document.body.appendChild(bandeau);
  }
  bandeau.innerHTML = html;
  bandeau.hidden = false;
  clearTimeout(bandeau._t);
  if (duree) bandeau._t = setTimeout(() => { bandeau.hidden = true; }, duree);
}

export function surveillerAttente({ discret = false } = {}) {
  const tenter = async () => {
    if (!lireAttente()) return;
    if (!discret) afficher("Commande en attente d’envoi : elle partira dès le retour du réseau.");
    if (navigator.onLine === false) return;
    const r = await envoyerAttente();
    if (discret) return;
    if (r.etat === "envoyee") {
      afficher(`Votre commande ${r.recap.numero ? `<b>${r.recap.numero}</b> ` : ""}a bien été envoyée. <a href="/confirmation?id=${encodeURIComponent(r.recap.id)}">Voir</a>`, 12000);
    } else if (r.etat === "refusee") {
      afficher(`Votre commande n’a pas pu être enregistrée. <a href="/panier">Vérifier ma commande</a>`, 15000);
    }
  };
  addEventListener("online", tenter);
  // Retour sur l'onglet (téléphone sorti de veille) : nouvel essai.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") tenter(); });
  tenter();
}
