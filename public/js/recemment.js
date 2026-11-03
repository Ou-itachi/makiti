// « Récemment consultés » : derniers produits vus, gardés sur le téléphone
// (identifiants seulement). Affichés en bas de l'accueil et de la fiche.
import { lireProduit } from "./donnees.js";
import { carteProduitHTML, brancherCartes } from "./carte-produit.js";

const CLE = "bokki-recemment";
const MAX_GARDES = 9;
const MAX_AFFICHES = 8;

const lire = () => {
  try { return JSON.parse(localStorage.getItem(CLE) || "[]").filter((id) => typeof id === "string"); } catch { return []; }
};
const ecrire = (ids) => {
  try { localStorage.setItem(CLE, JSON.stringify(ids)); } catch { /* stockage plein ou bloqué */ }
};

export function noterVue(id) {
  if (id) ecrire([id, ...lire().filter((x) => x !== id)].slice(0, MAX_GARDES));
}

// Section masquée tant qu'il n'y a rien à montrer. Lancé hors du premier
// affichage : cette section est en bas de page.
export function afficherRecemment(section, rail, exclure = "") {
  const lancer = async () => {
    const ids = lire().filter((id) => id !== exclure).slice(0, MAX_AFFICHES);
    if (!ids.length) return;
    const docs = await Promise.all(ids.map((id) => lireProduit(id).catch(() => null)));
    const produits = docs.filter(Boolean);
    if (!produits.length) return;
    rail.innerHTML = produits.map((p) => carteProduitHTML(p)).join("");
    brancherCartes(rail, (id) => produits.find((p) => p.id === id));
    section.hidden = false;
  };
  if ("requestIdleCallback" in window) requestIdleCallback(lancer, { timeout: 2500 });
  else setTimeout(lancer, 800);
}
