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

const BLOC = /<!-- partial:(header|footer|tabbar)((?:\s+\w+="[^"]*")*)\s*-->[\s\S]*?<!-- \/partial:\1 -->/g;

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
  const apres = avant.replace(BLOC, (_, nom, attrs) => {
    total++;
    const actif = /actif="([^"]*)"/.exec(attrs)?.[1] || "";
    try {
      return `<!-- partial:${nom}${attrs} -->\n${rendre(nom, actif)}\n<!-- /partial:${nom} -->`;
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
