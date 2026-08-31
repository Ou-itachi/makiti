import { functions } from "./firebase-config.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";

const creerCommande = httpsCallable(functions, "creerCommande");

const params = new URLSearchParams(location.search);
const productId = params.get("id");

const errorBox = document.getElementById("orderError");
const submitBtn = document.querySelector("#orderForm .confirm-btn");
const submitBtnLabel = document.querySelector("#orderForm .confirm-btn .btn-label");

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.hidden = false;
}
function hideError() {
  errorBox.hidden = true;
}

// ---------- Soumission de la commande ----------
window.__submitOrder = async function submitOrderReal() {
  hideError();

  const clientNom = document.getElementById("fname").value.trim();
  const clientTel = document.getElementById("fphone").value.trim();
  const ville = document.getElementById("fville").value;
  const quartier = document.getElementById("fquartier").value.trim();
  const repere = document.getElementById("frepere").value.trim();
  const quantite = window.modalQty || 1;

  if (!clientNom || !clientTel || !ville || !quartier) {
    showError("Merci de remplir tous les champs obligatoires.");
    return;
  }
  if (!productId) {
    showError("Produit introuvable, recharge la page.");
    return;
  }
  if (window.modalVarianteRequired && !window.modalVarianteId) {
    showError("Choisis une combinaison d'options avant de commander.");
    return;
  }

  submitBtn.disabled = true;
  if (submitBtnLabel) submitBtnLabel.textContent = "Envoi en cours…";

  try {
    // "Achat rapide" = un panier à un seul article. Le futur vrai panier
    // (KAN-75+) enverra le même champ articles[] avec plusieurs éléments —
    // creerCommande accepte les deux de façon unifiée.
    const result = await creerCommande({
      articles: [
        {
          produitId: productId,
          varianteId: window.modalVarianteId || null,
          quantite,
        },
      ],
      clientNom,
      clientTel,
      ville,
      quartier,
      repere,
    });
    window.location.href = "confirmation.html?id=" + encodeURIComponent(result.data.id);
  } catch (err) {
    showError(err.message || "Impossible d'enregistrer la commande, réessaie.");
    submitBtn.disabled = false;
    if (submitBtnLabel) submitBtnLabel.textContent = "Confirmer ma commande";
  }
};
