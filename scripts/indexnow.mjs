// IndexNow (Bing, Yandex, Seznam, Naver… ; Google ne l'utilise pas) :
// signale aux moteurs les adresses du site juste après un déploiement
// (postdeploy de firebase.json). Lit le sitemap EN LIGNE, donc les adresses
// réellement publiées. N'échoue jamais : un souci ici ne doit pas faire
// croire que le déploiement a raté.
//   node scripts/indexnow.mjs            envoie
//   node scripts/indexnow.mjs --essai    affiche sans envoyer
// Clé : le fichier public/<clé>.txt (32 caractères hexadécimaux, contenu =
// la clé). Même clé dans functions/src/index.ts (INDEXNOW_CLE), vérifiée par
// tests/parcours.mjs.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SITE = "https://bokki.shop";
const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const ESSAI = process.argv.includes("--essai");

try {
  const fichier = readdirSync(PUBLIC).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
  if (!fichier) throw new Error("fichier de clé public/<clé>.txt introuvable");
  const cle = readFileSync(PUBLIC + fichier, "utf8").trim();
  const sitemap = await (await fetch(`${SITE}/sitemap.xml`, { signal: AbortSignal.timeout(20000) })).text();
  const urlList = [...new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => u.startsWith(SITE)))];
  if (!urlList.length) throw new Error("sitemap vide");
  if (ESSAI) {
    console.log(`IndexNow (essai) : ${urlList.length} adresses, clé ${SITE}/${fichier}`);
  } else {
    const rep = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: new URL(SITE).host, key: cle, keyLocation: `${SITE}/${fichier}`, urlList }),
      signal: AbortSignal.timeout(20000),
    });
    // 200 = reçu ; 202 = reçu, clé en cours de vérification.
    console.log(rep.ok ? `✓ IndexNow : ${urlList.length} adresses signalées (HTTP ${rep.status}).` : `⚠ IndexNow : HTTP ${rep.status} ${await rep.text()}`);
  }
} catch (e) {
  console.warn(`⚠ IndexNow non envoyé : ${e.message}`);
}
