// Worker de la fonction regenererPrerendu (functions/src/index.ts).
// Lancé dans un thread à part : le pré-rendu installe de faux objets de
// navigateur (window, document…) qui ne doivent pas toucher le reste de la
// fonction (firebase-admin croirait tourner dans un navigateur).
//
// Les modèles de pages et les modules js/ sont relus sur le site EN LIGNE
// (version publiée par le dernier déploiement) : la régénération produit
// exactement ce que produirait `node scripts/prerender.mjs` avec ces fichiers.
// L'accueil en ligne est déjà pré-rendu : ses zones <!--pr:…--> sont
// simplement remplies à nouveau.
//
// Résultat renvoyé au thread principal : { fichiers, nbProduits } ou { erreur }.
import { parentPort, workerData } from "node:worker_threads";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, posix } from "node:path";

const SITE = workerData?.site || "https://bokki.shop";
const vraiFetch = globalThis.fetch;

// index.html, catalogue.html, produit.html : adresses propres (cleanUrls).
const ADRESSES = { "index.html": "/", "catalogue.html": "/catalogue", "produit.html": "/produit" };
async function lire(chemin) {
  const url = SITE + (ADRESSES[chemin] || `/${chemin}`);
  for (let essai = 1; ; essai++) {
    try {
      const rep = await vraiFetch(url, { cache: "no-store", signal: AbortSignal.timeout(20000) });
      if (!rep.ok) throw new Error(`HTTP ${rep.status} ${url}`);
      return await rep.text();
    } catch (err) {
      if (essai >= 3) throw err;
      await new Promise((r) => setTimeout(r, 1000 * essai));
    }
  }
}

// Copie locale des modules js/ nécessaires (et de leurs imports relatifs).
async function telechargerModules(dossier, entrees) {
  const vus = new Set();
  const file = [...entrees];
  while (file.length) {
    const f = posix.normalize(file.shift());
    if (vus.has(f)) continue;
    vus.add(f);
    const code = await lire(`js/${f}`);
    const cible = join(dossier, f);
    mkdirSync(dirname(cible), { recursive: true });
    writeFileSync(cible, code);
    for (const m of code.matchAll(/(?:from\s*|import\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
      file.push(posix.join(posix.dirname(f), m[1]));
    }
  }
}

const dossierJS = mkdtempSync(join(tmpdir(), "bokki-js-"));
try {
  await telechargerModules(dossierJS, ["carte-produit.js", "produit-categories.js", "currency-display.js", "seo-produit.js"]);
  const { prerendre } = await import("./coeur.mjs");
  const resultat = await prerendre({ lire, dossierJS });
  parentPort.postMessage(resultat);
} catch (err) {
  parentPort.postMessage({ erreur: String(err?.stack || err) });
} finally {
  rmSync(dossierJS, { recursive: true, force: true });
}
