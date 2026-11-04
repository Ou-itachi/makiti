// Firebase Storage, à part de firebase-config.js : seuls les écrans qui
// montrent ou envoient des fichiers (produits, demandes, détail d'une commande,
// historique) téléchargent ce SDK (≈ 14 Ko compressés) ; ni le livreur ni les
// autres pages de l'admin n'en ont besoin.
import { app, EMULATOR } from "./firebase-base.js";
import { getStorage, connectStorageEmulator } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";

export const storage = getStorage(app);
if (EMULATOR) {
  try { connectStorageEmulator(storage, "127.0.0.1", 9199); } catch (e) { console.warn("[Bokki] Émulateur Storage ignoré :", e); }
}
