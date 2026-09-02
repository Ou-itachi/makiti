// Renseigne les coordonnées de la boutique (téléphone, WhatsApp, adresse)
// sur les pages client à partir de parametres/boutique, édité dans l'admin
// (Paramètres → Informations de la boutique). Si le document n'existe pas
// encore, les valeurs déjà présentes dans le HTML restent affichées — elles
// servent de repli.
//
// Éléments ciblés via des attributs data-shop :
//   data-shop="telephone-text" | "telephone-link"
//   data-shop="whatsapp-text"  | "whatsapp-link"
//   data-shop="adresse-text"   | "adresse-link"
import { db } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

function digits(v) {
  return String(v || "").replace(/[^\d]/g, "");
}

function apply(data) {
  const set = (sel, fn) => document.querySelectorAll(`[data-shop="${sel}"]`).forEach(fn);

  if (data.telephone) {
    set("telephone-text", (el) => { el.textContent = data.telephone; });
    set("telephone-link", (el) => { el.setAttribute("href", "tel:+" + digits(data.telephone)); });
  }
  if (data.whatsapp) {
    set("whatsapp-text", (el) => { el.textContent = data.whatsapp; });
    set("whatsapp-link", (el) => { el.setAttribute("href", "https://wa.me/" + digits(data.whatsapp)); });
  }
  if (data.adresse) {
    set("adresse-text", (el) => { el.textContent = data.adresse; });
    set("adresse-link", (el) => {
      el.setAttribute(
        "href",
        "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(data.adresse)
      );
    });
  }
}

try {
  const snap = await getDoc(doc(db, "parametres", "boutique"));
  if (snap.exists()) apply(snap.data() || {});
} catch (err) {
  // Repli silencieux sur les valeurs du HTML : une coordonnée par défaut
  // affichée vaut mieux qu'une page cassée si la lecture échoue.
  console.warn("[Bokki] parametres/boutique non chargé :", err?.code || err);
}
