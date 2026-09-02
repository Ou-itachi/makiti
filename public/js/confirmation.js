import { db } from "./firebase-config.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { ajouterCommande } from "./mes-commandes-store.js";
import { initPushNotifications } from "./push-notifications.js";
import { articlesDe, montantCommande } from "./commande-utils.js";

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const PLACEHOLDER_IMG =
  "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='150' height='150'%3E%3Crect width='150' height='150' fill='%2316233D'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-size='12' fill='%2393A4C3' text-anchor='middle' dominant-baseline='middle'%3EBokki%3C/text%3E%3C/svg%3E";

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

function fmtGNF(n) {
  return Math.round(n || 0).toLocaleString("fr-FR").replace(/,/g, " ");
}

const params = new URLSearchParams(location.search);
const orderId = params.get("id");
if (!orderId) {
  location.href = "index.html";
} else {
  document.getElementById("trackLink").href = "suivi.html?id=" + encodeURIComponent(orderId);
  ajouterCommande(orderId);
}

function render(data) {
  document.getElementById("orderNum").textContent = data.numero || "—";
  document.getElementById("codeDigits").textContent = String(data.codeLivraison || "----")
    .split("")
    .join(" ");
  document.getElementById("statusPill").textContent = STATUT_LABEL[data.statut] || data.statut;

  const currentStep = STATUT_TO_STEP[data.statut] || "recue";
  const currentIdx = STEP_ORDER.indexOf(currentStep);
  document.querySelectorAll("#steps .step").forEach((el) => {
    const idx = STEP_ORDER.indexOf(el.dataset.step);
    el.classList.toggle("done", idx <= currentIdx);
  });

  const articles = articlesDe(data);
  document.getElementById("recapLines").innerHTML = articles
    .map(
      (a) => `
    <div class="recap-line">
      <img src="${escapeHTML(a.image || PLACEHOLDER_IMG)}" alt=""/>
      <div class="info">
        <h4>${escapeHTML(a.nom) || "Produit"}</h4>
        ${a.varianteLibelle ? `<span class="mc-variant">${escapeHTML(a.varianteLibelle)}</span>` : ""}
        <span>Quantité : ${a.quantite || 1}</span>
      </div>
      <span class="lprice">${fmtGNF(a.prixInitial)}</span>
    </div>`
    )
    .join("");
  const total = montantCommande(data);
  document.getElementById("recapTotal").textContent = fmtGNF(total) + " GNF";

  const delaiEl = document.getElementById("delaiEstimeText");
  if (data.delaiEstime) {
    delaiEl.textContent = "Livraison estimée : " + data.delaiEstime;
    delaiEl.hidden = false;
  } else {
    delaiEl.hidden = true;
  }
}

if (orderId) {
  onSnapshot(
    doc(db, "commandes", orderId),
    (snap) => {
      if (!snap.exists()) {
        location.href = "index.html";
        return;
      }
      const data = snap.data();
      render(data);
      initPushNotifications(orderId, data.codeLivraison, document.getElementById("enableNotifBtn"));
    },
    () => {
      location.href = "index.html";
    }
  );
}

document.getElementById("copyBtn").addEventListener("click", () => {
  const num = document.getElementById("orderNum").textContent;
  navigator.clipboard?.writeText(num);
});
