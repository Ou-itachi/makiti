// Corrections de la passe n°8, sur l'émulateur uniquement. À lancer avec :
//   firebase emulators:exec --project demo-bokki --only functions,firestore,auth,storage,pubsub "node tests/corrections-maj8.mjs"
import { chromium, devices } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { db, adminAuth, compte, appeler, attendre, verifier, bilan, Timestamp, nouveauLivreur, commande, nouvelId } from "./maj6-commun.mjs";

const RACINE = fileURLToPath(new URL("..", import.meta.url));
const PORT = 5079;
const BASE = `http://127.0.0.1:${PORT}`;
const MDP = "motdepasse-test";
const AVERTISSEMENT = "Connexion impossible : cette liste n'est peut-être pas à jour";

const admin = await compte("admin-maj8@test.bokki", MDP);
await db.collection("admins").doc(admin.uid).set({ email: admin.email, nom: "Aïssatou" });
await db.collection("parametres").doc("equipe").set({ telBokki: "622111111", telSecours: "117" });
const livreur = await nouveauLivreur("livreur-maj8", admin.jeton);
const client = await compte("client-maj8@test.bokki", MDP);
const pid = "produitMaj8";
await db.collection("produits").doc(pid).set({
  infosGenerales: { nom: "Téléphone test", categorie: "telephones", description: "Test", marque: "Test" },
  caracteristiques: {}, images: [], stock: 50, prix: { prix: 500000 }, prixVente: 500000, dateCreation: Timestamp.now(),
});

// --- K. Compteur de commandes par numéro ---
const corps = (tel, extra = {}) => ({ clientNom: "Awa", clientTel: tel, ville: "Conakry", quartier: "Kipé", articles: [{ produitId: pid, quantite: 1 }], ...extra });
const TEL_K = "622700001";
for (let i = 0; i < 7; i++) {
  const r = await appeler("creerCommande", corps(TEL_K, { quartier: "", idEnvoi: nouvelId() }));
  if (r.code !== "INVALID_ARGUMENT") verifier(`K. saisie invalide n°${i + 1} refusée comme invalide`, false, `${r.code} ${r.message}`);
}
const idsK = [];
let refusK = null;
for (let i = 0; i < 6; i++) {
  const idEnvoi = nouvelId();
  const r = await appeler("creerCommande", corps(TEL_K, { idEnvoi }));
  if (r.ok) idsK.push(idEnvoi);
  else refusK = { ...r, idEnvoi };
}
verifier("K. 7 saisies invalides ne consomment aucun des 5 envois", idsK.length === 5, `${idsK.length} commande(s) acceptée(s)`);
verifier("K. la 6e commande valide est refusée", refusK?.code === "RESOURCE_EXHAUSTED", refusK?.message);
verifier("K. le refus ne laisse aucune réservation en attente", refusK && !(await db.collection("envoisCommandes").doc(refusK.idEnvoi).get()).exists);
const reprise = await appeler("creerCommande", corps(TEL_K, { idEnvoi: idsK[0] }));
verifier("K. un envoi déjà abouti, renvoyé, passe toujours", reprise.ok);

// --- M. Une seule clé par numéro ---
const creation = await appeler("creerCommande", corps("622556677", { codePersonnel: "4827" }));
verifier("M. compte créé avec le numéro normal : clé inchangée", creation.ok && (await db.collection("codesClients").doc("224622556677").get()).exists, creation.message);
for (const saisie of ["622556677", "+224622556677", "00224622556677", "+00224622556677", "+2240622556677", "2240622556677", "00224 0 622 55 66 77"]) {
  const r = await appeler("identifierClient", { telephone: saisie, code: "4827" });
  verifier(`M. « ${saisie} » retrouve le compte`, r.resultat?.etat === "connecte", r.message || r.resultat?.etat);
}
const ivoirien = await appeler("creerCommande", corps("+2250707123456", { codePersonnel: "4827" }));
verifier("M. Côte d'Ivoire : le 0 reste dans la clé", ivoirien.ok && (await db.collection("codesClients").doc("2250707123456").get()).exists, ivoirien.message);
const italien = await appeler("creerCommande", corps("+390612345678", { codePersonnel: "4827" }));
verifier("M. pays hors liste : clé inchangée", italien.ok && (await db.collection("codesClients").doc("390612345678").get()).exists, italien.message);

// --- I. Code oublié ---
const uidTel = "tel_224622556677";
const passkey = (id, uid) => db.collection("passkeys").doc(id).set({ uid, publicKey: "x", counter: 0, appareil: "Test" });
await passkey("cleClient1", uidTel);
await passkey("cleClient2", uidTel);
await passkey("cleAutre", "autre-compte");
await adminAuth.createUser({ uid: uidTel }).catch((e) => { if (e.code !== "auth/uid-already-exists") throw e; });
await adminAuth.updateUser(uidTel, { password: "pour-la-date-1234" });
const avant = new Date((await adminAuth.getUser(uidTel)).tokensValidAfterTime).getTime();
await new Promise((r) => setTimeout(r, 1100));
const raz = await appeler("reinitialiserCodeClient", { telephone: "622556677" }, admin.jeton);
verifier("I. réinitialisation acceptée", raz.ok && /^\d{4}$/.test(raz.resultat?.code || ""), raz.message);
verifier("I. passkeys du client supprimées", !(await db.collection("passkeys").doc("cleClient1").get()).exists && !(await db.collection("passkeys").doc("cleClient2").get()).exists);
verifier("I. passkey d'un autre compte gardée", (await db.collection("passkeys").doc("cleAutre").get()).exists);
verifier("I. sessions révoquées", new Date((await adminAuth.getUser(uidTel)).tokensValidAfterTime).getTime() > avant);
const journal = await db.collection("journalActivite").where("action", "==", "reinitialiser_code_client").get();
verifier("I. action notée au journal", journal.size === 1 && journal.docs[0].data().cible === "+224622556677");
await appeler("creerCommande", corps("622556688", { codePersonnel: "4827" }));
await adminAuth.deleteUser("tel_224622556688").catch(() => {});
const sansAuth = await appeler("reinitialiserCodeClient", { telephone: "622556688" }, admin.jeton);
verifier("I. utilisateur absent de Auth toléré", sansAuth.ok, sansAuth.message);

// --- J. Passkeys interdites à l'équipe ---
for (const [nom, jeton] of [["admin", admin.jeton], ["livreur", livreur.jeton]]) {
  const o = await appeler("optionsEnregistrementPasskey", {}, jeton);
  verifier(`J. options refusées : ${nom}`, o.code === "PERMISSION_DENIED", o.message);
  const e = await appeler("enregistrerPasskey", { idDefi: "x", reponse: {} }, jeton);
  verifier(`J. enregistrement refusé : ${nom}`, e.code === "PERMISSION_DENIED", e.message);
}
const optionsClient = await appeler("optionsEnregistrementPasskey", {}, client.jeton);
verifier("J. un client garde les passkeys", optionsClient.ok, optionsClient.message);
await passkey("cleLivreur", livreur.uid);
const mdp = await appeler("nouveauMotDePasseLivreur", { livreurId: livreur.livreurId, motDePasse: "nouveau-mot-de-passe-1" }, admin.jeton);
verifier("J. nouveau mot de passe livreur : passkey supprimée", mdp.ok && !(await db.collection("passkeys").doc("cleLivreur").get()).exists, mdp.message);

// --- N. Collecte ---
const collecte = (paquet) => fetch("http://127.0.0.1:5001/demo-bokki/europe-west1/collecte", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(paquet) });
const rCollecte = await collecte({ m: { constructor: 5, toString: 5, hasOwnProperty: 5 } });
verifier("N. métriques héritées d'Object ignorées sans erreur", rCollecte.status === 204, `HTTP ${rCollecte.status}`);

// --- Interface ---
const serveur = spawn(process.execPath, ["tools/serveur-local.cjs"], { cwd: RACINE, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
await attendre(async () => { try { return (await fetch(BASE + "/")).ok; } catch { return false; } });
const navigateur = await chromium.launch({ args: ["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests"] });
const erreursJs = [];

async function contexte(options) {
  const ctx = await navigateur.newContext({ locale: "fr-FR", serviceWorkers: "block", ...options });
  ctx.setDefaultTimeout(45000);
  await ctx.addInitScript(() => { try { localStorage.setItem("bokki-emulator", "1"); } catch { /* ignore */ } });
  return ctx;
}
async function connecter(p) {
  p.on("pageerror", (e) => erreursJs.push(`${p.url()} : ${e.message}`));
  await p.goto(`${BASE}/admin/login.html?emulator=1`);
  await p.getByRole("button", { name: /administrateur|admin/i }).click();
  await p.fill("#fid", admin.email);
  await p.fill("#fpwd", MDP);
  await p.keyboard.press("Enter");
  await p.waitForURL(/dashboard/);
}
const ouvrir = async (p, page) => { await p.goto(`${BASE}/admin/${page}`); await p.waitForTimeout(350); };

const ctx = await contexte({ viewport: { width: 1280, height: 800 } });
const p = await ctx.newPage();
await connecter(p);

// A. Incidents hors ligne
await ouvrir(p, "incidents.html");
const toutVaBien = p.getByText("Aucun incident. Tout va bien.");
const avertissement = p.getByText(AVERTISSEMENT);
await toutVaBien.waitFor();
verifier("A. en ligne : « Tout va bien » sans avertissement", (await avertissement.count()) === 0);
await ctx.setOffline(true);
await avertissement.waitFor({ timeout: 40000 }).catch(() => {});
verifier("A. hors ligne : avertissement affiché", await avertissement.isVisible());
verifier("A. hors ligne : plus de « Tout va bien »", (await toutVaBien.count()) === 0);
const bandeauSos = p.locator(".lv-sos-bandeau");
verifier("A. bandeau SOS : ne laisse pas croire que tout va bien", (await bandeauSos.textContent().catch(() => ""))?.includes("SOS non vérifiés"));
verifier("A. bandeau SOS : la page reste décalée sous le bandeau", await p.evaluate(() => document.documentElement.classList.contains("sos-actif")));
verifier("C. bandeau hors ligne branché sur l'admin", await p.locator(".reseau-bandeau.hors-ligne").isVisible());
await ctx.setOffline(false);
await toutVaBien.waitFor({ timeout: 40000 }).catch(() => {});
verifier("A. retour du réseau : tout redevient normal", await toutVaBien.isVisible() && (await avertissement.count()) === 0 && (await bandeauSos.count()) === 0);

// C. Listes d'argent
await db.collection("fournisseurs").doc("fMaj8").set({ nom: "Fournisseur test", telephone: "622000000", montantDu: 150000 });
for (const page of ["fournisseurs.html", "versements-fournisseurs.html", "paiement-livreurs.html", "livreurs.html", "corbeille-commandes.html"]) {
  await ctx.setOffline(false);
  await ouvrir(p, page);
  await p.waitForTimeout(1500);
  const horsLigneAvant = await p.getByText(AVERTISSEMENT).count();
  await ctx.setOffline(true);
  await p.getByText(AVERTISSEMENT).waitFor({ timeout: 40000 }).catch(() => {});
  verifier(`C. ${page} : avertissement sans réseau seulement`, horsLigneAvant === 0 && await p.getByText(AVERTISSEMENT).isVisible());
}
await ctx.setOffline(false);

// D. Fenêtres
async function controlerFenetre(nom, page, ouvrirFenetre) {
  await ouvrir(p, page);
  await ouvrirFenetre();
  const boite = p.locator('.overlay.open [role="dialog"][aria-modal="true"]');
  await boite.waitFor();
  verifier(`D. ${nom} : titre relié`, await boite.evaluate((b) => !!document.getElementById(b.getAttribute("aria-labelledby"))?.textContent.trim()));
  verifier(`D. ${nom} : focus dans la fenêtre à l'ouverture`, await boite.evaluate((b) => b.contains(document.activeElement)));
  let dedans = true;
  for (let i = 0; i < 40 && dedans; i++) {
    await p.keyboard.press(i % 7 === 6 ? "Shift+Tab" : "Tab");
    dedans = await boite.evaluate((b) => b.contains(document.activeElement) && document.activeElement !== document.body);
  }
  verifier(`D. ${nom} : Tab reste dedans`, dedans);
  await p.keyboard.press("Escape");
  await boite.waitFor({ state: "detached", timeout: 1000 }).catch(() => {});
  verifier(`D. ${nom} : Échap ferme`, (await p.locator(".overlay.open .modal").count()) === 0);
}
const clic = (texte) => () => p.getByRole("button", { name: texte }).first().click();
await controlerFenetre("fournisseur", "fournisseurs.html", clic("Ajouter un fournisseur"));
verifier("D. fournisseur : focus rendu au bouton d'origine", (await p.evaluate(() => document.activeElement?.textContent || "")).includes("Ajouter un fournisseur"));
await controlerFenetre("produit", "produits.html", clic("Ajouter un produit"));
await controlerFenetre("paiement livreur", "paiement-livreurs.html", clic(/^(Payer|Corriger)/));
await controlerFenetre("argent reçu", "paiement-livreurs.html", clic("Argent reçu"));
await controlerFenetre("fiche livreur : modifier", `fiche-livreur.html?id=${livreur.livreurId}`, async () => { await p.getByRole("tab", { name: /Informations/ }).click().catch(() => {}); await p.getByRole("button", { name: "Modifier", exact: true }).click(); });
const cDetail = await commande({ uid: client.uid });
await controlerFenetre("commande : prix", `commande-detail.html?id=${cDetail.id}`, clic("Modifier le prix"));

await ctx.close();

// B. Étape Livraison : erreur sous le champ
const ctxClient = await contexte({ ...devices["Pixel 5"] });
const pc = await ctxClient.newPage();
pc.on("pageerror", (e) => erreursJs.push(`${pc.url()} : ${e.message}`));
await pc.goto(`${BASE}/produit.html?id=${pid}&emulator=1`);
await pc.locator("#pTitle").filter({ hasNotText: "Chargement" }).waitFor();
await pc.click("#btnPanier");
await pc.goto(`${BASE}/panier`);
await pc.click("#commander");
await pc.waitForURL(/commande\/identification/);
await pc.fill("#tel", "622334411");
const cases = pc.locator("#pin input");
for (const [i, c] of [..."4827"].entries()) await cases.nth(i).fill(c);
await pc.click("#continuer");
await pc.waitForURL(/commande\/livraison/);
const suitLeChamp = (id) => pc.evaluate((c) => document.getElementById(c).closest(".field").nextElementSibling?.id === "erreur", id);
await pc.fill("#nom", "");
await pc.click("#confirmer");
verifier("B. prénom manquant : erreur juste sous le champ", await suitLeChamp("nom"));
await pc.fill("#nom", "Fatou");
await pc.click("#confirmer");
verifier("B. ville manquante : erreur juste sous le champ", await suitLeChamp("ville"));
await pc.fill("#ville", "Conakry");
await pc.click("#confirmer");
verifier("B. quartier manquant : erreur juste sous le champ", await suitLeChamp("quartier"));
verifier("B. erreur visible à l'écran", await pc.locator("#erreur").isVisible());
const parent = await pc.evaluate(() => { const e = document.getElementById("erreur"); const r = e.getBoundingClientRect(); return r.width > 200; });
verifier("B. erreur sur toute la largeur dans la grille ville / quartier", parent);
await ctxClient.close();

// E et G. Téléphone
const ctxTel = await contexte({ ...devices["Pixel 5"] });
const t = await ctxTel.newPage();
await connecter(t);
for (const [page, ouvrirFenetre] of [
  ["fournisseurs.html", () => t.getByRole("button", { name: "Ajouter un fournisseur" }).first().click()],
  ["produits.html", () => t.getByRole("button", { name: "Ajouter un produit" }).first().click()],
  ["commandes.html", null], ["parametres.html", null], ["marges.html", null], ["statistiques.html", null], ["ma-livraison.html", null],
]) {
  await ouvrir(t, page);
  await t.waitForTimeout(800);
  if (ouvrirFenetre) await ouvrirFenetre();
  const v = await t.evaluate(() => ({
    meta: document.querySelector('meta[name="viewport"]').content,
    petits: [...document.querySelectorAll("input:not([type=checkbox]):not([type=radio]):not([type=file]),select,textarea")]
      .filter((c) => c.getClientRects().length && !c.closest(".code-input-row") && parseFloat(getComputedStyle(c).fontSize) < 16)
      .map((c) => c.id || c.className),
    touch: getComputedStyle(document.body).touchAction,
  }));
  verifier(`E. ${page} : zoom permis`, !/user-scalable|maximum-scale/.test(v.meta) && /pinch-zoom|manipulation/.test(v.touch), v.touch); // Chrome écrit « manipulation » pour pan-x pan-y pinch-zoom
  verifier(`E. ${page} : champs à 16 px`, v.petits.length === 0, v.petits.join(", "));
}
await ouvrir(t, "commandes.html");
const zone = await t.evaluate(() => {
  const chip = document.querySelector(".f-chip");
  if (!chip) return null;
  const s = getComputedStyle(chip, "::after");
  return { contenu: s.content, position: s.position, top: s.top, hauteur: chip.getBoundingClientRect().height };
});
verifier("G. .f-chip : zone agrandie par ::after", zone?.contenu === '""' && zone.position === "absolute" && zone.top === "-6px", JSON.stringify(zone));
await ctxTel.close();

// Corbeille
const ctxH = await contexte({ viewport: { width: 1280, height: 800 } });
const h = await ctxH.newPage();
await connecter(h);
await ouvrir(h, "corbeille-commandes.html");
await h.getByText("La corbeille est vide.").waitFor();
verifier("H. corbeille : « 0 commande »", (await h.locator(".tb-date").textContent()).trim() === "0 commande dans la corbeille");
await ctxH.close();

verifier("Aucune erreur JavaScript", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));
await navigateur.close();
serveur.kill();
process.exit(bilan() ? 1 : 0);
