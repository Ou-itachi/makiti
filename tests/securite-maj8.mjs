// Contrôles de la mise à jour n°8, sur l'émulateur : versements, suppression à
// trois, position partagée et SOS qui ne se rappelle pas.
import { Timestamp, db, adminAuth, compte, appeler, lire, ecrire, lister, verifier, bilan, nouveauLivreur, horloge, nouvelId as id } from "./maj6-commun.mjs";

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

// --- Horaires, geste du livreur et alertes de silence ---
const aHeure = (h, m) => { const d = new Date(midi); d.setUTCHours(h, m, 0, 0); return d.getTime(); };
const envoyer = async (...p) => (await appeler("enregistrerPositions", { points: p.map(point) }, liv.jeton)).resultat?.refuses;
verifier("19 h 20 accepté, 19 h 40 refusé sans livraison", await envoyer({ date: aHeure(19, 20) - 86400000 }) === 0 && await envoyer({ date: aHeure(19, 40) - 86400000 }) === 1);
const t0 = midi.getTime();
const min = (n) => t0 + n * 60000;
const lancer = async (cid, livreurId) => {
  await db.doc(`commandes/${cid}`).set({ statut: "en_livraison", lanceeLe: Timestamp.fromMillis(t0), livreurId, livreurNom: "Sékou", numero: cid });
  await db.doc(`livraisons/${cid}`).set({ statut: "en_livraison", lanceeLe: Timestamp.fromMillis(t0), livreurId, numero: cid });
};
await lancer("route-1", liv.livreurId);
await lancer("route-2", liv.livreurId);
await lancer("route-3", "autre-livreur");
const surveiller = async (ms) => { await horloge({ ms }); await appeler("testerTachesLivraison", { tache: "alertes" }, a1.jeton); };
const alerte = async (nom) => (await db.collection("alertes").doc(nom).get()).data();
await surveiller(min(74));
verifier("Silence : rien avant 1 h 15", !(await alerte(`silence_route-1_${t0}`)));
verifier("Le soir, envoi automatique accepté pendant une livraison", await envoyer({ source: "auto", commandeId: "route-2", date: aHeure(21, 0) - 86400000 }) === 0);
verifier("Position automatique acceptée", await envoyer({ source: "auto", commandeId: "route-1", date: min(60) }) === 0);
await surveiller(min(76));
verifier("Position automatique : elle ne vaut pas une réponse", (await alerte(`silence_route-1_${t0}`))?.titre === "Le livreur ne répond pas", JSON.stringify(await alerte(`silence_route-1_${t0}`)));
verifier("Rien reçu : alerte Position non reçue", (await alerte(`silence_route-3_${t0}`))?.titre === "Position non reçue");
const avant = (await db.collection("alertes").where("commandeId", "==", "route-1").get()).size;
await surveiller(min(77));
verifier("Une seule alerte par silence", (await db.collection("alertes").where("commandeId", "==", "route-1").get()).size === avant);
const ok = await appeler("enregistrerPositions", { points: [{ id: id(), date: min(80), commandeId: "route-1", source: "ok" }] }, liv.jeton);
verifier("Tout va bien accepté sans GPS", ok.resultat?.refuses === 0, JSON.stringify(ok.resultat));
verifier("Un appui vaut pour toutes ses livraisons", (await db.doc("livraisons/route-1").get()).data().dernierGeste?.toMillis() === min(80) && (await db.doc("livraisons/route-2").get()).data().dernierGeste?.toMillis() === min(80));
verifier("Sa réponse apparaît sur l'alerte", (await alerte(`silence_route-1_${t0}`))?.reponduLe?.toMillis() === min(80));
await surveiller(min(120));
verifier("Tout va bien remet le chrono à zéro", !(await alerte(`silence_route-1_${min(80)}`)));
await surveiller(min(139));
await envoyer({ source: "auto", commandeId: "route-1", date: min(140) });
await surveiller(min(156));
verifier("Même endroit depuis une heure : immobile", (await alerte(`silence_route-1_${min(80)}`))?.titre === "Immobile depuis 1 h, le livreur ne répond pas", JSON.stringify(await alerte(`silence_route-1_${min(80)}`)));
await db.doc("commandes/route-2").update({ statut: "livree" });
await db.doc("livraisons/route-2").update({ statut: "livree" });
verifier("Soir : point de statut accepté sur sa commande terminée", await envoyer({ source: "statut", commandeId: "route-2", date: aHeure(21, 0) - 86400000 }) === 0);
verifier("Soir : envoi automatique refusé sur une commande terminée", await envoyer({ source: "auto", commandeId: "route-2", date: aHeure(21, 0) - 86400000 }) === 1);
await surveiller(aHeure(19, 29));
verifier("Pas d'alerte du soir avant 19 h 30", !(await alerte(`retard1930_route-1_${new Date(t0).toISOString().slice(0, 10)}`)));
await surveiller(aHeure(19, 31));
verifier("19 h 30 : colis encore chez le livreur", !!(await alerte(`retard1930_route-1_${new Date(t0).toISOString().slice(0, 10)}`)));
const lendemain = aHeure(8, 1) + 86400000;
await surveiller(lendemain);
verifier("Le lendemain : colis non rendu signalé", !!(await alerte(`veille_route-1_${new Date(lendemain).toISOString().slice(0, 10)}`)));
await db.doc("commandes/route-1").update({ statut: "livree" });
await db.doc("commandes/route-3").update({ statut: "livree" });
await surveiller(Date.now() + 16 * 60000);
verifier("Alerte non prise après 15 min : admins relancés", !!(await alerte(`silence_route-3_${t0}`))?.relanceeLe);
verifier("Points du jour dans Localisation", (await fiche()).points?.length >= 1, JSON.stringify((await fiche()).points));
await horloge({ decalageMs: midi.getTime() - Date.now() });
await appeler("arreterLocalisation", {}, liv.jeton);

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
