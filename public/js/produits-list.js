import { db } from "./firebase-config.js";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

export const PLACEHOLDER_IMG =
  "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='500' height='500'%3E%3Crect width='500' height='500' fill='%2316233D'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-size='22' fill='%2393A4C3' text-anchor='middle' dominant-baseline='middle'%3EMakiti%3C/text%3E%3C/svg%3E";

export const CATEGORY_LABEL = {
  telephones: "Téléphones",
  ordinateurs: "Ordinateurs",
  televisions: "Télévisions",
  solaire: "Solaire",
  batteries: "Batteries",
  chaussures: "Chaussures",
};

export function fmtGNF(n) {
  return Math.round(n || 0).toLocaleString("fr-FR").replace(/,/g, " ");
}

function escapeHTML(s) {
  const div = document.createElement("div");
  div.textContent = s == null ? "" : String(s);
  return div.innerHTML;
}

export function cardHTML(p) {
  const img = (p.images && p.images[0]) || PLACEHOLDER_IMG;
  return `
    <article class="card" data-id="${p.id}">
      <div class="card-media">
        <span class="cod-tag">À LA LIVRAISON</span>
        <button class="card-fav" aria-label="Favoris"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/></svg></button>
        <img src="${escapeHTML(img)}" alt="${escapeHTML(p.nom)}"/>
      </div>
      <div class="card-body">
        <div class="card-cat">${escapeHTML(p.categorie)}</div>
        <h3>${escapeHTML(p.nom)}</h3>
        <div class="card-foot">
          <span class="price">${fmtGNF(p.prixVente)}<small>GNF</small></span>
          <button class="order-btn" data-id="${p.id}">Commander<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
        </div>
      </div>
    </article>`;
}

export function wireCardEvents(container) {
  container.querySelectorAll(".card[data-id]").forEach((card) => {
    const id = card.dataset.id;
    card.addEventListener("click", () => {
      location.href = `produit.html?id=${id}`;
    });
    const fav = card.querySelector(".card-fav");
    if (fav) fav.addEventListener("click", (e) => e.stopPropagation());
    const orderBtn = card.querySelector(".order-btn");
    if (orderBtn)
      orderBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        location.href = `produit.html?id=${id}`;
      });
  });
}

let produits = [];
let activeCat = null;

const prodGrid = document.getElementById("prodGrid");
const prodCount = document.getElementById("prodCount");
const searchInput = document.getElementById("searchInput");

function render() {
  const term = (searchInput.value || "").trim().toLowerCase();
  const list = produits.filter((p) => {
    if (activeCat && p.categorie !== CATEGORY_LABEL[activeCat]) return false;
    if (term && !(p.nom || "").toLowerCase().includes(term)) return false;
    return true;
  });
  prodGrid.innerHTML = list.length
    ? list.map(cardHTML).join("")
    : `<p style="grid-column:1/-1;text-align:center;color:var(--muted);padding:40px 0">Aucun produit ne correspond à votre recherche.</p>`;
  wireCardEvents(prodGrid);
  prodCount.textContent = `${list.length} produit${list.length !== 1 ? "s" : ""} disponible${list.length !== 1 ? "s" : ""}`;
}

if (searchInput) searchInput.addEventListener("input", render);

document.querySelectorAll("[data-cat]").forEach((el) => {
  el.addEventListener("click", () => {
    activeCat = el.dataset.cat;
    render();
  });
});

onSnapshot(query(collection(db, "produits"), orderBy("dateCreation", "desc")), (snap) => {
  produits = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  render();
});
