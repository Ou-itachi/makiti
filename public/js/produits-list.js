import { db } from "./firebase-config.js";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { filtresClient, descripteurFiltre, couleurHex } from "./produit-categories.js";

export const PLACEHOLDER_IMG =
  "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='500' height='500'%3E%3Crect width='500' height='500' fill='%2316233D'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-size='22' fill='%2393A4C3' text-anchor='middle' dominant-baseline='middle'%3EMakitti%3C/text%3E%3C/svg%3E";

export const CATEGORY_LABEL = {
  telephones: "Téléphones",
  ordinateurs: "Ordinateurs",
  televisions: "Télévisions",
  solaire: "Solaire",
  batteries: "Batteries",
  chaussures: "Chaussures",
  onduleurs: "Onduleurs",
  cables: "Câbles électriques",
  ventilateurs: "Ventilateurs",
  climatiseurs: "Climatiseurs",
  "machines-a-laver": "Machines à laver",
};

export function fmtGNF(n) {
  return Math.round(n || 0).toLocaleString("fr-FR").replace(/,/g, " ");
}

function escapeHTML(s) {
  const div = document.createElement("div");
  div.textContent = s == null ? "" : String(s);
  return div.innerHTML;
}

// Accesseurs compatibles ancien schéma plat (nom/categorie/prixVente) et
// nouveau schéma (infosGenerales/caracteristiques) — aucune migration de
// données n'est faite, ces replis évitent de casser le catalogue existant.
function nomAffiche(p) {
  return p.infosGenerales?.nom ?? p.nom ?? "";
}
function categorieAffichee(p) {
  return p.infosGenerales?.categorie ?? p.categorie ?? "";
}
function prixAffiche(p) {
  return p.caracteristiques?.prixMin ?? p.caracteristiques?.prix ?? p.prixVente ?? 0;
}
function valeurChamp(p, desc) {
  if (desc.source === "infosGenerales") return p.infosGenerales?.[desc.key] ?? p[desc.key];
  return p.caracteristiques?.[desc.key];
}

// Pastilles de couleur affichées sous l'image de la carte, avant même
// d'ouvrir la fiche produit (référence Back Market). Source : le tableau
// caracteristiques.couleur écrit par l'admin (une entrée par couleur ayant
// au moins une variante), pas la sous-collection variantes — la carte ne
// doit pas payer une lecture supplémentaire par produit juste pour ça.
function cardSwatchesHTML(p) {
  const couleurs = p.caracteristiques?.couleur;
  if (!Array.isArray(couleurs) || !couleurs.length) return "";
  const pastilles = couleurs
    .slice(0, 6)
    .map((c) => {
      const hex = couleurHex(c);
      const style = hex ? ` style="background:${hex}"` : "";
      const cls = hex ? "card-swatch" : "card-swatch card-swatch-fallback";
      return `<span class="${cls}"${style} title="${escapeHTML(c)}"></span>`;
    })
    .join("");
  return `<div class="card-swatches">${pastilles}</div>`;
}

export function cardHTML(p) {
  const img = (p.images && p.images[0]) || PLACEHOLDER_IMG;
  const nom = nomAffiche(p);
  const dePrix = p.caracteristiques?.prixMin != null ? "Dès " : "";
  const prix = prixAffiche(p);
  // NB : aucun champ "prix barré / promo" n'existe encore dans le schéma ni
  // dans le formulaire admin — ce rendu conditionnel est prêt à l'emploi
  // pour le jour où ce champ existera (caracteristiques.prixBarre), mais ne
  // s'affiche jamais tant que cette pièce n'est pas construite ailleurs.
  const prixBarre = p.caracteristiques?.prixBarre;
  const enPromo = typeof prixBarre === "number" && prixBarre > prix;
  return `
    <article class="card" data-id="${p.id}">
      <div class="card-media">
        <span class="cod-tag">À LA LIVRAISON</span>
        <button class="card-fav" aria-label="Favoris"><i class="ph ph-heart" style="font-size:15px"></i></button>
        <img src="${escapeHTML(img)}" alt="${escapeHTML(nom)}"/>
      </div>
      <div class="card-body">
        ${cardSwatchesHTML(p)}
        <div class="card-cat">${escapeHTML(categorieAffichee(p))}</div>
        <h3>${escapeHTML(nom)}</h3>
        <div class="card-foot">
          <div class="card-price-row">
            ${enPromo ? `<span class="price-old">${fmtGNF(prixBarre)}<small>GNF</small></span>` : ""}
            <span class="price">${dePrix}${fmtGNF(prix)}<small>GNF</small></span>
          </div>
          <button class="order-btn" data-id="${p.id}">Commander<i class="ph-bold ph-arrow-right" style="font-size:13px"></i></button>
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
let activeFilters = {}; // { [key]: valeur } ou { prix: {min, max} }

const prodGrid = document.getElementById("prodGrid");
const prodCount = document.getElementById("prodCount");
const searchInput = document.getElementById("searchInput");
const filterBar = document.getElementById("filterBarClient");

function produitsCategorie(catLabel) {
  return produits.filter((p) => categorieAffichee(p) === catLabel);
}

function matchesFilters(p) {
  return Object.entries(activeFilters).every(([key, val]) => {
    if (key === "prix") {
      const prix = prixAffiche(p);
      if (val.min != null && prix < val.min) return false;
      if (val.max != null && prix > val.max) return false;
      return true;
    }
    const desc = descripteurFiltre(categorieAffichee(p), key);
    const valeur = valeurChamp(p, desc);
    // Les dimensions de variante (stockage, couleur…) sont dénormalisées en
    // tableau sur le produit (une variante 128 Go ET une 256 Go coexistent) —
    // le filtre matche si l'une des valeurs correspond.
    if (Array.isArray(valeur)) return valeur.map(String).includes(val);
    return String(valeur ?? "") === val;
  });
}

function filterFieldHTML(desc, catLabel) {
  if (desc.key === "prix") {
    const cur = activeFilters.prix || {};
    return `
      <div class="filter-price" data-key="prix">
        <input type="number" min="0" placeholder="Min" value="${cur.min ?? ""}" data-bound="min"/>
        <span>—</span>
        <input type="number" min="0" placeholder="Max" value="${cur.max ?? ""}" data-bound="max"/>
      </div>`;
  }
  const valeursBrutes = produitsCategorie(catLabel).flatMap((p) => {
    const v = valeurChamp(p, desc);
    return Array.isArray(v) ? v : [v];
  });
  const options =
    desc.options ||
    [...new Set(valeursBrutes.filter((v) => v != null && v !== ""))].sort((a, b) =>
      typeof a === "number" ? a - b : String(a).localeCompare(String(b), "fr")
    );
  const current = activeFilters[desc.key] || "";
  return `
    <select data-key="${escapeHTML(desc.key)}">
      <option value="">${escapeHTML(desc.label)}</option>
      ${options.map((o) => `<option value="${escapeHTML(o)}" ${String(o) === current ? "selected" : ""}>${escapeHTML(o)}</option>`).join("")}
    </select>`;
}

function renderFilterBar() {
  if (!activeCat) {
    filterBar.hidden = true;
    filterBar.innerHTML = "";
    return;
  }
  const catLabel = CATEGORY_LABEL[activeCat];
  const fields = filtresClient(catLabel).slice(0, 6).map((key) => descripteurFiltre(catLabel, key));
  if (!fields.length) {
    filterBar.hidden = true;
    filterBar.innerHTML = "";
    return;
  }
  filterBar.hidden = false;
  const hasActive = Object.keys(activeFilters).length > 0;
  filterBar.innerHTML =
    fields.map((desc) => filterFieldHTML(desc, catLabel)).join("") +
    (hasActive ? `<button type="button" class="filter-reset" id="filterResetBtn">Réinitialiser</button>` : "");

  filterBar.querySelectorAll("select[data-key]").forEach((sel) => {
    sel.addEventListener("change", () => {
      if (sel.value) activeFilters[sel.dataset.key] = sel.value;
      else delete activeFilters[sel.dataset.key];
      renderFilterBar();
      render();
    });
  });
  filterBar.querySelectorAll(".filter-price input").forEach((input) => {
    input.addEventListener("change", () => {
      const min = filterBar.querySelector('.filter-price input[data-bound="min"]').value;
      const max = filterBar.querySelector('.filter-price input[data-bound="max"]').value;
      if (min || max) {
        activeFilters.prix = { min: min ? Number(min) : null, max: max ? Number(max) : null };
      } else {
        delete activeFilters.prix;
      }
      renderFilterBar();
      render();
    });
  });
  const resetBtn = document.getElementById("filterResetBtn");
  if (resetBtn)
    resetBtn.addEventListener("click", () => {
      activeFilters = {};
      renderFilterBar();
      render();
    });
}

function render() {
  const term = (searchInput.value || "").trim().toLowerCase();
  const list = produits.filter((p) => {
    if (activeCat && categorieAffichee(p) !== CATEGORY_LABEL[activeCat]) return false;
    if (term && !nomAffiche(p).toLowerCase().includes(term)) return false;
    if (activeCat && !matchesFilters(p)) return false;
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
    activeFilters = {};
    renderFilterBar();
    render();
  });
});

onSnapshot(query(collection(db, "produits"), orderBy("dateCreation", "desc")), (snap) => {
  produits = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderFilterBar();
  render();
});
