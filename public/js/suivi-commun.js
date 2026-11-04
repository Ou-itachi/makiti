// Affichage commun d'une commande (confirmation, suivi, mes commandes).
// Maquettes : design-refonte/maquettes/Confirmation.html, Suivi.html,
// MesCommandes.html (frise .tl, code .code, pastilles .pill-*).
import { articlesDe, montantCommande } from "./commande-utils.js";
import { moneyHTML } from "./currency-display.js";
import { escapeHTML, PLACEHOLDER_IMG } from "./carte-produit.js";

export const I = (id, c = "") => `<svg class="i${c}" aria-hidden="true"><use href="/assets/icons.svg?v=2#${id}"/></svg>`;

// Statuts « en cours » : mêmes valeurs que STATUTS_CODE_ACTIF (functions).
export const STATUTS_EN_COURS = ["nouvelle", "confirmee", "en_preparation", "en_livraison", "en_negociation", "non_joignable"];

const STATUT = {
  nouvelle: ["En attente de confirmation", "pill-amber", ""],
  confirmee: ["Confirmée", "pill-blue", "i-check"],
  en_negociation: ["Confirmée", "pill-blue", "i-check"],
  non_joignable: ["Nous n’arrivons pas à vous joindre", "pill-amber", "i-phone"],
  en_preparation: ["En préparation", "pill-blue", "i-package"],
  en_livraison: ["En livraison", "pill-blue", "i-truck"],
  livree: ["Livrée", "pill-green", "i-check"],
  retournee: ["Retournée", "pill-amber", ""],
  endommagee: ["Problème avec le colis", "pill-red", ""],
  annulee_client: ["Annulée", "pill-grey", ""],
};

// Statuts qui arrêtent la livraison : message à la place de la suite de la frise.
const MESSAGE_ARRET = {
  retournee: ["Commande retournée", "Votre commande nous a été retournée. Nous vous contactons.", "tl-retour"],
  endommagee: ["Problème avec votre colis", "Un problème est survenu avec votre colis. Nous vous contactons rapidement.", "tl-incident"],
  annulee_client: ["Commande annulée", "Votre commande a été annulée.", "tl-annulee"],
};

export function pastilleStatut(statut) {
  const [libelle, classe, icone] = STATUT[statut] || [statut || "—", "pill-grey", ""];
  return `<span class="pill ${classe}">${icone ? I(icone, " i-sm") : ""}${escapeHTML(libelle)}</span>`;
}

export function dateCourte(iso) {
  if (!iso) return "";
  const d = new Date(iso.toDate ? iso.toDate() : iso);
  if (Number.isNaN(d.getTime())) return "";
  const auj = new Date();
  if (d.toDateString() === auj.toDateString()) return "Aujourd’hui, " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: d.getFullYear() === auj.getFullYear() ? undefined : "numeric" });
}

const ETAPES = [
  ["recue", "Commande reçue"],
  ["confirmee", "Confirmée par téléphone"],
  ["en_preparation", "En préparation"],
  ["en_livraison", "En livraison"],
  ["livree", "Livrée"],
];
const STATUT_ETAPE = { nouvelle: 0, non_joignable: 0, confirmee: 1, en_negociation: 1, en_preparation: 2, en_livraison: 3, retournee: 3, endommagee: 3, annulee_client: 3, livree: 4 };
const ATTENTE = {
  confirmee: "Un agent vous appelle",
  en_preparation: "Nous préparons votre colis",
  en_livraison: "Le livreur est en route",
  livree: "Vous payez à la réception",
};
const EN_COURS = {
  recue: "Un agent va vous appeler",
  confirmee: "Votre colis va être préparé",
  en_preparation: "Préparation de votre colis",
  en_livraison: "Votre colis est en route",
};

export function friseHTML(data) {
  const arret = MESSAGE_ARRET[data.statut];
  if (arret) {
    return `<ol class="tl"><li class="done"><span class="dot">${I("i-check", " i-sm")}</span><div class="col"><b>Commande reçue</b><span class="small muted">${escapeHTML(dateCourte(data.dateCreation))}</span></div></li><li class="cur ${arret[2]}" aria-current="step"><span class="dot"></span><div class="col"><b>${arret[0]}</b><span class="small">${data.statut === "retournee" && data.raisonLivraison ? `Votre commande n'a pas pu être livrée (${escapeHTML(data.raisonLivraison)}). Nous vous contactons.` : arret[1]}</span></div></li></ol>`;
  }
  const idx = STATUT_ETAPE[data.statut] ?? 0;
  return `<ol class="tl">${ETAPES.map(([cle, titre], i) => {
    const fait = i < idx || (i === idx && cle === "livree");
    const cour = i === idx && !fait;
    let sous = fait ? "Terminé" : cour ? EN_COURS[cle] || "" : ATTENTE[cle] || "";
    if (cle === "recue") sous = dateCourte(data.dateCreation) || sous;
    if (cle === "livree" && data.dateLivraison) sous = dateCourte(data.dateLivraison);
    if (cle === "recue" && data.statut === "non_joignable") sous = "Rappelez-nous pour confirmer";
    return `<li class="${fait ? "done" : cour ? "cur" : "todo"}"${cour ? ' aria-current="step"' : ""}><span class="dot">${fait ? I("i-check", " i-sm") : ""}</span><div class="col"><b>${titre}</b><span class="small muted">${escapeHTML(sous)}</span></div></li>`;
  }).join("")}</ol>`;
}

export function codeHTML(code) {
  const chiffres = String(code || "").split("");
  return `<div class="code" role="img" aria-label="Code de livraison ${chiffres.join(" ")}">${chiffres.map((c) => `<span aria-hidden="true">${escapeHTML(c)}</span>`).join("")}</div>`;
}

// Lignes d'articles + livraison + total. libelleTotal selon la page.
export function recapHTML(data, libelleTotal = "Total") {
  const articles = articlesDe(data);
  const frais = Number(data.fraisLivraison) || 0;
  const livraison = fraisAConfirmer(data) ? "À confirmer par l’agent" : frais ? moneyHTML(frais) : "Gratuite";
  const lignes = articles.map((a) => `
    <div class="row between g10 small recap-l">
      <span>${Number(a.quantite) || 1} × ${escapeHTML(a.nom || "Produit")}${a.varianteLibelle ? ` <span class="muted">(${escapeHTML(a.varianteLibelle)})</span>` : ""}</span>
      <b>${moneyHTML(a.prixInitial)}</b>
    </div>`).join("");
  return `${lignes}
    <div class="row between small"><span class="muted">Livraison</span><b${fraisAConfirmer(data) || frais ? ' class="frais-payant"' : ""}>${livraison}</b></div>
    ${lignesReductionHTML(data)}
    <div class="divider"></div>
    <div class="row between total"><b>${escapeHTML(libelleTotal)}</b><b>${moneyHTML(totalAPayer(data))}</b></div>`;
}

// Réductions enregistrées par le serveur (creerCommande) : parrainage du
// filleul et crédit parrainage du client. Jamais calculées ici.
export function reductionTotale(data) {
  return Math.max(0, Number(data.reductionParrainage) || 0) + Math.max(0, Number(data.reductionCredit) || 0);
}
export function lignesReductionHTML(data) {
  const parrainage = Math.max(0, Number(data.reductionParrainage) || 0);
  const credit = Math.max(0, Number(data.reductionCredit) || 0);
  const pourcent = Number(data.pourcentParrainage) || 0;
  return (parrainage ? `<div class="row between small"><span class="muted">Réduction parrainage${pourcent ? ` (${String(pourcent).replace(".", ",")} %)` : ""}</span><b class="txt-reduc">−${moneyHTML(parrainage)}</b></div>` : "")
    + (credit ? `<div class="row between small"><span class="muted">Crédit parrainage</span><b class="txt-reduc">−${moneyHTML(credit)}</b></div>` : "");
}

// montantTotal (serveur) = articles seuls ; les frais de livraison s'y
// ajoutent, les réductions s'en déduisent. Un prix convenu au téléphone
// (prixConvenu) est final (l'agent part du montant déjà réduit).
// Ville non reconnue à la commande : frais annoncés par l'agent, pas encore
// saisis (fraisLivraison null). Le total n'inclut alors que les articles.
export function fraisAConfirmer(data) {
  return data?.fraisAConfirmer === true && typeof data.fraisLivraison !== "number";
}

export function totalAPayer(data) {
  if (data.prixConvenu != null) return Number(data.prixConvenu) || 0;
  return Math.max(0, (Number(montantCommande(data)) || 0) + (Number(data.fraisLivraison) || 0) - reductionTotale(data));
}

export function premiereImage(data) {
  return articlesDe(data)[0]?.image || PLACEHOLDER_IMG;
}
