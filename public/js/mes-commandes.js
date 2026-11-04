// « Mes commandes » (maquette MesCommandes.html) : commandes passées ou
// retrouvées depuis cet appareil (mes-commandes-store.js). Chaque commande est
// rechargée par obtenirSuiviCommande (code + téléphone vérifiés côté serveur).
import { appelPublic } from "./fonctions.js";
import { getCommandes } from "./mes-commandes-store.js";
import { articlesDe } from "./commande-utils.js";
import { moneyHTML, onCurrencyChange, refreshCurrencyPrices } from "./currency-display.js";
import { escapeHTML } from "./carte-produit.js";
import { I, STATUTS_EN_COURS, pastilleStatut, dateCourte, premiereImage, totalAPayer } from "./suivi-commun.js";
import { clientCourant, mesCommandesClient } from "./session-client.js";
import { ecouterStatut } from "./suivi-direct.js";

const $ = (id) => document.getElementById(id);
const obtenirSuivi = appelPublic("obtenirSuiviCommande");
const MAX_CHARGEES = 10;

let commandes = [];
let filtre = new URLSearchParams(location.search).get("filtre") === "en_cours" ? "en_cours" : "toutes";

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
        <span class="small muted">${plus}${escapeHTML(o.numero || "")}${o.codeLivraison ? ` · Code <b class="mc-code">${escapeHTML(String(o.codeLivraison))}</b>` : ""}</span>
        <div class="row between g10"><b class="txt-total">${moneyHTML(totalAPayer(o))}</b><span class="small muted">${escapeHTML(dateCourte(o.dateCreation))}</span></div>
      </div>
    </a>`;
}

function rendre() {
  brancherSuiviDirect();
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

// Dernière liste affichée, gardée sur le téléphone : affichée tout de suite,
// et hors connexion (effacée à la déconnexion, voir session-client.js).
const CLE_CACHE = "bokki-cache-commandes";
function lireCache() {
  try { return JSON.parse(localStorage.getItem(CLE_CACHE) || "null"); } catch { return null; }
}
function sessionIndice() {
  try { return localStorage.getItem("bokki-session") || null; } catch { return null; }
}

async function init() {
  const cache = lireCache();
  if (cache?.liste?.length && cache.uid === sessionIndice()) {
    commandes = cache.liste;
    rendre();
  }
  // Brief §5.1 : l'historique est lié au compte. Non connecté et rien sur
  // cet appareil → page Connexion (retour ici ensuite).
  const user = await clientCourant();
  const locales = getCommandes();
  if (!user && !locales.length) {
    location.replace("/connexion?retour=/mes-commandes");
    return;
  }
  $("sousTitre").textContent = user ? "Les commandes de votre compte et de ce téléphone." : "Les commandes passées depuis ce téléphone.";
  $("bandeauConnexion").hidden = Boolean(user);
  let duCompte = [];
  let echecCompte = false;
  if (user) {
    try { duCompte = await mesCommandesClient(); } catch (err) { echecCompte = true; console.warn("Commandes du compte non chargées :", err); }
  }
  const aCharger = locales.filter((c) => c.code && c.tel && !duCompte.some((d) => d.id === c.id)).slice(0, MAX_CHARGEES);
  const resultats = await Promise.allSettled(
    aCharger.map((c) => obtenirSuivi({ commandeId: c.id, code: c.code, telephone: c.tel }).then(({ data }) => ({ ...data, id: c.id })))
  );
  const chargees = new Map();
  resultats.forEach((r) => { if (r.status === "fulfilled") chargees.set(r.value.id, r.value); });
  // Réseau indisponible : on garde la dernière liste connue.
  const echecReseau = echecCompte || (aCharger.length > 0 && chargees.size === 0);
  const uid = user?.uid || null;
  if (echecReseau && cache?.liste?.length && cache.uid === uid) {
    commandes = cache.liste;
    dispatchEvent(new CustomEvent("bokki:donnees-cache"));
    rendre();
    return;
  }
  const idsCompte = new Set(duCompte.map((c) => c.id));
  commandes = duCompte.concat(
    locales.filter((c) => !idsCompte.has(c.id)).map((c) => chargees.get(c.id) || { id: c.id, numero: c.numero, statut: "", aVerifier: true })
  );
  // Commandes vérifiées d’abord, puis les plus récentes.
  commandes.sort((a, b) => (Number(Boolean(a.aVerifier)) - Number(Boolean(b.aVerifier))) || String(b.dateCreation || "").localeCompare(String(a.dateCreation || "")));
  $("filtres").querySelectorAll(".chip").forEach((x) => {
    x.classList.toggle("on", x.dataset.filtre === filtre);
    x.setAttribute("aria-pressed", String(x.dataset.filtre === filtre));
  });
  rendre();
  try { localStorage.setItem(CLE_CACHE, JSON.stringify({ uid, t: Date.now(), liste: commandes.slice(0, 30) })); } catch { /* stockage plein */ }
}

// Statuts à jour sans recharger : les commandes du compte (un seul appel)
// sont relues toutes les 60 s quand la page est visible et au retour sur
// l'appli. Les commandes de ce téléphone hors compte gardent la lecture faite
// à l'ouverture (un appel par commande : trop coûteux à répéter).
function brancherSuiviDirect() {
  commandes.forEach((o) => ecouterStatut(o.jetonSuivi, () => rafraichirCompte({ force: true })));
}
let dernierRafraichi = Date.now();
async function rafraichirCompte({ force = false } = {}) {
  if (!force && (document.visibilityState !== "visible" || Date.now() - dernierRafraichi < 15000)) return;
  dernierRafraichi = Date.now();
  if (!sessionIndice()) return;
  try {
    const frais = await mesCommandesClient();
    if (!frais.length) return;
    const parId = new Map(frais.map((c) => [c.id, c]));
    let change = false;
    commandes = commandes.map((o) => {
      const f = parId.get(o.id);
      if (f && f.statut !== o.statut) change = true;
      return f || o;
    });
    frais.forEach((f) => { if (!commandes.some((o) => o.id === f.id)) { commandes.unshift(f); change = true; } });
    if (change) rendre();
    brancherSuiviDirect();
  } catch { /* hors connexion : on garde la liste affichée */ }
}
setInterval(rafraichirCompte, 60000);
document.addEventListener("visibilitychange", () => rafraichirCompte());
addEventListener("pageshow", (e) => { if (e.persisted) rafraichirCompte(); });

init().catch((err) => {
  console.warn("Chargement des commandes impossible :", err);
  commandes = [];
  rendre();
});
