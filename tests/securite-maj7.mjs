// Contrôles de sécurité de la mise à jour n°7, sur l'émulateur : règles
// Firestore et fonctions, avec de vrais jetons de test.
import { db, bucket, compte, appeler, lire, ecrire, lister, commande, attendre, verifier, bilan, Timestamp, nouveauLivreur, horloge, nouvelId as id, CASES_CONFIRMER, CASES_PREPARER, attribuerPrete } from "./maj6-commun.mjs";

const midi = new Date(); midi.setUTCHours(12, 0, 0, 0);
await horloge({ decalageMs: midi.getTime() - Date.now() });
const adminC = await compte("admin7@test.bokki");
await db.collection("admins").doc(adminC.uid).set({ email: adminC.email, nom: "Oury" });
const livA = await nouveauLivreur("livreur7-a", adminC.jeton, { prenom: "Sékou", nom: "Fofana" });
const livB = await nouveauLivreur("livreur7-b", adminC.jeton, { prenom: "Alpha", nom: "Barry" });
const client = await compte("client7@test.bokki");

const fournisseur = async (id_, champs = {}) => { await db.collection("fournisseurs").doc(id_).set({ nom: id_, montantDu: 0, ...champs }); return db.collection("fournisseurs").doc(id_); };
const du = async (ref) => (await ref.get()).data().montantDu;
const produit = async (id_, fournisseurId) => { await db.collection("produits").doc(id_).set({ infosGenerales: { nom: `Produit ${id_}`, categorie: "Téléphones" }, caracteristiques: { prix: 100000 }, prixVente: 100000, fournisseurId, dateCreation: Timestamp.now(), images: [] }); return db.collection("produits").doc(id_); };
const payer = (fournisseurId, montant, jeton, extra = {}) => appeler("enregistrerPaiementFournisseur", { fournisseurId, montant, mode: "especes", idAction: id(), ...extra }, jeton);

// --- Accès : visiteur, client et livreur refusés partout ---
const f1 = await fournisseur("f-acces", { montantDu: 500000 });
const paye = await payer("f-acces", 100000, adminC.jeton, { note: "Acompte" });
verifier("Paiement fournisseur accepté, reçu créé", paye.ok && !!paye.resultat?.numero, paye.message);
const recuId = paye.resultat.recuId;
const payeL = await appeler("enregistrerPaiementLivreur", { livreurId: livA.livreurId, montant: 5000, mode: "orange_money", idAction: id() }, adminC.jeton);
verifier("Paiement livreur accepté, reçu créé", payeL.ok && /^PL-/.test(payeL.resultat?.numero || ""), payeL.message);

const fermees = ["recus", "compteurs", "alertesFermees"];
const adminSeul = ["fournisseurs", "paiementsFournisseurs"];
for (const [nom, jeton] of [["Visiteur", undefined], ["Client", client.jeton], ["Livreur", livA.jeton]]) {
  for (const c of [...fermees, ...adminSeul]) verifier(`${nom} : liste ${c} refusée`, (await lister(c, jeton)).status === 403);
  verifier(`${nom} : lecture d'un reçu refusée`, (await lire(`recus/${recuId}`, jeton)).status === 403);
  verifier(`${nom} : écriture d'un reçu refusée`, (await ecrire(`recus/${recuId}`, { montant: 1 }, jeton)).status === 403);
  verifier(`${nom} : compteur refusé`, (await lire("compteurs/recus", jeton)).status === 403);
  for (const [fonction, donnees] of [
    ["enregistrerPaiementFournisseur", { fournisseurId: "f-acces", montant: 1, mode: "especes", idAction: id() }],
    ["changerActivationFournisseur", { fournisseurId: "f-acces", actif: false }],
    ["supprimerFournisseur", { fournisseurId: "f-acces" }],
    ["gererProduitRetire", { produitId: "x" }],
    ["commandesARegler", {}],
    ["supprimerRecus", { ids: [recuId] }],
    ["traiterCorbeille", { ids: ["x"], action: "supprimer" }],
    ["supprimerAlertes", { ids: ["x"] }],
    ["supprimerEnregistrements", { ids: [id()] }],
  ]) {
    const r = await appeler(fonction, donnees, jeton);
    verifier(`${nom} : ${fonction} refusée`, !r.ok && ["UNAUTHENTICATED", "PERMISSION_DENIED"].includes(r.code), r.code);
  }
}
verifier("Livreur : ne lit pas ses propres reçus", (await lister("recus", livA.jeton, ["beneficiaireId", livA.livreurId])).status === 403);
verifier("Livreur : aucun reçu d'un autre", (await lister("recus", livA.jeton, ["beneficiaireId", livB.livreurId])).status === 403);
verifier("Admin : lit les reçus", (await lire(`recus/${recuId}`, adminC.jeton)).status === 200);
verifier("Admin : compteur fermé même pour lui", (await lire("compteurs/recus", adminC.jeton)).status === 403);
verifier("Admin : écriture directe d'un reçu refusée", (await ecrire(`recus/${recuId}`, { montant: 1 }, adminC.jeton)).status === 403);
verifier("Admin : suppression directe d'un fournisseur refusée", (await fetch(`http://127.0.0.1:8080/v1/projects/demo-bokki/databases/(default)/documents/fournisseurs/f-acces`, { method: "DELETE", headers: { Authorization: `Bearer ${adminC.jeton}` } })).status === 403);
verifier("Admin : « actif » direct refusé", (await ecrire("fournisseurs/f-acces", { actif: "non" }, adminC.jeton)).status === 403);
verifier("Admin : montantDu direct refusé", (await ecrire("fournisseurs/f-acces", { montantDu: 0 }, adminC.jeton)).status === 403);
verifier("Admin : paiement fournisseur non modifiable", (await ecrire(`paiementsFournisseurs/${paye.resultat.paiementId}`, { montant: 1 }, adminC.jeton)).status === 403);
const pp = await produit("p-direct", "f-acces");
verifier("Admin : enLigne direct refusé", (await ecrire("produits/p-direct", { enLigne: "x" }, adminC.jeton)).status === 403);
await pp.delete();

// --- Paiement : contenu du reçu, modes, rejeux ---
const recu = (await db.collection("recus").doc(recuId).get()).data();
verifier("Reçu : champs complets", recu.nom === "f-acces" && recu.montant === 100000 && recu.mode === "especes" && !!recu.date && recu.payePar === "Oury" && recu.note === "Acompte" && recu.resteApres === 400000, JSON.stringify({ n: recu.numero, r: recu.resteApres }));
verifier("Mode autre que Espèces ou Orange Money refusé", !(await payer("f-acces", 1000, adminC.jeton, { mode: "cheque" })).ok && !(await appeler("enregistrerPaiementLivreur", { livreurId: livA.livreurId, montant: 1000, mode: "virement", idAction: id() }, adminC.jeton)).ok);
verifier("Paiement sans identifiant d'action refusé", !(await payer("f-acces", 1000, adminC.jeton, { idAction: "" })).ok);
verifier("Paiement au-delà du dû refusé", !(await payer("f-acces", 99999999, adminC.jeton)).ok);
const refRejeu = await fournisseur("f-rejeu", { montantDu: 300000 });
const idRejeu = id();
const rejeux = await Promise.all([1, 2, 3].map(() => payer("f-rejeu", 100000, adminC.jeton, { idAction: idRejeu })));
const r2 = await payer("f-rejeu", 100000, adminC.jeton, { idAction: idRejeu });
const recusRejeu = await db.collection("recus").where("beneficiaireId", "==", "f-rejeu").get();
verifier("Rejeu fournisseur : un seul reçu", recusRejeu.size === 1, `${recusRejeu.size} reçu(s)`);
verifier("Rejeu fournisseur : un seul débit", (await du(refRejeu)) === 200000, String(await du(refRejeu)));
verifier("Rejeu fournisseur : même numéro renvoyé", rejeux.every((r) => r.ok && r.resultat.numero === rejeux[0].resultat.numero) && r2.resultat?.deja === true);
const idRejeuL = id();
for (let i = 0; i < 3; i++) await appeler("enregistrerPaiementLivreur", { livreurId: livB.livreurId, montant: 2000, mode: "especes", idAction: idRejeuL }, adminC.jeton);
verifier("Rejeu livreur : un seul reçu", (await db.collection("recus").where("beneficiaireId", "==", livB.livreurId).get()).size === 1);

// --- Numéros uniques en parallèle ---
await fournisseur("f-para", { montantDu: 10000000 });
const lots = await Promise.all(Array.from({ length: 14 }, (_, i) => (i % 2
  ? payer("f-para", 1000, adminC.jeton)
  : appeler("enregistrerPaiementLivreur", { livreurId: livA.livreurId, montant: 1000, mode: "especes", idAction: id() }, adminC.jeton))));
const numeros = lots.map((r) => r.resultat?.numero);
verifier("Parallèle : tous acceptés", lots.every((r) => r.ok), lots.find((r) => !r.ok)?.message);
verifier("Parallèle : numéros uniques", new Set(numeros).size === numeros.length, numeros.join(" "));
const tous = (await db.collection("recus").get()).docs.map((d) => d.data().numero);
verifier("Tous les numéros de la base sont uniques", new Set(tous).size === tous.length, `${tous.length} reçus`);

// --- Suppression de reçus : le dû ne bouge jamais ---
const fS = await fournisseur("f-supp", { montantDu: 1000000 });
const pa = await payer("f-supp", 300000, adminC.jeton);
const pb = await payer("f-supp", 200000, adminC.jeton);
const duAvant = await du(fS);
verifier("Refus de supprimer un lot trop grand", !(await appeler("supprimerRecus", { ids: Array.from({ length: 51 }, (_, i) => `fournisseur_x${i}`) }, adminC.jeton)).ok);
verifier("Refus d'un identifiant invalide", !(await appeler("supprimerRecus", { ids: ["../evil"] }, adminC.jeton)).ok);
const sup = await appeler("supprimerRecus", { ids: [pa.resultat.recuId] }, adminC.jeton);
verifier("Reçu supprimé par la fonction", sup.ok && sup.resultat.supprimes === 1 && !(await db.collection("recus").doc(pa.resultat.recuId).get()).exists, sup.message);
verifier("Reçu supprimé : montant dû inchangé", (await du(fS)) === duAvant);
verifier("Reçu supprimé : paiement conservé", (await db.collection("paiementsFournisseurs").doc(pa.resultat.paiementId).get()).exists);
const rejoue = await payer("f-supp", 300000, adminC.jeton, { idAction: pa.resultat.paiementId });
verifier("Reçu supprimé : le rejeu ne le recrée pas et ne débite pas", rejoue.resultat?.deja === true && !(await db.collection("recus").doc(pa.resultat.recuId).get()).exists && (await du(fS)) === duAvant);
const journalRecu = (await db.collection("journalActivite").where("action", "==", "recu_supprime").get()).docs.map((d) => d.data());
verifier("Journal : une ligne courte, sans montant ni nom du bénéficiaire", journalRecu.length === 1 && Object.keys(journalRecu[0]).sort().join() === "action,date,nom,numero,par", Object.keys(journalRecu[0] || {}).join());
verifier("Supprimer un reçu déjà supprimé : sans effet", (await appeler("supprimerRecus", { ids: [pa.resultat.recuId] }, adminC.jeton)).resultat?.supprimes === 0);

await db.collection("courses").doc("course-a").set({ livreurId: livB.livreurId, montantCourse: 50000, mois: "2026-11" });
const pl = await appeler("enregistrerPaiementLivreur", { livreurId: livB.livreurId, montant: 20000, mode: "especes", idAction: id() }, adminC.jeton);
const resteLivreur = async () => {
  const [c, p] = await Promise.all(["courses", "paiementsLivreurs"].map((n) => db.collection(n).where("livreurId", "==", livB.livreurId).get()));
  return c.docs.reduce((t, d) => t + d.data().montantCourse, 0) - p.docs.reduce((t, d) => t + d.data().montant, 0);
};
const resteAvant = await resteLivreur();
verifier("Reçu livreur : reste après paiement noté", (await db.collection("recus").doc(pl.resultat.recuId).get()).data().resteApres === resteAvant, String(resteAvant));
await appeler("supprimerRecus", { ids: [pl.resultat.recuId] }, adminC.jeton);
verifier("Reçu livreur supprimé : reste à payer inchangé", (await resteLivreur()) === resteAvant);
verifier("Paiement livreur non modifiable", (await ecrire(`paiementsLivreurs/${pl.resultat.recuId.replace("livreur_", "")}`, { montant: 1 }, adminC.jeton)).status === 403);

// --- Désactivation et suppression d'un fournisseur ---
const MESSAGE = "Réglez d'abord le montant dû";
const fD = await fournisseur("f-du", { montantDu: 1000 });
await produit("p-du", "f-du");
const d1 = await appeler("changerActivationFournisseur", { fournisseurId: "f-du", actif: false }, adminC.jeton);
verifier("Dû > 0 : désactivation refusée, message exact", !d1.ok && d1.message === MESSAGE, d1.message);
const d2 = await appeler("supprimerFournisseur", { fournisseurId: "f-du" }, adminC.jeton);
verifier("Dû > 0 : suppression refusée, message exact", !d2.ok && d2.message === MESSAGE, d2.message);
verifier("Dû > 0 : rien n'a changé", (await fD.get()).data().actif !== false && (await db.collection("produits").doc("p-du").get()).data().enLigne !== false);
await payer("f-du", 1000, adminC.jeton);
const d3 = await appeler("changerActivationFournisseur", { fournisseurId: "f-du", actif: false }, adminC.jeton);
const pDu = db.collection("produits").doc("p-du");
verifier("Dû = 0 : désactivé, produit retiré sans être supprimé", d3.ok && (await fD.get()).data().actif === false && (await pDu.get()).exists && (await pDu.get()).data().enLigne === false, d3.message);
const horsLigne = await appeler("gererProduitRetire", { produitId: "p-du" }, adminC.jeton);
verifier("Produit : pas de remise en ligne sous un fournisseur inactif", !horsLigne.ok);
verifier("Réactivation : produits de retour", (await appeler("changerActivationFournisseur", { fournisseurId: "f-du", actif: true }, adminC.jeton)).ok && (await pDu.get()).data().enLigne === undefined);
await appeler("changerActivationFournisseur", { fournisseurId: "f-du", actif: false }, adminC.jeton);
await fournisseur("f-autre");
verifier("Rattachement refusé vers un fournisseur inactif", !(await appeler("gererProduitRetire", { produitId: "p-du", rattacher: true, fournisseurId: "f-du" }, adminC.jeton)).ok);
const rat = await appeler("gererProduitRetire", { produitId: "p-du", rattacher: true, fournisseurId: "f-autre" }, adminC.jeton);
verifier("Rattachement : en ligne chez l'autre fournisseur", rat.ok && (await pDu.get()).data().fournisseurId === "f-autre" && (await pDu.get()).data().enLigne === undefined, rat.message);

const fX = await fournisseur("f-supprime");
const pX = await produit("p-supprime", "f-supprime");
await db.collection("produits").doc("p-supprime").collection("interne").doc("achat").set({ prixAchat: 60000 });
const cEnRoute = await commande({ articles: [{ produitId: "p-supprime", nom: "Produit", quantite: 1, prixInitial: 100000 }], statut: "en_livraison" });
const sX = await appeler("supprimerFournisseur", { fournisseurId: "f-supprime" }, adminC.jeton);
verifier("Dû = 0 : supprimé même avec un produit en ligne", sX.ok && (await fX.get()).data().supprime === true && (await pX.get()).data().enLigne === false, sX.message);
await cEnRoute.update({ statut: "livree", dateLivraison: Timestamp.now() });
verifier("Commande en route après suppression : le dû n'est pas perdu", !!(await attendre(async () => (await fX.get()).data().montantDu === 60000, 60000)));

// --- Commandes à régler : indépendant des reçus ---
await fournisseur("f-cmd");
await produit("p-cmd", "f-cmd");
await db.collection("produits").doc("p-cmd").collection("interne").doc("achat").set({ prixAchat: 100000 });
const fCmd = db.collection("fournisseurs").doc("f-cmd");
for (let i = 0; i < 3; i++) {
  const c = await commande({ articles: [{ produitId: "p-cmd", nom: "Produit", quantite: 1, prixInitial: 150000 }], statut: "en_livraison" });
  await c.update({ statut: "livree", dateLivraison: Timestamp.fromMillis(Date.now() + i * 1000) });
}
await attendre(async () => (await du(fCmd)) === 300000, 30000);
const liste = await appeler("commandesARegler", { fournisseurId: "f-cmd" }, adminC.jeton);
verifier("Commandes à régler : les 3 livrées", liste.ok && liste.resultat.commandes.length === 3 && liste.resultat.nombres["f-cmd"] === 3, JSON.stringify(liste.resultat?.nombres));
const pCmd = await payer("f-cmd", 150000, adminC.jeton);
const apres = await appeler("commandesARegler", { fournisseurId: "f-cmd" }, adminC.jeton);
verifier("Après paiement partiel : 2 commandes, 150 000 GNF", apres.resultat.commandes.length === 2 && apres.resultat.commandes.reduce((t, c) => t + c.montant, 0) === 150000);
await appeler("supprimerRecus", { ids: [pCmd.resultat.recuId] }, adminC.jeton);
verifier("Reçu supprimé : commandes à régler inchangées", (await appeler("commandesARegler", { fournisseurId: "f-cmd" }, adminC.jeton)).resultat.commandes.length === 2);

// --- Produits masqués : absents partout côté public ---
await fournisseur("f-public");
await produit("p-public", "f-public");
await appeler("changerActivationFournisseur", { fournisseurId: "f-public", actif: false }, adminC.jeton);
const achat = await appeler("creerCommande", {
  clientNom: "Test", clientTel: "622000099", ville: "Conakry", quartier: "Kipé", repere: "Marché", typeLivraison: "standard",
  articles: [{ produitId: "p-public", quantite: 1 }], idEnvoi: id(),
}, undefined);
verifier("Produit retiré : commande refusée", !achat.ok, achat.message);
verifier("Message de refus sans mot interne", !/fournisseur|madina/i.test(achat.message || ""), achat.message);
// Témoin : un produit visible doit, lui, apparaître. Sinon ces contrôles ne
// prouveraient rien (une page vide les satisferait aussi).
await produit("p-temoin", "f-autre");
await db.collection("produits").doc("p-temoin").update({ "infosGenerales.nom": "Temoin Visible" });
await db.collection("produits").doc("p-public").update({ "infosGenerales.nom": "Retire Cache" });
const sitemap = await fetch("http://127.0.0.1:5001/demo-bokki/europe-west1/sitemap");
const xml = await sitemap.text();
verifier("Sitemap : produit visible présent", sitemap.ok && xml.includes("temoin-visible"));
verifier("Sitemap : produit retiré absent", !xml.includes("retire-cache"));
const adresse = (segment) => fetch(`http://127.0.0.1:5001/demo-bokki/europe-west1/pageProduit/produit/${segment}`, { redirect: "manual" });
verifier("Adresse d'un produit visible : renvoie vers sa fiche", [301, 302].includes((await adresse("p-temoin")).status));
verifier("Adresse du produit retiré : introuvable", (await adresse("p-public")).status === 404);
verifier("Champ public neutre : aucun mot interne ajouté", Object.keys((await db.collection("produits").doc("p-public").get()).data()).every((k) => !/retrait|masqu|fournisseurActif/i.test(k)));

// --- Commandes : listes de contrôle ---
const statut = (ref, s, jeton, extra = {}) => appeler("changerStatutCommande", { commandeId: ref.id, statut: s, idAction: id(), ...extra }, jeton);
const c1 = await commande();
verifier("Confirmer sans cases : refusé", !(await statut(c1, "confirmee", adminC.jeton)).ok);
verifier("Confirmer avec 2 cases sur 3 : refusé", !(await statut(c1, "confirmee", adminC.jeton, { checklist: CASES_CONFIRMER.slice(0, 2) })).ok);
verifier("Confirmer avec les cases d'une autre étape : refusé", !(await statut(c1, "confirmee", adminC.jeton, { checklist: CASES_PREPARER })).ok);
verifier("Attribuer avant confirmation : refusé", !(await appeler("attribuerLivreur", { commandeId: c1.id, moiMeme: true }, adminC.jeton)).ok);
const ok1 = await statut(c1, "confirmee", adminC.jeton, { checklist: CASES_CONFIRMER });
const v1 = (await c1.get()).data();
verifier("Confirmer : toutes les cases, sans livreur", ok1.ok && v1.statut === "confirmee" && !v1.livreurId, ok1.message);
verifier("Validation notée : qui et quand", v1.validations?.confirmee?.nom === "Oury" && v1.validations.confirmee.par === adminC.uid && !!v1.validations.confirmee.date && v1.validations.confirmee.cases.length === 3);
verifier("Validation : écriture directe refusée", (await ecrire(`commandes/${c1.id}`, { validations: "x" }, adminC.jeton)).status === 403);
verifier("Attribuer avant préparation : refusé", !(await appeler("attribuerLivreur", { commandeId: c1.id, moiMeme: true }, adminC.jeton)).ok);
verifier("En préparation sans cases : refusé", !(await statut(c1, "en_preparation", adminC.jeton)).ok);
const ok2 = await statut(c1, "en_preparation", adminC.jeton, { checklist: CASES_PREPARER });
verifier("En préparation : toutes les cases", ok2.ok && (await c1.get()).data().validations.en_preparation?.nom === "Oury", ok2.message);
verifier("Je livre moi-même après préparation", (await appeler("attribuerLivreur", { commandeId: c1.id, moiMeme: true }, adminC.jeton)).ok);
const copie = await attendre(async () => (await db.collection("livraisons").doc(c1.id).get()).data());
verifier("Copie du livreur : pas de validations", !!copie && !("validations" in copie));
const c2 = await commande();
await attribuerPrete(c2.id, { livreurId: livA.livreurId }, adminC.jeton);
verifier("Livreur : ne peut pas valider une étape", (await statut(await commande(), "confirmee", livA.jeton, { checklist: CASES_CONFIRMER })).code === "PERMISSION_DENIED");

// --- Corbeille ---
const dans = await commande({ corbeille: true, dateCorbeille: Timestamp.now(), statut: "livree" });
await dans.collection("interne").doc("fournisseurs").set({ parFournisseur: {} });
const dehors = await commande({ statut: "livree" });
const rest = await commande({ corbeille: true, dateCorbeille: Timestamp.now(), statut: "livree" });
verifier("Corbeille : lot trop grand refusé", !(await appeler("traiterCorbeille", { ids: Array.from({ length: 51 }, (_, i) => `id${i}`), action: "restaurer" }, adminC.jeton)).ok);
verifier("Corbeille : commande hors corbeille intacte", (await appeler("traiterCorbeille", { ids: [dehors.id], action: "supprimer" }, adminC.jeton)).resultat?.traitees === 0 && (await dehors.get()).exists);
await appeler("traiterCorbeille", { ids: [rest.id], action: "restaurer" }, adminC.jeton);
verifier("Corbeille : restaurée", (await rest.get()).data().corbeille === false && !("dateCorbeille" in (await rest.get()).data()));
await appeler("traiterCorbeille", { ids: [dans.id], action: "supprimer" }, adminC.jeton);
verifier("Corbeille : supprimée avec sa partie interne", !(await dans.get()).exists && !(await dans.collection("interne").doc("fournisseurs").get()).exists);

// --- SOS et incidents ---
const alerte = async (etat, champs = {}) => { const ref = db.collection("alertes").doc(`sos_${id()}`); await ref.set({ type: "sos", titre: "SOS", etat, nom: "Sékou", numero: "", date: Timestamp.now(), commandeId: null, livreurId: livA.livreurId, ...champs }); return ref; };
for (const etat of ["active", "prise_en_charge"]) {
  const a = await alerte(etat);
  const r = await appeler("supprimerAlertes", { ids: [a.id] }, adminC.jeton);
  verifier(`SOS ${etat} : suppression refusée`, !r.ok && (await a.get()).exists, r.message);
}
for (const etat of ["cloturee", "annulee"]) {
  const a = await alerte(etat);
  await db.collection("positions").add({ alerteId: a.id, livreurId: livA.livreurId, expireAt: null });
  const r = await appeler("supprimerAlertes", { ids: [a.id] }, adminC.jeton);
  verifier(`SOS ${etat} : supprimé avec ses positions`, r.ok && !(await a.get()).exists && (await db.collection("positions").where("alerteId", "==", a.id).get()).empty, r.message);
}
const melange = [await alerte("cloturee"), await alerte("active")];
verifier("Lot mêlant SOS terminé et actif : tout refusé", !(await appeler("supprimerAlertes", { ids: melange.map((a) => a.id) }, adminC.jeton)).ok && (await melange[0].get()).exists);
verifier("Alerte : écriture directe refusée à l'admin", (await ecrire(`alertes/${melange[0].id}`, { etat: "x" }, adminC.jeton)).status === 403);

// --- Vidéo gardée ---
const video = async (champs) => {
  const vid = id();
  await db.collection("enregistrements").doc(vid).set({ livreurId: livA.livreurId, uid: livA.uid, commandeId: "cmd-video", numero: "BK-V", etat: "termine", garde: false, expireAt: null, morceaux: [0, 1], mime: "video/webm", debut: Timestamp.now(), ...champs });
  for (const i of [0, 1]) await bucket.file(`videos/${livA.livreurId}/${vid}/${i}`).save(Buffer.from("video"), { resumable: false });
  return vid;
};
const fichierPresent = async (vid) => (await bucket.file(`videos/${livA.livreurId}/${vid}/0`).exists())[0];
const gardee = await video({ garde: true });
const sos = await alerte("active", { commandeId: "cmd-video" });
const v1r = await appeler("supprimerEnregistrements", { ids: [gardee] }, adminC.jeton);
verifier("Vidéo gardée, incident en cours : refusée", !v1r.ok && await fichierPresent(gardee), v1r.message);
const normaleSos = await video({});
verifier("Vidéo normale, incident en cours : refusée", !(await appeler("supprimerEnregistrements", { ids: [normaleSos] }, adminC.jeton)).ok);
verifier("Retirer « Gardé » pendant l'incident : refusé", !(await appeler("garderIncident", { commandeId: "cmd-video", garde: false }, adminC.jeton)).ok);
await sos.update({ etat: "prise_en_charge" });
verifier("Vidéo gardée, pris en charge : refusée", !(await appeler("supprimerEnregistrements", { ids: [gardee] }, adminC.jeton)).ok);
await sos.update({ etat: "cloturee" });
const v2r = await appeler("supprimerEnregistrements", { ids: [gardee] }, adminC.jeton);
verifier("Vidéo gardée, incident terminé : supprimée avec fichier et morceaux", v2r.ok && !(await db.collection("enregistrements").doc(gardee).get()).exists
  && !(await fichierPresent(gardee)) && !(await bucket.file(`videos/${livA.livreurId}/${gardee}/1`).exists())[0], v2r.message);
const sansIncident = await video({ garde: true, commandeId: "cmd-seule" });
verifier("Vidéo gardée sans incident : protégée", !(await appeler("supprimerEnregistrements", { ids: [sansIncident] }, adminC.jeton)).ok);
const enCours = await video({ etat: "en_cours", commandeId: "cmd-seule-2" });
verifier("Vidéo en cours d'envoi : refusée", !(await appeler("supprimerEnregistrements", { ids: [enCours] }, adminC.jeton)).ok);
const normale = await video({ commandeId: "cmd-seule-3" });
const v3 = await appeler("supprimerEnregistrements", { ids: [normale] }, adminC.jeton);
verifier("Vidéo normale, sans incident : supprimée", v3.ok && !(await fichierPresent(normale)), v3.message);

// Alerte automatique supprimée : ne renaît pas à la surveillance suivante.
const lanceeRetard = Date.now() - 2 * 3600000;
const cRetard = await commande({ statut: "en_livraison", lanceeLe: Timestamp.fromMillis(lanceeRetard), livreurId: "livreur-sans-sos" });
await horloge({ ms: Date.now() });
await appeler("testerTachesLivraison", { tache: "surveiller" }, adminC.jeton);
const retard = db.collection("alertes").doc(`silence_${cRetard.id}_${lanceeRetard}`);
verifier("Surveillance : alerte automatique créée", (await retard.get()).exists);
await retard.update({ etat: "cloturee" });
await appeler("supprimerAlertes", { ids: [retard.id] }, adminC.jeton);
await appeler("testerTachesLivraison", { tache: "surveiller" }, adminC.jeton);
verifier("Alerte automatique supprimée : ne renaît pas", !(await retard.get()).exists);

process.exit(bilan() ? 1 : 0);
