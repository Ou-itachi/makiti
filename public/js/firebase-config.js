// Firebase pour l'ADMIN : application, Firestore, Auth et Functions. Storage
// est à part (firebase-stockage.js). Les pages de la boutique n'importent pas
// ce fichier : elles chargent seulement ce qu'il leur faut (voir
// firebase-base.js, auth-client.js, fonctions.js, donnees.js).
import { app, db } from "./firebase-base.js";
import { auth } from "./auth-client.js";
import { functions } from "./fonctions.js";

export { app, db, auth, functions };
export { appelPublic, memoriserRecapCommande, lireRecapCommande, messageErreurAppel } from "./fonctions.js";
