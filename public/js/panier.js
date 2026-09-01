import { functions } from "./firebase-config.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import {
  getPanier,
  onPanierChange,
  modifierQuantite,
  retirerArticle,
  viderPanier,
  montantTotalPanier,
} from "./panier-store.js";

const creerCommande = httpsCallable(functions, "creerCommande");

const PLACEHOLDER_IMG =
  "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='120' height='120' fill='%2316233D'/%3E%3C/svg%3E";

const emptyEl = document.getElementById("pnEmpty");
const contentEl = document.getElementById("pnContent");
const linesEl = document.getElementById("pnLines");
const totalEl = document.getElementById("pnTotal");
const errorEl = document.getElementById("pnError");
const form = document.getElementById("pnForm");
const submitBtn = document.getElementById("pnSubmit");
const submitLabel = submitBtn.querySelector(".btn-label");

function fmtGNF(n) {
  return Math.round(n || 0).toLocaleString("fr-FR").replace(/,/g, " ");
}
function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// clé DOM stable par ligne = produitId + varianteId (même logique que memeLigne
// du store) — permet de retrouver l'article ciblé par un bouton.
function ligneKey(a) {
  return a.produitId + "|" + (a.varianteId || "");
}

function ligneHTML(a) {
  const img = a.image || PLACEHOLDER_IMG;
  const sousTotal = (Number(a.prixUnitaire) || 0) * (Number(a.quantite) || 0);
  return `
    <div class="pn-line" data-key="${escapeHTML(ligneKey(a))}">
      <img src="${escapeHTML(img)}" alt="" class="pn-line-img" loading="lazy"/>
      <div class="pn-line-info">
        <h4>${escapeHTML(a.nom) || "Produit"}</h4>
        ${a.varianteLibelle ? `<span class="pn-line-variante">${escapeHTML(a.varianteLibelle)}</span>` : ""}
        <span class="pn-line-unit">${fmtGNF(a.prixUnitaire)} GNF l'unité</span>
        <div class="pn-line-bottom">
          <div class="qty-control">
            <button type="button" data-act="moins" aria-label="Diminuer la quantité">−</button>
            <span>${a.quantite}</span>
            <button type="button" data-act="plus" aria-label="Augmenter la quantité">+</button>
          </div>
          <button type="button" class="pn-line-remove" data-act="retirer" aria-label="Retirer du panier">
            <i class="ph ph-trash" style="font-size:15px"></i>
          </button>
        </div>
      </div>
      <span class="pn-line-price">${fmtGNF(sousTotal)}<small>GNF</small></span>
    </div>`;
}

function render() {
  const { articles } = getPanier();
  const vide = !articles.length;
  emptyEl.hidden = !vide;
  contentEl.hidden = vide;
  if (vide) {
    linesEl.innerHTML = "";
    return;
  }

  linesEl.innerHTML = articles.map(ligneHTML).join("");
  totalEl.textContent = fmtGNF(montantTotalPanier()) + " GNF";

  linesEl.querySelectorAll(".pn-line").forEach((row) => {
    const key = row.dataset.key;
    const article = articles.find((a) => ligneKey(a) === key);
    if (!article) return;
    row.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.dataset.act;
        if (act === "retirer") retirerArticle(article.produitId, article.varianteId);
        else modifierQuantite(article.produitId, article.varianteId, article.quantite + (act === "plus" ? 1 : -1));
      });
    });
  });
}

document.getElementById("pnClear").addEventListener("click", () => {
  if (confirm("Vider entièrement le panier ?")) viderPanier();
});

onPanierChange(render);
render();

// ---------- Commander tout le panier ----------
function showError(msg) {
  errorEl.textContent = msg;
  errorEl.hidden = false;
  errorEl.scrollIntoView({ behavior: "smooth", block: "center" });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.hidden = true;

  const { articles } = getPanier();
  if (!articles.length) {
    showError("Votre panier est vide.");
    return;
  }

  const clientNom = document.getElementById("fname").value.trim();
  const clientTel = document.getElementById("fphone").value.trim();
  const ville = document.getElementById("fville").value;
  const quartier = document.getElementById("fquartier").value.trim();
  const repere = document.getElementById("frepere").value.trim();

  if (!clientNom || !clientTel || !ville || !quartier) {
    showError("Merci de remplir tous les champs obligatoires.");
    return;
  }

  submitBtn.disabled = true;
  submitLabel.textContent = "Envoi en cours…";

  try {
    // Le serveur (creerCommande) revérifie chaque produit/variante et
    // recalcule tous les prix — le panier local ne sert qu'à composer la
    // liste produitId/varianteId/quantité.
    const result = await creerCommande({
      articles: articles.map((a) => ({
        produitId: a.produitId,
        varianteId: a.varianteId || null,
        quantite: a.quantite,
      })),
      clientNom,
      clientTel,
      ville,
      quartier,
      repere,
    });
    viderPanier();
    window.location.href = "confirmation.html?id=" + encodeURIComponent(result.data.id);
  } catch (err) {
    showError(err.message || "Impossible d'enregistrer la commande, réessayez.");
    submitBtn.disabled = false;
    submitLabel.textContent = "Commander tout le panier";
  }
});
