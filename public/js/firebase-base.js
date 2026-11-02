// Socle Firebase minimal : application + Firestore, rien d'autre.
// Les pages qui n'ont besoin que de Firestore importent ce module ; Auth,
// Storage et Functions (firebase-config.js, fonctions.js) ne sont
// téléchargés que par les pages qui s'en servent. L'application elle-même
// (et le basculement émulateurs) est dans firebase-appli.js.
import { app, EMULATOR, SUR_LOCALHOST } from "./firebase-appli.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

export { app, EMULATOR, SUR_LOCALHOST };

// Cache local persistant (IndexedDB) en prod : au relancement de l'app (PWA
// installée notamment), onSnapshot() résout instantanément depuis ce cache
// pendant que Firestore reconcilie en arrière-plan, et les dernières données
// vues restent lisibles hors connexion. persistentMultipleTabManager :
// site + admin peuvent être ouverts dans plusieurs onglets.
export const db = initializeFirestore(app, {
  localCache: EMULATOR
    ? memoryLocalCache()
    : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

if (EMULATOR) {
  try {
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    console.info("[Bokki] Émulateurs Firebase connectés (QA).");
  } catch (e) {
    console.warn("[Bokki] Basculement émulateur ignoré :", e);
  }
}
