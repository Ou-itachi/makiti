// Simulation complète de la mise à jour n°6 (section 12), sur l'émulateur :
// 2 admins, 1 livreur et 1 client, dans de vrais navigateurs, sur téléphone
// simulé et sur ordinateur. Aucune écriture hors émulateur (mode ?emulator=1).
import { chromium, devices } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { db, compte, appeler, commande, attendre, verifier, bilan, Timestamp, horloge, nouvelId, attribuerPrete } from "./maj6-commun.mjs";

const RACINE = fileURLToPath(new URL("..", import.meta.url));
const PORT = 5078;
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.DOSSIER_CAPTURES || "/tmp";
const serveur = spawn(process.execPath, ["tools/serveur-local.cjs"], { cwd: RACINE, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
await attendre(async () => { try { return (await fetch(BASE + "/")).ok; } catch { return false; } });

const MDP = "motdepasse-test";
const EMAIL_LIVREUR = "livreur-sim@test.bokki";

// Toujours dans les horaires de livraison, quelle que soit l'heure du test.
const reel = new Date();
const dansHoraires = reel.getUTCHours() >= 8 && reel.getUTCHours() < 16;
const depart = new Date(reel); if (!dansHoraires) depart.setUTCHours(10, 0, 0, 0);
const decalage = depart.getTime() - reel.getTime();
await horloge({ decalageMs: decalage });

// --- Données de test ---
const adminA = await compte("admin-a-sim@test.bokki", MDP);
const adminB = await compte("admin-b-sim@test.bokki", MDP);
await db.collection("admins").doc(adminA.uid).set({ email: adminA.email, nom: "Aïssatou Admin" });
await db.collection("admins").doc(adminB.uid).set({ email: adminB.email, nom: "Boubacar Admin" });
await db.collection("parametres").doc("equipe").set({ telBokki: "622111111", telSecours: "117" });
await db.collection("fournisseurs").doc("four-sim").set({ nom: "Fournisseur test", montantDu: 0 });
const produitId = "produit-simulation";
await db.collection("produits").doc(produitId).set({
  infosGenerales: { nom: "Téléphone de simulation", categorie: "telephones", description: "Produit de test", marque: "Test" },
  caracteristiques: { prix: 500000 }, prixVente: 500000, fournisseurId: "four-sim", dateCreation: Timestamp.now(), images: [],
});
await db.collection("produits").doc(produitId).collection("interne").doc("achat").set({ prixAchat: 300000 });

const navigateur = await chromium.launch({ args: ["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const erreursJs = [];
async function contexte(options) {
  const ctx = await navigateur.newContext({ locale: "fr-FR", serviceWorkers: "block", ...options });
  ctx.setDefaultTimeout(90000);
  if (!dansHoraires) await ctx.clock.install({ time: depart });
  await ctx.addInitScript(() => { try { localStorage.setItem("bokki-emulator", "1"); } catch { /* ignore */ } });
  return ctx;
}
async function ouvrir(ctx, nom) {
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(`${nom} (${p.url()}) : ${e.message}`));
  p.on("dialog", (d) => d.accept());
  return p;
}
async function connexion(p, email, espace = /administrateur|admin/i, motDePasse = MDP) {
  await p.goto(`${BASE}/admin/login.html?emulator=1`);
  await p.getByRole("button", { name: espace }).click();
  await p.fill("#fid", email);
  await p.fill("#fpwd", motDePasse);
  await p.click("button.btn-submit, button.login-btn");
}
const page = (p, chemin) => p.goto(`${BASE}/admin/${chemin}`);
const donnees = async (id) => (await db.collection("commandes").doc(id).get()).data();
const statut = async (id) => (await donnees(id)).statut;
const statutVaut = (id, s) => attendre(async () => (await statut(id)) === s);
const notifie = (destinataire, id, texte) => attendre(async () => {
  const s = await db.collection("journalNotifications").where("destinataire", "==", destinataire).get();
  return s.docs.some((d) => (!id || d.data().commandeId === id) && (!texte || `${d.data().titre} ${d.data().corps}`.includes(texte)));
});
const carte = (p, numero) => p.locator(".lm-carte", { hasText: numero });
const longPress = async (p, selecteur, ms = 2300) => {
  const b = await p.locator(selecteur).boundingBox();
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await p.mouse.down();
  await p.waitForTimeout(ms);
  await p.mouse.up();
};
const debordement = (p) => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
// Confirmer et En préparation avec leurs listes de contrôle, puis qui livre.
async function cocherEtValider(p) {
  for (const c of await p.locator(".fen-cases input").all()) await c.check();
  await p.locator(".fen-pied .fen-btn.noir").click();
}
async function confirmerDansDetail(p, id, choix) {
  await page(p, `commande-detail.html?id=${id}&action=confirmer`);
  await p.locator(".fen-cases").waitFor();
  await cocherEtValider(p);
  await statutVaut(id, "confirmee");
  await p.getByRole("button", { name: "En préparation" }).click();
  await cocherEtValider(p);
  await statutVaut(id, "en_preparation");
  if (choix === "moi") await p.getByRole("button", { name: "Je livre moi-même" }).click();
  else {
    await p.getByRole("button", { name: "Assigner", exact: true }).click();
    await p.locator(".pastille-livreur").filter({ hasText: choix }).click();
    await p.locator(".btn-confirm:visible").click();
  }
  await attendre(async () => (await donnees(id)).livreurId);
}
const lancerApi = async (id, jeton) => appeler("changerStatutCommande", { commandeId: id, statut: "en_livraison", idAction: nouvelId() }, jeton);

const TELEPHONE = { ...devices["iPhone 13"] };
const GEO = { geolocation: { latitude: 9.6412, longitude: -13.5784, accuracy: 12 }, permissions: ["geolocation", "camera"] };

try {
  const ctxClient = await contexte(TELEPHONE);
  const ctxAdminA = await contexte({ viewport: { width: 1280, height: 800 }, ...GEO });
  const ctxAdminB = await contexte(TELEPHONE);
  const ctxLivreur = await contexte({ ...TELEPHONE, ...GEO });
  const ctxLivreurPc = await contexte({ viewport: { width: 1280, height: 800 }, ...GEO });

  // Préparation par l'interface : un admin crée le livreur, qui se connecte.
  const pA = await ouvrir(ctxAdminA, "admin A");
  await connexion(pA, adminA.email);
  await pA.waitForURL(/dashboard/);
  const pB = await ouvrir(ctxAdminB, "admin B");
  await connexion(pB, adminB.email);
  await pB.waitForURL(/dashboard/);
  await page(pA, "creer-livreur.html");
  for (const [champ, valeur] of [["#prenom", "Ousmane"], ["#nom", "Keita"], ["#tel", "622000020"], ["#urgence", "622000021"], ["#zone", "Ratoma"], ["#email", EMAIL_LIVREUR], ["#mdp", "provisoire-1234"], ["#tarif", "20000"]]) await pA.fill(champ, valeur);
  await pA.locator("form.lv-form button[type=submit]").click();
  const fiche = await attendre(async () => (await db.collection("livreurs").where("compteEmail", "==", EMAIL_LIVREUR).get()).docs[0]);
  verifier("0. L'admin crée le livreur", !!fiche);
  const livreurId = fiche.id;
  const pL = await ouvrir(ctxLivreur, "livreur");
  await connexion(pL, EMAIL_LIVREUR, /livreur/i, "provisoire-1234");
  await pL.fill("#fnew", MDP);
  await pL.fill("#fnew2", MDP);
  await pL.locator(".lg-accepte input").check();
  await pL.click("button.btn-submit");
  await pL.waitForURL(/tableau-livreur/);
  verifier("0. Première connexion : mot de passe et information acceptée", true);
  const livreur = await compte(EMAIL_LIVREUR, MDP);

  // Connexion : chacun par son espace, même avec une session déjà ouverte.
  const REFUS_ESPACE = "Désolé, ce n'est pas le bon espace. Utilisez l'espace livreur.";
  const ctxEspaces = await contexte(TELEPHONE);
  const pE = await ouvrir(ctxEspaces, "choix d'espace");
  await connexion(pE, EMAIL_LIVREUR);
  await pE.getByText(REFUS_ESPACE).waitFor();
  verifier("0. Livreur par le bouton admin : refusé avec le message", /login/.test(pE.url()) && await pE.getByRole("button", { name: /en tant que livreur/ }).isVisible());
  await page(pE, "ma-livraison.html");
  await pE.waitForURL(/login/);
  verifier("0. Livreur par le bouton admin : session fermée", true);
  await connexion(pE, EMAIL_LIVREUR, /en tant que livreur/);
  await pE.waitForURL(/tableau-livreur/);
  await connexion(pE, EMAIL_LIVREUR);
  await pE.getByText(REFUS_ESPACE).waitFor();
  await page(pE, "tableau-livreur.html");
  await pE.waitForURL(/login/);
  verifier("0. Session livreur déjà ouverte : même refus, session fermée", true);
  await connexion(pE, adminB.email, /en tant que livreur/);
  await pE.getByText("Désolé, ce n'est pas le bon espace. Utilisez l'espace administrateur.").waitFor();
  verifier("0. Admin par le bouton livreur : refusé avec le message", /login/.test(pE.url()));
  await connexion(pE, adminB.email);
  await pE.waitForURL(/dashboard/);
  verifier("0. Admin par son bouton : accepté", true);
  await ctxEspaces.close();
  const EMAIL_PREMIERE = "livreur-premiere-sim@test.bokki";
  const premiere = await appeler("creerLivreur", { prenom: "Mamadou", nom: "Barry", telephone: "622000022", contactUrgence: "622000023", email: EMAIL_PREMIERE, motDePasse: "provisoire-1234" }, adminA.jeton);
  const ctxPremiere = await contexte(TELEPHONE);
  const pP = await ouvrir(ctxPremiere, "première connexion");
  await connexion(pP, EMAIL_PREMIERE, /en tant que livreur/, "provisoire-1234");
  await pP.locator("#fnew").waitFor();
  await page(pP, "ma-livraison.html");
  await pP.waitForURL(/premiere=1/);
  await pP.locator("#fnew").waitFor();
  verifier("0. Première connexion reprise par auth-guard : pas refusée", premiere.ok && (await pP.getByText(REFUS_ESPACE).count()) === 0);
  await ctxPremiere.close();

  // 1. Le client commande ; un admin confirme avec « Je livre moi-même ».
  const pC = await ouvrir(ctxClient, "client");
  await pC.goto(`${BASE}/produit.html?id=${produitId}&emulator=1`);
  await pC.locator("#pTitle").filter({ hasNotText: "Chargement" }).waitFor();
  await pC.click("#btnPanier");
  await pC.goto(`${BASE}/panier`);
  await pC.click("#commander");
  await pC.waitForURL(/commande\/identification/);
  await pC.fill("#tel", "622334455");
  const cases = pC.locator("#pin input");
  for (const [i, c] of [..."4827"].entries()) await cases.nth(i).fill(c);
  await pC.click("#continuer");
  await pC.waitForURL(/commande\/livraison/);
  await pC.fill("#nom", "Mariama Baldé");
  await pC.fill("#ville", "Conakry");
  await pC.fill("#quartier", "Kipé");
  await pC.fill("#repere", "Près de la pharmacie");
  await pC.click("#confirmer");
  await pC.waitForURL(/confirmation/);
  const creee = await attendre(async () => (await db.collection("commandes").where("clientNom", "==", "Mariama Baldé").limit(1).get()).docs[0]);
  const cid = creee.id;
  const { numero, codeLivraison } = creee.data();
  verifier("1. Le client commande", creee.data().statut === "nouvelle", numero);
  await creee.ref.update({ fcmToken: "jeton-client-simulation" });
  await pC.goto(`${BASE}/suivi`);
  await pC.fill("#numero", numero);
  await pC.fill("#code", codeLivraison);
  await pC.fill("#tel", "622334455");
  await pC.click("#chercher");
  await pC.getByText("En attente de confirmation").first().waitFor();
  await confirmerDansDetail(pA, cid, "moi");
  verifier("1. Confirmée par « Je livre moi-même »", (await donnees(cid)).livreurId === `admin_${adminA.uid}`);
  await page(pA, "ma-livraison.html");
  await carte(pA, numero).waitFor();
  verifier("1. Elle apparaît dans son « Ma livraison »", true);

  // 2. Une autre commande est assignée au livreur : chez lui seulement.
  const c2 = await commande({ produitId, clientNom: "Ibrahima Sow", quartier: "Dixinn" });
  const n2 = (await c2.get()).data().numero;
  await confirmerDansDetail(pB, c2.id, "Ousmane");
  verifier("2. Assignée au livreur", (await donnees(c2.id)).livreurId === livreurId);
  await page(pL, "ma-livraison.html");
  await carte(pL, n2).waitFor();
  verifier("2. Visible chez le livreur", await carte(pL, n2).isVisible());
  await pL.waitForTimeout(1000);
  verifier("2. Pas chez le livreur : la commande de l'admin", (await carte(pL, numero).count()) === 0);
  verifier("2. Pas chez l'admin : la commande du livreur", (await carte(pA, n2).count()) === 0);
  verifier("2. Le livreur n'a pas accès à Commandes", await (async () => { await page(pL, "commandes.html"); await pL.waitForURL(/ma-livraison/); return true; })());
  verifier("2. Aucun débordement sur téléphone", (await debordement(pL)) <= 0);
  await pL.screenshot({ path: `${CAPTURES}/ma-livraison-telephone.png`, fullPage: true });

  // 3. Une commande est annulée par l'admin après l'appel.
  const c3 = await commande({ produitId, clientNom: "Fatou Camara" });
  await page(pA, `commande-detail.html?id=${c3.id}&action=annulee_client`);
  await pA.selectOption("#raisonAnnulation", "Doublon");
  await pA.locator(".btn-confirm:visible").click();
  verifier("3. Annulée par l'admin après l'appel", !!(await statutVaut(c3.id, "annulee_client")));

  // 4. En préparation, puis lancement : partout en même temps.
  const pListe = await ouvrir(ctxAdminA, "admin A liste");
  await page(pListe, "commandes.html");
  await pListe.locator(`tr:has-text("${numero}")`).first().waitFor();
  verifier("4. En préparation", !!(await statutVaut(cid, "en_preparation")));
  await page(pA, "ma-livraison.html");
  await carte(pA, numero).click();
  await pA.getByRole("button", { name: "Je lance ma livraison" }).click();
  await pC.getByText("En livraison").first().waitFor();
  verifier("4. En livraison chez le client sans recharger", true);
  await pListe.locator(`tr:has-text("${numero}") .status-lecture`).filter({ hasText: "En livraison" }).waitFor();
  verifier("4. En livraison dans Commandes sans recharger", true);
  verifier("4. Le client est prévenu avec le prénom", !!(await notifie("client", cid, "arrive")));
  await page(pL, "ma-livraison.html");
  await carte(pL, n2).click();
  await pL.getByRole("button", { name: "Je lance ma livraison" }).click();
  verifier("4. Le livreur lance sur téléphone", !!(await statutVaut(c2.id, "en_livraison")));
  verifier("4. Une position part avec le bouton de statut", !!(await attendre(async () => !(await db.collection("positions").where("commandeId", "==", c2.id).where("source", "==", "statut").get()).empty)));

  // 5. Mauvais code 5 fois, blocage, correction ; puis le bon code.
  await pL.getByRole("button", { name: "Livrer", exact: true }).click();
  const faux = (await donnees(c2.id)).codeLivraison === "1111" ? "2222" : "1111";
  for (let i = 1; i <= 5; i++) {
    await pL.fill("#codeClient", faux);
    await pL.getByRole("button", { name: "Valider le code" }).click();
    if (i < 5) await pL.locator(".lm-code .form-error").filter({ hasText: String(5 - i) }).waitFor();
  }
  await pL.getByText("Trop d'essais").waitFor();
  verifier("5. Bloqué après 5 mauvais codes", (await donnees(c2.id)).codeBloque === true);
  verifier("5. « Appeler Bokki » proposé", await pL.getByRole("link", { name: "Appeler Bokki" }).isVisible());
  await page(pB, `commande-detail.html?id=${c2.id}`);
  await pB.getByRole("button", { name: "Corriger le statut" }).click();
  await pB.selectOption("#correctionStatut", "livree");
  await pB.fill("#correctionRaison", "Code vérifié par téléphone");
  await pB.locator(".btn-confirm:visible").click();
  verifier("5. Correction par l'admin", !!(await statutVaut(c2.id, "livree")));
  await carte(pA, numero).click();
  await pA.getByRole("button", { name: "Livrer", exact: true }).click();
  await pA.fill("#codeClient", codeLivraison);
  await pA.getByRole("button", { name: "Valider le code" }).click();
  await statutVaut(cid, "livree");
  await pC.getByText("Livrée").first().waitFor();
  verifier("5. Bon code : Livrée chez le client", true);
  await pListe.locator(`tr:has-text("${numero}") .status-lecture`).filter({ hasText: "Livrée" }).waitFor();
  verifier("5. Bon code : Livrée dans Commandes", true);
  const c5 = await commande({ produitId, clientNom: "Kadiatou Sylla" });
  const n5 = (await c5.get()).data().numero;
  await attribuerPrete(c5.id, { livreurId }, adminA.jeton);
  await lancerApi(c5.id, livreur.jeton);
  const pLPc = await ouvrir(ctxLivreurPc, "livreur ordinateur");
  await connexion(pLPc, EMAIL_LIVREUR, /livreur/i);
  await pLPc.waitForURL(/tableau-livreur/);
  await page(pLPc, "ma-livraison.html");
  await carte(pLPc, n5).click();
  await pLPc.getByRole("button", { name: "Livrer", exact: true }).click();
  await pLPc.fill("#codeClient", (await donnees(c5.id)).codeLivraison);
  await pLPc.getByRole("button", { name: "Valider le code" }).click();
  verifier("5. Livrée par le livreur sur ordinateur", !!(await statutVaut(c5.id, "livree")));
  const course = await attendre(async () => (await db.collection("courses").doc(c5.id).get()).data());
  verifier("5. Course comptée dans ses gains", course?.montantCourse === 20000, String(course?.montantCourse));
  verifier("5. Pas de course payée à l'admin", ((await db.collection("courses").doc(cid).get()).data()?.montantCourse || 0) === 0);
  await page(pLPc, "tableau-livreur.html");
  await pLPc.locator(".sum-card", { hasText: "Mes gains du jour" }).filter({ hasText: /40.000/ }).waitFor();
  verifier("5. Gains visibles dans son tableau de bord", true);

  // 6. Endommagée et raisons de Retournée, sur téléphone.
  await page(pL, "ma-livraison.html");
  for (const [libelle, attendu, raison] of [["Endommagée", "endommagee", null], ["Client a refusé", "retournee", "client_refuse"], ["Client n'a pas payé", "retournee", "client_non_paye"], ["Client absent", "retournee", "client_absent"]]) {
    const c = await commande({ produitId, clientNom: "Binta Diallo", fournisseurId: "four-sim", fcmToken: "jeton-client-simulation" });
    const n = (await c.get()).data().numero;
    await attribuerPrete(c.id, { livreurId }, adminA.jeton);
    await lancerApi(c.id, livreur.jeton);
    await carte(pL, n).click();
    await pL.getByRole("button", { name: libelle }).click();
    if (attendu === "endommagee") {
      await pL.setInputFiles("#photoPb", { name: "colis.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64") });
      await pL.getByText("Photo ajoutée.").waitFor();
      await pL.fill("#commentairePb", "Carton écrasé");
    }
    await pL.getByRole("button", { name: "Oui, confirmer" }).click();
    const ok = await statutVaut(c.id, attendu);
    const d = await donnees(c.id);
    verifier(`6. ${libelle} : statut et raison`, !!ok && (raison === null || d.raisonStatut?.raison === raison), `${d.statut} ${d.raisonStatut?.raison || ""}`);
    verifier(`6. ${libelle} : pas de course comptée`, !(await db.collection("courses").doc(c.id).get()).exists);
    verifier(`6. ${libelle} : le client est prévenu`, !!(await notifie("client", c.id, attendu === "endommagee" ? "problème" : "pas pu être livrée")));
    const copie = (await db.collection("livraisons").doc(c.id).get()).data();
    verifier(`6. ${libelle} : même statut et raison côté livraison`, copie?.statut === attendu && (raison === null || copie?.raison === raison));
  }

  // 7. Position, caméra, appel entrant simulé.
  const c7 = await commande({ produitId, clientNom: "Aminata Touré" });
  const n7 = (await c7.get()).data().numero;
  await attribuerPrete(c7.id, { livreurId }, adminA.jeton);
  await lancerApi(c7.id, livreur.jeton);
  await carte(pL, n7).click();
  await pL.getByRole("switch").click();
  await pL.getByText(/Position envoyée à/).waitFor();
  verifier("7. Position simulée reçue", !!(await attendre(async () => !(await db.collection("positions").where("commandeId", "==", c7.id).where("source", "==", "suivi").get()).empty)));
  const interrupteur = await pL.getByRole("switch").boundingBox();
  verifier("9. Interrupteur de 56 px", interrupteur.height >= 56, `${interrupteur.height}`);
  await pL.screenshot({ path: `${CAPTURES}/securite-telephone.png`, fullPage: true });
  await pL.getByRole("switch").click();
  await pL.getByText("Désactivée").waitFor();
  verifier("7. Position désactivée", true);
  await pL.getByRole("button", { name: "Je lance ma caméra" }).click();
  await pL.locator(".lm-enregistrement").waitFor();
  await pL.screenshot({ path: `${CAPTURES}/camera-telephone.png`, fullPage: true });
  const enr = await attendre(async () => (await db.collection("enregistrements").where("commandeId", "==", c7.id).get()).docs.find((d) => (d.data().morceaux || []).length >= 2));
  verifier("7. Morceaux envoyés pendant l'enregistrement", !!enr, `${enr?.data().morceaux?.length} morceaux`);
  await pL.evaluate(() => window.__enregistreur.flux.getVideoTracks()[0].dispatchEvent(new Event("mute")));
  const coupe = await attendre(async () => (await enr.ref.get()).data().etat === "interrompu");
  verifier("7. Appel entrant : enregistrement Interrompu", !!coupe, (await enr.ref.get()).data().raison);
  await page(pA, `enregistrements.html`);
  await pA.locator("tr", { hasText: n7 }).filter({ hasText: "Interrompu" }).waitFor();
  await pA.locator("tr", { hasText: n7 }).getByRole("button", { name: "Voir" }).click();
  await pA.locator("video.lv-video").waitFor();
  const video = await pA.evaluate(() => new Promise((r) => { const v = document.querySelector("video.lv-video"); const fin = () => r({ w: v.videoWidth, d: v.duration, e: v.error?.message }); if (v.readyState >= 1) fin(); else { v.onloadedmetadata = fin; v.onerror = fin; setTimeout(fin, 8000); } }));
  verifier("7. Morceaux lisibles dans Enregistrements", video.w > 0, JSON.stringify(video));
  verifier("7. Consultation par l'admin journalisée", !!(await attendre(async () => !(await db.collection("journalActivite").where("action", "==", "consulter_video").get()).empty)));
  await pL.waitForTimeout(500);

  // 8. SOS : les 2 admins, positions, prise en charge, clôture.
  await page(pB, "dashboard.html");
  await page(pA, "commandes.html");
  await pB.waitForTimeout(2000);
  await pL.locator(".lm-sos").waitFor();
  await pL.screenshot({ path: `${CAPTURES}/sos-bouton.png` });
  const avantBref = (await db.collection("alertes").where("type", "==", "sos").get()).size;
  await longPress(pL, ".lm-sos", 600);
  await pL.waitForTimeout(800);
  verifier("8. Un appui bref ne déclenche rien", (await db.collection("alertes").where("type", "==", "sos").get()).size === avantBref && (await pL.locator(".lm-sos-ecran").count()) === 0);
  await longPress(pL, ".lm-sos");
  await pL.getByText("Alerte envoyée").waitFor();
  await pL.screenshot({ path: `${CAPTURES}/sos-ecran.png` });
  verifier("8. Écran « Alerte envoyée »", await pL.locator(".lm-sos-ecran").getByRole("link", { name: "Appeler Bokki" }).isVisible() && await pL.locator(".lm-sos-ecran").getByRole("link", { name: "Appeler les secours" }).isVisible());
  await pA.locator(".lv-sos-bandeau").waitFor();
  await pB.locator(".lv-sos-bandeau").waitFor();
  verifier("8. Bandeau rouge chez les 2 admins", true);
  await pB.screenshot({ path: `${CAPTURES}/sos-bandeau-telephone.png` });
  verifier("8. Son chez les admins", (await pA.evaluate(() => window.__bokkiSon || 0)) > 0);
  verifier("8. Notification aux 2 admins", !!(await notifie(`admin:${adminA.uid}`, null, "SOS")) && !!(await notifie(`admin:${adminB.uid}`, null, "SOS")));
  // Celle de ce livreur : tests/securite-maj6.mjs laisse d'autres SOS dans le même émulateur.
  const alerte = (await db.collection("alertes").where("type", "==", "sos").where("livreurId", "==", livreurId).where("etat", "==", "active").get()).docs[0];
  const debut = Date.now();
  const positionsSos = await attendre(async () => (await db.collection("positions").where("alerteId", "==", alerte.id).get()).size >= 3, 80000);
  verifier("8. Une position toutes les 30 s", !!positionsSos, `${Math.round((Date.now() - debut) / 1000)} s pour 3 points`);
  await pA.locator(".lv-sos-bandeau a").click();
  await pA.getByRole("button", { name: "Je prends en charge" }).waitFor();
  await pA.locator("#carteIncident.leaflet-container").waitFor();
  verifier("8. Carte de l'alerte affichée", true);
  await pA.waitForTimeout(1000);
  await pA.screenshot({ path: `${CAPTURES}/incident-ordinateur.png` });
  await pA.getByRole("button", { name: "Je prends en charge" }).click();
  await pB.locator(".lv-sos-bandeau").waitFor({ state: "detached" });
  verifier("8. Prise en charge : bandeau retiré", (await alerte.ref.get()).data().priseParNom === "Aïssatou Admin", (await alerte.ref.get()).data().priseParNom);
  await pA.getByRole("button", { name: "Clôturer" }).click();
  await pL.locator(".lm-sos-ecran").waitFor({ state: "detached" });
  verifier("8. Clôture : fin de l'alerte chez le livreur", (await alerte.ref.get()).data().etat === "cloturee");
  await longPress(pL, ".lm-sos");
  await pL.getByText("Alerte envoyée").waitFor();
  await pL.locator(".lm-sos-annuler").click();
  await pL.locator(".lm-sos-ecran").waitFor({ state: "detached" });
  await pL.locator(".lm-sos").waitFor();
  const sosMaintenu = (await db.collection("alertes").where("type", "==", "sos").where("livreurId", "==", livreurId).where("etat", "==", "active").get()).docs[0];
  verifier("8. Annuler ramène à l'application, le signal reste", !!sosMaintenu);
  await pL.reload();
  await pL.locator(".lm-sos").waitFor();
  verifier("8. Après rechargement : pas d'écran SOS, alerte toujours active", !(await pL.locator(".lm-sos-ecran").count()) && (await sosMaintenu.ref.get()).data().etat === "active");

  // 9. Alertes 30 minutes et 18 h 30 (horloge simulée).
  const lancee = (await donnees(c7.id)).lanceeLe.toMillis();
  await db.doc("horlogeTest/actuelle").set({ ms: lancee + 29 * 60000 });
  await appeler("testerTachesLivraison", { tache: "alertes" }, adminA.jeton);
  verifier("9. Pas d'alerte avant 30 minutes", !(await db.collection("alertes").doc(`retard30_${c7.id}`).get()).exists);
  await db.doc("horlogeTest/actuelle").set({ ms: lancee + 31 * 60000 });
  await appeler("testerTachesLivraison", { tache: "alertes" }, adminA.jeton);
  const a30 = (await db.collection("alertes").doc(`retard30_${c7.id}`).get()).data();
  verifier("9. Alerte 30 minutes avec la dernière position", !!a30?.dernierePosition);
  const soir = new Date(lancee); soir.setUTCHours(18, 31, 0, 0);
  await db.doc("horlogeTest/actuelle").set({ ms: soir.getTime() });
  await appeler("testerTachesLivraison", { tache: "alertes" }, adminA.jeton);
  verifier("9. Alerte 18 h 30", (await db.collection("alertes").where("type", "==", "retard_1830").get()).size >= 1);
  await horloge({ decalageMs: decalage });
  await page(pA, "incidents.html");
  await pA.locator("tr", { hasText: "Pas de nouvelles depuis 30 minutes" }).first().waitFor();
  verifier("9. Alertes visibles dans Incidents et SOS", true);
  await pA.screenshot({ path: `${CAPTURES}/incidents-liste.png`, fullPage: true });
  verifier("9. Notification aux admins", !!(await notifie(`admin:${adminB.uid}`, null, "30 minutes")));

  // 11. Coupure réseau pendant une action, puis retour.
  const c11 = await commande({ produitId, clientNom: "Hawa Condé" });
  const n11 = (await c11.get()).data().numero;
  await attribuerPrete(c11.id, { livreurId }, adminA.jeton);
  await page(pL, "ma-livraison.html");
  await carte(pL, n11).click();
  await ctxLivreur.setOffline(true);
  await pL.getByRole("button", { name: "Je lance ma livraison" }).click();
  await pL.getByText("En attente de réseau").first().waitFor();
  verifier("11. Action gardée sur le téléphone", (await statut(c11.id)) === "en_preparation");
  await ctxLivreur.setOffline(false);
  verifier("11. Partie au retour du réseau", !!(await statutVaut(c11.id, "en_livraison")));
  await pL.waitForTimeout(2500);
  verifier("11. Une seule fois", (await donnees(c11.id)).historique.filter((h) => h.vers === "en_livraison").length === 1);

  // 10. Fin de journée, argent reçu avec écart, paiement.
  await lancerApi(c7.id, livreur.jeton);
  await pL.getByRole("button", { name: "Terminer ma journée" }).click();
  await pL.getByText("Résumé de ma journée").waitFor();
  await pL.screenshot({ path: `${CAPTURES}/journee-telephone.png` });
  const resume = await pL.locator(".modal .lv-defs").innerText();
  verifier("10. Résumé de journée", /Livrées\s*\n?\s*2/.test(resume) && /Retournées\s*\n?\s*3/.test(resume), resume.replace(/\s+/g, " "));
  await pL.getByRole("button", { name: "Fermer" }).click();
  const attendu = (await db.collection("journees").where("livreurId", "==", livreurId).get()).docs[0]?.data().encaisse || 0;
  await page(pA, "paiement-livreurs.html");
  const ligneLivreur = pA.locator("tr", { hasText: "Ousmane" }).first();
  await ligneLivreur.getByRole("button", { name: "Argent reçu" }).click();
  await pA.fill("#aMontant", String(attendu - 1000));
  await pA.locator(".btn-save:visible").click();
  const journee = await attendre(async () => (await db.collection("journees").where("livreurId", "==", livreurId).get()).docs.find((d) => d.data().etat === "recue"));
  verifier("10. Argent reçu avec écart", journee?.data().ecart === -1000, String(journee?.data().ecart));
  await ligneLivreur.getByRole("button", { name: /^(Payer|Corriger)/ }).click();
  await pA.fill("#pMontant", "10000");
  await pA.fill("#pNote", "Avance");
  await pA.locator(".btn-save:visible").click();
  const paye = await attendre(async () => (await db.collection("paiementsLivreurs").where("livreurId", "==", livreurId).get()).docs[0]);
  verifier("10. Paiement enregistré", paye?.data().montant === 10000);
  const adminsPayes = (await db.collection("paiementsLivreurs").get()).docs.filter((d) => String(d.data().livreurId).startsWith("admin_"));
  verifier("10. Aucun paiement d'admin", adminsPayes.length === 0);

  // 12. Livreur désactivé : déconnecté et bloqué, sur ses deux appareils.
  await page(pA, `fiche-livreur.html?id=${livreurId}`);
  await page(pLPc, "ma-livraison.html");
  await pA.getByRole("button", { name: "Désactiver" }).click();
  await pL.waitForURL(/login/);
  await pLPc.waitForURL(/login/);
  verifier("12. Déconnecté tout de suite sur ses 2 appareils", true);
  await connexion(pL, EMAIL_LIVREUR, /livreur/i);
  await pL.waitForTimeout(3000);
  verifier("12. Reconnexion bloquée", !/tableau-livreur|ma-livraison/.test(pL.url()), pL.url());
  verifier("12. Son accès serveur est coupé", !(await lancerApi(c11.id, livreur.jeton)).ok);

  verifier("Aucune erreur JavaScript", erreursJs.length === 0, erreursJs.slice(0, 3).join(" | "));
} catch (e) {
  verifier("Exécution de la simulation", false, e.message.split("\n").slice(0, 4).join(" "));
  let n = 0;
  for (const ctx of navigateur.contexts()) for (const p of ctx.pages()) {
    n += 1;
    console.log(`Page ${n} : ${p.url()}`);
    await p.screenshot({ path: `${CAPTURES}/echec-${n}.png` }).catch(() => undefined);
  }
  console.log("Erreurs JavaScript :", erreursJs.slice(0, 5).join(" | "));
} finally {
  await navigateur.close();
  serveur.kill();
}
process.exit(bilan() ? 1 : 0);
