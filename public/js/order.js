import { messageErreurAppel, appelPublic, memoriserRecapCommande } from "./firebase-config.js";
import { boutonChargement } from "./bouton-chargement.js";
import { ajouterCommande } from "./mes-commandes-store.js";

const creerCommande = appelPublic("creerCommande");

const params = new URLSearchParams(location.search);
const productId = params.get("id");

const errorBox = document.getElementById("orderError");
const submitBtn = document.querySelector("#orderForm .confirm-btn");

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.hidden = false;
}
function hideError() {
  errorBox.hidden = true;
}

// ---------- Préchauffage du serveur ----------
// Dès que le client ouvre le formulaire (bouton "Commander") ou touche un
// champ, on réveille creerCommande : le clic final ne subit plus le
// démarrage à froid de la fonction (2 à 5 s).
document.querySelector(".order-cta")?.addEventListener("pointerdown", () => creerCommande.prechauffer(), { once: true });
document.getElementById("orderForm")?.addEventListener("focusin", () => creerCommande.prechauffer(), { once: true });

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

  boutonChargement(submitBtn, true, "Envoi de la commande");

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
    ajouterCommande(result.data.id, result.data.codeLivraison, clientTel);
    memoriserRecapCommande(result.data);
    window.location.href = "confirmation.html?id=" + encodeURIComponent(result.data.id);
  } catch (err) {
    showError(messageErreurAppel(err, "Impossible d'enregistrer la commande, réessaie."));
    boutonChargement(submitBtn, false);
  }
};
