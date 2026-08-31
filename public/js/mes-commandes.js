import { db } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { getCommandeIds } from "./mes-commandes-store.js";
import { articlesDe, montantCommande } from "./commande-utils.js";

const PLACEHOLDER_IMG =
  "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='150' height='150'%3E%3Crect width='150' height='150' fill='%23E7E1D5'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-size='12' fill='%23948C7A' text-anchor='middle' dominant-baseline='middle'%3EMakitti%3C/text%3E%3C/svg%3E";

// Mêmes statuts "actifs" que STATUTS_CODE_ACTIF côté Cloud Function
// (functions/src/index.ts) — une commande est "en cours" tant qu'elle n'est
// ni livrée ni retournée.
const STATUTS_EN_COURS = ["nouvelle", "confirmee", "en_livraison", "en_negociation"];

const STATUT_LABEL = {
  nouvelle: "NOUVELLE — EN ATTENTE",
  confirmee: "CONFIRMÉE",
  en_negociation: "EN NÉGOCIATION",
  en_livraison: "EN LIVRAISON",
  livree: "LIVRÉE",
  retournee: "RETOURNÉE",
};
const STATUT_CLASS = {
  nouvelle: "st-attente",
  confirmee: "st-attente",
  en_negociation: "st-attente",
  en_livraison: "st-transit",
  livree: "st-livree",
  retournee: "st-retournee",
};

function fmtGNF(n) {
  return Math.round(n || 0).toLocaleString("fr-FR").replace(/,/g, " ");
}
function fmtDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return (
    d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) +
    ", " +
    d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
  );
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const listEl = document.getElementById("mcList");
const loadingEl = document.getElementById("mcLoading");
const emptyEl = document.getElementById("mcEmpty");
const tabsEl = document.getElementById("mcTabs");
const countToutesEl = document.getElementById("countToutes");
const countEnCoursEl = document.getElementById("countEnCours");

let orders = [];
let currentFilter = "toutes";

function renderList() {
  const visibles = currentFilter === "en_cours"
    ? orders.filter((o) => STATUTS_EN_COURS.includes(o.statut))
    : orders;

  if (visibles.length === 0) {
    listEl.innerHTML = "";
    listEl.hidden = true;
    emptyEl.hidden = false;
    emptyEl.querySelector("p").textContent =
      currentFilter === "en_cours"
        ? "Aucune commande en cours pour le moment."
        : "Vous n'avez pas encore de commande enregistrée sur cet appareil.";
    emptyEl.querySelector(".btn-primary").hidden = currentFilter === "en_cours";
    return;
  }

  emptyEl.hidden = true;
  listEl.hidden = false;
  listEl.innerHTML = visibles
    .map((o) => {
      const articles = articlesDe(o);
      const premier = articles[0] || {};
      const autresArticles = articles.length - 1;
      const total = montantCommande(o);
      const cls = STATUT_CLASS[o.statut] || "st-attente";
      const label = STATUT_LABEL[o.statut] || o.statut;
      return `
        <a class="mc-card" href="suivi.html?id=${encodeURIComponent(o.id)}">
          <div class="order-summary">
            <img src="${escapeHtml(premier.image || PLACEHOLDER_IMG)}" alt=""/>
            <div class="info">
              <h4>${escapeHtml(premier.nom || "Produit")}${autresArticles > 0 ? ` <span class="mc-more">+${autresArticles} article${autresArticles > 1 ? "s" : ""}</span>` : ""}</h4>
              ${premier.varianteLibelle ? `<span class="mc-variant">${escapeHtml(premier.varianteLibelle)}</span>` : ""}
              <span>N° ${escapeHtml(o.numero || "—")} · Quantité : ${escapeHtml(premier.quantite || 1)}</span>
            </div>
            <span class="amt">${fmtGNF(total)} GNF</span>
          </div>
          <div class="mc-card-foot">
            <span class="status-pill ${cls}">${escapeHtml(label)}</span>
            <span class="mc-date">${escapeHtml(fmtDate(o.dateCreation))}</span>
          </div>
        </a>`;
    })
    .join("");
}

function updateCounts() {
  countToutesEl.textContent = orders.length;
  countEnCoursEl.textContent = orders.filter((o) => STATUTS_EN_COURS.includes(o.statut)).length;
}

tabsEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".mc-tab");
  if (!btn) return;
  tabsEl.querySelectorAll(".mc-tab").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  currentFilter = btn.dataset.filter;
  renderList();
});

async function init() {
  const ids = getCommandeIds();
  if (ids.length === 0) {
    loadingEl.hidden = true;
    tabsEl.hidden = true;
    emptyEl.hidden = false;
    return;
  }

  const results = await Promise.allSettled(ids.map((id) => getDoc(doc(db, "commandes", id))));
  orders = results
    .map((r, i) => (r.status === "fulfilled" && r.value.exists() ? { id: ids[i], ...r.value.data() } : null))
    .filter(Boolean);

  loadingEl.hidden = true;
  updateCounts();
  renderList();
}

init();
