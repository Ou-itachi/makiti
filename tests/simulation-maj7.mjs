// Simulation de la mise à jour n°7, sur l'émulateur, dans de vrais navigateurs :
// parcours A à F sur ordinateur puis sur téléphone. Aucune écriture hors
// émulateur (mode ?emulator=1).
import { chromium, devices } from "playwright";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { db, bucket, compte, appeler, commande, attendre, verifier, bilan, Timestamp, nouveauLivreur, horloge, nouvelId } from "./maj6-commun.mjs";

const RACINE = fileURLToPath(new URL("..", import.meta.url));
const PORT = 5078;
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.DOSSIER_CAPTURES || "/tmp";
const serveur = spawn(process.execPath, ["tools/serveur-local.cjs"], { cwd: RACINE, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
await attendre(async () => { try { return (await fetch(BASE + "/")).ok; } catch { return false; } });

const MDP = "motdepasse-test";
const midi = new Date(); midi.setUTCHours(12, 0, 0, 0);
await horloge({ decalageMs: midi.getTime() - Date.now() });
const admin = await compte("admin-maj7@test.bokki", MDP);
await db.collection("admins").doc(admin.uid).set({ email: admin.email, nom: "Aïssatou" });
await db.collection("parametres").doc("equipe").set({ telBokki: "622111111", telSecours: "117" });

const navigateur = await chromium.launch({ args: ["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests"] });
const erreursJs = [];
const NOM_LONG = "Mamadou-Alpha Ibrahima Sory Thierno Abdoulaye Diallo de Labé Télimélé";
const fournisseur = (id, champs) => db.collection("fournisseurs").doc(id).set({ telephone: "622000000", ...champs });
const produit = async (id, nom, fournisseurId) => {
  await db.collection("produits").doc(id).set({ infosGenerales: { nom, categorie: "telephones", description: "Test", marque: "Test" }, caracteristiques: { prix: 500000 }, prixVente: 500000, fournisseurId, dateCreation: Timestamp.now(), images: [] });
  await db.collection("produits").doc(id).collection("interne").doc("achat").set({ prixAchat: 300000 });
};
const du = async (id) => (await db.collection("fournisseurs").doc(id).get()).data().montantDu;
const pause = (p) => p.waitForTimeout(350); // fin de la transition entre pages

for (const [appareil, options] of [
  ["ordinateur", { viewport: { width: 1280, height: 800 } }],
  ["telephone", { ...devices["Pixel 5"] }],
]) {
  const tag = appareil[0];
  const nom = (texte) => `${appareil} : ${texte}`;
  const ctx = await navigateur.newContext({ locale: "fr-FR", serviceWorkers: "block", acceptDownloads: true, ...options });
  ctx.setDefaultTimeout(45000);
  await ctx.addInitScript(() => { try { localStorage.setItem("bokki-emulator", "1"); } catch { /* ignore */ } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erreursJs.push(`${appareil} (${p.url()}) : ${e.message}`));
  await p.goto(`${BASE}/admin/login.html?emulator=1`);
  await p.getByRole("button", { name: /administrateur|admin/i }).click();
  await p.fill("#fid", admin.email);
  await p.fill("#fpwd", MDP);
  await p.click("button.btn-submit, button.login-btn");
  await p.waitForURL(/admin\/(?!login)/);

  const page = async (chemin) => { await p.goto(`${BASE}/admin/${chemin}`); await p.waitForLoadState("domcontentloaded"); await pause(p); };
  const capture = async (n) => { await pause(p); await p.screenshot({ path: join(CAPTURES, `${appareil}-${n}.png`), fullPage: true }); };
  const fenetre = () => p.locator(".fen");
  const valider = () => p.locator(".fen-pied .fen-btn.noir, .fen-pied .fen-btn.rouge").click();
  // Pas de défilement horizontal, cibles de 44 px au moins sur téléphone.
  const mise = async (ecran, selecteurs = "main button:visible, .fen button:visible, input[type=checkbox]:visible") => {
    await pause(p); // fenêtre : mesure après son animation d'ouverture
    const debord = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    verifier(nom(`${ecran} : pas de défilement horizontal`), debord <= 0, `${debord} px`);
    if (appareil !== "telephone") return;
    const petits = await p.locator(selecteurs).evaluateAll((els) => els.flatMap((e) => {
      const r = (e.closest("label") || e).getBoundingClientRect();
      return r.width && (r.width < 44 || r.height < 44) ? [`${(e.getAttribute("aria-label") || e.textContent || e.type).trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`] : [];
    }));
    verifier(nom(`${ecran} : cibles de 44 px`), !petits.length, petits.slice(0, 5).join(" | "));
  };

  // --- Données propres à ce passage ---
  const F = { a: `${tag}-amina`, b: `${tag}-binta`, z: `${tag}-zoumana`, l: `${tag}-long`, x: `${tag}-sans-du` };
  await fournisseur(F.z, { nom: "Zoumana Traoré", montantDu: 0 });
  await fournisseur(F.a, { nom: "Aminata Camara", montantDu: 0 });
  await fournisseur(F.b, { nom: "binta Sow", montantDu: 2000000 });
  await fournisseur(F.l, { nom: NOM_LONG, montantDu: 999999999999 });
  await fournisseur(F.x, { nom: "Saliou Bah", montantDu: 0 });
  const retire = `${tag}-retire`, reste = `${tag}-reste`;
  await produit(retire, `Produit Masquable ${tag}`, F.a);
  await produit(reste, `Produit Toujours Visible ${tag}`, F.z);
  const livre = await commande({ articles: [{ produitId: reste, nom: "Produit", quantite: 2, prixInitial: 500000 }], statut: "en_livraison" });
  await livre.update({ statut: "livree", dateLivraison: Timestamp.now() });
  await attendre(async () => (await du(F.z)) === 600000, 30000);

  // --- A. Fournisseurs ---
  await page("fournisseurs.html");
  const lignes = p.locator(".fo-table tbody tr");
  await lignes.filter({ hasText: "Zoumana" }).waitFor();
  const noms = (await p.locator(".fo-table a.fo-nom").allTextContents()).map((n) => n.trim());
  const miens = noms.filter((n) => /^(Aminata|binta|Saliou|Zoumana|Mamadou)/.test(n)).filter((n, i, t) => t.indexOf(n) === i);
  verifier(nom("A. Liste de A à Z, sans tenir compte des majuscules"), miens.join("|") === ["Aminata Camara", "binta Sow", NOM_LONG, "Saliou Bah", "Zoumana Traoré"].join("|"), miens.join("|"));
  const ligneB = lignes.filter({ hasText: "binta Sow" }).first();
  await ligneB.getByRole("button", { name: "Non actif" }).click();
  await p.getByText("Réglez d'abord le montant dû").first().waitFor();
  verifier(nom("A. Dû > 0 : désactivation bloquée, message exact"), true);
  await ligneB.getByRole("button", { name: "Supprimer binta Sow" }).click();
  verifier(nom("A. Dû > 0 : suppression bloquée, pas de fenêtre"), (await fenetre().count()) === 0 && await p.getByText("Réglez d'abord le montant dû").first().isVisible());
  await mise("Fournisseurs");
  await capture("A-fournisseurs");

  await ligneB.getByRole("button", { name: "Payer binta Sow" }).click();
  await fenetre().waitFor();
  await p.fill("#fpMontant", "500000");
  await fenetre().getByText("Orange Money").click();
  await mise("Fenêtre de paiement", ".fen button:visible, .fen input[type=radio]:visible");
  await capture("A-paiement");
  await valider();
  await fenetre().getByText("Paiement enregistré").waitFor();
  verifier(nom("A. Paiement : dû diminué"), (await du(F.b)) === 1500000);
  const lienRecu = await fenetre().getByRole("link", { name: "Voir le reçu" }).getAttribute("href");
  const texteFen = await fenetre().innerText();
  verifier(nom("B. Numéro de reçu affiché"), /REC-\d{4}/.test(texteFen), texteFen);
  const numero = texteFen.match(/REC-\d{4,}/)[0];

  await page("fournisseurs.html");
  const ligneA = p.locator(".fo-table tbody tr").filter({ hasText: "Aminata" }).first();
  await ligneA.getByRole("button", { name: "Non actif" }).click();
  await fenetre().waitFor();
  await valider();
  await attendre(async () => (await db.collection("produits").doc(retire).get()).data().enLigne === false);
  verifier(nom("A. Dû = 0 : désactivé avec un produit en ligne, produit gardé"), (await db.collection("fournisseurs").doc(F.a).get()).data().actif === false);

  // Le site public, tel qu'un visiteur le voit.
  const pub = await ctx.newPage();
  pub.on("pageerror", (e) => erreursJs.push(`public ${appareil} : ${e.message}`));
  await pub.goto(`${BASE}/catalogue?emulator=1`);
  await pub.getByText(`Produit Toujours Visible ${tag}`).first().waitFor();
  verifier(nom("A. Boutique : produit visible présent, produit retiré absent"), (await pub.getByText(`Produit Masquable ${tag}`).count()) === 0);
  await pub.goto(`${BASE}/produit?id=${retire}&emulator=1`);
  await pub.waitForTimeout(2500);
  verifier(nom("A. Fiche du produit retiré indisponible"), !(await pub.locator("body").innerText()).includes(`Produit Masquable ${tag}`));
  verifier(nom("A. Site public muet sur le mot interne"), !/fournisseur|madina/i.test(await pub.locator("body").innerText()));
  await pub.close();

  await page(`fournisseur-detail.html?id=${F.a}`);
  await p.getByText("Retiré de la boutique").first().waitFor();
  verifier(nom("A. Fournisseur inactif : pas de remise en ligne directe"), (await p.getByRole("button", { name: "Remettre en ligne" }).count()) === 0);
  await p.getByRole("button", { name: "Rattacher à un autre fournisseur" }).first().click();
  await fenetre().locator("select").selectOption(F.z);
  await mise("Fenêtre de rattachement", ".fen button:visible");
  await valider();
  await attendre(async () => { const d = (await db.collection("produits").doc(retire).get()).data(); return d.fournisseurId === F.z && d.enLigne === undefined; });
  verifier(nom("A. Produit rattaché et de retour"), true);

  await page(`fournisseur-detail.html?id=${F.z}`);
  await p.getByText(livre.id ? (await livre.get()).data().numero : "").first().waitFor();
  verifier(nom("A. Détail : commande à régler affichée"), true);
  await mise("Détail du fournisseur", "main button:visible");
  await capture("A-detail");
  await page(`fournisseur-detail.html?id=${F.x}`);
  await p.getByRole("button", { name: /Supprimer/ }).first().click();
  await fenetre().waitFor();
  await valider();
  await attendre(async () => (await db.collection("fournisseurs").doc(F.x).get()).data().supprime === true);
  await p.waitForURL(/fournisseurs\.html/);
  verifier(nom("A. Fournisseur supprimé, sans dû"), true);

  // --- B. Reçus ---
  await page(lienRecu);
  await p.getByRole("heading", { name: "binta Sow" }).first().waitFor().catch(() => {});
  verifier(nom("B. Reçu : champs présents"), await p.locator("body").innerText().then((t) => ["binta sow", "orange money", "aïssatou", numero.toLowerCase()].every((m) => t.toLowerCase().includes(m))));
  await mise("Reçu", "main button:visible");
  await capture("B-recu");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "Télécharger le PDF" }).first().click()]);
  const cheminPdf = join(CAPTURES, `${appareil}-recu.pdf`);
  await dl.saveAs(cheminPdf);
  const pdf = readFileSync(cheminPdf);
  verifier(nom("B. Vrai fichier PDF"), pdf.subarray(0, 5).toString() === "%PDF-" && pdf.includes("%%EOF") && dl.suggestedFilename().endsWith(".pdf"), dl.suggestedFilename());
  await p.emulateMedia({ media: "print" });
  verifier(nom("B. Impression : menu masqué"), !(await p.locator(".sidebar, aside").first().isVisible().catch(() => false)));
  await p.emulateMedia({ media: "screen" });

  const paye2 = await appeler("enregistrerPaiementFournisseur", { fournisseurId: F.b, montant: 250000, mode: "especes", idAction: nouvelId() }, admin.jeton);
  await appeler("enregistrerPaiementFournisseur", { fournisseurId: F.l, montant: 999999999999, mode: "especes", idAction: nouvelId() }, admin.jeton);
  await page("versements-fournisseurs.html");
  const ligneV = p.locator("tbody tr").filter({ hasText: "binta Sow" }).first();
  await ligneV.waitFor();
  verifier(nom("B. Total versé par fournisseur"), /750\D?000/.test(await ligneV.innerText()), await ligneV.innerText());
  verifier(nom("B. Lien présent dans le menu"), (await p.locator('a[href*="versements-fournisseurs"]').count()) >= 1);
  await mise("Versements");
  await capture("B-versements");
  await ligneV.locator("a.fo-nom").click();
  await p.getByRole("button", { name: `Supprimer le reçu ${numero}` }).waitFor();
  await p.getByRole("checkbox", { name: `Sélectionner le reçu ${numero}` }).check();
  await p.getByRole("checkbox", { name: `Sélectionner le reçu ${paye2.resultat.numero}` }).check();
  await mise("Reçus d'un fournisseur");
  await capture("B-recus-selection");
  await p.locator(".lot-barre .lot-action.rouge").click();
  await fenetre().waitFor();
  await capture("B-confirmation");
  const duAvant = await du(F.b);
  await valider();
  await attendre(async () => (await db.collection("recus").where("beneficiaireId", "==", F.b).get()).empty);
  verifier(nom("B. Deux reçus supprimés, dû inchangé"), (await du(F.b)) === duAvant);
  verifier(nom("B. Paiements conservés"), (await db.collection("paiementsFournisseurs").where("fournisseurId", "==", F.b).get()).size === 2);
  await page("journal-activite.html");
  await p.getByText(`reçu n°${numero} supprimé par Aïssatou`).first().waitFor();
  verifier(nom("B. Journal : ligne courte"), true);

  await page(`recu.html?type=fournisseur&cible=${F.l}`);
  await p.getByText("Total du mois").first().waitFor();
  await mise("Fiche du mois, nom long", "main button:visible");
  await capture("B-fiche-long");
  const [dlFiche] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "Télécharger le PDF" }).first().click()]);
  await dlFiche.saveAs(join(CAPTURES, `${appareil}-fiche-long.pdf`));
  verifier(nom("B. Fiche du mois en PDF, nom long et grand montant"), readFileSync(join(CAPTURES, `${appareil}-fiche-long.pdf`)).subarray(0, 5).toString() === "%PDF-");
  await page(`recu.html?type=fournisseur&cible=${F.b}`);
  await p.getByText("Aucun reçu ce mois-ci.").waitFor();
  verifier(nom("B. Fiche sans reçu"), true);

  // --- C. Livreurs ---
  const liv = await nouveauLivreur(`livreur7-${appareil}`, admin.jeton, { prenom: tag === "o" ? "Oumar" : "Ousmane", nom: `Test ${appareil}` });
  await db.collection("courses").doc(`course-${appareil}`).set({ livreurId: liv.livreurId, montantCourse: 80000, mois: new Date().toISOString().slice(0, 7), date: Timestamp.now(), numero: "BK-C" });
  await page("paiement-livreurs.html");
  const ligneL = p.locator("tbody tr").filter({ hasText: `Test ${appareil}` }).first();
  await ligneL.waitFor();
  await mise("Paiement des livreurs");
  await capture("C-livreurs");
  await ligneL.getByRole("button", { name: /^(Payer|Corriger)/ }).click();
  await p.fill("#pMontant", "30000");
  await p.selectOption("#pMode", "orange_money");
  await p.locator(".btn-save:visible").click();
  await p.getByText("Paiement enregistré").first().waitFor();
  const recusL = () => db.collection("recus").where("beneficiaireId", "==", liv.livreurId).get();
  await attendre(async () => (await recusL()).size === 1);
  const recuL = (await recusL()).docs[0];
  verifier(nom("C. Reçu livreur automatique"), recuL.data().mode === "orange_money" && recuL.data().resteApres === 50000 && recuL.data().numero.startsWith("PL-"), recuL.data().numero);
  await page("paiement-livreurs.html");
  const reste1 = await p.locator("tbody tr").filter({ hasText: `Test ${appareil}` }).first().innerText();
  await p.getByRole("checkbox", { name: `Sélectionner le reçu ${recuL.data().numero}` }).check();
  await p.locator(".lot-action.rouge").click();
  await fenetre().waitFor();
  await valider();
  await attendre(async () => (await recusL()).empty);
  await page("paiement-livreurs.html");
  const reste2 = await p.locator("tbody tr").filter({ hasText: `Test ${appareil}` }).first().innerText();
  verifier(nom("C. Reçu supprimé : reste à payer inchangé"), reste1 === reste2 && /50\D?000/.test(reste2), reste2);
  verifier(nom("C. Paiement toujours compté"), (await db.collection("paiementsLivreurs").where("livreurId", "==", liv.livreurId).get()).size === 1);

  // --- D. Commandes : liste, puis détail ---
  const c1 = await commande({ clientNom: `Client liste ${tag}` });
  const n1 = (await c1.get()).data().numero;
  await page("commandes.html");
  const ligneC = () => p.locator("tr", { hasText: n1 }).first();
  await ligneC().waitFor();
  await ligneC().getByRole("button", { name: "Confirmer" }).click();
  await fenetre().waitFor();
  const cases = fenetre().locator(".fen-cases input");
  verifier(nom("D. Confirmer : 3 cases, aucune question de livreur"), (await cases.count()) === 3 && !/livreur/i.test(await fenetre().innerText()));
  verifier(nom("D. Bouton inactif tant que tout n'est pas coché"), await fenetre().locator(".fen-pied .fen-btn.noir").isDisabled());
  await cases.nth(0).check(); await cases.nth(1).check();
  verifier(nom("D. Bouton inactif avec 2 cases sur 3"), await fenetre().locator(".fen-pied .fen-btn.noir").isDisabled());
  await cases.nth(2).check();
  await mise("Liste de contrôle", ".fen button:visible, .fen input:visible");
  await capture("D-checklist");
  await valider();
  await attendre(async () => (await c1.get()).data().statut === "confirmee");
  verifier(nom("D. Confirmée, qui et quand notés"), (await c1.get()).data().validations.confirmee.nom === "Aïssatou" && !(await c1.get()).data().livreurId);
  await ligneC().getByRole("button", { name: "En préparation" }).click();
  await fenetre().waitFor();
  verifier(nom("D. En préparation : 3 cases"), (await fenetre().locator(".fen-cases input").count()) === 3);
  for (const c of await fenetre().locator(".fen-cases input").all()) await c.check();
  await valider();
  await attendre(async () => (await c1.get()).data().statut === "en_preparation");
  await ligneC().getByRole("button", { name: "Je livre moi-même" }).waitFor();
  verifier(nom("D. Liste : Je livre moi-même et Assigner, pas de 3e bouton"), (await ligneC().getByRole("link", { name: "Assigner" }).count()) === 1);
  await mise("Commandes", "main .ord-assigner:visible");
  await capture("D-commandes");
  await ligneC().getByRole("button", { name: "Je livre moi-même" }).click();
  await attendre(async () => (await c1.get()).data().livreurId);
  verifier(nom("D. Je livre moi-même"), true);

  const c2 = await commande({ clientNom: `Client détail ${tag}` });
  await page(`commande-detail.html?id=${c2.id}`);
  await p.getByRole("button", { name: "Confirmer" }).first().click();
  await fenetre().waitFor();
  for (const c of await fenetre().locator(".fen-cases input").all()) await c.check();
  await valider();
  await attendre(async () => (await c2.get()).data().statut === "confirmee");
  await p.getByRole("button", { name: "En préparation" }).first().click();
  await fenetre().waitFor();
  for (const c of await fenetre().locator(".fen-cases input").all()) await c.check();
  await valider();
  await attendre(async () => (await c2.get()).data().statut === "en_preparation");
  await p.getByRole("button", { name: "Assigner", exact: true }).first().click();
  await p.locator(".pastille-livreur").filter({ hasText: tag === "o" ? "Oumar" : "Ousmane" }).click();
  await p.locator(".btn-confirm:visible").click();
  await attendre(async () => (await c2.get()).data().livreurId === liv.livreurId);
  await p.reload(); await pause(p);
  await p.getByText("Aïssatou").first().waitFor();
  await capture("D-detail");
  verifier(nom("D. Détail : deux étapes validées, puis Assigner"), !!(await c2.get()).data().validations.en_preparation);

  // --- E. Corbeille ---
  const corb = await Promise.all([1, 2, 3].map((i) => commande({ corbeille: true, dateCorbeille: Timestamp.now(), statut: "livree", clientNom: `Corbeille ${tag} ${i}` })));
  await page("corbeille-commandes.html");
  const n = await Promise.all(corb.map(async (c) => (await c.get()).data().numero));
  await p.getByRole("checkbox", { name: `Sélectionner la commande ${n[0]}` }).check();
  await p.getByRole("button", { name: "Restaurer", exact: true }).first().click();
  await fenetre().waitFor();
  await valider();
  await attendre(async () => (await corb[0].get()).data().corbeille === false);
  verifier(nom("E. Restaurée"), true);
  await p.locator(".lot-tout input:visible, th .lot-case input:visible").first().check();
  await mise("Corbeille");
  await capture("E-corbeille");
  await p.getByRole("button", { name: "Supprimer définitivement", exact: true }).first().click();
  await fenetre().waitFor();
  await p.locator(".fen-annuler").click();
  verifier(nom("E. Annuler ne supprime rien"), (await corb[1].get()).exists);
  await p.getByRole("button", { name: "Supprimer définitivement", exact: true }).first().click();
  await fenetre().waitFor();
  await valider();
  await attendre(async () => !(await corb[1].get()).exists && !(await corb[2].get()).exists);
  verifier(nom("E. Tout sélectionner puis Supprimer définitivement"), true);

  // --- F. Incidents et enregistrements ---
  const alerte = async (etat, numero) => { const ref = db.collection("alertes").doc(`sos_${nouvelId()}`); await ref.set({ type: "sos", titre: "SOS", etat, nom: `Livreur ${tag}`, numero, date: Timestamp.now(), commandeId: `cmd-${numero}`, livreurId: liv.livreurId }); return ref; };
  const a1 = await alerte("active", `SOS-${tag}1`), a2 = await alerte("cloturee", `SOS-${tag}2`), a3 = await alerte("annulee", `SOS-${tag}3`);
  await page("incidents.html");
  const ref = (a) => `INC-${a.id.slice(-6).toUpperCase()}`;
  await p.getByRole("button", { name: `Supprimer ${ref(a2)}` }).waitFor();
  const boutons = await p.locator('button[aria-label^="Supprimer INC-"]').evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  verifier(nom("F. Supprimer sur Résolu et Classé, pas sur actif"), boutons.includes(`Supprimer ${ref(a2)}`) && boutons.includes(`Supprimer ${ref(a3)}`) && !boutons.includes(`Supprimer ${ref(a1)}`), boutons.join(" | "));
  await p.getByRole("checkbox", { name: `Sélectionner ${ref(a2)}` }).check();
  await p.getByRole("checkbox", { name: `Sélectionner ${ref(a3)}` }).check();
  await mise("Incidents");
  await capture("F-incidents");
  await p.locator(".lot-action.rouge").click();
  await fenetre().waitFor();
  await valider();
  await attendre(async () => !(await a2.get()).exists && !(await a3.get()).exists);
  verifier(nom("F. Incidents terminés supprimés, actif conservé"), (await a1.get()).exists);

  const video = async (numero, champs) => {
    const vid = nouvelId();
    await db.collection("enregistrements").doc(vid).set({ livreurId: liv.livreurId, uid: liv.uid, nom: `Livreur ${tag}`, commandeId: `cmd-${numero}`, numero, etat: "termine", garde: false, expireAt: Timestamp.fromMillis(Date.now() + 864e5), morceaux: [0], mime: "video/webm", debut: Timestamp.now(), date: Timestamp.now(), duree: 30, ...champs });
    await bucket.file(`videos/${liv.livreurId}/${vid}/0`).save(Buffer.from("video"), { resumable: false });
    return vid;
  };
  const vGardee = await video(`SOS-${tag}1`, { garde: true });
  const vSeule = await video(`VID-${tag}`, {});
  await page("enregistrements.html");
  await p.getByRole("button", { name: `Supprimer la vidéo VID-${tag}` }).waitFor();
  verifier(nom("F. Vidéo gardée, incident en cours : pas de Supprimer"), (await p.getByRole("button", { name: `Supprimer la vidéo SOS-${tag}1` }).count()) === 0);
  await mise("Enregistrements");
  await capture("F-enregistrements");
  await p.getByRole("button", { name: `Supprimer la vidéo VID-${tag}` }).click();
  await fenetre().waitFor();
  await valider();
  await attendre(async () => !(await db.collection("enregistrements").doc(vSeule).get()).exists);
  verifier(nom("F. Vidéo supprimée avec son fichier"), !(await bucket.file(`videos/${liv.livreurId}/${vSeule}/0`).exists())[0]);
  await a1.update({ etat: "cloturee" });
  await page("enregistrements.html");
  await p.getByRole("button", { name: `Supprimer la vidéo SOS-${tag}1` }).waitFor({ state: "attached" }).catch(() => {});
  verifier(nom("F. Incident terminé : Supprimer apparaît sur la vidéo gardée"), (await p.getByRole("button", { name: `Supprimer la vidéo SOS-${tag}1` }).count()) === 1);
  await p.getByRole("button", { name: `Supprimer la vidéo SOS-${tag}1` }).click();
  await fenetre().waitFor();
  await valider();
  await attendre(async () => !(await db.collection("enregistrements").doc(vGardee).get()).exists);
  verifier(nom("F. Vidéo gardée supprimée après l'incident"), true);
  await ctx.close();
  // Le passage suivant recrée les mêmes noms : la liste doit repartir propre.
  for (const d of (await db.collection("fournisseurs").get()).docs) await d.ref.delete();
}

// --- Connexion : chaque compte seulement par son espace ---
{
  const REFUS_ADMIN = "Désolé, ce n'est pas le bon espace. Utilisez l'espace administrateur.";
  const REFUS_LIVREUR = "Désolé, ce n'est pas le bon espace. Utilisez l'espace livreur.";
  const livreur = await nouveauLivreur("livreur-espaces", admin.jeton, { prenom: "Mariama", nom: "Espaces" });
  const entrer = async (p, bouton, email) => {
    await p.goto(`${BASE}/admin/login.html?emulator=1`);
    await p.getByRole("button", { name: bouton }).click();
    await p.fill("#fid", email);
    await p.fill("#fpwd", MDP);
    await p.click("button.btn-submit, button.login-btn");
  };
  const session = async (p) => p.evaluate(() => new Promise((ok) => {
    const req = indexedDB.open("firebaseLocalStorageDb");
    req.onerror = () => ok(false);
    req.onsuccess = () => {
      const base = req.result;
      if (!base.objectStoreNames.contains("firebaseLocalStorage")) return ok(false);
      const lire = base.transaction("firebaseLocalStorage").objectStore("firebaseLocalStorage").getAll();
      lire.onsuccess = () => ok(lire.result.some((l) => String(l.fbase_key).startsWith("firebase:authUser")));
      lire.onerror = () => ok(false);
    };
  })) || (await p.evaluate(() => Object.keys(sessionStorage).some((c) => c.startsWith("firebase:authUser"))));
  const nouveau = async () => {
    const ctx = await navigateur.newContext({ locale: "fr-FR", serviceWorkers: "block" });
    ctx.setDefaultTimeout(45000);
    await ctx.addInitScript(() => { try { localStorage.setItem("bokki-emulator", "1"); } catch { /* ignore */ } });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => erreursJs.push(`connexion (${p.url()}) : ${e.message}`));
    return { ctx, p };
  };

  const c1 = await nouveau();
  await c1.p.goto(`${BASE}/admin/login.html?emulator=1`);
  await c1.p.getByRole("button", { name: /administrateur/i }).click();
  verifier("Connexion : champs sans fausse valeur", (await c1.p.getAttribute("#fid", "placeholder")) === "Votre e-mail" && (await c1.p.getAttribute("#fpwd", "placeholder")) === "Votre mot de passe");
  await entrer(c1.p, /en tant que livreur/i, admin.email);
  await c1.p.getByText(REFUS_ADMIN).waitFor();
  verifier("Connexion : admin par le bouton livreur refusé, texte exact", !c1.p.url().includes("ma-livraison"), c1.p.url());
  verifier("Connexion : admin refusé et déconnecté", !(await session(c1.p)));
  await c1.p.screenshot({ path: join(CAPTURES, "connexion-refus-admin.png") });
  await entrer(c1.p, /administrateur/i, admin.email);
  await c1.p.waitForURL(/dashboard\.html/);
  verifier("Connexion : admin accepté par le bouton administrateur", true);
  await c1.p.goto(`${BASE}/admin/ma-livraison.html`);
  await c1.p.waitForTimeout(1500);
  verifier("Connexion : admin garde Ma livraison une fois entré", /ma-livraison/.test(c1.p.url()), c1.p.url());
  await c1.p.goto(`${BASE}/admin/login.html?espace=livreur&premiere=1&emulator=1`);
  await c1.p.waitForURL(/ma-livraison\.html/);
  verifier("Connexion : session déjà ouverte, aucun refus", true);
  await c1.ctx.close();

  const c2 = await nouveau();
  await entrer(c2.p, /administrateur/i, livreur.email);
  await c2.p.getByText(REFUS_LIVREUR).waitFor();
  verifier("Connexion : livreur par le bouton administrateur refusé et déconnecté", !(await session(c2.p)));
  await entrer(c2.p, /en tant que livreur/i, livreur.email);
  await c2.p.waitForURL(/tableau-livreur\.html/);
  verifier("Connexion : livreur accepté par le bouton livreur", true);
  await c2.ctx.close();
}

verifier("Aucune erreur JavaScript", !erreursJs.length, erreursJs.slice(0, 8).join("\n"));
await navigateur.close();
serveur.kill();
process.exit(bilan() ? 1 : 0);
