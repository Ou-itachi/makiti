import { db } from "./firebase-config.js";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

function fmtDate(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function stars(note) {
  const n = Math.max(0, Math.min(5, Math.round(note || 0)));
  return "★".repeat(n) + "☆".repeat(5 - n);
}

function initiales(nom) {
  return (nom || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("");
}

function escapeHTML(s) {
  const div = document.createElement("div");
  div.textContent = s == null ? "" : String(s);
  return div.innerHTML;
}

const listEl = document.getElementById("tList");
const emptyEl = document.getElementById("tEmpty");

onSnapshot(
  query(collection(db, "avis"), orderBy("dateCreation", "desc")),
  (snap) => {
    const avis = snap.docs.map((d) => d.data());

    const avgEl = document.getElementById("tAvg");
    const avgStarsEl = document.getElementById("tAvgStars");
    const countEl = document.getElementById("tCount");
    if (avis.length) {
      const moyenne = avis.reduce((sum, a) => sum + (a.note || 0), 0) / avis.length;
      avgEl.textContent = moyenne.toFixed(1);
      avgStarsEl.textContent = stars(moyenne);
      countEl.textContent = avis.length + " avis";
    } else {
      avgEl.textContent = "—";
      avgStarsEl.textContent = "☆☆☆☆☆";
      countEl.textContent = "0 avis";
    }

    const cards = avis
      .map(
        (a) => `
        <div class="t-card">
          <div class="t-card-head">
            <span class="t-card-stars">${stars(a.note)}</span>
            <span class="t-card-date">${fmtDate(a.dateCreation)}</span>
          </div>
          <p>${escapeHTML(a.commentaire) || "<em>Aucun commentaire laissé.</em>"}</p>
          <div class="t-card-foot">
            <div class="t-avatar">${escapeHTML(initiales(a.clientNom))}</div>
            <div>
              <h5>${escapeHTML(a.clientNom) || "Client Makiti"}</h5>
              <span>${escapeHTML(a.produitNom) || ""}</span>
            </div>
          </div>
        </div>`
      )
      .join("");

    listEl.querySelectorAll(".t-card").forEach((el) => el.remove());
    emptyEl.hidden = avis.length > 0;
    emptyEl.insertAdjacentHTML("afterend", cards);
  },
  (err) => {
    console.error(err);
    emptyEl.textContent = "Impossible de charger les avis pour le moment.";
    emptyEl.hidden = false;
  }
);
