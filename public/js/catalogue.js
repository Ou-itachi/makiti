// Catalogue : /catalogue, /catalogue?q=…, /categorie/<slug> (réécrit vers
// cette page par firebase.json). Maquette : design-refonte/maquettes/Catalogue.html.
//
// Données Firestore (collection « produits », lecture publique) :
// • « Tout », tri récent, sans recherche ni filtre de prix : pages
//   successives orderBy(dateCreation) — taille de page selon le réseau —
//   et nombre exact via une requête de comptage (1 lecture) ;
// • une catégorie : where(infosGenerales.categorie == …) SANS orderBy (aucun
//   index composite à créer), tri fait ici ; plafond MAX_PRODUITS ;
// • recherche / tri ou filtre par prix sur « Tout » : tout le catalogue
//   (plafond MAX_PRODUITS) — Firestore ne fait ni recherche plein texte ni
//   tri sur un prix dont le champ varie selon le produit.
import {
  CATEGORY_LABEL, carteProduitHTML, carteSqueletteHTML, brancherCartes, chargerFirestore,
  nomProduit, categorieProduit, prixProduit, dateProduit, escapeHTML,
} from "./carte-produit.js";
import { filtresClient, descripteurFiltre } from "./produit-categories.js";
import { onCurrencyChange, refreshCurrencyPrices } from "./currency-display.js";
import { niveauReseau } from "./reseau.js";

const MAX_PRODUITS = 200;
const TAILLE_PAGE = { lent: 12, moyen: 24, rapide: 48 }[niveauReseau()] || 24;

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

const $ = (id) => document.getElementById(id);
const grille = $("grille"), compte = $("compte"), plus = $("plus");
const recherche = $("searchInput");

// ---------- État (reflété dans l'URL) ----------
const etat = {
  cat: null, // slug
  q: "",
  tri: "recent",
  prix: { min: null, max: null },
  filtres: {}, // { key: valeur }
};
function lireURL() {
  const slug = location.pathname.match(/^\/categorie\/([^/]+)\/?$/)?.[1] || null;
  etat.cat = slug && CATEGORY_LABEL[slug] ? slug : null;
  const p = new URLSearchParams(location.search);
  etat.q = (p.get("q") || "").trim().slice(0, 80);
  etat.tri = ["recent", "prix-asc", "prix-desc"].includes(p.get("tri")) ? p.get("tri") : "recent";
  etat.prix = { min: num(p.get("min")), max: num(p.get("max")) };
  etat.filtres = {};
}
function num(v) {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) && n >= 0 ? n : null;
}
function ecrireURL(remplacer = false) {
  const p = new URLSearchParams();
  if (etat.q) p.set("q", etat.q);
  if (etat.tri !== "recent") p.set("tri", etat.tri);
  if (etat.prix.min != null) p.set("min", etat.prix.min);
  if (etat.prix.max != null) p.set("max", etat.prix.max);
  const url = (etat.cat ? `/categorie/${etat.cat}` : "/catalogue") + (p.toString() ? `?${p}` : "");
  if (url !== location.pathname + location.search) history[remplacer ? "replaceState" : "pushState"]({}, "", url);
}

// ---------- SEO ----------
function majSEO() {
  const data = CATEGORY_SEO[etat.cat];
  const label = etat.cat ? CATEGORY_LABEL[etat.cat] : null;
  const url = etat.cat ? `https://bokki.shop/categorie/${etat.cat}` : "https://bokki.shop/catalogue";
  const titre = data?.title || "Bokki | Catalogue, paiement à la livraison en Guinée";
  const desc = data?.description || "Tous les produits Bokki : téléphones, ordinateurs, énergie solaire, mode… Commandez sans avance et payez en espèces à la livraison en Guinée.";
  document.title = etat.q ? `Recherche « ${etat.q} » | Bokki` : titre;
  const meta = (sel, v) => document.querySelector(sel)?.setAttribute("content", v);
  meta('meta[name="description"]', desc);
  meta('meta[property="og:title"]', titre);
  meta('meta[property="og:description"]', desc);
  meta('meta[property="og:url"]', url);
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.href = url;
  const sd = $("pageStructuredData");
  if (sd) {
    sd.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "BreadcrumbList", itemListElement: [
          { "@type": "ListItem", position: 1, name: "Accueil", item: "https://bokki.shop/" },
          { "@type": "ListItem", position: 2, name: label || "Catalogue", item: url },
        ] },
        { "@type": "CollectionPage", "@id": `${url}#collection`, name: titre, description: desc, url },
      ],
    });
  }
  const h1 = etat.q ? `Résultats pour « ${etat.q} »` : data?.heading || "Tous les produits";
  $("titre").textContent = h1;
  $("crumbCourant").textContent = etat.q ? "Recherche" : label || "Tous les produits";
  const intro = $("intro");
  intro.textContent = !etat.q && data ? data.intro : "";
  intro.hidden = !intro.textContent;
  document.querySelectorAll("#chips .chip").forEach((a) => {
    const on = (a.dataset.cat || null) === etat.cat;
    a.classList.toggle("on", on);
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  document.querySelectorAll(".hdr-nav a[data-cat]").forEach((a) => {
    const on = a.dataset.cat === etat.cat;
    a.classList.toggle("on", on);
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  if (recherche && document.activeElement !== recherche) recherche.value = etat.q;
}

// ---------- Données ----------
let source = { cle: null, produits: [], complet: false, curseur: null, total: null, enCours: null };
function cleSource() {
  const tout = !etat.q && etat.tri === "recent" && etat.prix.min == null && etat.prix.max == null;
  return etat.cat ? `cat:${etat.cat}` : tout ? "pages" : "tout";
}
async function charger(suite = false) {
  const cle = cleSource();
  if (!suite && source.cle === cle) return;
  if (!suite) {
    // Le jeu complet « tout » contient déjà la vue paginée : on le réutilise.
    if (cle === "pages" && source.cle === "tout") return;
    if (cle === "tout" && source.cle === "pages" && source.complet) { source.cle = "tout"; return; }
    source = { cle, produits: [], complet: false, curseur: null, total: null, enCours: null };
  }
  const { db, fs } = await chargerFirestore();
  const col = fs.collection(db, "produits");
  const courant = source;
  let snap;
  if (cle.startsWith("cat:")) {
    snap = await fs.getDocs(fs.query(col, fs.where("infosGenerales.categorie", "==", CATEGORY_LABEL[etat.cat]), fs.limit(MAX_PRODUITS)));
    courant.complet = true;
  } else if (cle === "tout") {
    snap = await fs.getDocs(fs.query(col, fs.orderBy("dateCreation", "desc"), fs.limit(MAX_PRODUITS)));
    courant.complet = true;
  } else {
    const clauses = [fs.orderBy("dateCreation", "desc")];
    if (courant.curseur) clauses.push(fs.startAfter(courant.curseur));
    clauses.push(fs.limit(TAILLE_PAGE));
    const [s, total] = await Promise.all([
      fs.getDocs(fs.query(col, ...clauses)),
      courant.total == null ? fs.getCountFromServer(col).then((c) => c.data().count).catch(() => null) : courant.total,
    ]);
    snap = s;
    courant.total = total;
    courant.curseur = snap.docs.at(-1) || courant.curseur;
    courant.complet = snap.docs.length < TAILLE_PAGE;
  }
  if (source !== courant) return; // une autre vue a été demandée entre-temps
  courant.produits.push(...snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  if (courant.complet) courant.total = courant.produits.length;
}

// ---------- Filtres ----------
function normaliser(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
function valeurChamp(p, desc) {
  if (desc.source === "infosGenerales") return p.infosGenerales?.[desc.key] ?? p[desc.key];
  return p.caracteristiques?.[desc.key];
}
function correspond(p) {
  if (etat.cat && categorieProduit(p) !== CATEGORY_LABEL[etat.cat]) return false;
  if (etat.q) {
    const texte = normaliser(`${nomProduit(p)} ${categorieProduit(p)} ${p.infosGenerales?.marque ?? ""}`);
    if (!normaliser(etat.q).split(/\s+/).every((mot) => texte.includes(mot))) return false;
  }
  const prix = prixProduit(p);
  if (etat.prix.min != null && prix < etat.prix.min) return false;
  if (etat.prix.max != null && prix > etat.prix.max) return false;
  for (const [key, val] of Object.entries(etat.filtres)) {
    const v = valeurChamp(p, descripteurFiltre(categorieProduit(p), key));
    if (Array.isArray(v) ? !v.map(String).includes(val) : String(v ?? "") !== val) return false;
  }
  return true;
}
function trier(liste) {
  const l = [...liste];
  if (etat.tri === "prix-asc") l.sort((a, b) => prixProduit(a) - prixProduit(b));
  else if (etat.tri === "prix-desc") l.sort((a, b) => prixProduit(b) - prixProduit(a));
  else l.sort((a, b) => dateProduit(b) - dateProduit(a));
  return l;
}

function renderPanneauFiltres() {
  const btn = $("btnFiltres"), panneau = $("panneauFiltres");
  const label = etat.cat && CATEGORY_LABEL[etat.cat];
  const champs = label ? filtresClient(label).filter((k) => k !== "prix").map((k) => descripteurFiltre(label, k)) : [];
  btn.hidden = !champs.length;
  if (!champs.length) { panneau.hidden = true; btn.setAttribute("aria-expanded", "false"); return; }
  const n = Object.keys(etat.filtres).length;
  $("nbFiltres").hidden = !n;
  $("nbFiltres").textContent = n;
  const produitsCat = source.produits.filter((p) => categorieProduit(p) === label);
  panneau.innerHTML = champs.map((desc) => {
    const valeurs = desc.options || [...new Set(produitsCat.flatMap((p) => {
      const v = valeurChamp(p, desc);
      return Array.isArray(v) ? v : [v];
    }).filter((v) => v != null && v !== ""))].sort((a, b) => (typeof a === "number" ? a - b : String(a).localeCompare(String(b), "fr")));
    const cur = etat.filtres[desc.key] || "";
    return `<label class="field"><span class="lbl">${escapeHTML(desc.label)}</span><select class="input" data-key="${escapeHTML(desc.key)}"><option value="">Tous</option>${valeurs
      .map((o) => `<option value="${escapeHTML(o)}"${String(o) === cur ? " selected" : ""}>${escapeHTML(o)}</option>`).join("")}</select></label>`;
  }).join("") + (n ? `<div class="actions"><button type="button" class="btn btn-secondary btn-sm" id="filtresEffacer">Effacer les filtres</button></div>` : "");
}

// ---------- Rendu ----------
let affiches = TAILLE_PAGE;
function render() {
  majSEO();
  renderPanneauFiltres();
  const prixActif = etat.prix.min != null || etat.prix.max != null;
  $("btnPrix").classList.toggle("on", prixActif);
  $("tri").value = etat.tri;
  const liste = trier(source.produits.filter(correspond));
  const exact = source.complet || cleSource() === "pages";
  const total = cleSource() === "pages" ? source.total ?? liste.length : liste.length;
  compte.textContent = `${total} produit${total > 1 ? "s" : ""}`;
  const visibles = cleSource() === "pages" ? liste : liste.slice(0, affiches);
  if (!liste.length) {
    const label = etat.cat && CATEGORY_LABEL[etat.cat];
    grille.innerHTML = `<div class="empty"><span class="ico ico-blue"><svg class="i i-lg" aria-hidden="true"><use href="/assets/icons.svg?v=2#${etat.q ? "i-search" : "i-package"}"/></svg></span>${
      etat.q || prixActif || Object.keys(etat.filtres).length
        ? "<b>Aucun produit ne correspond.</b><span>Essayez un autre mot ou retirez des filtres.</span>"
        : `<b>${label ? `${escapeHTML(label)} : bientôt disponible` : "Bientôt disponible"}</b><span>Dites-nous ce que vous cherchez, on le trouve pour vous.</span><a class="btn btn-primary btn-sm" href="/demande-produit">Faire une demande</a>`
    }</div>`;
  } else {
    grille.innerHTML = visibles.map((p, i) => carteProduitHTML(p, { eager: i < 2 })).join("");
  }
  grille.removeAttribute("aria-busy");
  const resteServeur = cleSource() === "pages" && !source.complet;
  plus.hidden = !(resteServeur || visibles.length < liste.length);
  if (!exact) compte.textContent = `${liste.length} produits affichés`;
}

async function actualiser({ remplacer = false, garderPage = false } = {}) {
  if (!garderPage) affiches = TAILLE_PAGE;
  ecrireURL(remplacer);
  majSEO();
  if (cleSource() !== source.cle && !(cleSource() === "pages" && source.cle === "tout")) {
    grille.setAttribute("aria-busy", "true");
    grille.innerHTML = Array.from({ length: 8 }, carteSqueletteHTML).join("");
    compte.textContent = "Chargement…";
  }
  try {
    await charger();
    render();
  } catch (err) {
    console.error("Catalogue indisponible", err);
    grille.removeAttribute("aria-busy");
    grille.innerHTML = '<div class="empty" role="alert"><b>Le catalogue est momentanément indisponible.</b><span>Vérifiez votre connexion puis réessayez.</span><button type="button" class="btn btn-secondary btn-sm" id="reessayer">Réessayer</button></div>';
    compte.textContent = "";
    source.cle = null;
  }
}

// ---------- Événements ----------
brancherCartes(grille, (id) => source.produits.find((p) => p.id === id));

grille.addEventListener("click", (e) => {
  if (e.target.id === "reessayer") actualiser({ remplacer: true });
});

function changerCategorie(slug) {
  etat.cat = slug;
  etat.filtres = {};
  actualiser();
}
document.addEventListener("click", (e) => {
  const a = e.target.closest("#chips a[data-cat], .hdr-nav a[data-cat]");
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  changerCategorie(a.dataset.cat || null);
  a.blur();
  if (a.closest(".hdr-nav")) window.scrollTo({ top: 0 });
});

$("tri").addEventListener("change", (e) => {
  etat.tri = e.target.value;
  actualiser();
});

function basculer(btnId, panneauId) {
  const btn = $(btnId), panneau = $(panneauId);
  const ouvrir = panneau.hidden;
  for (const [b, p] of [["btnPrix", "panneauPrix"], ["btnFiltres", "panneauFiltres"]]) {
    $(p).hidden = true;
    $(b).setAttribute("aria-expanded", "false");
  }
  panneau.hidden = !ouvrir;
  btn.setAttribute("aria-expanded", String(ouvrir));
  if (ouvrir) panneau.querySelector("input,select")?.focus();
}
$("btnPrix").addEventListener("click", () => {
  $("prixMin").value = etat.prix.min ?? "";
  $("prixMax").value = etat.prix.max ?? "";
  basculer("btnPrix", "panneauPrix");
});
$("btnFiltres").addEventListener("click", () => basculer("btnFiltres", "panneauFiltres"));
$("panneauPrix").addEventListener("submit", (e) => {
  e.preventDefault();
  etat.prix = { min: num($("prixMin").value), max: num($("prixMax").value) };
  basculer("btnPrix", "panneauPrix");
  actualiser();
});
$("prixEffacer").addEventListener("click", () => {
  etat.prix = { min: null, max: null };
  basculer("btnPrix", "panneauPrix");
  actualiser();
});
$("panneauFiltres").addEventListener("change", (e) => {
  const sel = e.target.closest("select[data-key]");
  if (!sel) return;
  if (sel.value) etat.filtres[sel.dataset.key] = sel.value;
  else delete etat.filtres[sel.dataset.key];
  render();
  $("panneauFiltres").querySelector(`select[data-key="${CSS.escape(sel.dataset.key)}"]`)?.focus();
});
$("panneauFiltres").addEventListener("click", (e) => {
  if (e.target.id !== "filtresEffacer") return;
  etat.filtres = {};
  render();
  $("btnFiltres").focus();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  for (const [b, p] of [["btnPrix", "panneauPrix"], ["btnFiltres", "panneauFiltres"]]) {
    if (!$(p).hidden) { $(p).hidden = true; $(b).setAttribute("aria-expanded", "false"); $(b).focus(); }
  }
});

plus.querySelector("button").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  if (cleSource() === "pages" && !source.complet) {
    btn.disabled = true;
    btn.textContent = "Chargement…";
    try { await charger(true); } catch (err) { console.error(err); }
    btn.disabled = false;
    btn.textContent = "Voir plus de produits";
  } else {
    affiches += TAILLE_PAGE;
  }
  render();
});

// Recherche du header : filtre en direct (déclenchée aussi par header-search.js).
let minuterie;
recherche?.addEventListener("input", () => {
  clearTimeout(minuterie);
  minuterie = setTimeout(() => {
    etat.q = recherche.value.trim().slice(0, 80);
    actualiser({ remplacer: true });
  }, 250);
});
document.addEventListener("bokki:recherche", () => {
  clearTimeout(minuterie);
  etat.q = (recherche?.value || "").trim().slice(0, 80);
  actualiser();
});

window.addEventListener("popstate", () => {
  lireURL();
  actualiser({ remplacer: true });
});
onCurrencyChange(() => refreshCurrencyPrices(grille));

lireURL();
actualiser({ remplacer: true });
