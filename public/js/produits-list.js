import { filtresClient, descripteurFiltre } from "./produit-categories.js";
import { ajouterArticle } from "./panier-store.js";
import { formatCurrencyFromGNF, moneyHTML, onCurrencyChange } from "./currency-display.js";
import { niveauReseau, reseauRapide } from "./reseau.js";

export const PLACEHOLDER_IMG =
  "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='500' height='500'%3E%3Crect width='500' height='500' fill='%2316233D'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-size='22' fill='%2393A4C3' text-anchor='middle' dominant-baseline='middle'%3EBokki%3C/text%3E%3C/svg%3E";

// slug (data-cat, URL) -> libellé de catégorie (valeur Firestore
// infosGenerales.categorie). Doit rester aligné avec PRODUIT_CATEGORIES
// (produit-categories.js) et CATEGORY_SLUG (produit-detail.js).
export const CATEGORY_LABEL = {
  telephones: "Téléphones",
  ordinateurs: "Ordinateurs",
  tablettes: "Tablettes",
  televisions: "Télévisions",
  electronique: "Électronique",
  energie: "Énergie",
  vetements: "Vêtements",
  chaussures: "Chaussures",
  voitures: "Voitures",
};

export function fmtGNF(n) {
  return formatCurrencyFromGNF(n);
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
  // Miniature 480 px seulement si elle garde la photo entière
  // (miniaturesEntieres) : les anciennes étaient recadrées en carré et
  // coupaient les côtés des photos larges (télés…). Sinon : l'originale.
  const thumbnail = (p.miniaturesEntieres && p.imagesSmall && p.imagesSmall[0]) || img;
  const imageWidth = Number(p.imageWidths?.[0]);
  // Sur un téléphone à écran haute densité, le srcset choisit presque
  // toujours l'originale (46vw × 3 > 480 px). Hors réseau rapide, la
  // vignette 480 px suffit largement pour une carte : on n'offre pas le choix.
  const responsiveSrcset = reseauRapide() && thumbnail !== img && imageWidth > 480 ? `srcset="${escapeHTML(thumbnail)} 480w, ${escapeHTML(img)} ${imageWidth}w" sizes="(max-width: 640px) 46vw, (max-width: 1024px) 30vw, 22vw"` : "";
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
        <img src="${escapeHTML(thumbnail)}" ${responsiveSrcset} alt="${escapeHTML(nom)}" width="480" height="480" loading="lazy" decoding="async"/>
        <button class="card-cart" data-id="${p.id}"${aVariantes ? ' data-variantes="1"' : ""} aria-label="${libelleCart}" title="${libelleCart}">
          <i class="ph-bold ph-shopping-cart" style="font-size:16px"></i>
        </button>
      </div>
      <div class="card-body">
        <h3>${escapeHTML(nom)}</h3>
        <div class="card-price-row">
          <span class="price">${dePrix}${moneyHTML(prix)}</span>
          ${enPromo ? `<span class="price-old">${moneyHTML(prixBarre)}</span>` : ""}
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
const categoryPath = location.pathname.match(/^\/categorie\/([^/]+)\/?$/)?.[1] || null;
const categoryQuery = new URLSearchParams(location.search).get("categorie");
let activeCat = categoryPath || categoryQuery || null;
let activeFilters = {}; // { [key]: valeur } ou { prix: {min, max} }

const CATEGORY_SEO = {
  telephones: { title: "Bokki | Téléphones à Conakry, paiement à la livraison", heading: "Acheter un téléphone en Guinée", description: "Bokki propose des téléphones en Guinée : comparez marque, mémoire, état et prix en GNF. Commandez sans avance et payez en espèces à la livraison.", intro: "Chez Bokki, comparez les téléphones selon leur modèle, capacité et état. Les fiches présentent les caractéristiques disponibles ; le paiement se fait en espèces à la livraison, sans avance." },
  ordinateurs: { title: "Bokki | Ordinateurs à Conakry, paiement à la livraison", heading: "Acheter un ordinateur en Guinée", description: "Bokki vous aide à trouver un ordinateur pour étudier, travailler ou la maison. Consultez les caractéristiques et prix, puis payez à la livraison, sans avance.", intro: "Pour étudier, travailler ou équiper la maison, comparez chez Bokki les ordinateurs par modèle et caractéristiques. Les prix sont affichés en GNF et le paiement se fait à la livraison." },
  tablettes: { title: "Bokki | Tablettes et paiement à la livraison", heading: "Acheter une tablette en Guinée", description: "Découvrez les tablettes Bokki en Guinée. Comparez modèles et options, commandez sans avance et payez en espèces à la réception.", intro: "Explorez chez Bokki les tablettes et leurs options pour trouver un format adapté à vos usages. Les détails et prix sont indiqués sur les fiches ; le paiement se fait à la livraison." },
  televisions: { title: "Bokki | Télévisions à Conakry et en Guinée", heading: "Acheter une télévision en Guinée", description: "Comparez chez Bokki les télévisions disponibles en Guinée : dimensions, caractéristiques et prix. Commandez sans avance et payez à la livraison.", intro: "Comparez les télévisions proposées par Bokki selon leurs dimensions et caractéristiques. La boutique livre à Conakry et en Guinée ; le paiement se fait à la livraison, sans avance." },
  electronique: { title: "Bokki | Électronique et accessoires", heading: "Électronique et accessoires en Guinée", description: "Bokki propose des équipements électroniques en Guinée. Consultez détails et prix en GNF, puis payez votre commande à la livraison.", intro: "La sélection électronique de Bokki rassemble des équipements pour différents usages. Consultez chaque description pour les détails, le prix et les conditions de livraison avant de commander." },
  energie: { title: "Bokki | Énergie solaire et équipements", heading: "Équipements d’énergie en Guinée", description: "Panneaux solaires, batteries et équipements d’énergie chez Bokki en Guinée. Consultez les caractéristiques et payez à la livraison, sans avance.", intro: "Chez Bokki, comparez les panneaux, batteries et équipements d’énergie selon les informations techniques indiquées sur chaque fiche. Le paiement s’effectue à la livraison." },
  vetements: { title: "Bokki | Vêtements avec livraison", heading: "Acheter des vêtements en Guinée", description: "Découvrez les vêtements proposés par Bokki en Guinée. Consultez tailles et détails sur chaque fiche, puis réglez à la réception.", intro: "Parcourez chez Bokki les vêtements disponibles et consultez les tailles, modèles et matières lorsqu’ils sont renseignés. Votre commande est payée à la réception en Guinée." },
  chaussures: { title: "Bokki | Chaussures avec paiement à la livraison", heading: "Acheter des chaussures en Guinée", description: "Trouvez des chaussures chez Bokki en Guinée et consultez les pointures indiquées. Commandez sans avance et payez à la livraison.", intro: "Choisissez chez Bokki vos chaussures en consultant les pointures et options précisées sur la fiche produit. La boutique livre en Guinée et le paiement intervient à la réception." },
  voitures: { title: "Bokki | Véhicules et annonces à Conakry", heading: "Véhicules disponibles en Guinée", description: "Consultez les véhicules proposés par Bokki en Guinée. Contactez l’équipe à Conakry pour confirmer les détails avant toute commande.", intro: "Consultez chez Bokki les informations et photos disponibles pour chaque véhicule. Les annonces peuvent nécessiter une confirmation : contactez notre équipe à Conakry avant toute démarche." },
};

function updateCategorySEO(category) {
  const data = CATEGORY_SEO[category];
  const url = category ? `https://bokki.shop/categorie/${category}` : "https://bokki.shop/";
  const title = data?.title || "Bokki : boutique en ligne à Conakry";
  const description = data?.description || "Bokki est une boutique en ligne pour commander téléphones, ordinateurs, solaire et mode en Guinée. Livraison à Conakry, paiement à la livraison sans avance.";
  document.title = title;
  const setMeta = (selector, value) => document.querySelector(selector)?.setAttribute("content", value);
  setMeta('meta[name="description"]', description);
  setMeta('meta[property="og:title"]', title);
  setMeta('meta[property="og:description"]', description);
  setMeta('meta[property="og:url"]', url);
  setMeta('meta[name="twitter:title"]', title);
  setMeta('meta[name="twitter:description"]', description);
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.href = url;
  const structuredData = document.getElementById("pageStructuredData");
  if (structuredData) {
    try {
      const schema = JSON.parse(structuredData.textContent);
      const breadcrumb = schema["@graph"]?.find((item) => item["@type"] === "BreadcrumbList");
      if (breadcrumb) breadcrumb.itemListElement = category
        ? [
            { "@type": "ListItem", position: 1, name: "Accueil", item: "https://bokki.shop/" },
            { "@type": "ListItem", position: 2, name: CATEGORY_LABEL[category], item: url },
          ]
        : [{ "@type": "ListItem", position: 1, name: "Accueil", item: url }];
      const collection = schema["@graph"]?.find((item) => item["@type"] === "CollectionPage");
      if (category) {
        const data = { "@type": "CollectionPage", "@id": `${url}#collection`, name: title, description, url };
        if (collection) Object.assign(collection, data);
        else schema["@graph"].push(data);
      } else if (collection) {
        schema["@graph"] = schema["@graph"].filter((item) => item !== collection);
      }
      structuredData.textContent = JSON.stringify(schema);
    } catch (error) {
      console.warn("Données structurées de catégorie indisponibles", error);
    }
  }
  const heading = document.querySelector("#category-guides-title");
  if (heading && data) heading.textContent = data.heading;
  else if (heading) heading.textContent = "Acheter en ligne par catégorie en Guinée";
  const descriptionNode = document.getElementById("category-guides-description");
  if (descriptionNode) descriptionNode.textContent = data?.intro || "Parcourez le catalogue Bokki par univers. Les produits sont livrés en Guinée et le paiement se fait à la réception, sans avance.";
  const heroHeading = document.querySelector(".hero-copy h1");
  if (heroHeading) heroHeading.textContent = data?.heading || "Bokki, boutique en ligne en Guinée";
}

function setCategoryRoute(category) {
  const route = category ? `/categorie/${category}` : "/";
  if (location.pathname !== route) history.pushState({}, "", route);
  updateCategorySEO(category);
}

if (activeCat && !CATEGORY_SEO[activeCat]) activeCat = null;
updateCategorySEO(activeCat);

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
const loadMoreWrap = document.getElementById("loadMoreWrap");
// Produits par page selon le réseau : moins de documents et d'images à
// télécharger avant que la grille s'affiche en connexion lente ("Voir plus"
// charge la suite).
const TAILLE_PAGE = { lent: 12, moyen: 24, rapide: 48 };
let lastProductDoc = null;
let catalogueHasMore = true;
let loadingMoreProducts = false;

// Le HTML et le SEO des routes catégories doivent s'activer sans attendre
// les SDK Firebase distants. Si le chargement réseau traîne, on remplace les
// squelettes par un message clair; un résultat Firestore tardif reste affiché.
const catalogueTimeout = window.setTimeout(() => {
  if (prodGrid?.dataset.catalogueReady === "true") return;
  prodGrid.innerHTML = '<p role="status" style="grid-column:1/-1;text-align:center;padding:40px 0">Le catalogue met plus de temps à répondre. Vous pouvez parcourir le site ou <a href="contact">contacter Bokki</a>.</p>';
  prodCount.textContent = "Chargement du catalogue…";
}, 6000);

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
  if (prodGrid.dataset.catalogueReady !== "true") {
    filterBar.hidden = true;
    return;
  }
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
  if (prodGrid.dataset.catalogueReady !== "true") return;
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
  prodCount.textContent = catalogueHasMore
    ? `${list.length} produit(s) affiché(s)`
    : `${list.length} produit${list.length !== 1 ? "s" : ""} disponible${list.length !== 1 ? "s" : ""}`;
  if (loadMoreWrap) {
    loadMoreWrap.hidden = !catalogueHasMore;
    const button = loadMoreWrap.querySelector("button");
    if (button) {
      button.disabled = loadingMoreProducts;
      button.textContent = loadingMoreProducts ? "Chargement…" : "Voir plus de produits";
    }
  }
}

onCurrencyChange(() => render());

if (searchInput) searchInput.addEventListener("input", render);

// Liens catégorie du menu (data-cat) ET puces de l'accueil (.cat-chip,
// data-cat vide = « Tout ») : même comportement, on tient les puces à jour.
document.querySelectorAll("[data-cat]").forEach((el) => {
  el.addEventListener("click", (event) => {
    event.preventDefault();
    activeCat = el.dataset.cat || null;
    setCategoryRoute(activeCat);
    activeFilters = {};
    syncCatChips();
    renderFilterBar();
    render();
    document.getElementById("produits")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

window.addEventListener("popstate", () => {
  const pathCategory = location.pathname.match(/^\/categorie\/([^/]+)\/?$/)?.[1];
  activeCat = pathCategory && CATEGORY_SEO[pathCategory] ? pathCategory : null;
  updateCategorySEO(activeCat);
  activeFilters = {};
  syncCatChips();
  renderFilterBar();
  render();
});

if (activeCat) {
  syncCatChips();
  document.querySelector("#produits")?.scrollIntoView({ block: "start" });
}

async function connecterCatalogue() {
  try {
    const [{ db }, firestore] = await Promise.all([
      import("./firebase-config.js"),
      import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js"),
    ]);
    async function chargerPage() {
      if (loadingMoreProducts || !catalogueHasMore) return;
      loadingMoreProducts = true;
      render();
      try {
        const taillePage = TAILLE_PAGE[niveauReseau()] || 24;
        const clauses = [firestore.orderBy("dateCreation", "desc"), firestore.limit(taillePage)];
        if (lastProductDoc) clauses.splice(1, 0, firestore.startAfter(lastProductDoc));
        const snap = await firestore.getDocs(firestore.query(firestore.collection(db, "produits"), ...clauses));
        lastProductDoc = snap.docs.at(-1) || lastProductDoc;
        catalogueHasMore = snap.docs.length === taillePage;
        produits.push(...snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        window.clearTimeout(catalogueTimeout);
        prodGrid.dataset.catalogueReady = "true";
        renderFilterBar();
        loadingMoreProducts = false;
        render();
      } catch (error) {
        loadingMoreProducts = false;
        throw error;
      }
    }
    loadMoreWrap?.querySelector("button")?.addEventListener("click", () => chargerPage().catch((error) => {
      console.error("Chargement du catalogue impossible", error);
      prodCount.textContent = "Impossible de charger la suite du catalogue. Réessayez.";
    }));
    await chargerPage();
  } catch (error) {
    window.clearTimeout(catalogueTimeout);
    console.error("Initialisation du catalogue impossible", error);
    prodGrid.dataset.catalogueReady = "error";
    prodGrid.innerHTML = '<p role="status" style="grid-column:1/-1;text-align:center;padding:40px 0">Le catalogue est momentanément indisponible. <a href="contact">Contactez Bokki</a>.</p>';
    prodCount.textContent = "Catalogue indisponible";
  }
}

connecterCatalogue();
