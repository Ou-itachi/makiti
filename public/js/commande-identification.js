// Commande, étape 1 : identification (maquette Identification.html).
// Phase 3 : téléphone seul. (Phase 6 : + Google / code personnel.)
import { lireCommande, majCommande, lireCoordonnees, normaliserTelephone, telephoneLocal } from "./commande-store.js";

const $ = (id) => document.getElementById(id);
const commande = lireCommande();
if (!commande) location.replace("/panier");
if (commande?.source === "direct" && commande.articles?.[0]?.produitId) {
  $("retour").href = `/produit?id=${encodeURIComponent(commande.articles[0].produitId)}`;
}

const tel = $("tel");
tel.value = telephoneLocal(commande?.tel || lireCoordonnees().tel || "");

function erreurTel(msg) {
  $("telErreur").textContent = msg || "";
  $("telErreur").hidden = !msg;
  tel.setAttribute("aria-invalid", msg ? "true" : "false");
  tel.closest(".prefix").style.borderColor = msg ? "var(--danger)" : "";
}
tel.addEventListener("input", () => erreurTel(""));

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const numero = normaliserTelephone(tel.value);
  if (!numero) {
    erreurTel("Numéro invalide : 9 chiffres commençant par 6 (ex. 622 12 34 56), ou numéro étranger avec « + ».");
    tel.focus();
    return;
  }
  majCommande({ tel: numero });
  location.href = "/commande/livraison";
});
