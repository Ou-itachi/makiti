// Contrôles de sécurité de la mise à jour n°5 (section 6), sur l'émulateur :
// règles Firestore, règles Storage et fonctions, avec de vrais jetons de test.
import { db, bucket, compte, appeler, lire, ecrire, lister, commande, attendre, verifier, bilan, photoJpeg, STORAGE, FieldValue } from "./maj5-commun.mjs";

const id = () => Math.random().toString(36).slice(2).padEnd(12, "0") + Date.now().toString(36);
const statut = (ref, s, jeton, extra = {}) => appeler("changerStatutCommande", { commandeId: ref.id, statut: s, idAction: id(), ...extra }, jeton);
const statutEnBase = async (ref) => (await ref.get()).data().statut;

const adminC = await compte("admin@test.bokki");
await db.collection("admins").doc(adminC.uid).set({ email: adminC.email });
await db.collection("livreurs").doc("liv-a").set({ nom: "Sékou Fofana", telephone: "622000010" });
await db.collection("livreurs").doc("liv-b").set({ nom: "Alpha Barry", telephone: "622000011" });
const lierA = await appeler("lierCompteLivreur", { livreurId: "liv-a", email: "livreur-a@test.bokki", motDePasse: "motdepasse-test" }, adminC.jeton);
const lierB = await appeler("lierCompteLivreur", { livreurId: "liv-b", email: "livreur-b@test.bokki", motDePasse: "motdepasse-test" }, adminC.jeton);
verifier("L'admin crée les comptes livreur", lierA.ok && lierB.ok, lierA.message || lierB.message);
const livA = await compte("livreur-a@test.bokki"); // nouveau jeton : badge livreurId inclus
const livB = await compte("livreur-b@test.bokki");
const client = await compte("client@test.bokki");
const autreClient = await compte("autre-client@test.bokki");

// --- Visiteur non connecté ---
const c1 = await commande({ uid: client.uid });
verifier("Visiteur : lecture d'une commande refusée", (await lire(`commandes/${c1.id}`)).status === 403);
verifier("Visiteur : liste des commandes refusée", (await lister("commandes")).status === 403);
verifier("Visiteur : modification refusée", (await ecrire(`commandes/${c1.id}`, { statut: "livree" })).status === 403);
verifier("Visiteur : fonction de statut refusée", (await statut(c1, "en_livraison")).code === "UNAUTHENTICATED");
verifier("Visiteur : copie livraison refusée", (await lire(`livraisons/${c1.id}`)).status === 403);

// --- Client ---
const c2 = await commande({ uid: autreClient.uid });
verifier("Client : lecture directe refusée, même la sienne", (await lire(`commandes/${c1.id}`, client.jeton)).status === 403);
const miennes = await appeler("mesCommandesClient", {}, client.jeton);
const ids = (miennes.resultat?.commandes || []).map((c) => c.id);
verifier("Client : ne reçoit que ses commandes", ids.includes(c1.id) && !ids.includes(c2.id), `${ids.length} commande(s)`);
verifier("Client : changement de statut direct refusé", (await ecrire(`commandes/${c1.id}`, { statut: "annulee_client" }, client.jeton)).status === 403);
verifier("Client : fonction de statut refusée", (await statut(c1, "annulee_client", client.jeton, { raison: "test" })).code === "PERMISSION_DENIED");

// --- Attribution : admin seul ---
verifier("Livreur : ne peut pas attribuer", (await appeler("attribuerLivreur", { commandeId: c1.id, livreurId: "liv-a" }, livA.jeton)).code === "PERMISSION_DENIED");
verifier("Client : ne peut pas attribuer", (await appeler("attribuerLivreur", { commandeId: c1.id, livreurId: "liv-a" }, client.jeton)).code === "PERMISSION_DENIED");
verifier("Livreur : ne peut pas confirmer", (await statut(c1, "confirmee", livA.jeton)).code === "PERMISSION_DENIED");
verifier("Admin : confirmer sans livreur refusé", !(await appeler("attribuerLivreur", { commandeId: c1.id, livreurId: "" }, adminC.jeton)).ok && (await statutEnBase(c1)) === "nouvelle");
verifier("Admin : pas de « Confirmée » sans attribution", (await statut(c1, "confirmee", adminC.jeton)).code === "FAILED_PRECONDITION");
verifier("Transition interdite : Nouvelle vers En livraison (admin)", (await statut(c1, "en_livraison", adminC.jeton)).code === "FAILED_PRECONDITION" && (await statutEnBase(c1)) === "nouvelle");
verifier("Transition interdite : Nouvelle vers En livraison (livreur)", (await statut(c1, "en_livraison", livA.jeton)).code === "PERMISSION_DENIED");
verifier("Admin : statut direct en base refusé par les règles", (await ecrire(`commandes/${c1.id}`, { statut: "livree" }, adminC.jeton)).status === 403);
verifier("Admin : attribution directe en base refusée", (await ecrire(`commandes/${c1.id}`, { livreurId: "liv-a" }, adminC.jeton)).status === 403);

const a = await appeler("attribuerLivreur", { commandeId: c1.id, livreurId: "liv-a", note: "Appeler avant", prevenir: true }, adminC.jeton);
verifier("Admin : confirme en attribuant", a.ok && (await statutEnBase(c1)) === "confirmee", a.message);
const d1 = (await c1.get()).data();
verifier("Attribution enregistrée avec l'historique", d1.livreurId === "liv-a" && !!d1.attribueeLe && d1.attribueePar === adminC.uid && d1.historique?.[0]?.type === "attribution");

// --- Livreur : ce qu'il voit ---
const copie = await attendre(async () => { const s = await db.collection("livraisons").doc(c1.id).get(); return s.exists ? s : null; });
verifier("Copie livraison créée après attribution", !!copie);
verifier("Copie sans code de livraison ni nom complet", copie && !("codeLivraison" in copie.data()) && !("clientNom" in copie.data()) && copie.data().clientInitiales === "M. B.");
verifier("Livreur : lecture directe de la commande refusée", (await lire(`commandes/${c1.id}`, livA.jeton)).status === 403);
verifier("Livreur : liste des commandes refusée", (await lister("commandes", livA.jeton)).status === 403);
verifier("Livreur : voit sa livraison", (await lire(`livraisons/${c1.id}`, livA.jeton)).status === 200);
verifier("Autre livreur : ne voit pas cette livraison", (await lire(`livraisons/${c1.id}`, livB.jeton)).status === 403);
verifier("Livreur : liste limitée à ses livraisons", (await lister("livraisons", livA.jeton, ["livreurId", "liv-a"])).status === 200);
verifier("Livreur : liste des livraisons d'un autre refusée", (await lister("livraisons", livA.jeton, ["livreurId", "liv-b"])).status === 403);
verifier("Livreur : liste sans filtre refusée", (await lister("livraisons", livA.jeton)).status === 403);
verifier("Livreur : écriture sur sa copie refusée", (await ecrire(`livraisons/${c1.id}`, { statut: "livree" }, livA.jeton)).status === 403);
verifier("Livreur : ne peut pas se créer un compte livreur", (await ecrire(`comptesLivreurs/${client.uid}`, { livreurId: "liv-a" }, client.jeton)).status === 403);
verifier("Livreur : ne lit pas le compte d'un autre", (await lire(`comptesLivreurs/${livB.uid}`, livA.jeton)).status === 403);
verifier("Livreur : pas d'accès admin", (await lire("parametres/livraison", livA.jeton)).status === 403);

// --- Livreur : ce qu'il ne peut pas faire ---
verifier("Livreur : modification de prix refusée", (await ecrire(`commandes/${c1.id}`, { prixConvenu: 1 }, livA.jeton)).status === 403);
verifier("Livreur : modification des frais refusée", (await ecrire(`commandes/${c1.id}`, { fraisLivraison: 0 }, livA.jeton)).status === 403);
verifier("Livreur : modification d'attribution refusée", (await ecrire(`commandes/${c1.id}`, { livreurId: "liv-b" }, livA.jeton)).status === 403);
verifier("Livreur : « Livrée » par statut refusée", (await statut(c1, "livree", livA.jeton)).code === "PERMISSION_DENIED");
verifier("Autre livreur : action refusée", (await statut(c1, "en_livraison", livB.jeton)).code === "PERMISSION_DENIED" && (await statutEnBase(c1)) === "confirmee");
verifier("Livreur : En préparation refusée", (await statut(c1, "en_preparation", livA.jeton)).code === "PERMISSION_DENIED");
verifier("Livreur : En négociation refusée", (await statut(c1, "en_negociation", livA.jeton)).code === "PERMISSION_DENIED");
verifier("Livreur : validation du code refusée", (await appeler("validerCodeLivraison", { commandeId: c1.id, code: d1.codeLivraison }, livA.jeton)).code === "PERMISSION_DENIED");
verifier("Livreur : ne donne pas d'accès", (await appeler("lierCompteLivreur", { livreurId: "liv-b", email: "x@test.bokki", motDePasse: "motdepasse-test" }, livA.jeton)).code === "PERMISSION_DENIED");

// --- Livreur : ce qu'il peut faire ---
const idemp = id();
const e1 = await appeler("changerStatutCommande", { commandeId: c1.id, statut: "en_livraison", idAction: idemp }, livA.jeton);
const e2 = await appeler("changerStatutCommande", { commandeId: c1.id, statut: "en_livraison", idAction: idemp }, livA.jeton);
const h1 = (await c1.get()).data().historique;
verifier("Livreur : passe en livraison", e1.ok && (await statutEnBase(c1)) === "en_livraison", e1.message);
verifier("Même action renvoyée : une seule fois", e2.resultat?.deja === true && h1.filter((h) => h.vers === "en_livraison").length === 1);
verifier("Historique : qui et quand", h1.at(-1).par === livA.uid && h1.at(-1).role === "livreur" && !!h1.at(-1).date);
verifier("Livreur : Retournée sans raison refusée", (await statut(c1, "retournee", livA.jeton)).code === "INVALID_ARGUMENT");
verifier("Livreur : Annulée sans raison refusée", (await statut(c1, "annulee_client", livA.jeton)).code === "INVALID_ARGUMENT");
verifier("Livreur : Endommagée sans photo refusée", (await statut(c1, "endommagee", livA.jeton, { commentaire: "Cassé" })).code === "INVALID_ARGUMENT");
verifier("Livreur : photo non image refusée", (await statut(c1, "endommagee", livA.jeton, { commentaire: "Cassé", photo: { mimeType: "image/jpeg", base64: Buffer.from("pas une image").toString("base64") } })).code === "INVALID_ARGUMENT");
const dom = await statut(c1, "endommagee", livA.jeton, { commentaire: "Colis écrasé", photo: { mimeType: "image/jpeg", base64: photoJpeg } });
verifier("Livreur : Endommagée avec photo acceptée", dom.ok && (await statutEnBase(c1)) === "endommagee", dom.message);
verifier("Livreur : plus d'action après Endommagée", (await statut(c1, "en_livraison", livA.jeton)).code === "PERMISSION_DENIED");
verifier("Admin : corriger vers Livrée sans code refusé", (await statut(c1, "livree", adminC.jeton)).code === "PERMISSION_DENIED");

// --- Stockage privé des photos ---
const chemin = (await c1.get()).data().photoIncident;
const url = `${STORAGE}/${encodeURIComponent(chemin)}?alt=media`;
const lirePhoto = (jeton) => fetch(url, { headers: jeton ? { Authorization: `Firebase ${jeton}` } : {} });
verifier("Photo enregistrée dans le dossier privé", chemin?.startsWith("incidents/liv-a/"), chemin);
verifier("Photo : visiteur refusé", (await lirePhoto()).status === 403);
verifier("Photo : client refusé", (await lirePhoto(client.jeton)).status === 403);
verifier("Photo : autre livreur refusé", (await lirePhoto(livB.jeton)).status === 403);
verifier("Photo : livreur concerné autorisé", (await lirePhoto(livA.jeton)).status === 200);
const adminFrais = await compte(adminC.email);
await attendre(async () => {
  const j = JSON.parse(Buffer.from((await compte(adminC.email)).jeton.split(".")[1], "base64url").toString());
  return j.admin === true;
}, 8000);
verifier("Photo : admin autorisé", (await lirePhoto((await compte(adminC.email)).jeton)).status === 200);
const envoi = await fetch(`${STORAGE}/${encodeURIComponent("incidents/liv-a/x/y.jpg")}`, { method: "POST", headers: { Authorization: `Firebase ${livA.jeton}`, "Content-Type": "image/jpeg" }, body: "x" });
verifier("Photo : dépôt direct refusé", envoi.status === 403);

// --- Changement de livreur ---
const c3 = await commande();
await appeler("attribuerLivreur", { commandeId: c3.id, livreurId: "liv-a" }, adminC.jeton);
await attendre(async () => (await db.collection("livraisons").doc(c3.id).get()).exists);
await appeler("attribuerLivreur", { commandeId: c3.id, livreurId: "liv-b" }, adminC.jeton);
const passe = await attendre(async () => (await db.collection("livraisons").doc(c3.id).get()).data()?.livreurId === "liv-b");
verifier("Changement de livreur : la commande passe au nouveau", !!passe);
verifier("Ancien livreur : plus d'accès", (await lire(`livraisons/${c3.id}`, livA.jeton)).status === 403);
const c4 = await commande({ statut: "livree", livreurId: "liv-a" });
verifier("Commande livrée : livreur non modifiable", (await appeler("attribuerLivreur", { commandeId: c4.id, livreurId: "liv-b" }, adminC.jeton)).code === "FAILED_PRECONDITION");
verifier("Compte livreur retiré : plus d'action", (await appeler("delierCompteLivreur", { livreurId: "liv-b" }, adminC.jeton)).ok && (await statut(c3, "en_livraison", livB.jeton)).code === "PERMISSION_DENIED");
void adminFrais; void FieldValue; void bucket;
process.exit(bilan() ? 1 : 0);
