import { functions } from "./firebase-config.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { getCodeCommande, getTelephoneCommande } from "./mes-commandes-store.js";
import { initPushNotifications } from "./push-notifications.js";
import { articlesDe, montantCommande } from "./commande-utils.js";
import { formatCurrencyFromGNF, moneyHTML, onCurrencyChange, refreshCurrencyPrices } from "./currency-display.js";

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const PLACEHOLDER_IMG =
  "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='150' height='150'%3E%3Crect width='150' height='150' fill='%2316233D'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-size='12' fill='%2393A4C3' text-anchor='middle' dominant-baseline='middle'%3EBokki%3C/text%3E%3C/svg%3E";
const obtenirSuiviCommande = httpsCallable(functions, "obtenirSuiviCommande");

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
  return formatCurrencyFromGNF(n);
}

const params = new URLSearchParams(location.search);
const orderId = params.get("id");
if (!orderId) {
  location.href = "index.html";
} else {
  document.getElementById("trackLink").href = "suivi.html?id=" + encodeURIComponent(orderId);
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
      <img src="${escapeHTML(a.image || PLACEHOLDER_IMG)}" alt="" loading="lazy" decoding="async"/>
      <div class="info">
        <h4>${escapeHTML(a.nom) || "Produit"}</h4>
        ${a.varianteLibelle ? `<span class="mc-variant">${escapeHTML(a.varianteLibelle)}</span>` : ""}
        <span>Quantité : ${a.quantite || 1}</span>
      </div>
      <span class="lprice">${moneyHTML(a.prixInitial)}</span>
    </div>`
    )
    .join("");
  const total = montantCommande(data);
  document.getElementById("recapTotal").innerHTML = moneyHTML(total);

  const delaiEl = document.getElementById("delaiEstimeText");
  if (data.delaiEstime) {
    delaiEl.textContent = "Livraison estimée : " + data.delaiEstime;
    delaiEl.hidden = false;
  } else {
    delaiEl.hidden = true;
  }
}

onCurrencyChange(() => refreshCurrencyPrices());

if (orderId) {
  const code = getCodeCommande(orderId);
  const telephone = getTelephoneCommande(orderId);
  if (!code || !telephone) {
    location.replace("suivi.html?id=" + encodeURIComponent(orderId));
  } else {
    obtenirSuiviCommande({ commandeId: orderId, code, telephone })
      .then(({ data }) => {
        render(data);
        initPushNotifications(orderId, data.codeLivraison, telephone, document.getElementById("enableNotifBtn"));
      })
      .catch((error) => {
        console.error("Chargement de la commande impossible :", error);
        location.replace("suivi.html?id=" + encodeURIComponent(orderId));
      });
  }
}

document.getElementById("copyBtn").addEventListener("click", () => {
  const num = document.getElementById("orderNum").textContent;
  navigator.clipboard?.writeText(num);
});
