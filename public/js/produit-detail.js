import { db } from "./firebase-config.js";
import {
  doc,
  onSnapshot,
  collection,
  query,
  where,
  limit,
  getDocs,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const PLACEHOLDER_IMG =
  "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='500' height='500'%3E%3Crect width='500' height='500' fill='%2316233D'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-size='22' fill='%2393A4C3' text-anchor='middle' dominant-baseline='middle'%3EMakiti%3C/text%3E%3C/svg%3E";

const CATEGORY_SLUG = {
  "Téléphones": "telephones",
  Ordinateurs: "ordinateurs",
  "Télévisions": "televisions",
  Solaire: "solaire",
  Batteries: "batteries",
  Chaussures: "chaussures",
};

function fmtGNF(n) {
  return Math.round(n || 0).toLocaleString("fr-FR").replace(/,/g, " ");
}
function escapeHTML(s) {
  const div = document.createElement("div");
  div.textContent = s == null ? "" : String(s);
  return div.innerHTML;
}

const params = new URLSearchParams(location.search);
const productId = params.get("id");
if (!productId) {
  location.href = "index.html";
}

function similarCardHTML(p) {
  const img = (p.images && p.images[0]) || PLACEHOLDER_IMG;
  return `
    <article class="card" data-id="${p.id}">
      <div class="card-media">
        <span class="cod-tag">À LA LIVRAISON</span>
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

async function loadSimilar(categorie) {
  const similarSection = document.getElementById("similarSection");
  const similarGrid = document.getElementById("similarGrid");
  const snap = await getDocs(query(collection(db, "produits"), where("categorie", "==", categorie), limit(6)));
  const items = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((p) => p.id !== productId)
    .slice(0, 4);
  if (!items.length) {
    similarSection.hidden = true;
    return;
  }
  similarSection.hidden = false;
  similarGrid.innerHTML = items.map(similarCardHTML).join("");
  similarGrid.querySelectorAll(".card[data-id]").forEach((card) => {
    const id = card.dataset.id;
    card.addEventListener("click", () => (location.href = `produit.html?id=${id}`));
    const btn = card.querySelector(".order-btn");
    if (btn)
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        location.href = `produit.html?id=${id}`;
      });
  });
}

function render(data) {
  document.title = "Makiti — " + data.nom;

  const slug = CATEGORY_SLUG[data.categorie] || "";
  const crumbCat = document.getElementById("crumbCat");
  crumbCat.textContent = data.categorie;
  crumbCat.dataset.cat = slug;
  document.getElementById("crumbCurrent").textContent = data.nom;

  document.getElementById("pCat").textContent = data.categorie;
  document.getElementById("pTitle").textContent = (data.nom || "").toUpperCase();
  document.getElementById("pPrice").innerHTML = fmtGNF(data.prixVente) + "<small>GNF</small>";
  document.getElementById("pDesc").textContent = data.description || "";

  const inStock = (data.stock || 0) > 0;
  const pStock = document.getElementById("pStock");
  pStock.textContent = inStock ? `${data.stock} unités disponibles` : "Rupture de stock";
  pStock.classList.toggle("out", !inStock);
  const stockBadge = document.getElementById("stockBadge");
  stockBadge.textContent = inStock ? "EN STOCK" : "RUPTURE";
  stockBadge.classList.toggle("out", !inStock);

  const imgs = data.images && data.images.length ? data.images : [PLACEHOLDER_IMG];
  window.images = imgs;
  const thumbsEl = document.getElementById("thumbs");
  thumbsEl.innerHTML = imgs
    .map(
      (url, i) =>
        `<div class="gal-thumb${i === 0 ? " active" : ""}" onclick="setImg(${i},this)"><img src="${escapeHTML(url)}" alt=""/></div>`
    )
    .join("");
  window.thumbs = document.querySelectorAll(".gal-thumb");
  window.curImg = 0;
  document.getElementById("mainImg").src = imgs[0];

  window.qty = 1;
  document.getElementById("qtyVal").textContent = "1";

  document.getElementById("recapImg").src = imgs[0];
  document.getElementById("recapName").textContent = data.nom;
  document.getElementById("recapCat").textContent = data.categorie;
  window.modalUnit = data.prixVente || 0;
  window.modalQty = 1;
  if (typeof window.changeModalQty === "function") window.changeModalQty(0);

  loadSimilar(data.categorie);
}

onSnapshot(doc(db, "produits", productId), (snap) => {
  if (!snap.exists()) {
    location.href = "index.html";
    return;
  }
  render(snap.data());
});
