import { db } from "./firebase-config.js";
import {
  doc,
  onSnapshot,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { categorieConfig, couleurHex } from "./produit-categories.js";

const AVIS_PREVIEW_COUNT = 2;

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

// Accesseurs compatibles ancien schéma plat (nom/categorie/prixVente/stock)
// et nouveau schéma (infosGenerales/caracteristiques) — aucune migration de
// données n'est faite, ces replis évitent de casser les produits existants.
function nomAffiche(data) {
  return data.infosGenerales?.nom ?? data.nom ?? "";
}
function categorieAffichee(data) {
  return data.infosGenerales?.categorie ?? data.categorie ?? "";
}
function descriptionAffichee(data) {
  return data.infosGenerales?.description ?? data.description ?? "";
}
function prixSansVariante(data) {
  return data.caracteristiques?.prix ?? data.prixVente ?? 0;
}
function stockSansVariante(data) {
  return data.caracteristiques?.stock ?? data.stock ?? 0;
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

function fmtAvisDate(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
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
        <img src="${escapeHTML(img)}" alt="${escapeHTML(nomAffiche(p))}"/>
      </div>
      <div class="card-body">
        <div class="card-cat">${escapeHTML(categorieAffichee(p))}</div>
        <h3>${escapeHTML(nomAffiche(p))}</h3>
        <div class="card-foot">
          <span class="price">${fmtGNF(p.caracteristiques?.prixMin ?? prixSansVariante(p))}<small>GNF</small></span>
          <button class="order-btn" data-id="${p.id}">Commander<i class="ph-bold ph-arrow-right" style="font-size:13px"></i></button>
        </div>
      </div>
    </article>`;
}

async function loadSimilar(categorie) {
  const similarSection = document.getElementById("similarSection");
  const similarGrid = document.getElementById("similarGrid");
  // Ne retrouve que les produits déjà écrits dans le nouveau schéma (pas de
  // migration des anciens produits dans ce ticket — limitation connue).
  const snap = await getDocs(
    query(collection(db, "produits"), where("infosGenerales.categorie", "==", categorie), limit(6))
  );
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

function avisCardHTML(a) {
  return `
    <div class="t-card">
      <div class="t-card-head">
        <span class="t-card-stars">${stars(a.note)}</span>
        <span class="t-card-date">${fmtAvisDate(a.dateCreation)}</span>
      </div>
      <p>${escapeHTML(a.commentaire) || "<em>Aucun commentaire laissé.</em>"}</p>
      <div class="t-card-foot">
        <div class="t-avatar">${escapeHTML(initiales(a.clientNom))}</div>
        <div><h5>${escapeHTML(a.clientNom) || "Client Makiti"}</h5></div>
      </div>
    </div>`;
}

let reviewsExpanded = false;

function renderReviews(avis) {
  const section = document.getElementById("reviewsSection");
  const list = document.getElementById("reviewsList");
  const moreBtn = document.getElementById("reviewsMoreBtn");
  const rating = document.getElementById("pRating");

  if (!avis.length) {
    section.hidden = true;
    rating.hidden = true;
    return;
  }

  const moyenne = avis.reduce((sum, a) => sum + (a.note || 0), 0) / avis.length;
  rating.hidden = false;
  document.getElementById("pRatingStars").textContent = stars(moyenne);
  document.getElementById("pRatingText").textContent =
    moyenne.toFixed(1) + " sur 5 · " + avis.length + " avis";

  section.hidden = false;
  const visible = reviewsExpanded ? avis : avis.slice(0, AVIS_PREVIEW_COUNT);
  list.innerHTML = visible.map(avisCardHTML).join("");

  if (avis.length > AVIS_PREVIEW_COUNT && !reviewsExpanded) {
    moreBtn.hidden = false;
    moreBtn.innerHTML =
      "Voir les " + (avis.length - AVIS_PREVIEW_COUNT) + " autres avis " +
      '<i class="ph-bold ph-caret-down" style="font-size:13px"></i>';
  } else {
    moreBtn.hidden = true;
  }
}

let currentAvis = [];
document.getElementById("reviewsMoreBtn")?.addEventListener("click", () => {
  reviewsExpanded = true;
  renderReviews(currentAvis);
});

function loadReviews(prodId) {
  onSnapshot(
    query(collection(db, "avis"), where("produitId", "==", prodId), orderBy("dateCreation", "desc")),
    (snap) => {
      currentAvis = snap.docs.map((d) => d.data());
      renderReviews(currentAvis);
    },
    (err) => console.error(err)
  );
}

// ---------- Caractéristiques (essentiel/secondaire dynamiques) ----------
function specRows(data, config) {
  const infos = data.infosGenerales || {};
  const car = data.caracteristiques || {};
  const dimKeys = new Set((config?.variantes?.dimensions || []).map((d) => d.key));
  const rows = [];
  if (infos.marque) rows.push(["Marque", infos.marque]);
  if (infos.modele) rows.push(["Modèle", infos.modele]);
  if (infos.etat) rows.push(["État", infos.etat]);
  (config?.essentiel || []).forEach((f) => {
    if (dimKeys.has(f.key)) return; // déjà affiché par le sélecteur de variantes
    if (car[f.key]) rows.push([f.label, car[f.key]]);
  });
  (config?.secondaire || []).forEach((f) => {
    if (car[f.key]) rows.push([f.label, car[f.key]]);
  });
  if (infos.garantie) rows.push(["Garantie", infos.garantie]);
  return rows;
}

function renderSpecsTab(data, config) {
  const tab0 = document.getElementById("tab-0");
  const emptyEl = document.getElementById("specsEmpty");
  tab0.querySelectorAll(".spec-row").forEach((el) => el.remove());
  const rows = specRows(data, config);
  if (!rows.length) {
    emptyEl.style.display = "block";
    return;
  }
  emptyEl.style.display = "none";
  emptyEl.insertAdjacentHTML(
    "beforebegin",
    rows.map(([l, v]) => `<div class="spec-row"><span>${escapeHTML(l)}</span><span>${escapeHTML(v)}</span></div>`).join("")
  );
}

// ---------- Sélecteur de variantes (chaque combinaison a son propre prix + stock) ----------
let currentProductData = null;
let currentCategorieConfig = null;
let variantesList = [];
let selectedOptions = {};

function dimensions() {
  return currentCategorieConfig?.variantes?.dimensions || [];
}

function resolveVariante() {
  const dims = dimensions();
  if (!dims.length || dims.some((d) => !selectedOptions[d.key])) return null;
  return variantesList.find((v) => dims.every((d) => v.options?.[d.key] === selectedOptions[d.key])) || null;
}

function combinaisonPossible(dimKey, valeur) {
  // Une option est disponible s'il existe au moins une variante EN STOCK qui
  // combine cette valeur avec les autres dimensions déjà choisies — une
  // combinaison inexistante et une combinaison en rupture sont toutes les
  // deux "indisponibles" pour le client.
  return variantesList.some((v) => {
    if (v.options?.[dimKey] !== valeur) return false;
    if ((v.stock || 0) <= 0) return false;
    return Object.entries(selectedOptions).every(([k, val]) => k === dimKey || v.options?.[k] === val);
  });
}

function renderVariantPicker() {
  const picker = document.getElementById("variantPicker");
  // "couleur" est représentée par les pastilles juste sous le prix, pas ici.
  const dims = dimensions().filter((d) => d.key !== "couleur");
  if (!dims.length) {
    picker.hidden = true;
    return;
  }
  picker.hidden = false;
  picker.innerHTML = dims
    .map((dim) => {
      const valeurs = [...new Set(variantesList.map((v) => v.options?.[dim.key]).filter(Boolean))];
      const pills = valeurs
        .map((valeur) => {
          const active = selectedOptions[dim.key] === valeur;
          const dispo = combinaisonPossible(dim.key, valeur);
          const cls = ["variant-pill", active ? "active" : "", !dispo ? "unavailable" : ""].filter(Boolean).join(" ");
          const contenu = dispo
            ? escapeHTML(valeur)
            : `<span class="vp-val">${escapeHTML(valeur)}</span><span class="vp-tag">indisponible</span>`;
          return `<button type="button" class="${cls}" data-dim="${escapeHTML(dim.key)}" data-val="${escapeHTML(valeur)}" ${!dispo ? "disabled" : ""}>${contenu}</button>`;
        })
        .join("");
      return `<div class="variant-dim"><span class="vd-label">${escapeHTML(dim.label)}</span><div class="vd-options">${pills}</div></div>`;
    })
    .join("");

  picker.querySelectorAll(".variant-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedOptions[btn.dataset.dim] = btn.dataset.val;
      renderVariantPicker();
      renderCouleurSwatches();
      updatePriceStockCTA();
    });
  });
}

// ---------- Pastilles de couleur (juste sous le prix, avec image liée) ----------
function imageForCouleur(valeur) {
  const withImage = variantesList.find((v) => v.options?.couleur === valeur && v.image);
  return withImage?.image || currentProductData?.images?.[0] || PLACEHOLDER_IMG;
}

function renderCouleurSwatches() {
  const box = document.getElementById("couleurSwatches");
  const aCouleur = dimensions().some((d) => d.key === "couleur");
  if (!aCouleur) {
    box.hidden = true;
    return;
  }
  const valeurs = [...new Set(variantesList.map((v) => v.options?.couleur).filter(Boolean))];
  if (!valeurs.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.innerHTML = valeurs
    .map((valeur) => {
      const active = selectedOptions.couleur === valeur;
      const dispo = combinaisonPossible("couleur", valeur);
      const hex = couleurHex(valeur);
      const cls = ["couleur-swatch", active ? "active" : "", !dispo ? "unavailable" : "", !hex ? "couleur-swatch-fallback" : ""]
        .filter(Boolean)
        .join(" ");
      const style = hex ? ` style="background:${hex}"` : "";
      const titre = dispo ? valeur : `${valeur} — indisponible`;
      return `<button type="button" class="${cls}"${style} data-val="${escapeHTML(valeur)}" title="${escapeHTML(titre)}" ${!dispo ? "disabled" : ""}>${hex ? "" : escapeHTML(valeur)}</button>`;
    })
    .join("");

  box.querySelectorAll(".couleur-swatch").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedOptions.couleur = btn.dataset.val;
      renderCouleurSwatches();
      renderVariantPicker();
      updatePriceStockCTA();
      const url = imageForCouleur(btn.dataset.val);
      const mainImg = document.getElementById("mainImg");
      const recapImg = document.getElementById("recapImg");
      if (mainImg) mainImg.src = url;
      if (recapImg) recapImg.src = url;
    });
  });
}

function updatePriceStockCTA() {
  const pPrice = document.getElementById("pPrice");
  const pStock = document.getElementById("pStock");
  const stockBadge = document.getElementById("stockBadge");
  const orderBtn = document.querySelector(".order-cta");
  const recapVariante = document.getElementById("recapVariante");
  const data = currentProductData;
  if (!data) return;

  const dims = dimensions();
  if (dims.length) {
    const resolved = resolveVariante();
    if (resolved) {
      const inStock = (resolved.stock || 0) > 0;
      pPrice.innerHTML = fmtGNF(resolved.prix) + "<small>GNF</small>";
      pStock.textContent = inStock ? `${resolved.stock} unités disponibles` : "Rupture pour cette combinaison";
      pStock.classList.toggle("out", !inStock);
      stockBadge.textContent = inStock ? "EN STOCK" : "RUPTURE";
      stockBadge.classList.toggle("out", !inStock);
      orderBtn.disabled = !inStock;
      window.modalUnit = resolved.prix;
      window.modalVarianteId = resolved.id;
      window.modalVarianteRequired = true;
      // La combinaison choisie (ex. "128 Go · Noir") reste visible dans la
      // boîte de dialogue de commande, pas seulement sur la fiche produit —
      // le client doit pouvoir vérifier ce qu'il commande avant de confirmer.
      recapVariante.textContent = resolved.libelle || "";
      recapVariante.hidden = !resolved.libelle;
    } else {
      const prix = variantesList.length ? Math.min(...variantesList.map((v) => v.prix || 0)) : 0;
      pPrice.innerHTML = "Dès " + fmtGNF(prix) + "<small>GNF</small>";
      pStock.textContent = "Choisissez les options ci-dessus pour voir la disponibilité";
      pStock.classList.remove("out");
      stockBadge.textContent = "OPTIONS";
      stockBadge.classList.remove("out");
      orderBtn.disabled = true;
      window.modalUnit = prix;
      window.modalVarianteId = null;
      window.modalVarianteRequired = true;
      recapVariante.hidden = true;
    }
    if (typeof window.updateModalTotal === "function") window.updateModalTotal();
    return;
  }

  const prix = prixSansVariante(data);
  const stock = stockSansVariante(data);
  const inStock = stock > 0;
  recapVariante.hidden = true;
  pPrice.innerHTML = fmtGNF(prix) + "<small>GNF</small>";
  pStock.textContent = inStock ? `${stock} unités disponibles` : "Rupture de stock";
  pStock.classList.toggle("out", !inStock);
  stockBadge.textContent = inStock ? "EN STOCK" : "RUPTURE";
  stockBadge.classList.toggle("out", !inStock);
  orderBtn.disabled = false;
  window.modalUnit = prix;
  window.modalVarianteId = null;
  window.modalVarianteRequired = false;
  if (typeof window.updateModalTotal === "function") window.updateModalTotal();
}

function loadVariantes(prodId) {
  onSnapshot(collection(db, "produits", prodId, "variantes"), (snap) => {
    variantesList = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    selectedOptions = {};
    renderVariantPicker();
    renderCouleurSwatches();
    updatePriceStockCTA();
  });
}

function render(data) {
  currentProductData = data;
  currentCategorieConfig = categorieConfig(categorieAffichee(data));

  const nom = nomAffiche(data);
  const categorie = categorieAffichee(data);

  document.title = "Makiti — " + nom;

  const slug = CATEGORY_SLUG[categorie] || "";
  const crumbCat = document.getElementById("crumbCat");
  crumbCat.textContent = categorie;
  crumbCat.dataset.cat = slug;
  document.getElementById("crumbCurrent").textContent = nom;

  document.getElementById("pCat").textContent = categorie;
  document.getElementById("pTitle").textContent = nom.toUpperCase();
  document.getElementById("pDesc").textContent = descriptionAffichee(data);

  renderSpecsTab(data, currentCategorieConfig);
  renderVariantPicker();
  renderCouleurSwatches();
  updatePriceStockCTA();

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
  document.getElementById("recapName").textContent = nom;
  document.getElementById("recapCat").textContent = categorie;
  window.modalQty = 1;
  if (typeof window.changeModalQty === "function") window.changeModalQty(0);

  loadSimilar(categorie);
}

if (productId) {
  onSnapshot(doc(db, "produits", productId), (snap) => {
    if (!snap.exists()) {
      location.href = "index.html";
      return;
    }
    render(snap.data());
  });
  loadVariantes(productId);
  loadReviews(productId);
}
