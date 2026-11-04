// Outils communs aux tests de la mise à jour n°5. Émulateur uniquement :
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

export async function attendre(condition, delai = 15000) {
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
