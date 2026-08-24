import { db, functions } from "./firebase-config.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";

const creerAvis = httpsCallable(functions, "creerAvis");

const PLACEHOLDER_IMG =
  "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='150' height='150'%3E%3Crect width='150' height='150' fill='%2316233D'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-size='12' fill='%2393A4C3' text-anchor='middle' dominant-baseline='middle'%3EMakiti%3C/text%3E%3C/svg%3E";

const STEP_ORDER = ["recue", "confirmee", "en_livraison", "livree"];
const STATUT_TO_STEP = {
  nouvelle: "recue",
  confirmee: "confirmee",
  en_negociation: "confirmee",
  en_livraison: "en_livraison",
  livree: "livree",
  retournee: "en_livraison",
};
const STATUT_LABEL = {
  nouvelle: "NOUVELLE — EN ATTENTE",
  confirmee: "CONFIRMÉE",
  en_negociation: "EN NÉGOCIATION",
  en_livraison: "EN LIVRAISON",
  livree: "LIVRÉE",
  retournee: "RETOURNÉE",
};
const STEP_TITLES = {
  recue: "Commande reçue",
  confirmee: "Confirmée par téléphone",
  en_livraison: "En livraison",
  livree: "Livrée",
};

function fmtGNF(n) {
  return Math.round(n || 0).toLocaleString("fr-FR").replace(/,/g, " ");
}
function fmtDate(ts) {
  if (!ts) return null;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) +
    ", " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

const params = new URLSearchParams(location.search);
const orderId = params.get("id");

const resultCard = document.querySelector(".result-card");
const timelineEl = document.querySelector(".timeline");

function render(data) {
  document.querySelector(".result-card .num").textContent = data.numero || "—";
  const pill = document.querySelector(".result-card .status-pill");
  pill.textContent = STATUT_LABEL[data.statut] || data.statut;

  const currentStep = STATUT_TO_STEP[data.statut] || "recue";
  const currentIdx = STEP_ORDER.indexOf(currentStep);

  timelineEl.innerHTML = STEP_ORDER.map((step, idx) => {
    const done = idx < currentIdx || (idx === currentIdx && step === "livree");
    const current = idx === currentIdx && step !== "livree";
    const cls = done ? "done" : current ? "current" : "";
    let dateLabel = "En attente";
    if (step === "recue") dateLabel = fmtDate(data.dateCreation) || "En attente";
    if (step === "livree" && data.dateLivraison) dateLabel = fmtDate(data.dateLivraison);
    const dot = done
      ? '<i class="ph-bold ph-check" style="font-size:12px"></i>'
      : current
      ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="var(--terre)" stroke="none"><circle cx="12" cy="12" r="10"/></svg>'
      : "";
    return `
      <div class="tl-item ${cls}">
        <div class="tl-dot">${dot}</div>
        <div class="tl-content">
          <h4>${STEP_TITLES[step]}</h4>
          <span>${dateLabel}</span>
        </div>
      </div>`;
  }).join("");

  document.getElementById("codeDigitsSm").textContent = String(data.codeLivraison || "----")
    .split("")
    .join(" ");

  document.querySelector(".order-summary img").src = data.produitImage || PLACEHOLDER_IMG;
  document.querySelector(".order-summary h4").textContent = data.produitNom || "Produit";
  document.querySelector(".order-summary .info span").textContent = "Quantité : " + (data.quantite || 1);
  const total = data.prixConvenu != null ? data.prixConvenu : data.prixInitial || 0;
  document.querySelector(".order-summary .amt").textContent = fmtGNF(total) + " GNF";

  const delaiEl = document.getElementById("delaiEstimeText");
  if (data.delaiEstime) {
    delaiEl.textContent = "Livraison estimée : " + data.delaiEstime;
    delaiEl.hidden = false;
  } else {
    delaiEl.hidden = true;
  }

  const livRow = document.getElementById("livraisonRow");
  if (data.fraisLivraison > 0) {
    document.getElementById("livraisonFraisAmt").textContent = fmtGNF(data.fraisLivraison) + " GNF";
    livRow.hidden = false;
  } else {
    livRow.hidden = true;
  }

  const avisSection = document.getElementById("avisSection");
  if (data.statut === "livree") {
    avisSection.hidden = false;
    showAvisExistant(data.avisSoumis);
  } else {
    avisSection.hidden = true;
  }
}

// ---------- Avis client (note + commentaire) ----------
// L'état "déjà envoyé" vient directement du champ avisSoumis de la commande
// (écrit par la Cloud Function creerAvis dans la même transaction que
// l'avis public) — pas d'une requête séparée sur la collection avis, qui
// n'a jamais besoin de connaître commandeId côté client.
let selectedStars = 0;

function showAvisExistant(avisSoumis) {
  if (!avisSoumis) return;
  document.getElementById("avisForm").hidden = true;
  document.getElementById("avisDone").hidden = false;
  document.getElementById("avisDoneStars").textContent = "★".repeat(avisSoumis.note) + "☆".repeat(5 - avisSoumis.note);
  document.getElementById("avisDoneComment").textContent = avisSoumis.commentaire || "";
}

const starsInput = document.getElementById("starsInput");
const avisError = document.getElementById("avisError");
const avisSubmitBtn = document.getElementById("avisSubmitBtn");

function renderStars() {
  starsInput.querySelectorAll(".star-btn").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.star) <= selectedStars);
  });
}
starsInput?.addEventListener("click", (e) => {
  const btn = e.target.closest(".star-btn");
  if (!btn) return;
  selectedStars = Number(btn.dataset.star);
  renderStars();
});

avisSubmitBtn?.addEventListener("click", async () => {
  avisError.hidden = true;
  if (selectedStars < 1 || selectedStars > 5) {
    avisError.textContent = "Choisis une note de 1 à 5 étoiles.";
    avisError.hidden = false;
    return;
  }
  avisSubmitBtn.disabled = true;
  avisSubmitBtn.textContent = "Envoi…";
  try {
    const commentaire = document.getElementById("avisComment").value.trim();
    // produit/client ne sont plus envoyés par le client : la Cloud Function
    // les relit depuis la vraie commande côté serveur, pour ne jamais faire
    // confiance à un nom/produit arbitraire.
    await creerAvis({ commandeId: orderId, note: selectedStars, commentaire });
    document.getElementById("avisForm").hidden = true;
    document.getElementById("avisDone").hidden = false;
    document.getElementById("avisDoneStars").textContent = "★".repeat(selectedStars) + "☆".repeat(5 - selectedStars);
    document.getElementById("avisDoneComment").textContent = commentaire;
  } catch (err) {
    console.error(err);
    avisError.textContent = "Impossible d'enregistrer ton avis : " + (err.message || err.code || "réessaie.");
    avisError.hidden = false;
    avisSubmitBtn.disabled = false;
    avisSubmitBtn.textContent = "Envoyer mon avis";
  }
});

if (orderId) {
  onSnapshot(
    doc(db, "commandes", orderId),
    (snap) => {
      if (!snap.exists()) {
        resultCard.innerHTML = "<p>Commande introuvable.</p>";
        return;
      }
      render(snap.data());
    },
    () => {
      resultCard.innerHTML = "<p>Impossible de charger cette commande.</p>";
    }
  );
} else {
  // Pas d'id dans l'URL : recherche par numéro/téléphone pas encore
  // disponible (nécessite une Cloud Function de recherche sécurisée, les
  // règles Firestore interdisant les requêtes "list" publiques pour ne pas
  // exposer les codes de livraison — hors scope pour l'instant).
  resultCard.hidden = true;
}
