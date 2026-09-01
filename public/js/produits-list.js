import { db } from "./firebase-config.js";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { filtresClient, descripteurFiltre } from "./produit-categories.js";
import { ajouterArticle } from "./panier-store.js";

export const PLACEHOLDER_IMG =
  "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='500' height='500'%3E%3Crect width='500' height='500' fill='%2316233D'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-size='22' fill='%2393A4C3' text-anchor='middle' dominant-baseline='middle'%3EMakitti%3C/text%3E%3C/svg%3E";

// slug (data-cat, URL) -> libellé de catégorie (valeur Firestore
// infosGenerales.categorie). Doit rester aligné avec PRODUIT_CATEGORIES
// (produit-categories.js) et CATEGORY_SLUG (produit-detail.js).
export const CATEGORY_LABEL = {
  telephones: "Téléphones",
  ordinateurs: "Ordinateurs",
  tablettes: "Tablettes",
  televisions: "Télévisions",
  electronique: "Électronique",
  vetements: "Vêtements",
  chaussures: "Chaussures",
  voitures: "Voitures",
};

export function fmtGNF(n) {
  return Math.round(n || 0).toLocaleString("fr-FR").replace(/,/g, " ");
}

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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

// Carte produit calée sur la maquette FurniGo : fond gris clair, photo,
// nom, prix courant en gras + ancien prix barré si promo, et un bouton
// panier rond en bas à droite (ajout rapide, distinct du clic sur la carte
// qui ouvre la fiche). Pas d'étoiles/avis ici (uniquement sur la fiche),
// pas de cœur, pas de bouton « Commander » — comme la maquette. Le badge
// « À la livraison » (paiement à la livraison) reste, discret.
export function cardHTML(p) {
  const img = (p.images && p.images[0]) || PLACEHOLDER_IMG;
  const nom = nomAffiche(p);
  // Un produit à variantes n'a qu'un prix « à partir de » sur la carte
  // (caracteristiques.prixMin) — l'ajout rapide renvoie alors vers la fiche
  // pour choisir l'option (le serveur refuse une commande sans varianteId,
  // voir functions/resoudreArticle).
  const aVariantes = p.caracteristiques?.prixMin != null;
  const dePrix = aVariantes ? "Dès " : "";
  const prix = prixAffiche(p);
  // Champ optionnel caracteristiques.prixBarre (prix de référence avant
  // promo) : barré à côté du prix courant s'il est renseigné et supérieur.
  const prixBarre = p.caracteristiques?.prixBarre;
  const enPromo = typeof prixBarre === "number" && prixBarre > prix;
  const libelleCart = aVariantes ? "Choisir les options" : "Ajouter au panier";
  return `
    <article class="card" data-id="${p.id}">
      <div class="card-media">
        <span class="cod-tag">À LA LIVRAISON</span>
        <img src="${escapeHTML(img)}" alt="${escapeHTML(nom)}" loading="lazy"/>
        <button class="card-cart" data-id="${p.id}"${aVariantes ? ' data-variantes="1"' : ""} aria-label="${libelleCart}" title="${libelleCart}">
          <i class="ph-bold ph-shopping-cart" style="font-size:16px"></i>
        </button>
      </div>
      <div class="card-body">
        <h3>${escapeHTML(nom)}</h3>
        <div class="card-price-row">
          <span class="price">${dePrix}${fmtGNF(prix)}<small>GNF</small></span>
          ${enPromo ? `<span class="price-old">${fmtGNF(prixBarre)}</span>` : ""}
        </div>
      </div>
    </article>`;
}

export function wireCardEvents(container, onQuickAdd) {
  container.querySelectorAll(".card[data-id]").forEach((card) => {
    const id = card.dataset.id;
    card.addEventListener("click", () => {
      location.href = `produit.html?id=${id}`;
    });
    // Bouton panier rapide (rond, coin bas-droit) : ajoute au panier sans
    // ouvrir la fiche — sauf produit à variantes, qui renvoie vers la fiche
    // pour choisir l'option.
    const cartBtn = card.querySelector(".card-cart");
    if (cartBtn)
      cartBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (cartBtn.dataset.variantes) {
          location.href = `produit.html?id=${id}`;
          return;
        }
        onQuickAdd?.(id, cartBtn);
      });
  });
}

let produits = [];
let activeCat = null;
let activeFilters = {}; // { [key]: valeur } ou { prix: {min, max} }

// Ajout rapide au panier depuis une carte (produit sans variantes). Le
// prixUnitaire stocké localement n'est qu'indicatif pour l'affichage du
// panier — creerCommande recalcule toujours le prix côté serveur.
function quickAdd(produitId, btn) {
  const p = produits.find((x) => x.id === produitId);
  if (!p) return;
  ajouterArticle({
    produitId,
    varianteId: null,
    nom: nomAffiche(p),
    image: (p.images && p.images[0]) || PLACEHOLDER_IMG,
    prixUnitaire: prixAffiche(p),
    quantite: 1,
  });
  btn.classList.add("added");
  btn.innerHTML = '<i class="ph-bold ph-check" style="font-size:16px"></i>';
  clearTimeout(btn._resetTimer);
  btn._resetTimer = setTimeout(() => {
    btn.classList.remove("added");
    btn.innerHTML = '<i class="ph-bold ph-shopping-cart" style="font-size:16px"></i>';
  }, 1300);
}

const prodGrid = document.getElementById("prodGrid");
const prodCount = document.getElementById("prodCount");
const searchInput = document.getElementById("searchInput");
const searchGo = document.getElementById("searchGo");
const filterBar = document.getElementById("filterBarClient");
const catChips = document.getElementById("catChips");

// Puces de catégorie de l'accueil (« Tout / Téléphones / … », réf. maquette) :
// même rôle que les liens catégorie du menu (data-cat), en plus visible.
function syncCatChips() {
  if (!catChips) return;
  catChips.querySelectorAll(".cat-chip").forEach((c) => {
    c.classList.toggle("is-active", (c.dataset.cat || "") === (activeCat || ""));
  });
}

// Le bouton rond dans la barre de recherche du header : sur l'accueil, la
// grille filtre déjà en direct — on se contente d'amener la grille à l'écran.
if (searchGo) {
  searchGo.addEventListener("click", () => {
    document.getElementById("produits")?.scrollIntoView({ behavior: "smooth" });
    render();
  });
}

// Préremplissage depuis la barre de recherche du header sur une autre page
// (js/header-search.js renvoie ici avec ?q=... — cette page filtre déjà en
// direct à la frappe, il suffit de partir avec la valeur déjà en place).
const qParam = new URLSearchParams(location.search).get("q");
if (qParam && searchInput) searchInput.value = qParam;

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
    ? list.map((p) => cardHTML(p)).join("")
    : `<p style="grid-column:1/-1;text-align:center;color:var(--muted);padding:40px 0">Aucun produit ne correspond à votre recherche.</p>`;
  wireCardEvents(prodGrid, quickAdd);
  prodCount.textContent = `${list.length} produit${list.length !== 1 ? "s" : ""} disponible${list.length !== 1 ? "s" : ""}`;
}

if (searchInput) searchInput.addEventListener("input", render);

// Liens catégorie du menu (data-cat) ET puces de l'accueil (.cat-chip,
// data-cat vide = « Tout ») : même comportement, on tient les puces à jour.
document.querySelectorAll("[data-cat]").forEach((el) => {
  el.addEventListener("click", () => {
    activeCat = el.dataset.cat || null;
    activeFilters = {};
    syncCatChips();
    renderFilterBar();
    render();
  });
});

onSnapshot(query(collection(db, "produits"), orderBy("dateCreation", "desc")), (snap) => {
  produits = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderFilterBar();
  render();
});
