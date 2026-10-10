import { filtresClient, descripteurFiltre } from "./produit-categories.js";
import { ajouterArticle } from "./panier-store.js";

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
  const thumbnail = (p.imagesSmall && p.imagesSmall[0]) || img;
  const imageWidth = Number(p.imageWidths?.[0]);
  const responsiveSrcset = thumbnail !== img && imageWidth > 480 ? `srcset="${escapeHTML(thumbnail)} 480w, ${escapeHTML(img)} ${imageWidth}w" sizes="(max-width: 640px) 46vw, (max-width: 1024px) 30vw, 22vw"` : "";
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
const categoryPath = location.pathname.match(/^\/categorie\/([^/]+)\/?$/)?.[1] || null;
const categoryQuery = new URLSearchParams(location.search).get("categorie");
let activeCat = categoryPath || categoryQuery || null;
let activeFilters = {}; // { [key]: valeur } ou { prix: {min, max} }

const CATEGORY_SEO = {
  telephones: { title: "Téléphones en Guinée, paiement à la livraison | Bokki", heading: "Acheter un téléphone en Guinée", description: "Achetez un téléphone en Guinée avec Bokki : consultez les modèles disponibles, vérifiez votre appareil à la réception et payez le livreur en espèces." },
  ordinateurs: { title: "Ordinateurs en Guinée, paiement à la livraison | Bokki", heading: "Acheter un ordinateur en Guinée", description: "Découvrez les ordinateurs disponibles chez Bokki en Guinée. Comparez les caractéristiques, commandez sans avance et payez après vérification à la livraison." },
  tablettes: { title: "Tablettes en Guinée, paiement à la livraison | Bokki", heading: "Acheter une tablette en Guinée", description: "Parcourez les tablettes disponibles en Guinée sur Bokki. Les options et caractéristiques sont indiquées sur les fiches, avec paiement en espèces à la livraison." },
  televisions: { title: "Télévisions en Guinée, paiement à la livraison | Bokki", heading: "Acheter une télévision en Guinée", description: "Retrouvez les télévisions disponibles chez Bokki en Guinée. Consultez les caractéristiques et réglez votre achat au livreur après réception." },
  electronique: { title: "Électronique et solaire en Guinée | Bokki", heading: "Électronique et solaire en Guinée", description: "Découvrez les équipements électroniques et solaires proposés par Bokki en Guinée. Commandez sans avance et payez à la livraison après vérification." },
  energie: { title: "Énergie solaire en Guinée, paiement à la livraison | Bokki", heading: "Équipements d’énergie en Guinée", description: "Découvrez les panneaux solaires, batteries, onduleurs et kits d’énergie disponibles chez Bokki en Guinée. Commandez sans avance et payez à la livraison après vérification." },
  vetements: { title: "Vêtements en Guinée, paiement à la livraison | Bokki", heading: "Acheter des vêtements en Guinée", description: "Parcourez les vêtements disponibles chez Bokki en Guinée. Consultez chaque description, commandez sans avance et payez à la réception." },
  chaussures: { title: "Chaussures en Guinée, paiement à la livraison | Bokki", heading: "Acheter des chaussures en Guinée", description: "Trouvez des chaussures disponibles en Guinée sur Bokki. Vérifiez les détails et options sur les fiches puis payez en espèces à la livraison." },
  voitures: { title: "Voitures en Guinée | Bokki", heading: "Véhicules disponibles en Guinée", description: "Consultez les véhicules et annonces disponibles dans la catégorie voitures de Bokki en Guinée. Contactez l'équipe pour les détails avant toute commande." },
};

function updateCategorySEO(category) {
  const data = CATEGORY_SEO[category];
  const url = category ? `https://bokki.shop/categorie/${category}` : "https://bokki.shop/";
  const title = data?.title || "Bokki — électronique, solaire & mode livrés en Guinée · Paiement à la livraison";
  const description = data?.description || "Bokki — téléphones, ordinateurs, télévisions, panneaux solaires, mode et chaussures livrés partout en Guinée. Vérifiez le produit devant le livreur, payez à la livraison. Aucune avance.";
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
  if (heading && data) heading.textContent = title.split(" |")[0];
  else if (heading) heading.textContent = "Acheter en ligne par catégorie en Guinée";
  const descriptionNode = document.getElementById("category-guides-description");
  if (descriptionNode) descriptionNode.textContent = data?.description || "Parcourez le catalogue Bokki par univers. Les produits sont livrés en Guinée et le paiement se fait à la réception, après vérification.";
  const heroHeading = document.querySelector(".hero-copy h1");
  if (heroHeading) heroHeading.textContent = data?.heading || "ZÉRO AVANCE, LIVRAISON GRATUITE";
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
const PAGE_SIZE = 48;
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
        const clauses = [firestore.orderBy("dateCreation", "desc"), firestore.limit(PAGE_SIZE)];
        if (lastProductDoc) clauses.splice(1, 0, firestore.startAfter(lastProductDoc));
        const snap = await firestore.getDocs(firestore.query(firestore.collection(db, "produits"), ...clauses));
        lastProductDoc = snap.docs.at(-1) || lastProductDoc;
        catalogueHasMore = snap.docs.length === PAGE_SIZE;
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
