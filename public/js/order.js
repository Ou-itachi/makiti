import { db, functions } from "./firebase-config.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import {
  collection,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const creerCommande = httpsCallable(functions, "creerCommande");

const params = new URLSearchParams(location.search);
const productId = params.get("id");

const errorBox = document.getElementById("orderError");
const submitBtn = document.querySelector("#orderForm .confirm-btn");
const submitBtnLabel = document.querySelector("#orderForm .confirm-btn .btn-label");
const villeSelect = document.getElementById("fville");
const premiumFraisLabel = document.getElementById("premiumFraisLabel");
const livOptPremium = document.getElementById("livOptPremium");
const livraisonRadios = document.querySelectorAll('input[name="livraisonType"]');

function fmtGNF(n) {
  return Math.round(n || 0).toLocaleString("fr-FR").replace(/,/g, " ");
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.hidden = false;
}
function hideError() {
  errorBox.hidden = true;
}

// ---------- Zones de livraison (délai + frais premium) ----------
let zones = [];
function zoneForVille(ville) {
  return zones.find((z) => z.ville === ville) || null;
}

function refreshLivraisonUI() {
  const zone = zoneForVille(villeSelect.value);
  if (!villeSelect.value) {
    premiumFraisLabel.textContent = "Choisissez d'abord une ville";
    livOptPremium.classList.add("disabled");
    livraisonRadios.forEach((r) => {
      if (r.value === "premium") r.disabled = true;
    });
  } else if (!zone) {
    premiumFraisLabel.textContent = "Indisponible pour cette ville";
    livOptPremium.classList.add("disabled");
    livraisonRadios.forEach((r) => {
      if (r.value === "premium") r.disabled = true;
    });
  } else {
    premiumFraisLabel.textContent = fmtGNF(zone.frais) + " GNF · " + (zone.delai || "");
    livOptPremium.classList.remove("disabled");
    livraisonRadios.forEach((r) => {
      if (r.value === "premium") r.disabled = false;
    });
  }
  updateFraisSelectionne();
}

function updateFraisSelectionne() {
  const selected = document.querySelector('input[name="livraisonType"]:checked');
  const type = selected ? selected.value : "standard";
  const zone = zoneForVille(villeSelect.value);
  window.livraisonFrais = type === "premium" && zone ? Number(zone.frais) || 0 : 0;
  if (typeof window.updateModalTotal === "function") window.updateModalTotal();
}

onSnapshot(collection(db, "zones"), (snap) => {
  zones = snap.docs.map((d) => d.data());
  refreshLivraisonUI();
});

villeSelect.addEventListener("change", () => {
  // Revenir en standard si Premium n'est plus valable pour la nouvelle ville.
  const zone = zoneForVille(villeSelect.value);
  if (!zone) {
    const standardRadio = document.querySelector('input[name="livraisonType"][value="standard"]');
    if (standardRadio) standardRadio.checked = true;
  }
  refreshLivraisonUI();
});
livraisonRadios.forEach((r) => r.addEventListener("change", updateFraisSelectionne));

// ---------- Soumission de la commande ----------
window.__submitOrder = async function submitOrderReal() {
  hideError();

  const clientNom = document.getElementById("fname").value.trim();
  const clientTel = document.getElementById("fphone").value.trim();
  const ville = document.getElementById("fville").value;
  const quartier = document.getElementById("fquartier").value.trim();
  const repere = document.getElementById("frepere").value.trim();
  const quantite = window.modalQty || 1;
  const livraisonTypeEl = document.querySelector('input[name="livraisonType"]:checked');
  const livraisonType = livraisonTypeEl ? livraisonTypeEl.value : "standard";

  if (!clientNom || !clientTel || !ville || !quartier) {
    showError("Merci de remplir tous les champs obligatoires.");
    return;
  }
  if (!productId) {
    showError("Produit introuvable, recharge la page.");
    return;
  }

  submitBtn.disabled = true;
  if (submitBtnLabel) submitBtnLabel.textContent = "Envoi en cours…";

  try {
    const result = await creerCommande({
      produitId: productId,
      quantite,
      clientNom,
      clientTel,
      ville,
      quartier,
      repere,
      livraisonType,
    });
    window.location.href = "confirmation.html?id=" + encodeURIComponent(result.data.id);
  } catch (err) {
    showError(err.message || "Impossible d'enregistrer la commande, réessaie.");
    submitBtn.disabled = false;
    if (submitBtnLabel) submitBtnLabel.textContent = "Confirmer ma commande";
  }
};
