// Commande, étape 1 : identification (maquette Identification.html).
// Téléphone (prérempli avec le dernier numéro utilisé sur ce téléphone,
// indicatif compris) + code personnel à 4 chiffres — petit lien Google
// discret pour les anciens comptes créés avec Google :
//  • déjà client → connexion (identifierClient), puis étape 2 préremplie ;
//  • nouveau → le code choisi part avec la commande, le compte est créé par
//    creerCommande à la confirmation.
import { lireCommande, majCommande, lireCoordonnees, memoriserCoordonnees, brancherIndicatif } from "./commande-store.js";
import { clientCourant, connexionTelephone, connexionGoogle, resultatRedirection, messageConnexion, identifierClient } from "./session-client.js";
import { brancherPin } from "./code-pin.js";
import { boutonChargement } from "./bouton-chargement.js";

const $ = (id) => document.getElementById(id);
const commande = lireCommande();
if (!commande) location.replace("/panier");
if (commande?.source === "direct" && commande.articles?.[0]?.produitId) {
  $("retour").href = `/produit?id=${encodeURIComponent(commande.articles[0].produitId)}`;
}

// Déjà connecté (ou retour de la redirection Google) : étape 2.
resultatRedirection().then(async () => {
  if (await clientCourant()) location.replace("/commande/livraison");
});

const tel = $("tel");
const telSaisi = brancherIndicatif(tel);
telSaisi.definir(commande?.tel || lireCoordonnees().tel || "");
const pin = brancherPin($("pin"));
// Numéro déjà connu : il ne reste que le code à taper.
if (telSaisi.valeur()) pin.focus();
setTimeout(() => identifierClient.prechauffer?.(), 600);

function erreur(msg, champ) {
  $("erreur").textContent = msg || "";
  $("erreur").hidden = !msg;
  tel.removeAttribute("aria-invalid");
  tel.closest(".prefix").style.borderColor = "";
  pin.invalide(false);
  if (champ === "tel") {
    tel.setAttribute("aria-invalid", "true");
    tel.closest(".prefix").style.borderColor = "var(--danger)";
    tel.focus();
  } else if (champ === "pin") {
    pin.invalide(true);
    pin.focus();
  }
}
tel.addEventListener("input", () => erreur(""));

$("google").addEventListener("click", async () => {
  erreur("");
  try {
    const r = await connexionGoogle();
    if (r) location.href = "/commande/livraison";
  } catch (err) {
    const m = messageConnexion(err);
    if (m) erreur(m);
  }
});

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const numero = telSaisi.valeur();
  if (!numero) return erreur(telSaisi.indicatif() === "224" ? "Numéro invalide : 9 chiffres commençant par 6 (ex. 622 12 34 56)." : "Numéro invalide pour ce pays : vérifiez l’indicatif et le numéro.", "tel");
  const code = pin.valeur();
  if (!/^\d{4}$/.test(code)) return erreur("Entrez votre mot de passe à 4 chiffres.", "pin");
  erreur("");
  const bouton = $("continuer");
  boutonChargement(bouton, true, "Vérification");
  try {
    const etat = await connexionTelephone(numero, code);
    if (etat === "nouveau") majCommande({ tel: numero, codePersonnel: code });
    else {
      majCommande({ tel: numero, codePersonnel: null });
      // Déjà client : numéro prérempli la prochaine fois. (Nouveau client :
      // mémorisé à l'envoi de la commande, avec les autres coordonnées.)
      memoriserCoordonnees({ tel: numero });
    }
    location.href = "/commande/livraison";
  } catch (err) {
    boutonChargement(bouton, false);
    const c = err?.code || "";
    if (c === "functions/permission-denied" || c === "functions/resource-exhausted") { pin.vider(); erreur(err.message, "pin"); }
    else if (c === "functions/invalid-argument" && /code/i.test(err.message)) { pin.vider(); erreur(err.message, "pin"); }
    else erreur(messageConnexion(err));
  }
});
