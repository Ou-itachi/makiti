// Outils communs aux tests de la mise à jour n°6. Émulateur uniquement :
// refuse de tourner sur un autre projet que demo-bokki.
import { createRequire } from "node:module";

export const PROJET = "demo-bokki";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIREBASE_STORAGE_EMULATOR_HOST = "127.0.0.1:9199";
if (!PROJET.startsWith("demo-")) throw new Error("Projet de démonstration obligatoire.");

const require = createRequire(new URL("../functions/package.json", import.meta.url));
const admin = require("firebase-admin");
admin.initializeApp({ projectId: PROJET, storageBucket: `${PROJET}.appspot.com` });
export const db = admin.firestore();
export const adminAuth = admin.auth();
export const bucket = admin.storage().bucket();
export const { Timestamp, FieldValue } = admin.firestore;

const FS = `http://127.0.0.1:8080/v1/projects/${PROJET}/databases/(default)/documents`;
export const STORAGE = `http://127.0.0.1:9199/v0/b/${PROJET}.appspot.com/o`;
const CLE = "cle-emulateur";

export async function compte(email, motDePasse = "motdepasse-test") {
  const url = (a) => `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:${a}?key=${CLE}`;
  const corps = JSON.stringify({ email, password: motDePasse, returnSecureToken: true });
  const entetes = { "Content-Type": "application/json" };
  let r = await fetch(url("signInWithPassword"), { method: "POST", headers: entetes, body: corps });
  if (!r.ok) r = await fetch(url("signUp"), { method: "POST", headers: entetes, body: corps });
  const j = await r.json();
  if (!j.idToken) throw new Error("Compte impossible : " + JSON.stringify(j));
  return { uid: j.localId, jeton: j.idToken, email };
}

export async function appeler(nom, data, jeton) {
  const r = await fetch(`http://127.0.0.1:5001/${PROJET}/europe-west1/${nom}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) },
    body: JSON.stringify({ data }),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, statut: r.status, code: j.error?.status, message: j.error?.message, resultat: j.result };
}

// Requêtes REST soumises aux règles Firestore, comme un navigateur.
export const lire = (chemin, jeton) => fetch(`${FS}/${chemin}`, { headers: jeton ? { Authorization: `Bearer ${jeton}` } : {} });
export function ecrire(chemin, champs, jeton) {
  const fields = Object.fromEntries(Object.entries(champs).map(([k, v]) => [k, typeof v === "number" ? { integerValue: String(v) } : { stringValue: String(v) }]));
  const masque = Object.keys(champs).map((k) => `updateMask.fieldPaths=${k}`).join("&");
  return fetch(`${FS}/${chemin}?${masque}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) },
    body: JSON.stringify({ fields }),
  });
}
export function lister(collection, jeton, filtre) {
  return fetch(`${FS}:runQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collection }], ...(filtre ? { where: { fieldFilter: { field: { fieldPath: filtre[0] }, op: "EQUAL", value: { stringValue: filtre[1] } } } } : {}) } }),
  });
}

let n = 0;
export async function commande(champs = {}) {
  n += 1;
  const ref = db.collection("commandes").doc();
  const numero = `BK-2026-T${String(n).padStart(2, "0")}${ref.id.slice(0, 3).toUpperCase()}`;
  await ref.set({
    numero, statut: "nouvelle", clientNom: "Mariama Bah", clientTel: "622000001", ville: "Conakry", quartier: "Kipé",
    repere: "Près du marché", montantTotal: 100000, prixInitial: 100000, fraisLivraison: 0, codeLivraison: String(1000 + Math.floor(Math.random() * 8999)),
    articles: [{ produitId: "p1", nom: "Produit test", quantite: 1, prixInitial: 100000 }], dateCreation: Timestamp.now(), fcmToken: "jeton-client-test", ...champs,
  });
  return ref;
}

export async function attendre(condition, delai = 90000) {
  const fin = Date.now() + delai;
  for (;;) {
    const v = await condition();
    if (v) return v;
    if (Date.now() > fin) return null;
    await new Promise((r) => setTimeout(r, 250));
  }
}

let echecs = 0;
export function verifier(nom, ok, detail = "") {
  if (!ok) echecs += 1;
  console.log(`${ok ? "OK   " : "ÉCHEC"} ${nom}${detail ? ` : ${detail}` : ""}`);
}
export const bilan = () => {
  console.log(echecs ? `\n${echecs} contrôle(s) en échec.` : "\nTous les contrôles passent.");
  return echecs;
};
export const photoJpeg = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z", "base64").toString("base64");

// Crée un livreur comme l'admin, puis passe sa première connexion.
export async function nouveauLivreur(prefixe, jetonAdmin, extra = {}) {
  const email = `${prefixe}@test.bokki`;
  const r = await appeler("creerLivreur", {
    prenom: extra.prenom || prefixe, nom: extra.nom || "Test", telephone: "622000010", contactUrgence: "622000011",
    email, motDePasse: "provisoire-1234", tarifCourse: extra.tarifCourse ?? 20000,
  }, jetonAdmin);
  if (!r.ok) throw new Error(`Livreur ${prefixe} : ${r.message}`);
  const provisoire = await compte(email, "provisoire-1234");
  const fin = await appeler("terminerPremiereConnexion", { motDePasse: "motdepasse-test", accepte: true }, provisoire.jeton);
  if (!fin.ok) throw new Error(`Première connexion ${prefixe} : ${fin.message}`);
  return { ...(await compte(email)), livreurId: r.resultat.livreurId };
}

// Depuis la mise à jour n°7 : Confirmer et En préparation passent par leur liste
// de contrôle, puis le livreur s'attribue. Cases de l'interface et du serveur.
export const CASES_CONFIRMER = ["client_appele", "adresse_verifiee", "prix_annonce"];
export const CASES_PREPARER = ["produit_recupere", "produit_verifie", "colis_prepare"];
export async function confirmerEtPreparer(commandeId, jetonAdmin) {
  for (const [statut, checklist] of [["confirmee", CASES_CONFIRMER], ["en_preparation", CASES_PREPARER]]) {
    const r = await appeler("changerStatutCommande", { commandeId, statut, idAction: nouvelId(), checklist }, jetonAdmin);
    if (!r.ok) throw new Error(`${statut} : ${r.message}`);
  }
}
// Attribue, puis attend la copie du livreur : écrite par un déclencheur, sans
// elle ses premiers appels (position, vidéo) sont refusés.
export async function attribuerPrete(commandeId, qui, jetonAdmin, extra = {}) {
  await confirmerEtPreparer(commandeId, jetonAdmin);
  const r = await appeler("attribuerLivreur", { commandeId, ...qui, ...extra }, jetonAdmin);
  if (r.ok) await attendre(async () => (await db.collection("livraisons").doc(commandeId).get()).data()?.livreurId);
  return r;
}
export const horloge = (champs) => db.doc("horlogeTest/actuelle").set(champs);
export const nouvelId = () => Math.random().toString(36).slice(2).padEnd(12, "0") + Date.now().toString(36);
