#!/usr/bin/env node
// Recopie le header, le footer et la barre d'onglets communs dans les pages
// du site client (sans dépendance, sans étape de build).
//
// Dans une page, un bloc partagé est délimité par deux commentaires :
//   <!-- partial:header actif="telephones" -->
//   … contenu généré, NE PAS MODIFIER À LA MAIN …
//   <!-- /partial:header -->
// Le contenu entre les deux est remplacé par public/_partials/<nom>.html.
// L'attribut facultatif actif="…" met en évidence la catégorie (header) ou
// l'onglet (tabbar : accueil | categories | panier | compte).
//
//   node tools/partials.cjs           met les pages à jour
//   node tools/partials.cjs --check   échoue si une page n'est pas à jour
//                                     (lancé avant chaque déploiement)
// CommonJS (et non module ES) : le binaire autonome de la CLI Firebase, qui
// lance ce script en predeploy, embarque un Node qui refuse les .mjs.
const { readFileSync, writeFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

const RACINE = join(__dirname, "..", "public");
const DOSSIER_PARTIALS = join(RACINE, "_partials");
const CHECK = process.argv.includes("--check");

// Doit rester aligné avec CATEGORY_LABEL (js/produits-list.js).
const CATEGORIES = [
  ["telephones", "Téléphones"],
  ["ordinateurs", "Ordinateurs"],
  ["tablettes", "Tablettes"],
  ["televisions", "Télévisions"],
  ["electronique", "Électronique"],
  ["energie", "Énergie"],
  ["vetements", "Vêtements"],
  ["chaussures", "Chaussures"],
  ["voitures", "Voitures"],
];
const ONGLETS = ["accueil", "categories", "panier", "compte"];
// Pages sans barre d'onglets (la fiche produit a sa barre d'achat en bas).
const SANS_ONGLETS = new Set(["produit.html"]);

// Pages publiques (indexées) : elles portent les données structurées de
// Bokki, générées depuis tools/faits-bokki.json (source unique des faits).
const PUBLIQUES = new Set(["index.html", "catalogue.html", "produit.html", "faq.html", "a-propos.html", "comment-ca-marche.html", "contact.html", "legal.html", "temoignages.html", "demande-produit.html", "livraison.html", "conseils.html"]);
const FAITS = JSON.parse(readFileSync(join(__dirname, "faits-bokki.json"), "utf8"));
const jsonScript = (o) => JSON.stringify(o).replace(/</g, "\\u003c");

function organisationLD() {
  const f = FAITS;
  const horaires = f.horaires.map((h) => ({ "@type": "OpeningHoursSpecification", dayOfWeek: h.jours, opens: h.ouvre, closes: h.ferme }));
  const contact = (telephone, zone) => ({
    "@type": "ContactPoint", telephone, email: f.email, contactType: "customer service",
    availableLanguage: ["French"], areaServed: zone, hoursAvailable: horaires,
  });
  const o = {
    "@context": "https://schema.org",
    "@type": "OnlineStore",
    "@id": `${f.url}#organization`,
    name: f.nom,
    alternateName: f.autresNoms,
    url: f.url,
    logo: f.logo,
    image: f.image,
    description: f.description,
    email: f.email,
    telephone: f.telephone,
    areaServed: { "@type": "Country", name: f.pays, identifier: f.codePays },
    currenciesAccepted: f.devise,
    paymentAccepted: f.paiement.join(", "),
    contactPoint: [contact(f.telephone, f.codePays), ...f.telephonesSecondaires.map((t) => contact(t.numero, f.codePays))],
    sameAs: f.reseaux,
  };
  if (f.dateCreation) o.foundingDate = f.dateCreation;
  return `<script type="application/ld+json" id="organisationLD">${jsonScript(o)}</script>`;
}

// FAQPage générée depuis les questions visibles de la page (accordéons
// .acc-q / .acc-a) : jamais de réponse balisée qui ne serait pas affichée.
function texte(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").replace(/ ([.,)])/g, "$1").trim();
}
function faqLD(page, html) {
  const questions = [...html.matchAll(/<button[^>]*class="acc-q"[^>]*>([\s\S]*?)<span>[\s\S]*?<div class="acc-a"[^>]*>([\s\S]*?)<\/div>/g)]
    .map(([, q, r]) => ({ "@type": "Question", name: texte(q), acceptedAnswer: { "@type": "Answer", text: texte(r) } }));
  if (!questions.length) throw new Error(`${page} : bloc faq sans question visible`);
  return `<script type="application/ld+json" id="faqLD">${jsonScript({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: questions })}</script>`;
}

const modeles = Object.fromEntries(
  ["header", "footer", "tabbar"].map((nom) => [
    nom,
    readFileSync(join(DOSSIER_PARTIALS, `${nom}.html`), "utf8").trimEnd(),
  ]),
);

function rendre(nom, actif) {
  let html = modeles[nom];
  if (nom === "header") {
    if (actif && !CATEGORIES.some(([slug]) => slug === actif)) {
      throw new Error(`catégorie inconnue : actif="${actif}"`);
    }
    const liens = CATEGORIES.map(([slug, label]) =>
      slug === actif
        ? `<a href="/categorie/${slug}" data-cat="${slug}" class="on" aria-current="page">${label}</a>`
        : `<a href="/categorie/${slug}" data-cat="${slug}">${label}</a>`,
    ).join("\n      ");
    html = html.replace("{{cats}}", liens);
  }
  if (nom === "tabbar") {
    if (actif && !ONGLETS.includes(actif)) throw new Error(`onglet inconnu : actif="${actif}"`);
    html = html
      .replace(/\{\{on:(\w+)\}\}/g, (_, o) => (o === actif ? " on" : ""))
      .replace(/\{\{cur:(\w+)\}\}/g, (_, o) => (o === actif ? ' aria-current="page"' : ""));
  }
  if (/\{\{[^}]*\}\}/.test(html)) throw new Error(`variable non remplacée dans ${nom}.html`);
  return html;
}

const BLOC = /<!-- partial:(header|footer|tabbar|organisation|faq)((?:\s+\w+="[^"]*")*)\s*-->[\s\S]*?<!-- \/partial:\1 -->/g;

const pages = readdirSync(RACINE).filter((f) => f.endsWith(".html"));
const enRetard = [];
const erreurs = [];
let total = 0;

for (const page of pages) {
  const chemin = join(RACINE, page);
  const avant = readFileSync(chemin, "utf8");
  // Structure : chaque marqueur ouvert doit être reconnu (sinon une faute de
  // frappe laisserait passer une page sans header), et chaque page doit avoir
  // exactement un header, un footer et (sauf exception) une barre d'onglets.
  const ouverts = (avant.match(/<!-- partial:/g) || []).length;
  const reconnus = [...avant.matchAll(BLOC)].map((m) => m[1]);
  if (ouverts !== reconnus.length) erreurs.push(`${page} : marqueur partial mal formé ou non fermé`);
  for (const nom of ["header", "footer", "tabbar"]) {
    const n = reconnus.filter((r) => r === nom).length;
    const attendu = nom === "tabbar" && SANS_ONGLETS.has(page) ? 0 : 1;
    if (n !== attendu) erreurs.push(`${page} : ${n} bloc(s) ${nom}, ${attendu} attendu(s)`);
  }
  const nOrg = reconnus.filter((r) => r === "organisation").length;
  if (nOrg !== (PUBLIQUES.has(page) ? 1 : 0)) erreurs.push(`${page} : ${nOrg} bloc(s) organisation, ${PUBLIQUES.has(page) ? 1 : 0} attendu(s)`);
  const apres = avant.replace(BLOC, (_, nom, attrs) => {
    total++;
    const actif = /actif="([^"]*)"/.exec(attrs)?.[1] || "";
    try {
      const contenu = nom === "organisation" ? organisationLD() : nom === "faq" ? faqLD(page, avant) : rendre(nom, actif);
      return `<!-- partial:${nom}${attrs} -->\n${contenu}\n<!-- /partial:${nom} -->`;
    } catch (e) {
      throw new Error(`${page} : ${e.message}`);
    }
  });
  if (apres !== avant) {
    enRetard.push(page);
    if (!CHECK) writeFileSync(chemin, apres);
  }
}

// Le service worker doit précacher la même version de bokki.css que les pages.
const versionsCss = new Set();
for (const page of pages) {
  for (const m of readFileSync(join(RACINE, page), "utf8").matchAll(/css\/bokki\.css\?v=([\w.-]+)/g)) versionsCss.add(m[1]);
}
const sw = readFileSync(join(RACINE, "sw.js"), "utf8");
if (versionsCss.size !== 1) erreurs.push(`versions de bokki.css différentes selon les pages : ${[...versionsCss].join(", ")}`);
else if (!sw.includes(`"/css/bokki.css?v=${[...versionsCss][0]}"`)) erreurs.push("sw.js : SHELL_FILES ne précache pas la version de bokki.css utilisée par les pages");
if (total === 0) erreurs.push("aucun bloc partagé trouvé");

if (erreurs.length) {
  console.error("✗ " + erreurs.join("\n✗ "));
  process.exit(1);
}

if (CHECK && enRetard.length) {
  console.error(
    `✗ Header/footer/onglets pas à jour dans : ${enRetard.join(", ")}\n` +
      "  Lancez « npm run partials » puis relancez le déploiement.",
  );
  process.exit(1);
}
console.log(
  CHECK
    ? `✓ ${total} blocs partagés à jour dans ${pages.length} pages.`
    : `✓ ${enRetard.length} page(s) mise(s) à jour (${total} blocs).`,
);
