// Firebase complet (application, Firestore, Auth, Storage, Functions) pour
// l'ADMIN. Les pages de la boutique n'importent pas ce fichier : elles
// chargent seulement ce qu'il leur faut (voir firebase-base.js,
// auth-client.js, fonctions.js, donnees.js) — sur la boutique, Firebase
// n'est plus téléchargé en entier sur chaque page.
import { app, db, EMULATOR } from "./firebase-base.js";
import { auth } from "./auth-client.js";
import { functions } from "./fonctions.js";
import { getStorage, connectStorageEmulator } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";

export { app, db, auth, functions };
export { appelPublic, memoriserRecapCommande, lireRecapCommande, messageErreurAppel } from "./fonctions.js";

export const storage = getStorage(app);
if (EMULATOR) {
  try { connectStorageEmulator(storage, "127.0.0.1", 9199); } catch (e) { console.warn("[Bokki] Émulateur Storage ignoré :", e); }
}
