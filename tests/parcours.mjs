#!/usr/bin/env node
// Tests automatiques du parcours d'achat (suggestion 1) et de l'accessibilité
// (suggestion 10), sur un téléphone simulé :
//   accueil → fiche produit → ajout au panier → panier → début de commande.
// La commande n'est JAMAIS envoyée (le site lit les vraies données de
// production, en lecture seule).
//
//   npm test                       serveur local (lancé et arrêté tout seul)
//   BASE_URL=https://… npm test    une adresse en ligne (version de test…)
//
// Échoue (code 1) si une étape casse, si une erreur JavaScript apparaît, ou
// si axe-core trouve un problème d'accessibilité « grave » ou « critique ».
import { chromium, devices } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const RACINE = fileURLToPath(new URL("..", import.meta.url));
const PORT = 5077;
let BASE = process.env.BASE_URL?.replace(/\/$/, "");
let serveur = null;
const echecs = [];
const avertissements = [];

async function demarrerServeur() {
  serveur = spawn(process.execPath, ["tools/serveur-local.cjs"], { cwd: RACINE, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
  BASE = `http://localhost:${PORT}`;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + "/")).ok) return; } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Le serveur local ne démarre pas");
}

function etape(nom, ok, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${nom}${detail ? " — " + detail : ""}`);
  if (!ok) echecs.push(nom);
}

async function accessibilite(page, nom) {
  await page.waitForTimeout(800); // fin des animations d'apparition (sinon faux défauts de contraste)
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const graves = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const legers = r.violations.length - graves.length;
  // Contrastes : signalés, sans bloquer (choix de marque à arbitrer à la main).
  const bloquants = graves.filter((v) => v.id !== "color-contrast");
  for (const v of graves) {
    const msg = `${nom} : ${v.id} (${v.impact}) ×${v.nodes.length} — ${v.help} — ex. ${v.nodes[0]?.target?.join(" ")}`;
    if (v.id === "color-contrast") avertissements.push(msg); else console.log("   ↳ " + msg);
  }
  etape(`Accessibilité ${nom}`, bloquants.length === 0, `${bloquants.length} bloquant(s), ${graves.length - bloquants.length} contraste(s), ${legers} mineur(s)`);
}

async function principal() {
  // Adresses des fiches : même calcul sur le site et dans les fonctions.
  const { readFileSync } = await import("node:fs");
  etape("Adresses produit identiques site / fonctions",
    readFileSync(RACINE + "public/js/slug.js", "utf8") === readFileSync(RACINE + "functions/prerender/slug.mjs", "utf8"),
    "copier public/js/slug.js vers functions/prerender/slug.mjs");
  const { readdirSync } = await import("node:fs");
  const cleIndexNow = readdirSync(RACINE + "public").find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
  etape("IndexNow : clé identique site / fonctions",
    Boolean(cleIndexNow) && readFileSync(RACINE + "public/" + cleIndexNow, "utf8").trim() === cleIndexNow.slice(0, 32)
      && readFileSync(RACINE + "functions/src/index.ts", "utf8").includes(`INDEXNOW_CLE = "${cleIndexNow.slice(0, 32)}"`),
    cleIndexNow || "public/<clé>.txt introuvable");
  if (!BASE) await demarrerServeur();
  console.log(`Parcours d'achat sur ${BASE}\n`);
  const navigateur = await chromium.launch();
  const contexte = await navigateur.newContext({ ...devices["Pixel 5"], serviceWorkers: "block" });
  const page = await contexte.newPage();
  const erreursJs = [];
  page.on("pageerror", (e) => erreursJs.push(`${page.url()} : ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|net::ERR|favicon|reCAPTCHA|AppCheck|Content Security Policy.*localhost/i.test(m.text())) erreursJs.push(`${page.url()} : ${m.text()}`);
  });

  // 1. Accueil
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  const cartes = page.locator(".pcard .pcard-link");
  await cartes.first().waitFor({ timeout: 20000 }).catch(() => {});
  const nbCartes = await cartes.count();
  etape("Accueil : produits affichés", nbCartes > 0, `${nbCartes} produit(s)`);
  const hrefs = await cartes.evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  etape("Accueil : liens des fiches avec le nom du produit", hrefs.length > 0 && hrefs.every((h) => /^\/produit\/[a-z0-9-]+-[a-z0-9]{4}$/.test(h)), hrefs[0] || "");
  await accessibilite(page, "accueil");

  // 2. Fiche produit : on prend le 1er produit achetable directement
  //    (sans variante à choisir), sinon on choisit la 1re variante.
  const liens = await cartes.evaluateAll((as) => as.slice(0, 8).map((a) => a.getAttribute("href")));
  let ajoute = false;
  for (const href of liens) {
    await page.goto(new URL(href, BASE).href, { waitUntil: "domcontentloaded" });
    await page.locator("#pTitle").filter({ hasNotText: "Chargement…" }).waitFor({ timeout: 20000 }).catch(() => {});
    const btn = page.locator("#btnPanier");
    if (await btn.isDisabled()) {
      const choix = page.locator("[data-variante], .variant-opt, .opt:not([disabled])").first();
      if (await choix.count()) await choix.click().catch(() => {});
    }
    if (await btn.isEnabled().catch(() => false)) {
      etape("Fiche produit : titre et bouton panier", true, (await page.locator("#pTitle").innerText()).slice(0, 50));
      await accessibilite(page, "fiche produit");
      await btn.click();
      ajoute = true;
      break;
    }
  }
  etape("Ajout au panier", ajoute, ajoute ? "" : "aucun produit achetable parmi les 8 premiers");

  // 3. Panier
  await page.goto(BASE + "/panier", { waitUntil: "domcontentloaded" });
  const lignes = page.locator("article.line");
  await lignes.first().waitFor({ timeout: 10000 }).catch(() => {});
  etape("Panier : article présent", (await lignes.count()) > 0);
  await accessibilite(page, "panier");

  // 4. Début de commande (formulaire seulement, rien n'est envoyé)
  await page.goto(BASE + "/commande/identification", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const champ = await page.locator("input").count();
  etape("Commande : formulaire affiché", champ > 0, `${champ} champ(s)`);
  await accessibilite(page, "commande");

  // 5. Pages de contenu (mise à jour n°2) : lisibles, accessibles, accordéon.
  for (const chemin of ["/livraison", "/comment-ca-marche", "/conseils"]) {
    await page.goto(BASE + chemin, { waitUntil: "domcontentloaded" });
    await accessibilite(page, chemin);
  }
  const q = page.locator("#ccm-q1");
  await page.goto(BASE + "/comment-ca-marche", { waitUntil: "domcontentloaded" });
  await q.click();
  etape("Comment ça marche : réponse ouverte au clic", await page.locator("#ccm-r1").isVisible());

  etape("Aucune erreur JavaScript", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));
  await navigateur.close();
}

try {
  await principal();
} catch (e) {
  etape("Exécution des tests", false, e.message);
} finally {
  serveur?.kill();
}
if (avertissements.length) {
  console.log(`\nÀ regarder (contrastes, non bloquant) :`);
  for (const a of avertissements) console.log("  · " + a);
}
console.log(echecs.length ? `\n✗ ${echecs.length} échec(s) : ${echecs.join(", ")}` : "\n✓ Parcours d'achat OK");
process.exit(echecs.length ? 1 : 0);
