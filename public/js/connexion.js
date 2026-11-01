// Page Connexion (maquette Connexion.html), affichée quand une personne non
// connectée appuie sur « Compte ». Après connexion : Mon compte (ou la page
// demandée via ?retour=/chemin).
import { clientCourant, connexionTelephone, connexionGoogle, resultatRedirection, messageConnexion, identifierClient } from "./session-client.js";
import { normaliserTelephone, telephoneLocal, lireCoordonnees } from "./commande-store.js";
import { brancherPin } from "./code-pin.js";
import { ajouterFavoriEnAttente } from "./favoris.js";

// Après connexion : favori demandé avant (cœur touché sans être connecté),
// puis la page de départ.
async function apresConnexion() {
  await ajouterFavoriEnAttente().catch((e) => console.warn("Favori en attente :", e));
  location.replace(destination);
}
import { boutonChargement } from "./bouton-chargement.js";

const $ = (id) => document.getElementById(id);
const retourDemande = new URLSearchParams(location.search).get("retour") || "";
// Seulement un chemin interne (pas de redirection ouverte vers un autre site).
const destination = /^\/(?!\/)[\w\-/?=&.%]*$/.test(retourDemande) ? retourDemande : "/compte";

resultatRedirection().then(async () => {
  if (await clientCourant()) apresConnexion();
  else $("carte").removeAttribute("aria-busy");
});

const tel = $("tel");
tel.value = telephoneLocal(lireCoordonnees().tel || "");
const pin = brancherPin($("pin"));
setTimeout(() => identifierClient.prechauffer?.(), 600);

function erreur(msg, champ) {
  $("erreur").textContent = msg || "";
  $("erreur").hidden = !msg;
  tel.removeAttribute("aria-invalid");
  pin.invalide(false);
  if (champ === "tel") { tel.setAttribute("aria-invalid", "true"); tel.focus(); }
  if (champ === "pin") { pin.invalide(true); pin.focus(); }
}

$("google").addEventListener("click", async () => {
  erreur("");
  try {
    if (await connexionGoogle()) apresConnexion();
  } catch (err) {
    const m = messageConnexion(err);
    if (m) erreur(m);
  }
});

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const numero = normaliserTelephone(tel.value);
  if (!numero) return erreur("Numéro invalide : 9 chiffres commençant par 6 (ex. 622 12 34 56), ou numéro étranger avec « + ».", "tel");
  const code = pin.valeur();
  if (!/^\d{4}$/.test(code)) return erreur("Entrez votre code personnel à 4 chiffres.", "pin");
  erreur("");
  const bouton = $("connecter");
  boutonChargement(bouton, true, "Connexion");
  try {
    const etat = await connexionTelephone(numero, code);
    if (etat === "nouveau") {
      boutonChargement(bouton, false);
      pin.vider();
      return erreur("Aucun compte avec ce numéro. Votre compte se crée à votre première commande.");
    }
    apresConnexion();
  } catch (err) {
    boutonChargement(bouton, false);
    const c = err?.code || "";
    if (c === "functions/permission-denied" || c === "functions/resource-exhausted" || (c === "functions/invalid-argument" && /code/i.test(err.message))) {
      pin.vider();
      return erreur(err.message, "pin");
    }
    erreur(messageConnexion(err));
  }
});
