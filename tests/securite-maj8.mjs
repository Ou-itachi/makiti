// Contrôles de la mise à jour n°8, sur l'émulateur : versements, suppression à
// trois, position partagée et SOS qui ne se rappelle pas.
import { db, adminAuth, compte, appeler, lire, ecrire, lister, verifier, bilan, nouveauLivreur, horloge, nouvelId as id } from "./maj6-commun.mjs";

const midi = new Date(); midi.setUTCHours(12, 0, 0, 0);
await horloge({ decalageMs: midi.getTime() - Date.now() });
const a1 = await compte("admin8-a@test.bokki");
const a2 = await compte("admin8-b@test.bokki");
const a3 = await compte("admin8-c@test.bokki");
const ancien = await compte("admin8-ancien@test.bokki");
for (const [c, nom] of [[a1, "Oury"], [a2, "Aladji"], [a3, "Tijane"], [ancien, "Ancien"]]) await db.collection("admins").doc(c.uid).set({ email: c.email, nom });
await adminAuth.updateUser(ancien.uid, { disabled: true });
const liv = await nouveauLivreur("livreur8", a1.jeton, { prenom: "Sékou", nom: "Fofana" });
const client = await compte("client8@test.bokki");

const com = db.collection("commandes").doc("cmd-maj8");
await com.set({ statut: "livree", montantTotal: 1000000, fraisLivraison: 50000, numero: "BK-8" });
await com.collection("interne").doc("fournisseurs").set({ parFournisseur: { f1: { montant: 500000 } } });
const etat = async () => (await appeler("etatVersements", {}, a1.jeton)).resultat;
const verser = (montant, jeton, email, extra = {}) => appeler("effectuerVersement", { idAction: id(), montant, date: midi.toISOString().slice(0, 10), note: "Banque", email, ...extra }, jeton);

// --- Accès ---
for (const [nom, jeton] of [["Visiteur", undefined], ["Client", client.jeton], ["Livreur", liv.jeton]]) {
  verifier(`${nom} : journal refusé`, (await lister("versements", jeton)).status === 403);
  verifier(`${nom} : positions refusées`, (await lister("localisations", jeton)).status === 403);
  for (const [f, d] of [["etatVersements", {}], ["effectuerVersement", { idAction: id(), montant: 1, date: "2026-01-01", email: "x" }], ["demanderSuppressionVersement", { id: id() }], ["corrigerVersement", { idAction: id(), versementId: id(), bonMontant: 1, motif: "x", email: "x" }]]) {
    verifier(`${nom} : ${f} refusée`, !(await appeler(f, d, jeton)).ok);
  }
}

// --- Montants ---
const e0 = await etat();
verifier("Argent disponible : même calcul que la marge", e0.gagne === 450000 && e0.verse === 0 && e0.disponible === 450000, JSON.stringify(e0));
verifier("Compte désactivé hors des administrateurs", e0.admins.length === 3 && !e0.admins.some((a) => a.uid === ancien.uid));
const faux = await verser(1000, a1.jeton, a2.email);
verifier("E-mail d'un autre admin refusé", !faux.ok && faux.code === "PERMISSION_DENIED", faux.code);
verifier("Montant au-delà du disponible refusé", !(await verser(450001, a1.jeton, a1.email)).ok);
verifier("Montant négatif refusé", !(await verser(-5, a1.jeton, a1.email)).ok);
verifier("Montant décimal refusé", !(await verser(10.5, a1.jeton, a1.email)).ok);
verifier("Date future refusée", !(await verser(1000, a1.jeton, a1.email, { date: "2099-01-01" })).ok);
const idV = id();
const rejeux = await Promise.all([1, 2, 3].map(() => verser(100000, a1.jeton, a1.email.toUpperCase(), { idAction: idV })));
verifier("Versement validé, e-mail sans tenir compte des majuscules", rejeux.every((r) => r.ok));
verifier("Rejeu : déduit une seule fois", (await etat()).disponible === 350000, String((await etat()).disponible));
const paralleles = await Promise.all([1, 2, 3].map(() => verser(200000, a2.jeton, a2.email)));
verifier("Versements simultanés : jamais au-delà du disponible", paralleles.filter((r) => r.ok).length === 1 && (await etat()).disponible === 150000, JSON.stringify(paralleles.map((r) => r.ok)));
verifier("Écriture directe refusée à l'admin", (await ecrire(`versements/${idV}`, { montant: 1 }, a1.jeton)).status === 403);
verifier("Total fermé même à l'admin", (await lire("versementsTotaux/global", a1.jeton)).status === 403);

// --- Correction ---
const corr = (bonMontant, jeton, email, extra = {}) => appeler("corrigerVersement", { idAction: id(), versementId: idV, bonMontant, motif: "Erreur de saisie", email, ...extra }, jeton);
verifier("Correction sans motif refusée", !(await corr(90000, a1.jeton, a1.email, { motif: " " })).ok);
verifier("Correction avec l'e-mail d'un autre refusée", !(await corr(90000, a1.jeton, a2.email)).ok);
verifier("Correction identique refusée", !(await corr(100000, a1.jeton, a1.email)).ok);
verifier("Correction au-delà du disponible refusée", !(await corr(300000, a1.jeton, a1.email)).ok);
verifier("Correction acceptée", (await corr(90000, a3.jeton, a3.email)).ok);
verifier("Correction : la différence revient", (await etat()).disponible === 160000, String((await etat()).disponible));
const orig = (await db.collection("versements").doc(idV).get()).data();
verifier("Correction : l'original reste", orig.montant === 100000 && orig.montantCorrige === 90000);
verifier("Seconde correction depuis le montant corrigé", (await corr(95000, a3.jeton, a3.email)).ok && (await etat()).disponible === 155000);

// --- Suppression à trois ---
const sup = (jeton) => appeler("demanderSuppressionVersement", { id: idV }, jeton);
const r1 = await sup(a1.jeton);
verifier("1er admin : le reçu reste", r1.resultat?.efface === false && (await db.collection("versements").doc(idV).get()).exists);
const dep = (await etat()).disponible;
verifier("Demande annulable", (await appeler("annulerSuppressionVersement", { id: idV }, a1.jeton)).ok && !(await db.collection("versements").doc(idV).get()).data().suppressions[a1.uid]);
await sup(a1.jeton); await sup(a1.jeton);
await sup(a2.jeton);
verifier("2 admins sur 3 : le reçu reste", (await db.collection("versements").doc(idV).get()).exists);
const r3 = await sup(a3.jeton);
verifier("3e admin : le reçu est effacé", r3.resultat?.efface === true && !(await db.collection("versements").doc(idV).get()).exists);
verifier("Effacement : l'argent reste déduit", (await etat()).disponible === dep, String((await etat()).disponible));

// --- Position ---
const point = (champs = {}) => ({ id: id(), lat: 9.6412, lng: -13.5784, precision: 12, date: midi.getTime(), commandeId: null, source: "suivi", ...champs });
const fiche = async () => (await db.collection("localisations").doc(liv.uid).get()).data();
const pos = await appeler("enregistrerPositions", { points: [point()] }, liv.jeton);
verifier("Position acceptée sans livraison", pos.resultat?.refuses === 0, JSON.stringify(pos.resultat));
const f1 = await fiche();
verifier("Localisation visible avec précision", f1?.visible === true && f1.partage === true && f1.precision === 12 && !f1.sos, JSON.stringify(f1));
verifier("Admin lit la localisation", (await lire(`localisations/${liv.uid}`, a1.jeton)).status === 200);
verifier("Livreur n'écrit pas sa localisation", (await ecrire(`localisations/${liv.uid}`, { lat: 1 }, liv.jeton)).status === 403);
const hors = new Date(midi); hors.setUTCHours(21);
verifier("Hors horaires refusé sans SOS", (await appeler("enregistrerPositions", { points: [point({ date: hors.getTime() })] }, liv.jeton)).resultat?.refuses === 1);
verifier("Point de statut sans commande refusé", (await appeler("enregistrerPositions", { points: [point({ source: "statut" })] }, liv.jeton)).resultat?.refuses === 1);
await appeler("arreterLocalisation", {}, liv.jeton);
verifier("Arrêt : la position disparaît", (await fiche()).visible === false);

// --- SOS ---
const sos = await appeler("declencherSos", { id: id() }, liv.jeton);
verifier("SOS envoyé", sos.ok, sos.message);
await appeler("enregistrerPositions", { points: [point({ source: "sos", alerteId: sos.resultat.alerteId })] }, liv.jeton);
const f2 = await fiche();
verifier("SOS : position affichée sans partage", f2.visible === true && f2.sos === true && f2.partage === false, JSON.stringify(f2));
await appeler("annulerSos", { alerteId: sos.resultat.alerteId }, liv.jeton);
verifier("SOS : Annuler ne rappelle pas le signal", (await db.collection("alertes").doc(sos.resultat.alerteId).get()).data().etat === "active");
await appeler("traiterAlerte", { alerteId: sos.resultat.alerteId, action: "cloturer", note: "Joint" }, a1.jeton);
verifier("SOS clôturé : la position disparaît", (await fiche()).visible === false && (await fiche()).sos === false);

process.exit(bilan() ? 1 : 0);
