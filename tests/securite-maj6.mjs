// Contrôles de sécurité de la mise à jour n°6 (section 11), sur l'émulateur :
// règles Firestore, règles Storage et fonctions, avec de vrais jetons de test.
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { db, bucket, compte, appeler, lire, ecrire, lister, commande, attendre, verifier, bilan, photoJpeg, STORAGE, Timestamp, nouveauLivreur, horloge, nouvelId as id } from "./maj6-commun.mjs";

const statut = (ref, s, jeton, extra = {}) => appeler("changerStatutCommande", { commandeId: ref.id, statut: s, idAction: id(), ...extra }, jeton);
const statutEnBase = async (ref) => (await ref.get()).data().statut;
const code = (ref, c, jeton) => appeler("validerCodeLivraison", { commandeId: ref.id, code: c, idAction: id() }, jeton);
const attribuer = (ref, livreurId, jeton, extra = {}) => appeler("attribuerLivreur", { commandeId: ref.id, livreurId, ...extra }, jeton);
const midi = new Date(); midi.setUTCHours(12, 0, 0, 0);
await horloge({ decalageMs: midi.getTime() - Date.now() });
const point = (ref, extra = {}) => ({ id: id(), lat: 9.6, lng: -13.6, precision: 10, date: midi.getTime(), commandeId: ref?.id ?? null, source: "suivi", ...extra });
const COLLECTIONS = ["commandes", "livraisons", "positions", "enregistrements", "photosIncident", "alertes", "paiementsLivreurs", "courses", "journees", "journalActivite"];

const adminC = await compte("admin@test.bokki");
await db.collection("admins").doc(adminC.uid).set({ email: adminC.email });
const livA = await nouveauLivreur("livreur-a", adminC.jeton, { prenom: "Sékou", nom: "Fofana" });
const livB = await nouveauLivreur("livreur-b", adminC.jeton, { prenom: "Alpha", nom: "Barry" });
const client = await compte("client@test.bokki");
const autreClient = await compte("autre-client@test.bokki");

// --- Visiteur ---
const c1 = await commande({ uid: client.uid });
for (const nom of COLLECTIONS) verifier(`Visiteur : liste ${nom} refusée`, (await lister(nom)).status === 403);
verifier("Visiteur : lecture d'une commande refusée", (await lire(`commandes/${c1.id}`)).status === 403);
verifier("Visiteur : modification refusée", (await ecrire(`commandes/${c1.id}`, { statut: "livree" })).status === 403);
verifier("Visiteur : fonction de statut refusée", (await statut(c1, "en_livraison")).code === "UNAUTHENTICATED");
verifier("Visiteur : SOS refusé", (await appeler("declencherSos", { id: id() })).code === "UNAUTHENTICATED");
verifier("Visiteur : position refusée", (await appeler("enregistrerPositions", { points: [point(c1)] })).code === "UNAUTHENTICATED");

// --- Client ---
const c2 = await commande({ uid: autreClient.uid });
verifier("Client : lecture directe refusée, même la sienne", (await lire(`commandes/${c1.id}`, client.jeton)).status === 403);
const miennes = await appeler("mesCommandesClient", {}, client.jeton);
const ids = (miennes.resultat?.commandes || []).map((c) => c.id);
verifier("Client : ne reçoit que ses commandes", ids.includes(c1.id) && !ids.includes(c2.id), `${ids.length} commande(s)`);
verifier("Client : changement de statut direct refusé", (await ecrire(`commandes/${c1.id}`, { statut: "annulee_client" }, client.jeton)).status === 403);
verifier("Client : fonction de statut refusée", (await statut(c1, "annulee_client", client.jeton, { raison: "test" })).code === "PERMISSION_DENIED");
for (const nom of COLLECTIONS.slice(2)) verifier(`Client : liste ${nom} refusée`, (await lister(nom, client.jeton)).status === 403);
verifier("Client : SOS refusé", (await appeler("declencherSos", { id: id() }, client.jeton)).code === "PERMISSION_DENIED");
verifier("Client : ne peut pas attribuer", (await attribuer(c1, livA.livreurId, client.jeton)).code === "PERMISSION_DENIED");

// --- Attribution et transitions ---
verifier("Livreur : ne peut pas attribuer", (await attribuer(c1, livA.livreurId, livA.jeton)).code === "PERMISSION_DENIED");
verifier("Livreur : ne peut pas confirmer", (await statut(c1, "confirmee", livA.jeton)).code === "PERMISSION_DENIED");
verifier("Admin : confirmer sans livreur refusé", !(await attribuer(c1, "", adminC.jeton)).ok && (await statutEnBase(c1)) === "nouvelle");
verifier("Admin : pas de « Confirmée » sans attribution", !(await statut(c1, "confirmee", adminC.jeton)).ok);
verifier("Transition interdite : Nouvelle vers En livraison (admin)", !(await statut(c1, "en_livraison", adminC.jeton)).ok && (await statutEnBase(c1)) === "nouvelle");
verifier("Transition interdite : Nouvelle vers En livraison (livreur)", !(await statut(c1, "en_livraison", livA.jeton)).ok);
verifier("Transition interdite : Nouvelle vers Retournée", !(await statut(c1, "retournee", adminC.jeton, { raison: "client_absent" })).ok);
verifier("Admin : statut direct en base refusé par les règles", (await ecrire(`commandes/${c1.id}`, { statut: "livree" }, adminC.jeton)).status === 403);
verifier("Admin : attribution directe en base refusée", (await ecrire(`commandes/${c1.id}`, { livreurId: livA.livreurId }, adminC.jeton)).status === 403);
const a = await attribuer(c1, livA.livreurId, adminC.jeton, { note: "Appeler avant", prevenir: true });
verifier("Admin : confirme en attribuant", a.ok && (await statutEnBase(c1)) === "confirmee", a.message);

// --- Livreur : ce qu'il voit ---
const copie = await attendre(async () => { const s = await db.collection("livraisons").doc(c1.id).get(); return s.exists ? s : null; });
verifier("Copie sans code de livraison ni nom complet", copie && !("codeLivraison" in copie.data()) && !("clientNom" in copie.data()));
verifier("Livreur : lecture directe de la commande refusée", (await lire(`commandes/${c1.id}`, livA.jeton)).status === 403);
verifier("Livreur : liste des commandes refusée", (await lister("commandes", livA.jeton)).status === 403);
verifier("Livreur : voit sa livraison", (await lire(`livraisons/${c1.id}`, livA.jeton)).status === 200);
verifier("Autre livreur : ne voit pas cette livraison", (await lire(`livraisons/${c1.id}`, livB.jeton)).status === 403);
verifier("Livreur : liste des livraisons d'un autre refusée", (await lister("livraisons", livA.jeton, ["livreurId", livB.livreurId])).status === 403);
verifier("Livreur : liste sans filtre refusée", (await lister("livraisons", livA.jeton)).status === 403);
verifier("Livreur : écriture sur sa copie refusée", (await ecrire(`livraisons/${c1.id}`, { statut: "livree" }, livA.jeton)).status === 403);
verifier("Livreur : ne peut pas se créer un compte", (await ecrire(`comptesLivreurs/${client.uid}`, { livreurId: livA.livreurId }, client.jeton)).status === 403);
verifier("Livreur : ne lit pas le compte d'un autre", (await lire(`comptesLivreurs/${livB.uid}`, livA.jeton)).status === 403);
verifier("Livreur : paramètres de livraison refusés", (await lire("parametres/livraison", livA.jeton)).status === 403);
verifier("Livreur : numéros d'équipe lisibles", (await lire("parametres/equipe", livA.jeton)).status !== 403);
for (const nom of ["courses", "paiementsLivreurs", "alertes", "enregistrements", "positions"]) {
  verifier(`Livreur : ses ${nom} lisibles`, (await lister(nom, livA.jeton, ["livreurId", livA.livreurId])).status === 200);
  verifier(`Livreur : ${nom} d'un autre refusés`, (await lister(nom, livA.jeton, ["livreurId", livB.livreurId])).status === 403);
}
verifier("Livreur : journal d'activité refusé", (await lister("journalActivite", livA.jeton)).status === 403);

// --- Livreur : ce qu'il ne peut pas faire ---
for (const [champ, valeur] of [["prixConvenu", 1], ["fraisLivraison", 0], ["livreurId", livB.livreurId]]) {
  verifier(`Livreur : ${champ} refusé`, (await ecrire(`commandes/${c1.id}`, { [champ]: valeur }, livA.jeton)).status === 403);
}
verifier("Livreur : « Livrée » par statut refusée", !(await statut(c1, "livree", livA.jeton)).ok);
verifier("Autre livreur : action refusée", !(await statut(c1, "en_livraison", livB.jeton)).ok && (await statutEnBase(c1)) === "confirmee");
verifier("Livreur : En préparation refusée", !(await statut(c1, "en_preparation", livA.jeton)).ok);
verifier("Livreur : annulation refusée", !(await statut(c1, "annulee_client", livA.jeton, { raison: "x" })).ok);
verifier("Livreur : correction refusée", (await appeler("corrigerStatutCommande", { commandeId: c1.id, statut: "livree", raison: "x" }, livA.jeton)).code === "PERMISSION_DENIED");
verifier("Livreur : paiement refusé", (await appeler("enregistrerPaiementLivreur", { livreurId: livA.livreurId, montant: 1000, mode: "especes", idAction: id() }, livA.jeton)).code === "PERMISSION_DENIED");
verifier("Livreur : argent reçu refusé", (await appeler("enregistrerArgentRecu", { livreurId: livA.livreurId, montant: 1000 }, livA.jeton)).code === "PERMISSION_DENIED");
verifier("Livreur : création de livreur refusée", (await appeler("creerLivreur", { prenom: "X", nom: "Y", telephone: "1", contactUrgence: "2", email: "x@test.bokki", motDePasse: "motdepasse-test" }, livA.jeton)).code === "PERMISSION_DENIED");
verifier("Livreur : désactiver un autre refusé", (await appeler("changerActivationLivreur", { livreurId: livB.livreurId, actif: false }, livA.jeton)).code === "PERMISSION_DENIED");

// --- Livreur : ce qu'il peut faire ---
const idemp = id();
const e1 = await appeler("changerStatutCommande", { commandeId: c1.id, statut: "en_livraison", idAction: idemp }, livA.jeton);
const e2 = await appeler("changerStatutCommande", { commandeId: c1.id, statut: "en_livraison", idAction: idemp }, livA.jeton);
const h1 = (await c1.get()).data().historique;
verifier("Livreur : passe en livraison", e1.ok && (await statutEnBase(c1)) === "en_livraison", e1.message);
verifier("Même action renvoyée : une seule fois", e2.resultat?.deja === true && h1.filter((h) => h.vers === "en_livraison").length === 1);
verifier("Livreur : Retournée sans raison refusée", !(await statut(c1, "retournee", livA.jeton)).ok);
verifier("Livreur : Endommagée sans photo refusée", !(await statut(c1, "endommagee", livA.jeton, { commentaire: "Cassé" })).ok);
verifier("Livreur : photo non image refusée", !(await statut(c1, "endommagee", livA.jeton, { commentaire: "Cassé", photo: { mimeType: "image/jpeg", base64: Buffer.from("pas une image").toString("base64") } })).ok);

// --- Position, vidéo et SOS ---
const posOk = await appeler("enregistrerPositions", { points: [point(c1)] }, livA.jeton);
verifier("Position : livreur sur sa commande acceptée", posOk.ok && posOk.resultat?.refuses === 0, posOk.message);
verifier("Position : commande d'un autre refusée", !(await appeler("enregistrerPositions", { points: [point(c1)] }, livB.jeton)).ok);
const nuit = new Date(midi); nuit.setUTCHours(21);
const posNuit = await appeler("enregistrerPositions", { points: [point(c1, { date: nuit.getTime() - 86400000 })] }, livA.jeton);
verifier("Position : jamais hors 8 h – 18 h", posNuit.resultat?.refuses === 1);
const point2 = point(c1);
await appeler("enregistrerPositions", { points: [point2] }, livA.jeton);
await appeler("enregistrerPositions", { points: [point2] }, livA.jeton);
verifier("Position : un même point n'est compté qu'une fois", (await db.collection("positions").where("commandeId", "==", c1.id).get()).size === 2);

const vid = id();
const dem = await appeler("demarrerEnregistrement", { id: vid, commandeId: c1.id, mime: "video/webm" }, livA.jeton);
verifier("Vidéo : démarrage sur sa commande", dem.ok, dem.message);
verifier("Vidéo : autre livreur refusé au démarrage", !(await appeler("demarrerEnregistrement", { id: id(), commandeId: c1.id, mime: "video/webm" }, livB.jeton)).ok);
verifier("Vidéo : type non vidéo refusé", !(await appeler("demarrerEnregistrement", { id: id(), commandeId: c1.id, mime: "text/html" }, livA.jeton)).ok);
const morceau = { id: vid, index: 0, base64: Buffer.from("video-test").toString("base64") };
verifier("Vidéo : morceau accepté", (await appeler("envoyerMorceau", morceau, livA.jeton)).ok);
verifier("Vidéo : morceau d'un autre refusé", !(await appeler("envoyerMorceau", morceau, livB.jeton)).ok);
const cheminVideo = `videos/${livA.livreurId}/${vid}/0`;
const lireStorage = (chemin, jeton) => fetch(`${STORAGE}/${encodeURIComponent(chemin)}?alt=media`, { headers: jeton ? { Authorization: `Firebase ${jeton}` } : {} });
verifier("Vidéo : lecture directe visiteur refusée", (await lireStorage(cheminVideo)).status === 403);
verifier("Vidéo : lecture directe client refusée", (await lireStorage(cheminVideo, client.jeton)).status === 403);
verifier("Vidéo : lecture directe autre livreur refusée", (await lireStorage(cheminVideo, livB.jeton)).status === 403);
verifier("Vidéo : dépôt direct refusé", (await fetch(`${STORAGE}/${encodeURIComponent(cheminVideo)}`, { method: "POST", headers: { Authorization: `Firebase ${livA.jeton}`, "Content-Type": "video/webm" }, body: "x" })).status === 403);
verifier("Vidéo : consultation autre livreur refusée", (await appeler("consulterEnregistrement", { id: vid }, livB.jeton)).code === "PERMISSION_DENIED");
verifier("Vidéo : lecture autre livreur refusée", (await appeler("lireFichierLivraison", { enregistrementId: vid, index: 0 }, livB.jeton)).code === "PERMISSION_DENIED");
verifier("Vidéo : consultation client refusée", (await appeler("consulterEnregistrement", { id: vid }, client.jeton)).code === "PERMISSION_DENIED");
verifier("Vidéo : son auteur la consulte", (await appeler("consulterEnregistrement", { id: vid }, livA.jeton)).resultat?.morceaux?.length === 1);
const vueAdmin = await appeler("consulterEnregistrement", { id: vid }, adminC.jeton);
const lecture = await appeler("lireFichierLivraison", { enregistrementId: vid, index: 0 }, adminC.jeton);
verifier("Vidéo : admin la lit", vueAdmin.ok && Buffer.from(lecture.resultat?.base64 || "", "base64").toString() === "video-test");
await appeler("envoyerMorceau", { ...morceau, base64: Buffer.from("video-remplacee").toString("base64") }, livA.jeton);
const relu = await appeler("lireFichierLivraison", { enregistrementId: vid, index: 0 }, adminC.jeton);
verifier("Vidéo : un morceau reçu n'est jamais remplacé", Buffer.from(relu.resultat?.base64 || "", "base64").toString() === "video-test");
verifier("Vidéo : consultation admin journalisée", (await db.collection("journalActivite").where("action", "==", "consulter_video").get()).size === 1);
await appeler("terminerEnregistrement", { id: vid, etat: "interrompu", raison: "Appel entrant" }, livA.jeton);
const enr = (await db.collection("enregistrements").doc(vid).get()).data();
verifier("Vidéo : interruption enregistrée avec sa raison", enr.etat === "interrompu" && enr.raison === "Appel entrant");
await appeler("terminerEnregistrement", { id: vid, etat: "termine" }, livA.jeton);
verifier("Vidéo : une interruption ne s'efface pas", (await db.collection("enregistrements").doc(vid).get()).data().etat === "interrompu");

const sosId = id();
const sos = await appeler("declencherSos", { id: sosId, commandeId: c1.id }, livA.jeton);
verifier("SOS : déclenché par le livreur", sos.ok, sos.message);
verifier("SOS : commande d'un autre refusée", !(await appeler("declencherSos", { id: id(), commandeId: c1.id }, livB.jeton)).ok);
verifier("SOS : autre livreur ne le lit pas", (await lire(`alertes/${sos.resultat.alerteId}`, livB.jeton)).status === 403);
verifier("SOS : prise en charge refusée au livreur", (await appeler("traiterAlerte", { alerteId: sos.resultat.alerteId, action: "prendre" }, livA.jeton)).code === "PERMISSION_DENIED");
verifier("SOS : annulation par un autre refusée", !(await appeler("annulerSos", { alerteId: sos.resultat.alerteId }, livB.jeton)).ok);
verifier("SOS : écriture directe refusée", (await ecrire(`alertes/${sos.resultat.alerteId}`, { etat: "annulee" }, livA.jeton)).status === 403);
const posSos = await appeler("enregistrerPositions", { points: [point(c1, { source: "sos", alerteId: sos.resultat.alerteId, date: nuit.getTime() - 86400000 })] }, livA.jeton);
verifier("SOS : position acceptée même hors horaires", posSos.resultat?.refuses === 0, JSON.stringify(posSos.resultat));
const alerteAvant = (await db.collection("alertes").doc(sos.resultat.alerteId).get()).data().nbPositions;
const posAutre = await appeler("enregistrerPositions", { points: [point(null, { source: "sos", alerteId: sos.resultat.alerteId })] }, livB.jeton);
verifier("SOS : position sur l'alerte d'un autre refusée", posAutre.resultat?.refuses === 1
  && (await db.collection("alertes").doc(sos.resultat.alerteId).get()).data().nbPositions === alerteAvant
  && (await db.collection("positions").where("alerteId", "==", sos.resultat.alerteId).where("uid", "==", livB.uid).get()).empty, JSON.stringify(posAutre.resultat));
const posSansAlerte = await appeler("enregistrerPositions", { points: [point(null, { source: "sos", date: nuit.getTime() - 86400000 })] }, livA.jeton);
verifier("SOS : pas de position hors horaires sans alerte", posSansAlerte.resultat?.refuses === 1, JSON.stringify(posSansAlerte.resultat));
const posChemin = await appeler("enregistrerPositions", { points: [point(c1, { alerteId: `${sos.resultat.alerteId}/x/y` })] }, livA.jeton);
verifier("SOS : identifiant d'alerte avec chemin refusé", posChemin.resultat?.refuses === 1, JSON.stringify(posChemin.resultat));
await appeler("enregistrerPositions", { points: [point(c1, { commandeId: ` ${c1.id}` })] }, livA.jeton);
verifier("Position : identifiant de commande nettoyé partout", !(await db.collection("livraisons").doc(` ${c1.id}`).get()).exists);
verifier("SOS : pris en charge par l'admin", (await appeler("traiterAlerte", { alerteId: sos.resultat.alerteId, action: "prendre" }, adminC.jeton)).ok);
const sosClos = await appeler("declencherSos", { id: id() }, livA.jeton);
await appeler("traiterAlerte", { alerteId: sosClos.resultat.alerteId, action: "cloturer", note: "Livreur joint" }, adminC.jeton);
await appeler("annulerSos", { alerteId: sosClos.resultat.alerteId }, livA.jeton);
verifier("SOS : clôture de l'admin non annulable", (await db.collection("alertes").doc(sosClos.resultat.alerteId).get()).data().etat === "cloturee");

const dom = await statut(c1, "endommagee", livA.jeton, { commentaire: "Colis écrasé", photo: { mimeType: "image/jpeg", base64: photoJpeg } });
verifier("Livreur : Endommagée avec photo acceptée", dom.ok && (await statutEnBase(c1)) === "endommagee", dom.message);
verifier("Livreur : plus d'action après Endommagée", !(await statut(c1, "en_livraison", livA.jeton)).ok);
verifier("Admin : Livrée sans code refusée", !(await statut(c1, "livree", adminC.jeton)).ok);

const chemin = (await c1.get()).data().photoIncident;
verifier("Photo : dossier privé", chemin?.startsWith(`incidents/${livA.livreurId}/`), chemin);
verifier("Photo : visiteur refusé", (await lireStorage(chemin)).status === 403);
verifier("Photo : client refusé", (await lireStorage(chemin, client.jeton)).status === 403);
verifier("Photo : autre livreur refusé", (await lireStorage(chemin, livB.jeton)).status === 403);

// --- Code de livraison ---
const c5 = await commande();
await attribuer(c5, livA.livreurId, adminC.jeton);
await statut(c5, "en_livraison", livA.jeton);
const bon = (await c5.get()).data().codeLivraison;
const faux = bon === "1111" ? "2222" : "1111";
verifier("Code : autre livreur refusé", !(await code(c5, bon, livB.jeton)).ok);
let dernier;
for (let i = 0; i < 5; i++) dernier = await code(c5, faux, livA.jeton);
verifier("Code : bloqué après 5 essais", (await c5.get()).data().codeBloque === true, dernier.message);
verifier("Code : le bon code est refusé une fois bloqué", !(await code(c5, bon, livA.jeton)).ok && (await statutEnBase(c5)) === "en_livraison");
const cor = await appeler("corrigerStatutCommande", { commandeId: c5.id, statut: "livree", raison: "Vérifié par téléphone" }, adminC.jeton);
verifier("Code : l'admin corrige après blocage", cor.ok && (await statutEnBase(c5)) === "livree", cor.message);
const c6 = await commande();
await attribuer(c6, livA.livreurId, adminC.jeton);
verifier("Code : refusé avant « En livraison »", !(await code(c6, (await c6.get()).data().codeLivraison, livA.jeton)).ok);
await statut(c6, "en_livraison", livA.jeton);
verifier("Code : le bon code livre", (await code(c6, (await c6.get()).data().codeLivraison, livA.jeton)).ok && (await statutEnBase(c6)) === "livree");
verifier("Livreur : course comptée", !!(await attendre(async () => (await db.collection("courses").doc(c6.id).get()).exists)));

// --- Argent : fin de journée et appels rejoués ---
await attendre(async () => (await db.collection("courses").doc(c5.id).get()).exists);
await appeler("terminerJournee", {}, livA.jeton);
const remise = await appeler("enregistrerArgentRecu", { livreurId: livA.livreurId, montant: 150000 }, adminC.jeton);
const refRemise = db.collection("journees").doc(`${livA.livreurId}_${new Date().toISOString().slice(0, 10)}`);
const avantRejeu = (await refRemise.get()).data();
verifier("Argent reçu : remise enregistrée", remise.ok && avantRejeu.etat === "recue" && avantRejeu.attendu > 0, remise.message);
verifier("Argent reçu : appel rejoué refusé", !(await appeler("enregistrerArgentRecu", { livreurId: livA.livreurId, montant: 150000 }, adminC.jeton)).ok
  && (await refRemise.get()).data().attendu === avantRejeu.attendu);
await appeler("terminerJournee", {}, livA.jeton);
verifier("Fin de journée : ne rouvre pas une remise reçue", (await refRemise.get()).data().etat === "recue");
const idPaiement = id();
for (let i = 0; i < 2; i++) await appeler("enregistrerPaiementLivreur", { livreurId: livA.livreurId, montant: 1000, mode: "especes", idAction: idPaiement }, adminC.jeton);
const paiementsNotes = await db.collection("journalActivite").where("action", "==", "payer_livreur").get();
verifier("Paiement rejoué : une seule ligne au journal", paiementsNotes.size === 1, `${paiementsNotes.size} ligne(s)`);

// --- Réattribution : la position du livreur précédent ne suit pas ---
const c4 = await commande();
await attribuer(c4, livA.livreurId, adminC.jeton);
await attendre(async () => (await db.collection("livraisons").doc(c4.id).get()).exists);
await statut(c4, "en_livraison", livA.jeton);
await appeler("enregistrerPositions", { points: [point(c4)] }, livA.jeton);
const posAvant = (await db.collection("livraisons").doc(c4.id).get()).data().dernierePosition;
await attribuer(c4, livB.livreurId, adminC.jeton);
const repris = await attendre(async () => { const d = (await db.collection("livraisons").doc(c4.id).get()).data(); return d?.livreurId === livB.livreurId ? d : null; });
verifier("Réattribution : position du précédent retirée", !!posAvant && !!repris && !("dernierePosition" in repris));
verifier("Réattribution : ancien livreur sans accès", (await lire(`livraisons/${c4.id}`, livA.jeton)).status === 403);

// --- Mot de passe réinitialisé : l'ancienne session ne reprend pas le compte ---
const livC = await nouveauLivreur("livreur-c", adminC.jeton);
await new Promise((r) => setTimeout(r, 1200));
const reinit = await appeler("nouveauMotDePasseLivreur", { livreurId: livC.livreurId, motDePasse: "provisoire-5678" }, adminC.jeton);
const vol = await appeler("terminerPremiereConnexion", { motDePasse: "motdepasse-vole", accepte: true }, livC.jeton);
let volConnecte = true;
try { await compte("livreur-c@test.bokki", "motdepasse-vole"); } catch { volConnecte = false; }
verifier("Réinitialisation : ancienne session refusée", reinit.ok && vol.code === "UNAUTHENTICATED" && !volConnecte, vol.code);
const reprise = await compte("livreur-c@test.bokki", "provisoire-5678");
verifier("Réinitialisation : le nouveau mot de passe fonctionne", (await appeler("terminerPremiereConnexion", { motDePasse: "motdepasse-test", accepte: true }, reprise.jeton)).ok);

// --- Admin : tout, y compris livrer lui-même ---
const c7 = await commande();
const moi = await appeler("attribuerLivreur", { commandeId: c7.id, moiMeme: true }, adminC.jeton);
verifier("Admin : Je livre moi-même", moi.ok && (await c7.get()).data().livreurId === `admin_${adminC.uid}`, moi.message);
verifier("Admin : lance sa livraison", (await statut(c7, "en_livraison", adminC.jeton)).ok);
verifier("Admin : position sur sa livraison", (await appeler("enregistrerPositions", { points: [point(c7)] }, adminC.jeton)).resultat?.refuses === 0);
verifier("Admin : livre avec le code", (await code(c7, (await c7.get()).data().codeLivraison, adminC.jeton)).ok);
await attendre(async () => (await db.collection("courses").doc(c7.id).get()).exists, 5000);
verifier("Admin : pas de paiement par course", ((await db.collection("courses").doc(c7.id).get()).data()?.montantCourse || 0) === 0);
for (const nom of COLLECTIONS.slice(1)) verifier(`Admin : liste ${nom} permise`, (await lister(nom, adminC.jeton)).status === 200);

// --- Suppression à 7 jours ---
const c8 = await commande();
await attribuer(c8, livA.livreurId, adminC.jeton);
await statut(c8, "en_livraison", livA.jeton);
await appeler("enregistrerPositions", { points: [point(c8)] }, livA.jeton);
const vidP = id();
await appeler("demarrerEnregistrement", { id: vidP, commandeId: c8.id, mime: "video/webm" }, livA.jeton);
await appeler("envoyerMorceau", { id: vidP, index: 0, base64: "dGVzdA==" }, livA.jeton);
const c9 = await commande();
await attribuer(c9, livA.livreurId, adminC.jeton);
await statut(c9, "en_livraison", livA.jeton);
await appeler("enregistrerPositions", { points: [point(c9)] }, livA.jeton);
const vidG = id();
await appeler("demarrerEnregistrement", { id: vidG, commandeId: c9.id, mime: "video/webm" }, livA.jeton);
await appeler("envoyerMorceau", { id: vidG, index: 0, base64: "dGVzdA==" }, livA.jeton);
verifier("Gardé (incident) marqué", (await appeler("garderIncident", { commandeId: c9.id, garde: true }, adminC.jeton)).ok);
verifier("Garder : refusé au livreur", (await appeler("garderIncident", { commandeId: c9.id, garde: true }, livA.jeton)).code === "PERMISSION_DENIED");
const commandesAvant = (await db.collection("commandes").get()).size;
await horloge({ ms: Date.now() + 6 * 86400000 });
await appeler("testerTachesLivraison", { tache: "purge" }, adminC.jeton);
verifier("Purge : rien avant 7 jours", (await db.collection("enregistrements").doc(vidP).get()).exists);
await horloge({ ms: Date.now() + 8 * 86400000 });
const purge = await appeler("testerTachesLivraison", { tache: "purge" }, adminC.jeton);
const fichierExiste = async (c) => (await bucket.file(c).exists())[0];
verifier("Purge : position, vidéo et fichier supprimés", purge.ok
  && (await db.collection("positions").where("commandeId", "==", c8.id).get()).empty
  && !(await db.collection("enregistrements").doc(vidP).get()).exists
  && !(await fichierExiste(`videos/${livA.livreurId}/${vidP}/0`)), JSON.stringify(purge.resultat));
verifier("Purge : « Gardé » conservé", (await db.collection("enregistrements").doc(vidG).get()).exists
  && !(await db.collection("positions").where("commandeId", "==", c9.id).get()).empty
  && await fichierExiste(`videos/${livA.livreurId}/${vidG}/0`));
verifier("Purge : position SOS conservée", !(await db.collection("positions").where("source", "==", "sos").get()).empty);
verifier("Purge : aucune commande touchée", (await db.collection("commandes").get()).size === commandesAvant);
await horloge({ decalageMs: midi.getTime() - Date.now() });

// --- Livreur désactivé ---
const c10 = await commande();
await attribuer(c10, livB.livreurId, adminC.jeton);
const jetonAvant = livB.jeton;
const des = await appeler("changerActivationLivreur", { livreurId: livB.livreurId, actif: false }, adminC.jeton);
verifier("Désactivation par l'admin", des.ok, des.message);
verifier("Désactivé : fonction refusée immédiatement", (await statut(c10, "en_livraison", jetonAvant)).code !== undefined && (await statutEnBase(c10)) === "confirmee");
verifier("Désactivé : lecture de ses livraisons refusée", (await lire(`livraisons/${c10.id}`, jetonAvant)).status === 403);
let connexion = true;
try { await compte("livreur-b@test.bokki"); } catch { connexion = false; }
verifier("Désactivé : connexion impossible", connexion === false);
verifier("Désactivé : ses vidéos refusées", (await appeler("consulterEnregistrement", { id: vidG }, jetonAvant)).code !== undefined);

// --- Secrets et dépendances ---
const RACINE = fileURLToPath(new URL("..", import.meta.url));
const secrets = execSync(String.raw`grep -rIlE "BEGIN (RSA )?PRIVATE KEY|sk_live_|\"private_key\"|client_secret" public || true`, { cwd: RACINE }).toString().trim();
verifier("Aucune clé secrète dans le code client", secrets === "", secrets);
const expliquees = new Set(["sharp"]); // pré-rendu au déploiement, jamais exposé aux visiteurs (voir rapport)
for (const dossier of [".", "functions"]) {
  let rapport = null;
  try { rapport = execSync("npm audit --json", { cwd: `${RACINE}/${dossier}`, stdio: ["ignore", "pipe", "ignore"] }).toString(); }
  catch (e) { rapport = e.stdout?.toString() || null; }
  const v = JSON.parse(rapport || "{}").vulnerabilities;
  if (!v) { verifier(`npm audit ${dossier}`, false, "audit indisponible"); continue; }
  const graves = Object.values(v).filter((x) => ["critical", "high"].includes(x.severity)).map((x) => x.name);
  const nonExpliquees = graves.filter((n) => !expliquees.has(n));
  verifier(`npm audit ${dossier} : aucune faille grave non expliquée`, nonExpliquees.length === 0, graves.join(", ") || "aucune");
}
process.exit(bilan() ? 1 : 0);
