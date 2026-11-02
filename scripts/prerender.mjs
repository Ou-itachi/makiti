#!/usr/bin/env node
// Pré-rendu (mise à jour n°1, point 3) : écrit le contenu du catalogue
// directement dans le HTML, pour un affichage sans attendre Firebase.
//
//   node scripts/prerender.mjs             avant chaque déploiement
//   node scripts/prerender.mjs --nettoyer  après (index.html redevient tel
//                                          qu'enregistré dans git)
//   (lancés automatiquement par firebase.json via scripts/prerender-deploy.cjs)
//
// Le travail est fait par functions/prerender/coeur.mjs, partagé avec la
// fonction regenererPrerendu (régénération automatique après une
// modification de produit dans l'admin). Ici : fichiers de public/.
//
// En cas d'échec réseau, rien n'est modifié (les pages restent valides :
// le JavaScript charge alors les produits comme avant).
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { prerendre, RAIL_VIDE, BALISE_INSTALLER } from "../functions/prerender/coeur.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(RACINE, "public");

if (process.argv.includes("--nettoyer")) {
  const f = join(PUBLIC, "index.html");
  const html = readFileSync(f, "utf8")
    .replace(/<div class="rail" id="selection"[^>]*><!--pr:selection-->[\s\S]*?<!--\/pr:selection--><\/div>/, RAIL_VIDE)
    .replace(/<!--pr:donnees-->[\s\S]*?<!--\/pr:donnees-->\n/, "")
    .replace(/<script data-pr-installer>[\s\S]*?<\/script>/, () => BALISE_INSTALLER);
  writeFileSync(f, html);
  console.log("✓ Pré-rendu retiré de index.html (pages produit/catégorie gardées, ignorées par git).");
  process.exit(0);
}

const debut = Date.now();
let resultat;
try {
  resultat = await prerendre({ lire: async (chemin) => readFileSync(join(PUBLIC, chemin), "utf8"), dossierJS: join(PUBLIC, "js") });
} catch (err) {
  console.error("✗ Pré-rendu annulé :", err.message);
  console.error("  Les pages restent valides : le JavaScript chargera les produits comme avant.");
  process.exit(0);
}
for (const dossier of ["categorie", "produit"]) {
  rmSync(join(PUBLIC, dossier), { recursive: true, force: true });
  mkdirSync(join(PUBLIC, dossier), { recursive: true });
}
for (const [chemin, html] of Object.entries(resultat.fichiers)) writeFileSync(join(PUBLIC, chemin), html);
const nbCat = Object.keys(resultat.fichiers).filter((c) => c.startsWith("/categorie/")).length;
console.log(`✓ Pré-rendu : accueil, ${nbCat} catégories, ${resultat.nbProduits} fiches produit (${((Date.now() - debut) / 1000).toFixed(1)} s).`);
