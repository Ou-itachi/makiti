// « Mes commandes » (maquette MesCommandes.html) : commandes passées ou
// retrouvées depuis cet appareil (mes-commandes-store.js). Chaque commande est
// rechargée par obtenirSuiviCommande (code + téléphone vérifiés côté serveur).
import { appelPublic } from "./firebase-config.js";
import { getCommandes } from "./mes-commandes-store.js";
import { articlesDe } from "./commande-utils.js";
import { moneyHTML, onCurrencyChange, refreshCurrencyPrices } from "./currency-display.js";
import { escapeHTML } from "./carte-produit.js";
import { I, STATUTS_EN_COURS, pastilleStatut, dateCourte, premiereImage, totalAPayer } from "./suivi-commun.js";

const $ = (id) => document.getElementById(id);
const obtenirSuivi = appelPublic("obtenirSuiviCommande");
const MAX_CHARGEES = 10;

let commandes = [];
let filtre = "toutes";

function carteHTML(o) {
  const lien = o.numero ? `/suivi?numero=${encodeURIComponent(o.numero)}` : `/suivi?id=${encodeURIComponent(o.id)}`;
  if (o.aVerifier) {
    return `
      <a class="card row g14 mc" href="${lien}">
        <span class="thumb">${I("i-package")}</span>
        <div class="col g6 mc-txt">
          <div class="row between g10"><b>${escapeHTML(o.numero || "Commande")}</b><span class="pill pill-grey">Code requis</span></div>
          <span class="small muted">Entrez votre code pour voir cette commande.</span>
        </div>
      </a>`;
  }
  const articles = articlesDe(o);
  const premier = articles[0] || {};
  const autres = articles.length - 1;
  const plus = autres > 0 ? `+${autres} article${autres > 1 ? "s" : ""} · ` : "";
  return `
    <a class="card row g14 mc" href="${lien}">
      <span class="thumb"><img src="${escapeHTML(premiereImage(o))}" alt="" loading="lazy" decoding="async" width="64" height="64"/></span>
      <div class="col g6 mc-txt">
        <div class="row between g10 mc-top"><b class="mc-nom">${escapeHTML(premier.nom || "Commande")}</b>${pastilleStatut(o.statut)}</div>
        <span class="small muted">${plus}${escapeHTML(o.numero || "")}</span>
        <div class="row between g10"><b>${moneyHTML(totalAPayer(o))}</b><span class="small muted">${escapeHTML(dateCourte(o.dateCreation))}</span></div>
      </div>
    </a>`;
}

function rendre() {
  const liste = $("liste");
  liste.removeAttribute("aria-busy");
  const visibles = filtre === "en_cours" ? commandes.filter((o) => STATUTS_EN_COURS.includes(o.statut)) : commandes;
  $("nToutes").textContent = commandes.length;
  $("nEnCours").textContent = commandes.filter((o) => STATUTS_EN_COURS.includes(o.statut)).length;
  $("filtres").hidden = commandes.length === 0;
  if (!visibles.length) {
    liste.innerHTML = `
      <div class="card empty">
        <span class="ico ico-blue">${I("i-package")}</span>
        <b>${filtre === "en_cours" ? "Aucune commande en cours" : "Aucune commande sur ce téléphone"}</b>
        ${filtre === "en_cours" ? "" : `<span class="small">Vos commandes apparaîtront ici après votre premier achat.</span><a class="btn btn-primary" href="/catalogue">Voir les produits</a>`}
      </div>`;
    return;
  }
  liste.innerHTML = visibles.map(carteHTML).join("");
}

$("filtres").addEventListener("click", (e) => {
  const b = e.target.closest(".chip");
  if (!b) return;
  filtre = b.dataset.filtre;
  $("filtres").querySelectorAll(".chip").forEach((x) => {
    x.classList.toggle("on", x === b);
    x.setAttribute("aria-pressed", String(x === b));
  });
  rendre();
});

onCurrencyChange(() => refreshCurrencyPrices());

async function init() {
  const locales = getCommandes();
  const aCharger = locales.filter((c) => c.code && c.tel).slice(0, MAX_CHARGEES);
  const resultats = await Promise.allSettled(
    aCharger.map((c) => obtenirSuivi({ commandeId: c.id, code: c.code, telephone: c.tel }).then(({ data }) => ({ ...data, id: c.id })))
  );
  const chargees = new Map();
  resultats.forEach((r) => { if (r.status === "fulfilled") chargees.set(r.value.id, r.value); });
  commandes = locales.map((c) => chargees.get(c.id) || { id: c.id, numero: c.numero, statut: "", aVerifier: true });
  // Commandes vérifiées d’abord, puis les plus récentes.
  commandes.sort((a, b) => (a.aVerifier - b.aVerifier) || String(b.dateCreation || "").localeCompare(String(a.dateCreation || "")));
  rendre();
}

init().catch((err) => {
  console.warn("Chargement des commandes impossible :", err);
  commandes = [];
  rendre();
});
