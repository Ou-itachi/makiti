// Panier (maquette design-refonte/maquettes/Panier.html). Le formulaire de
// livraison a quitté cette page : « Commander » ouvre l'étape 1 de la
// commande (/commande/identification).
import { moneyHTML, onCurrencyChange } from "./currency-display.js";
import { getPanier, onPanierChange, majPrixArticles, modifierQuantite, retirerArticle, viderPanier, montantTotalPanier, compterArticles } from "./panier-store.js";
import { escapeHTML, PLACEHOLDER_IMG } from "./carte-produit.js";
import { demarrerCommande } from "./commande-store.js";
import { lienEtapeCommande } from "./commande-acces.js";
import { urlProduit } from "./slug.js";
import { articlesAuPrixActuel } from "./prix-articles.js";

const QTE_MAX = 20;
const $ = (id) => document.getElementById(id);
const cle = (a) => `${a.produitId}|${a.varianteId || ""}`;

function ligneHTML(a) {
  const q = Number(a.quantite) || 1;
  return `
    <article class="card line" data-cle="${escapeHTML(cle(a))}">
      <a class="thumb" href="${escapeHTML(urlProduit(a.produitId, a.nom))}" tabindex="-1" aria-hidden="true"><img src="${escapeHTML(a.image || PLACEHOLDER_IMG)}" alt="" loading="lazy" width="52" height="52"/></a>
      <div class="col">
        <div class="row between" style="align-items:flex-start">
          <div class="col g6" style="gap:2px">
            <a class="line-name" href="${escapeHTML(urlProduit(a.produitId, a.nom))}">${escapeHTML(a.nom || "Produit")}</a>
            ${a.varianteLibelle ? `<span class="line-var">${escapeHTML(a.varianteLibelle)}</span>` : ""}
          </div>
          <button type="button" class="line-del" data-act="retirer" aria-label="Retirer ${escapeHTML(a.nom || "ce produit")} du panier"><svg class="i" aria-hidden="true"><use href="/assets/icons.svg?v=2#i-trash"/></svg></button>
        </div>
        <div class="row between wrapf">
          <span class="strong">${moneyHTML((Number(a.prixUnitaire) || 0) * q)}${q > 1 ? `<span class="small muted" style="display:block;font-weight:500">${q} × ${moneyHTML(a.prixUnitaire)}</span>` : ""}</span>
          <div class="stepper" role="group" aria-label="Quantité de ${escapeHTML(a.nom || "ce produit")}">
            <button type="button" data-act="moins" aria-label="Diminuer la quantité">−</button>
            <span aria-live="polite">${q}</span>
            <button type="button" class="plus" data-act="plus" aria-label="Augmenter la quantité"${q >= QTE_MAX ? " disabled" : ""}>+</button>
          </div>
        </div>
      </div>
    </article>`;
}

function render() {
  const { articles } = getPanier();
  const vide = !articles.length;
  $("vide").hidden = !vide;
  $("contenu-panier").hidden = vide;
  $("vider").hidden = vide;
  const n = compterArticles();
  $("nbArticles").textContent = vide ? "" : `(${n})`;
  if (vide) {
    $("lignes").innerHTML = "";
    return;
  }
  $("lignes").innerHTML = articles.map(ligneHTML).join("");
  const total = montantTotalPanier();
  $("sousTotalLbl").textContent = `Sous-total (${n} article${n > 1 ? "s" : ""})`;
  $("sousTotal").innerHTML = moneyHTML(total);
  $("total").innerHTML = moneyHTML(total);
  $("totalBtn").innerHTML = moneyHTML(total);
}

$("lignes").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const ligne = btn.closest("[data-cle]");
  const a = getPanier().articles.find((x) => cle(x) === ligne.dataset.cle);
  if (!a) return;
  const act = btn.dataset.act;
  if (act === "retirer") retirerArticle(a.produitId, a.varianteId);
  else modifierQuantite(a.produitId, a.varianteId, Math.min(QTE_MAX, a.quantite + (act === "plus" ? 1 : -1)));
  // Garder le focus clavier sur le même bouton après le nouveau rendu.
  const memeBtn = document.querySelector(`[data-cle="${CSS.escape(ligne.dataset.cle)}"] button[data-act="${act}"]`);
  (memeBtn || $("lignes").querySelector("button") || $("vide").querySelector("a"))?.focus();
});

$("vider").addEventListener("click", () => {
  if (confirm("Vider entièrement le panier ?")) viderPanier();
});

$("commander").addEventListener("click", async () => {
  if (!getPanier().articles.length) return;
  demarrerCommande("panier");
  location.href = await lienEtapeCommande();
});

onPanierChange(render);
onCurrencyChange(render);
render();
// Prix relus après l'affichage : promotion commencée ou terminée entre-temps.
articlesAuPrixActuel(getPanier().articles).then(majPrixArticles);
