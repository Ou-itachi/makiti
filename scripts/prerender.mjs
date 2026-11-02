#!/usr/bin/env node
// Pré-rendu (mise à jour n°1, point 3) : écrit le contenu du catalogue
// directement dans le HTML, pour un affichage sans attendre Firebase.
//
//   node scripts/prerender.mjs             avant chaque déploiement
//   node scripts/prerender.mjs --nettoyer  après (index.html redevient tel
//                                          qu'enregistré dans git)
//   (lancés automatiquement : « predeploy » / « postdeploy » de firebase.json)
//
// • Lecture SEULE de Firestore, par l'API REST publique : exactement les
//   données que lit déjà le navigateur (mêmes règles de sécurité, aucun
//   identifiant d'administrateur, aucune écriture possible).
// • Accueil (public/index.html) : les cartes de « Sélection du moment »
//   (8 produits, comme aujourd'hui) + 20 produits en JSON.
// • Catégories : public/categorie/<slug>.html (20 premiers produits).
// • Fiches : public/produit/<id>.html (nom, prix, photos, description,
//   caractéristiques, variantes et avis en JSON).
// • Chaque page reçoit <script type="application/json" id="bk-data"> :
//   donnees.js l'affiche tout de suite, puis relit Firestore en arrière-plan.
//   Le prix d'une commande est TOUJOURS recalculé par le serveur.
// • Les cartes sont produites par la même fonction que dans le navigateur
//   (public/js/carte-produit.js) : rendu identique.
//
// En cas d'échec réseau, rien n'est modifié (les pages restent valides :
// le JavaScript charge alors les produits comme avant).
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(RACINE, "public");
const API = "https://firestore.googleapis.com/v1/projects/makiti-gn/databases/(default)/documents";
const SITE = "https://bokki.shop";
const NB_ACCUEIL = 8; // cartes affichées sur l'accueil (accueil.js : NOMBRE)
const NB_JSON_ACCUEIL = 20;
const NB_CATEGORIE = 20;
const NB_EAGER = 4; // premières photos : chargement prioritaire

const RAIL_VIDE = '<div class="rail" id="selection" aria-busy="true"><!--pr:selection--><!--/pr:selection--></div>';
if (process.argv.includes("--nettoyer")) {
  const f = join(PUBLIC, "index.html");
  const html = readFileSync(f, "utf8")
    .replace(/<div class="rail" id="selection"[^>]*><!--pr:selection-->[\s\S]*?<!--\/pr:selection--><\/div>/, RAIL_VIDE)
    .replace(/<!--pr:donnees-->[\s\S]*?<!--\/pr:donnees-->\n/, "")
    .replace(/<script data-pr-installer>[\s\S]*?<\/script>/, '<script src="/js/ios-install-prompt.js"></script>');
  writeFileSync(f, html);
  console.log("✓ Pré-rendu retiré de index.html (pages produit/catégorie gardées, ignorées par git).");
  process.exit(0);
}
// ---------- Environnement minimal pour les modules du navigateur ----------
// Seul Firestore est joignable : currency-display.js ne doit pas détecter le
// pays de la machine qui lance le script (les prix restent en GNF, devise
// par défaut ; le navigateur convertit ensuite selon le visiteur).
const vraiFetch = globalThis.fetch;
globalThis.fetch = (url, options) => String(url).startsWith(API) ? vraiFetch(url, options) : new Promise(() => {}); // jamais résolu : rien à afficher, rien à attendre
const memoire = {};
globalThis.localStorage = { getItem: (k) => memoire[k] ?? null, setItem: (k, v) => { memoire[k] = String(v); }, removeItem: (k) => { delete memoire[k]; } };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.location = new URL(SITE + "/");
globalThis.window = globalThis;
Object.defineProperty(globalThis, "navigator", { value: { onLine: true, connection: { effectiveType: "3g", saveData: false } }, configurable: true });
globalThis.addEventListener = () => {};
globalThis.dispatchEvent = () => {};
globalThis.CustomEvent = class { constructor(t) { this.type = t; } };
const elementFactice = () => ({ setAttribute() {}, append() {}, appendChild() {}, remove() {}, classList: { add() {}, remove() {}, toggle() {} }, style: {}, dataset: {} });
globalThis.document = {
  addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
  createElement: elementFactice, documentElement: { dataset: {}, lang: "fr" }, body: elementFactice(), head: elementFactice(),
};
const importer = (f) => import(pathToFileURL(join(PUBLIC, "js", f)).href);
const carte = await importer("carte-produit.js");
const { categorieConfig } = await importer("produit-categories.js");
const { moneyHTML } = await importer("currency-display.js");
const { carteProduitHTML, nomProduit, categorieProduit, prixProduit, dateProduit, aDesVariantes, escapeHTML, CATEGORY_LABEL, CATEGORY_SLUG, PLACEHOLDER_IMG } = carte;

// ---------- Lecture Firestore (REST public, même format que donnees.js) ----------
function valeur(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("mapValue" in v) return champs(v.mapValue.fields);
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(valeur);
  if ("referenceValue" in v) return v.referenceValue;
  if ("geoPointValue" in v) return v.geoPointValue;
  return null;
}
function champs(f = {}) {
  const o = {};
  for (const [k, v] of Object.entries(f)) o[k] = valeur(v);
  return o;
}
const documentREST = (d) => ({ id: d.name.split("/").pop(), ...champs(d.fields), __nom: d.name });

async function lireJSON(url, options) {
  for (let essai = 1; ; essai++) {
    try {
      const rep = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
      if (!rep.ok) throw new Error(`HTTP ${rep.status} ${url}`);
      return await rep.json();
    } catch (err) {
      if (essai >= 3) throw err;
      await new Promise((r) => setTimeout(r, 1000 * essai));
    }
  }
}
async function tousLesProduits() {
  const docs = [];
  let jeton = "";
  do {
    const j = await lireJSON(`${API}/produits?pageSize=300${jeton ? `&pageToken=${encodeURIComponent(jeton)}` : ""}`);
    docs.push(...(j.documents || []).map(documentREST));
    jeton = j.nextPageToken || "";
  } while (jeton);
  return docs;
}
const variantesDe = async (id) => ((await lireJSON(`${API}/produits/${encodeURIComponent(id)}/variantes?pageSize=100`)).documents || []).map(documentREST);
async function avisDe(id) {
  const lignes = await lireJSON(`${API}:runQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: "avis" }],
      where: { fieldFilter: { field: { fieldPath: "produitId" }, op: "EQUAL", value: { stringValue: id } } },
      orderBy: [{ field: { fieldPath: "dateCreation" }, direction: "DESCENDING" }],
      limit: 50,
    } }),
  });
  return lignes.filter((l) => l.document).map((l) => documentREST(l.document));
}
async function parLots(liste, n, f) {
  const res = new Array(liste.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < liste.length) { const k = i++; res[k] = await f(liste[k]); }
  }));
  return res;
}

// ---------- Outils HTML ----------
// JSON sûr dans une balise <script> (pas de « </script> » possible).
const jsonScript = (o) => JSON.stringify(o).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const attr = (s) => escapeHTML(String(s ?? ""));
function remplacerUneFois(html, motif, remplacement, nom) {
  const n = typeof motif === "string" ? html.split(motif).length - 1 : (html.match(new RegExp(motif.source, motif.flags.replace("g", "") + "g")) || []).length;
  if (n !== 1) throw new Error(`pré-rendu : « ${nom} » trouvé ${n} fois (attendu : 1)`);
  return html.replace(motif, remplacement);
}
// Contenu entre <!--pr:nom--> et <!--/pr:nom--> (créé au 1er passage).
function zone(html, nom, contenu) {
  const re = new RegExp(`<!--pr:${nom}-->[\\s\\S]*?<!--/pr:${nom}-->`);
  return html.replace(re, `<!--pr:${nom}-->${contenu}<!--/pr:${nom}-->`);
}
const meta = (html, sel, valeurAttr) => html.replace(sel, (m) => m.replace(/content="[^"]*"/, `content="${attr(valeurAttr)}"`));
function balisesSEO(html, { titre, description, url, type, image }) {
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHTML(titre)}</title>`);
  html = meta(html, /<meta name="description" content="[^"]*"\/>/, description);
  html = meta(html, /<meta property="og:title" content="[^"]*"\/>/, titre);
  html = meta(html, /<meta property="og:description" content="[^"]*"\/>/, description);
  html = meta(html, /<meta property="og:url" content="[^"]*"\/>/, url);
  if (type) html = meta(html, /<meta property="og:type" content="[^"]*"\/>/, type);
  if (image) html = meta(html, /<meta property="og:image" content="[^"]*"\/>/, image);
  html = html.replace(/<link rel="canonical" href="[^"]*"\/>/, `<link rel="canonical" href="${attr(url)}"/>`);
  return html;
}
// Le script de la barre « Installer » est synchrone (il se place sous
// l'en-tête avant l'affichage) : chargé à part, il bloquait la lecture de la
// page en 3G jusqu'à son arrivée. Il est écrit directement dans les pages
// pré-rendues (même code, aucune requête de plus).
const BALISE_INSTALLER = '<script src="/js/ios-install-prompt.js"></script>';
const SCRIPT_INSTALLER = `<script data-pr-installer>${readFileSync(join(PUBLIC, "js", "ios-install-prompt.js"), "utf8").replace(/<\/script/gi, "<\\/script")}</script>`;
const avecInstaller = (html) => html.includes(BALISE_INSTALLER) ? html.replace(BALISE_INSTALLER, () => SCRIPT_INSTALLER) : html;
const donneesPage = (o) => `<script type="application/json" id="bk-data">${jsonScript({ t: Date.now(), ...o })}</script>`;
function avecDonnees(html, o) {
  html = avecInstaller(html);
  const bloc = `<!--pr:donnees-->${donneesPage(o)}<!--/pr:donnees-->`;
  if (html.includes("<!--pr:donnees-->")) return zone(html, "donnees", donneesPage(o));
  return remplacerUneFois(html, "</body>", `${bloc}\n</body>`, "</body>");
}
function cartes(liste) {
  // 4 premières : loading="eager" + fetchpriority="high" ; suivantes : lazy.
  return liste.map((p, i) => carteProduitHTML(p, { eager: i < NB_EAGER })).join("")
    .replace(/ fetchpriority="high" decoding/g, ' loading="eager" fetchpriority="high" decoding');
}
const parDate = (a, b) => dateProduit(b) - dateProduit(a);

// ---------- Données ----------
const debut = Date.now();
let produits;
try {
  produits = await tousLesProduits();
} catch (err) {
  console.error("✗ Pré-rendu annulé (Firestore injoignable) :", err.message);
  console.error("  Les pages restent valides : le JavaScript chargera les produits comme avant.");
  process.exit(0);
}
// Ordre de l'accueil : celui de donnees.js (dateCreation puis __name__ décroissants).
const recents = produits.filter((p) => p.dateCreation)
  .sort((a, b) => String(b.dateCreation).localeCompare(String(a.dateCreation)) || b.__nom.localeCompare(a.__nom));
const sous = {};
await parLots(produits, 6, async (p) => {
  sous[`v:${p.id}`] = await variantesDe(p.id);
  sous[`a:${p.id}`] = await avisDe(p.id).catch(() => []);
});
const parId = Object.fromEntries(produits.map((p) => [p.id, p]));

// ---------- 1. Accueil ----------
{
  const f = join(PUBLIC, "index.html");
  let html = readFileSync(f, "utf8");
  const selection = recents.slice(0, NB_ACCUEIL);
  const json = recents.slice(0, NB_JSON_ACCUEIL);
  html = remplacerUneFois(html, /<div class="rail" id="selection"[^>]*>(?=<!--pr:selection-->)/, '<div class="rail" id="selection">', "rail #selection");
  // Pas de data-ids : accueil.js redessine une fois les cartes avec l'état
  // propre au téléphone (favoris, devise), sans squelettes ni saut.
  html = zone(html, "selection", cartes(selection));
  html = avecDonnees(html, { produits: Object.fromEntries(json.map((p) => [p.id, p])), listes: { "p:r:": json.map((p) => p.id) } });
  writeFileSync(f, html);
}

// ---------- 2. Pages catégorie ----------
const source = readFileSync(join(PUBLIC, "catalogue.html"), "utf8");
const seoCat = (() => {
  // CATEGORY_SEO de catalogue.js (titre, h1, description, intro) : relu ici
  // pour que le HTML statique corresponde à ce qu'affiche le JavaScript.
  const js = readFileSync(join(PUBLIC, "js", "catalogue.js"), "utf8");
  const m = js.match(/const CATEGORY_SEO = (\{[\s\S]*?\n\});/);
  return m ? Function(`return (${m[1]})`)() : {};
})();
rmSync(join(PUBLIC, "categorie"), { recursive: true, force: true });
mkdirSync(join(PUBLIC, "categorie"), { recursive: true });
for (const [slug, label] of Object.entries(CATEGORY_LABEL)) {
  const liste = produits.filter((p) => categorieProduit(p) === label).sort(parDate).slice(0, NB_CATEGORIE);
  const s = seoCat[slug] || {};
  const url = `${SITE}/categorie/${slug}`;
  const titre = s.title || "Bokki | Catalogue, paiement à la livraison en Guinée";
  const description = s.description || "";
  let html = balisesSEO(source, { titre, description, url });
  html = html.replace(/<script type="application\/ld\+json" id="pageStructuredData">[\s\S]*?<\/script>/, `<script type="application/ld+json" id="pageStructuredData">${jsonScript({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Accueil", item: `${SITE}/` },
        { "@type": "ListItem", position: 2, name: label, item: url },
      ] },
      { "@type": "CollectionPage", "@id": `${url}#collection`, name: titre, description, url },
    ],
  })}</script>`);
  html = html.replace(/(<h1[^>]*id="titre"[^>]*>)[^<]*(<\/h1>)/, `$1${escapeHTML(s.heading || label)}$2`);
  html = html.replace(/(<span id="crumbCourant" aria-current="page">)[^<]*(<\/span>)/, `$1${escapeHTML(label)}$2`);
  if (s.intro) html = html.replace(/<p class="cat-intro" id="intro" hidden><\/p>/, `<p class="cat-intro" id="intro">${escapeHTML(s.intro)}</p>`);
  html = html.replace(/<a class="chip( on)?" href="([^"]*)" data-cat="([^"]*)"( aria-current="page")?>/g, (m, on, href, cat) =>
    `<a class="chip${cat === slug ? " on" : ""}" href="${href}" data-cat="${cat}"${cat === slug ? ' aria-current="page"' : ""}>`);
  if (liste.length) {
    html = html.replace(/<div class="pgrid" id="grille" aria-live="polite" aria-busy="true">[\s\S]*?<\/div><\/div><\/div>(?=\s*<div class="more")/,
      () => `<div class="pgrid" id="grille" aria-live="polite" data-prerendu>${cartes(liste)}</div>`);
    if (!html.includes("data-prerendu")) throw new Error("pré-rendu : grille du catalogue introuvable");
  }
  html = avecDonnees(html, { produits: Object.fromEntries(liste.map((p) => [p.id, p])), listes: { [`p::${label}`]: liste.map((p) => p.id) } });
  writeFileSync(join(PUBLIC, "categorie", `${slug}.html`), html);
}

// ---------- 3. Fiches produit ----------
const ficheSource = readFileSync(join(PUBLIC, "produit.html"), "utf8");
const descriptionDe = (p) => p.infosGenerales?.description ?? p.description ?? "";
function lignesSpecs(p, config) {
  const infos = p.infosGenerales || {};
  const car = p.caracteristiques || {};
  const dims = new Set((config?.variantes?.dimensions || []).map((d) => d.key));
  const lignes = [];
  if (infos.marque) lignes.push(["Marque", infos.marque]);
  if (infos.modele) lignes.push(["Modèle", infos.modele]);
  if (infos.etat) lignes.push(["État", infos.etat]);
  for (const f of [...(config?.essentiel || []), ...(config?.secondaire || [])]) {
    if (!dims.has(f.key) && car[f.key] != null && car[f.key] !== "") lignes.push([f.label, Array.isArray(car[f.key]) ? car[f.key].join(", ") : car[f.key]]);
  }
  if (infos.garantie) lignes.push(["Garantie", infos.garantie]);
  return lignes;
}
rmSync(join(PUBLIC, "produit"), { recursive: true, force: true });
mkdirSync(join(PUBLIC, "produit"), { recursive: true });
for (const p of produits) {
  const nom = nomProduit(p);
  const categorie = categorieProduit(p);
  const slug = CATEGORY_SLUG[categorie];
  const config = categorieConfig(categorie);
  const variantes = sous[`v:${p.id}`] || [];
  const url = `${SITE}/produit/${encodeURIComponent(p.id)}`;
  const desc = (descriptionDe(p) || `${nom} disponible chez Bokki, avec paiement à la livraison et sans avance.`).slice(0, 280);
  const titre = `Bokki | ${nom} — ${categorie}`;
  let html = balisesSEO(ficheSource, { titre, description: `Bokki — ${desc} Paiement à la livraison.`.slice(0, 300), url, type: "product", image: p.images?.[0] });
  html = meta(html, /<meta property="og:description" content="[^"]*"\/>/, desc);
  // Données structurées « Product » (mêmes champs que fiche-produit.js).
  const prixV = variantes.map((v) => Number(v.prix)).filter((x) => x > 0);
  const base = { url, priceCurrency: "GNF", availability: "https://schema.org/InStock", seller: { "@type": "Organization", name: "Bokki", url: `${SITE}/` } };
  const p0 = Number(p.caracteristiques?.prix ?? p.prixVente ?? 0) || Number(p.caracteristiques?.prixMin) || 0;
  const offers = prixV.length
    ? Math.max(...prixV) > Math.min(...prixV)
      ? { "@type": "AggregateOffer", ...base, lowPrice: Math.min(...prixV), highPrice: Math.max(...prixV), offerCount: prixV.length }
      : { "@type": "Offer", ...base, price: prixV[0] }
    : p0 > 0 ? { "@type": "Offer", ...base, price: p0 } : undefined;
  html = remplacerUneFois(html, "</head>", `<script type="application/ld+json" id="productStructuredData">${jsonScript({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Product", "@id": `${url}#product`, name: nom, description: desc, category: categorie, sku: p.id,
        image: (p.images || []).filter((u) => typeof u === "string" && /^https:\/\//.test(u)),
        brand: p.infosGenerales?.marque ? { "@type": "Brand", name: p.infosGenerales.marque } : undefined, offers },
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Accueil", item: `${SITE}/` },
        { "@type": "ListItem", position: 2, name: categorie || "Catalogue", item: slug ? `${SITE}/categorie/${slug}` : `${SITE}/catalogue` },
        { "@type": "ListItem", position: 3, name: nom, item: url },
      ] },
    ],
  })}</script>\n</head>`, "</head>");
  // Contenu visible.
  const hd = p.images?.length ? p.images : [PLACEHOLDER_IMG];
  const petites = hd.map((u, i) => (p.miniaturesEntieres && typeof p.imagesSmall?.[i] === "string" && p.imagesSmall[i]) || u);
  const lignes = lignesSpecs(p, config);
  const prixAffiche = variantes.length
    ? `<span class="pfrom">Dès </span>${moneyHTML(Math.min(...variantes.map((v) => Number(v.prix) || 0)))}`
    : aDesVariantes(p) ? `<span class="pfrom">Dès </span>${moneyHTML(Number(p.caracteristiques?.prixMin) || 0)}` : moneyHTML(prixProduit(p));
  html = remplacerUneFois(html, '<body class="p-chargement">', "<body>", "body");
  html = html.replace(/(<a id="crumbCat" href=")[^"]*(">)[^<]*(<\/a>)/, `$1${slug ? `/categorie/${slug}` : "/catalogue"}$2${escapeHTML(categorie || "Catalogue")}$3`);
  html = html.replace(/(<span id="crumbNom"[^>]*>)[^<]*(<\/span>)/, `$1${escapeHTML(nom)}$2`);
  html = html.replace(/(<span class="small strong muted" id="pCat">)[^<]*(<\/span>)/, `$1${escapeHTML(categorie)}$2`);
  html = html.replace(/(<h1 class="h1" id="pTitle">)[^<]*(<\/h1>)/, `$1${escapeHTML(nom)}$2`);
  html = html.replace(/(<span class="p-price" id="pPrice">)[^<]*(<\/span>)/, `$1${prixAffiche}$2`);
  const d = descriptionDe(p);
  html = html.replace(/<p class="p-desc" id="pDesc"><\/p>/, `<p class="p-desc" id="pDesc"${d ? "" : " hidden"}>${escapeHTML(d)}</p>`);
  html = html.replace(/<img id="mainImg" alt="" /, `<img id="mainImg" src="${attr(petites[0])}" alt="${attr(`${nom}, photo du produit`)}" `);
  if (hd.length > 1) {
    html = html.replace(/<div class="thumbs" id="thumbs"><\/div>/, `<div class="thumbs" id="thumbs">${petites.map((u, i) => `<button type="button" class="thumb" data-i="${i}" aria-label="Photo ${i + 1} sur ${hd.length}"${i === 0 ? ' aria-current="true"' : ""}><img src="${attr(u)}" alt="" loading="lazy" width="52" height="52"/></button>`).join("")}</div>`);
    html = html.replace(/(<span class="pill pill-grey" id="galCompteur") hidden>1 \/ 1<\/span>/, `$1>1 / ${hd.length}</span>`);
  }
  html = lignes.length
    ? remplacerUneFois(html, '<div id="specs"></div>', `<div id="specs">${lignes.map(([l, v]) => `<div class="spec"><span class="muted">${escapeHTML(l)}</span><b>${escapeHTML(v)}</b></div>`).join("")}</div>`, "specs")
    : remplacerUneFois(html, '<p class="muted small" id="specsVide" hidden>', '<p class="muted small" id="specsVide">', "specsVide");
  html = remplacerUneFois(html, /<link rel="preload" as="image" id="preloadFiche"[^>]*>|(?=<link rel="stylesheet" href="assets\/fonts\/fonts.css"\/>)/,
    `<link rel="preload" as="image" id="preloadFiche" href="${attr(petites[0])}" fetchpriority="high"/>\n`, "préchargement photo");
  html = avecDonnees(html, { produits: { [p.id]: p }, sous: { [`v:${p.id}`]: variantes, [`a:${p.id}`]: sous[`a:${p.id}`] || [] } });
  writeFileSync(join(PUBLIC, "produit", `${encodeURIComponent(p.id)}.html`), html);
}

console.log(`✓ Pré-rendu : accueil, ${Object.keys(CATEGORY_LABEL).length} catégories, ${produits.length} fiches produit (${((Date.now() - debut) / 1000).toFixed(1)} s).`);
