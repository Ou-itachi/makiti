// Simulation complète de la mise à jour n°5 (section 7), sur l'émulateur :
// un client, un admin et un livreur, dans de vrais navigateurs.
// Aucune écriture hors émulateur : les navigateurs sont en mode ?emulator=1.
import { chromium, devices } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { db, adminAuth, compte, appeler, commande, attendre as attendreBase, verifier, bilan, Timestamp } from "./maj5-commun.mjs";

// L'émulateur exécute les fonctions l'une après l'autre : marge large.
const attendre = (condition, delai = 90000) => attendreBase(condition, delai);
const RACINE = fileURLToPath(new URL("..", import.meta.url));
const PORT = 5078;
const BASE = `http://127.0.0.1:${PORT}`;
const serveur = spawn(process.execPath, ["tools/serveur-local.cjs"], { cwd: RACINE, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
await attendre(async () => { try { return (await fetch(BASE + "/")).ok; } catch { return false; } });

// --- Données de test ---
const MDP = "motdepasse-test";
const adminC = await compte("admin-sim@test.bokki", MDP);
await db.collection("admins").doc(adminC.uid).set({ email: adminC.email });
await db.collection("livreurs").doc("liv-sim").set({ nom: "Ousmane Keita", telephone: "622000020", zonePrincipale: "Ratoma", fraisParLivraison: 20000 });
await db.collection("livreurs").doc("liv-autre").set({ nom: "Alpha Barry", telephone: "622000021" });
const lien = await appeler("lierCompteLivreur", { livreurId: "liv-sim", email: "livreur-sim@test.bokki", motDePasse: MDP }, adminC.jeton);
if (!lien.ok) throw new Error("Compte livreur : " + lien.message);
await db.collection("fournisseurs").doc("four-sim").set({ nom: "Fournisseur test", montantDu: 0 });
await db.collection("parametres").doc("parrainage").set({ actif: true, pourcentParrain: 10, plafondParrain: 1000000, maxFilleulsParMois: 0 });
const produitId = "produit-simulation";
await db.collection("produits").doc(produitId).set({
  infosGenerales: { nom: "Téléphone de simulation", categorie: "telephones", description: "Produit de test", marque: "Test" },
  caracteristiques: { prix: 500000 }, prixVente: 500000, fournisseurId: "four-sim", dateCreation: Timestamp.now(), images: [],
});
await db.collection("produits").doc(produitId).collection("interne").doc("achat").set({ prixAchat: 300000 });
const parrain = await adminAuth.createUser({ email: "parrain-sim@test.bokki" });
await db.collection("clients").doc(parrain.uid).set({ creditParrainage: 0, gainsParrainage: 0, nbFilleulsLivres: 0 });

const navigateur = await chromium.launch({ args: ["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests"] });
const erreursJs = [];
async function contexte(options) {
  const ctx = await navigateur.newContext({ ...options, serviceWorkers: "block", permissions: [] });
  ctx.setDefaultTimeout(90000);
  await ctx.addInitScript(() => { try { localStorage.setItem("bokki-emulator", "1"); } catch { /* ignore */ } });
  return ctx;
}
async function page(ctx, nom) {
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(`${nom} : ${e.message}`));
  p.on("dialog", (d) => d.accept());
  return p;
}
async function connexion(p, email) {
  await p.goto(`${BASE}/admin/login.html?emulator=1`);
  await p.fill("#fid", email);
  await p.fill("#fpwd", MDP);
  await p.click("button.login-btn");
}
const ligne = (p, numero) => p.locator(`.ml-table tr[data-numero="${numero}"]`);
const statutBase = async (id) => (await db.collection("commandes").doc(id).get()).data().statut;
const notification = (destinataire, id, titre) => attendre(async () => {
  const s = await db.collection("journalNotifications").where("commandeId", "==", id).get();
  return s.docs.some((d) => d.data().destinataire === destinataire && (!titre || d.data().titre.includes(titre)));
});

try {
  const ctxClient = await contexte({ ...devices["iPhone 13"], locale: "fr-FR" });
  const ctxAdmin = await contexte({ viewport: { width: 1280, height: 800 }, locale: "fr-FR" });
  const ctxLivreur = await contexte({ ...devices["iPhone 13"], locale: "fr-FR" });
  const ctxLivreurPc = await contexte({ viewport: { width: 1280, height: 800 }, locale: "fr-FR" });

  // 1. Le client passe une commande.
  const pClient = await page(ctxClient, "client");
  await pClient.goto(`${BASE}/produit.html?id=${produitId}&emulator=1`);
  await pClient.locator("#pTitle").filter({ hasNotText: "Chargement" }).waitFor({ timeout: 90000 });
  await pClient.click("#btnPanier");
  await pClient.goto(`${BASE}/panier`);
  await pClient.click("#commander");
  await pClient.waitForURL(/commande\/identification/, { timeout: 90000 });
  await pClient.fill("#tel", "622334455");
  const cases = pClient.locator("#pin input");
  for (const [i, c] of [..."4827"].entries()) await cases.nth(i).fill(c);
  await pClient.click("#continuer");
  await pClient.waitForURL(/commande\/livraison/, { timeout: 90000 });
  await pClient.fill("#nom", "Mariama Baldé");
  await pClient.fill("#ville", "Conakry");
  await pClient.fill("#quartier", "Kipé");
  await pClient.fill("#repere", "Près de la pharmacie");
  await pClient.click("#confirmer");
  await pClient.waitForURL(/confirmation/, { timeout: 90000 });
  const creee = await attendre(async () => (await db.collection("commandes").where("clientNom", "==", "Mariama Baldé").limit(1).get()).docs[0]);
  verifier("1. Le client passe une commande", !!creee, creee?.data().numero);
  const cid = creee.id;
  const { numero, codeLivraison, statut: statutDepart } = creee.data();
  verifier("1. Commande au statut Nouvelle", statutDepart === "nouvelle");
  await creee.ref.update({ fcmToken: "jeton-client-simulation" });

  // Suivi ouvert par le client pendant toute la simulation.
  await pClient.goto(`${BASE}/suivi`);
  await pClient.fill("#numero", numero);
  await pClient.fill("#code", codeLivraison);
  await pClient.fill("#tel", "622334455");
  await pClient.click("#chercher");
  await pClient.getByText("En attente de confirmation").first().waitFor({ timeout: 90000 });

  // 2. L'admin confirme en touchant le prénom du livreur.
  const pAdmin = await page(ctxAdmin, "admin");
  await connexion(pAdmin, adminC.email);
  await pAdmin.waitForURL(/dashboard/, { timeout: 90000 });
  await pAdmin.goto(`${BASE}/admin/commande-detail.html?id=${cid}`);
  await pAdmin.locator(".tb-actions .add-btn").click();
  await pAdmin.getByRole("button", { name: "Confirmer et attribuer" }).click();
  await pAdmin.getByText("Choisissez qui livrera cette commande.").waitFor({ timeout: 5000 });
  verifier("2. Impossible de confirmer sans livreur", (await statutBase(cid)) === "nouvelle");
  await pAdmin.getByRole("radio", { name: /Ousmane/ }).click();
  await pAdmin.fill("#noteLivreur", "Appeler avant d'arriver");
  await pAdmin.getByRole("button", { name: "Confirmer et attribuer" }).click();
  verifier("2. L'admin confirme en touchant le prénom", !!(await attendre(async () => (await statutBase(cid)) === "confirmee")));
  verifier("2. Le livreur est prévenu", !!(await notification("livreur:liv-sim", cid, "Nouvelle livraison")));
  verifier("2. Le client reçoit sa notification", !!(await notification("client", cid, "confirmée")));

  // 3. Le livreur, sur téléphone simulé, passe en livraison.
  const pLivreur = await page(ctxLivreur, "livreur");
  await connexion(pLivreur, "livreur-sim@test.bokki");
  await pLivreur.waitForURL(/mes-livraisons/, { timeout: 90000 });
  await pLivreur.goto(`${BASE}/admin/commandes.html`);
  await pLivreur.waitForURL(/mes-livraisons/, { timeout: 90000 });
  verifier("3. Le livreur est renvoyé vers Mes livraisons depuis Commandes", true);
  await ligne(pLivreur, numero).waitFor({ timeout: 90000 });
  verifier("2. La commande apparaît dans Mes livraisons", await ligne(pLivreur, numero).isVisible());
  const texteLigne = await ligne(pLivreur, numero).innerText();
  verifier("3. Client affiché en initiales et quartier", texteLigne.includes("M. B.") && texteLigne.includes("Kipé") && !texteLigne.includes("Mariama"));
  const contenu = await pLivreur.content();
  verifier("3. Le code de livraison n'arrive pas au livreur", !contenu.includes(`>${codeLivraison}<`));
  verifier("3. Le menu du livreur est réduit", (await pLivreur.locator(".sb-link").filter({ hasText: "Commandes" }).count()) === 0);
  const largeur = await pLivreur.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  verifier("3. Aucun débordement sur téléphone", largeur <= 0, `${largeur} px`);
  await pLivreur.screenshot({ path: `${process.env.DOSSIER_CAPTURES || "/tmp"}/livreur-telephone-liste.png` });
  await ligne(pLivreur, numero).getByRole("button", { name: numero }).click();
  await pLivreur.getByTestId("fiche-livraison").waitFor();
  await pLivreur.screenshot({ path: `${process.env.DOSSIER_CAPTURES || "/tmp"}/livreur-telephone-fiche.png`, fullPage: true });
  const dernierGros = pLivreur.locator(".ml-btn.gros").last();
  await dernierGros.scrollIntoViewIfNeeded();
  const boite = await dernierGros.boundingBox();
  verifier("3. Les trois gros boutons sont visibles sur téléphone", (await pLivreur.locator(".ml-btn.gros").count()) === 3 && boite.height >= 48 && boite.y + boite.height <= pLivreur.viewportSize().height, `hauteur ${boite.height}`);
  await pLivreur.screenshot({ path: `${process.env.DOSSIER_CAPTURES || "/tmp"}/livreur-telephone-boutons.png` });
  const pCommandes = await page(ctxAdmin, "admin liste");
  await pCommandes.goto(`${BASE}/admin/commandes.html`);
  await pCommandes.locator(`tr:has-text("${numero}")`).first().waitFor({ timeout: 90000 });
  await pLivreur.getByRole("button", { name: "Passer en « En livraison »" }).click();
  verifier("3. Statut En livraison en base", !!(await attendre(async () => (await statutBase(cid)) === "en_livraison")));
  verifier("3. Le statut change dans Commandes sans recharger", !!(await attendre(async () => (await pCommandes.locator(`tr:has-text("${numero}") select`).first().inputValue()) === "en_livraison")));
  await pAdmin.locator(".status-pill.transit").first().waitFor({ timeout: 90000 });
  verifier("3. Le statut change dans le détail admin", true);
  await pClient.getByText("En livraison").first().waitFor({ timeout: 90000 });
  verifier("3. Le statut change dans le suivi du client", true);
  await pLivreur.getByRole("button", { name: "Toutes mes livraisons" }).click();
  verifier("3. Le client reçoit sa notification", !!(await notification("client", cid, "livraison")));

  // 3 bis. Même chose sur ordinateur.
  const cPc = await commande({ produitId, clientNom: "Ibrahima Sow", quartier: "Dixinn" });
  await appeler("attribuerLivreur", { commandeId: cPc.id, livreurId: "liv-sim" }, adminC.jeton);
  const numeroPc = (await cPc.get()).data().numero;
  const pPc = await page(ctxLivreurPc, "livreur ordinateur");
  await connexion(pPc, "livreur-sim@test.bokki");
  await pPc.waitForURL(/mes-livraisons/, { timeout: 90000 });
  await ligne(pPc, numeroPc).waitFor({ timeout: 90000 });
  await pPc.screenshot({ path: `${process.env.DOSSIER_CAPTURES || "/tmp"}/livreur-ordinateur.png` });
  await ligne(pPc, numeroPc).getByRole("button", { name: "Passer en livraison" }).click();
  verifier("3. Le livreur passe en livraison sur ordinateur", !!(await attendre(async () => (await statutBase(cPc.id)) === "en_livraison")));

  // Le livreur ne valide pas le code.
  await ligne(pPc, numero).getByRole("button", { name: "Valider le code" }).click();
  await pPc.getByText("réservée à l'admin").waitFor({ timeout: 5000 });
  verifier("7. Valider le code : message clair pour le livreur", (await statutBase(cid)) === "en_livraison");

  // 4. L'admin valide le code.
  await pAdmin.goto(`${BASE}/admin/commande-detail.html?id=${cid}&action=code`);
  const chiffres = pAdmin.locator(".code-input-row input");
  await chiffres.first().waitFor({ state: "visible", timeout: 90000 });
  await chiffres.first().fill("9");
  await chiffres.nth(1).fill("9");
  await chiffres.nth(2).fill("9");
  await chiffres.nth(3).fill("9");
  await pAdmin.getByRole("button", { name: "Valider la livraison" }).click();
  await pAdmin.getByText("Code incorrect").waitFor({ timeout: 90000 });
  verifier("4. Mauvais code refusé", (await statutBase(cid)) === "en_livraison");
  for (const [i, c] of [...codeLivraison].entries()) await chiffres.nth(i).fill(c);
  await pAdmin.getByRole("button", { name: "Valider la livraison" }).click();
  verifier("4. Le bon code passe la commande en Livrée", !!(await attendre(async () => (await statutBase(cid)) === "livree")));
  verifier("4. Livrée dans Commandes", !!(await attendre(async () => (await pCommandes.locator(`tr:has-text("${numero}") select`).first().inputValue()) === "Livrée" || (await pCommandes.locator(`tr:has-text("${numero}") select`).first().innerText()).includes("Livrée"))));
  await pClient.getByText("Livrée").first().waitFor({ timeout: 90000 });
  verifier("4. Livrée dans le suivi du client", true);
  verifier("4. Fournisseur crédité", !!(await attendre(async () => (await db.collection("fournisseurs").doc("four-sim").get()).data().montantDu === 300000)));
  verifier("4. Code de livraison libéré", !!(await attendre(async () => !(await db.collection("codesActifs").doc(codeLivraison).get()).exists)));

  const cParrain = await commande({ parrainUid: parrain.uid, codeParrainage: "TEST", articles: [{ produitId, nom: "T", quantite: 1, prixInitial: 100000 }] });
  await appeler("attribuerLivreur", { commandeId: cParrain.id, livreurId: "liv-sim" }, adminC.jeton);
  await appeler("changerStatutCommande", { commandeId: cParrain.id, statut: "en_livraison", idAction: "actionparrainage0001" }, adminC.jeton);
  const codeP = (await cParrain.get()).data().codeLivraison;
  await appeler("validerCodeLivraison", { commandeId: cParrain.id, code: codeP }, adminC.jeton);
  verifier("4. Parrain récompensé", !!(await attendre(async () => (await db.collection("clients").doc(parrain.uid).get()).data().creditParrainage === 10000)));

  // 5. Retournée, Endommagée, Annulée par le client.
  // Deux commandes livrées à 300 000 : crédit asynchrone, attendu avant de comparer.
  verifier("4. Fournisseur crédité une fois par commande livrée", !!(await attendre(async () => (await db.collection("fournisseurs").doc("four-sim").get()).data().montantDu === 600000)));
  const duAvant = 600000;
  const payeur = await adminAuth.createUser({ email: "payeur-sim@test.bokki" });
  await db.collection("clients").doc(payeur.uid).set({ creditParrainage: 0 });
  const creer = async (nom) => {
    const r = await commande({ clientNom: nom, uid: payeur.uid, reductionCredit: 5000, clientTel: "622000099" });
    await appeler("attribuerLivreur", { commandeId: r.id, livreurId: "liv-sim" }, adminC.jeton);
    return { ref: r, ...(await r.get()).data() };
  };
  const cRetour = await creer("Aïssatou Diallo");
  const cDegat = await creer("Mamadou Camara");
  const cAnnul = await creer("Fatoumata Barry");
  await ligne(pLivreur, cRetour.numero).waitFor({ timeout: 90000 });

  await ligne(pLivreur, cRetour.numero).getByRole("button", { name: cRetour.numero }).click();
  await pLivreur.getByRole("button", { name: "Retournée" }).click();
  await pLivreur.getByRole("button", { name: "Oui, confirmer" }).click();
  await pLivreur.getByText("Choisissez la raison.").waitFor({ timeout: 5000 });
  await pLivreur.selectOption("#mlRaison", "client_absent");
  await pLivreur.getByRole("button", { name: "Oui, confirmer" }).click();
  verifier("5. Retournée avec raison", !!(await attendre(async () => (await statutBase(cRetour.ref.id)) === "retournee")));
  await pLivreur.getByRole("button", { name: "Toutes mes livraisons" }).click();

  await ligne(pLivreur, cDegat.numero).getByRole("button", { name: cDegat.numero }).click();
  await pLivreur.getByRole("button", { name: /Endommagée/ }).click();
  await pLivreur.fill("#mlCommentaire", "Carton écrasé");
  await pLivreur.getByRole("button", { name: "Oui, confirmer" }).click();
  await pLivreur.getByText("Ajoutez une photo.").waitFor({ timeout: 5000 });
  const photoPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
  const fichier = `${process.env.DOSSIER_CAPTURES || "/tmp"}/colis.png`;
  writeFileSync(fichier, photoPng);
  await pLivreur.setInputFiles("#mlPhoto", fichier);
  await pLivreur.waitForTimeout(500);
  await pLivreur.getByRole("button", { name: "Oui, confirmer" }).click();
  verifier("5. Endommagée avec photo", !!(await attendre(async () => (await statutBase(cDegat.ref.id)) === "endommagee")));
  const degat = (await cDegat.ref.get()).data();
  verifier("5. Photo et commentaire enregistrés", !!degat.photoIncident && degat.raisonStatut?.commentaire === "Carton écrasé");
  await pLivreur.getByRole("button", { name: "Toutes mes livraisons" }).click();

  await ligne(pPc, cAnnul.numero).waitFor({ timeout: 90000 });
  await ligne(pPc, cAnnul.numero).getByRole("button", { name: "Changer le statut" }).click();
  await ligne(pPc, cAnnul.numero).getByRole("button", { name: "Annulée par le client" }).click();
  await pPc.fill("#mlAnnulation", "Le client a changé d'avis");
  await pPc.getByRole("button", { name: "Oui, confirmer" }).click();
  verifier("5. Annulée par le client avec raison", !!(await attendre(async () => (await statutBase(cAnnul.ref.id)) === "annulee_client")));

  for (const [nom, c, statut, titre] of [["Retournée", cRetour, "retournee", "retournée"], ["Endommagée", cDegat, "endommagee", "colis"], ["Annulée", cAnnul, "annulee_client", "annulée"]]) {
    verifier(`5. ${nom} : notification client`, !!(await notification("client", c.ref.id, titre)));
    verifier(`5. ${nom} : code libéré`, !!(await attendre(async () => !(await db.collection("codesActifs").doc(c.codeLivraison).get()).exists)));
    const suivi = await appeler("obtenirSuiviCommande", { commandeId: c.ref.id, code: c.codeLivraison, telephone: "622000099" });
    verifier(`5. ${nom} : suivi client`, suivi.resultat?.statut === statut, suivi.message);
    await pCommandes.goto(`${BASE}/admin/commandes.html?statut=${statut}`);
    await pCommandes.locator(`tr:has-text("${c.numero}")`).first().waitFor({ timeout: 90000 });
    verifier(`5. ${nom} : visible dans Commandes`, true);
  }
  verifier("5. Crédit parrainage rendu trois fois", !!(await attendre(async () => (await db.collection("clients").doc(payeur.uid).get()).data().creditParrainage === 15000)));
  await new Promise((r) => setTimeout(r, 5000));
  verifier("5. Fournisseur non crédité", (await db.collection("fournisseurs").doc("four-sim").get()).data().montantDu === duAvant);

  const pDet = await page(ctxAdmin, "admin photo");
  await pDet.goto(`${BASE}/admin/commande-detail.html?id=${cDegat.ref.id}`);
  await pDet.getByAltText("Photo du colis endommagé").waitFor({ timeout: 90000 });
  verifier("5. L'admin voit la photo et l'historique", (await pDet.locator(".hist-statut li").count()) >= 2);

  const pSuivi = await page(ctxClient, "client suivi");
  await pSuivi.goto(`${BASE}/suivi`);
  await pSuivi.fill("#numero", cDegat.numero);
  await pSuivi.fill("#code", cDegat.codeLivraison);
  await pSuivi.fill("#tel", "622000099");
  await pSuivi.click("#chercher");
  await pSuivi.getByText("Un problème est survenu avec votre colis").first().waitFor({ timeout: 90000 });
  verifier("5. Message clair dans le suivi du client", true);

  // 6. Coupure réseau pendant un changement de statut.
  const cReseau = await creer("Sékou Keita");
  await ligne(pLivreur, cReseau.numero).waitFor({ timeout: 90000 });
  await ctxLivreur.setOffline(true);
  await pLivreur.waitForTimeout(300);
  await ligne(pLivreur, cReseau.numero).getByRole("button", { name: "Passer en livraison" }).click();
  await ligne(pLivreur, cReseau.numero).getByText("Envoi en attente").waitFor({ timeout: 5000 });
  await pLivreur.waitForTimeout(1500);
  verifier("6. Hors ligne : action gardée, rien envoyé", (await statutBase(cReseau.ref.id)) === "confirmee");
  await pLivreur.reload().catch(() => undefined);
  await ctxLivreur.setOffline(false);
  await pLivreur.goto(`${BASE}/admin/mes-livraisons.html`);
  verifier("6. Retour du réseau : l'action part toute seule", !!(await attendre(async () => (await statutBase(cReseau.ref.id)) === "en_livraison")));
  await pLivreur.waitForTimeout(2500);
  const hist = (await cReseau.ref.get()).data().historique.filter((h) => h.vers === "en_livraison");
  verifier("6. Une seule fois", hist.length === 1, `${hist.length} entrée(s)`);
  verifier("6. File vide après envoi", await pLivreur.evaluate(() => (JSON.parse(localStorage.getItem("bokki-actions-livraison") || "[]")).length === 0));

  // 7. Action interdite.
  const cAutre = await commande({ clientNom: "Autre Client" });
  await appeler("attribuerLivreur", { commandeId: cAutre.id, livreurId: "liv-autre" }, adminC.jeton);
  await pLivreur.evaluate((id) => localStorage.setItem("bokki-actions-livraison", JSON.stringify([{ commandeId: id, numero: "BK-INTERDITE", statut: "en_livraison", idAction: "actioninterdite00001" }])), cAutre.id);
  await pLivreur.reload();
  await pLivreur.getByText("Cette commande ne vous est pas attribuée.").waitFor({ timeout: 90000 });
  verifier("7. Action interdite refusée avec un message clair", (await statutBase(cAutre.id)) === "confirmee");

  verifier("Aucune erreur JavaScript", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));
} catch (e) {
  verifier("Exécution de la simulation", false, e.message.split("\n").slice(0, 3).join(" "));
  let n = 0;
  for (const ctx of navigateur.contexts()) for (const p of ctx.pages()) {
    n += 1;
    console.log(`Page ${n} : ${p.url()}`);
    await p.screenshot({ path: `${process.env.DOSSIER_CAPTURES || "/tmp"}/echec-${n}.png` }).catch(() => undefined);
  }
  console.log("Erreurs JavaScript :", erreursJs.slice(0, 5).join(" | "));
} finally {
  await navigateur.close();
  serveur.kill();
}
process.exit(bilan() ? 1 : 0);
