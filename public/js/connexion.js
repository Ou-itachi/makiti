// Page Connexion (maquette Connexion.html), affichée quand une personne non
// connectée appuie sur « Compte ». Après connexion : Mon compte (ou la page
// demandée via ?retour=/chemin).
// Méthode principale : numéro (prérempli avec le dernier numéro utilisé sur
// ce téléphone, indicatif compris) + code personnel. Aussi : passkey (Face
// ID / empreinte, si l'appareil le permet et que la personne l'a activée),
// et un petit lien Google discret pour les anciens comptes créés avec Google.
import { clientCourant, connexionTelephone, connexionGoogle, resultatRedirection, messageConnexion, identifierClient } from "./session-client.js";
import { lireCoordonnees, memoriserCoordonnees, brancherIndicatif } from "./commande-store.js";
import { brancherPin } from "./code-pin.js";
import { ajouterFavoriEnAttente } from "./favoris.js";
import { boutonChargement } from "./bouton-chargement.js";
import {
  passkeyDisponible, conditionnelleDisponible, passkeysLocales, LIBELLE_PASSKEY,
  preparerConnexionPasskey, connexionPasskey, arreterPasskey,
  preparerActivationPasskey, activerPasskey, messagePasskey,
} from "./passkey.js";

// Après connexion : favori demandé avant (cœur touché sans être connecté),
// puis la page de départ.
async function apresConnexion() {
  arreterPasskey();
  await ajouterFavoriEnAttente().catch((e) => console.warn("Favori en attente :", e));
  location.replace(destination);
}

const $ = (id) => document.getElementById(id);
const retourDemande = new URLSearchParams(location.search).get("retour") || "";
// Seulement un chemin interne (pas de redirection ouverte vers un autre site).
const destination = /^\/(?!\/)[\w\-/?=&.%]*$/.test(retourDemande) ? retourDemande : "/compte";

resultatRedirection().then(async (resultat) => {
  if (await clientCourant()) {
    // Retour de la page Google : connexion toute fraîche.
    if (resultat) apresConnexionFraiche();
    else apresConnexion();
  } else {
    $("carte").removeAttribute("aria-busy");
    // Numéro déjà connu sur ce téléphone : il ne reste que le code à taper.
    if (telSaisi.valeur()) pin.focus();
    brancherPasskey();
  }
});

const tel = $("tel");
const telSaisi = brancherIndicatif(tel);
// Dernier numéro utilisé sur ce téléphone (gardé même après déconnexion).
telSaisi.definir(lireCoordonnees().tel || "");
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
  erreurPasskey("");
  try {
    if (await connexionGoogle()) apresConnexionFraiche();
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
  if (!/^\d{4}$/.test(code)) return erreur("Entrez votre code personnel à 4 chiffres.", "pin");
  erreur("");
  erreurPasskey("");
  const bouton = $("connecter");
  boutonChargement(bouton, true, "Connexion");
  try {
    const etat = await connexionTelephone(numero, code);
    if (etat === "nouveau") {
      boutonChargement(bouton, false);
      pin.vider();
      return erreur("Aucun compte avec ce numéro. Votre compte se crée à votre première commande.");
    }
    // Prérempli la prochaine fois (connexion et commande).
    memoriserCoordonnees({ tel: numero });
    apresConnexionFraiche();
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

// ---------- Passkey : connexion ----------
function erreurPasskey(msg) {
  $("erreurPasskey").textContent = msg || "";
  $("erreurPasskey").hidden = !msg;
}

async function brancherPasskey() {
  if (!(await passkeyDisponible())) return;
  const bouton = $("passkey");
  $("passkeyTexte").textContent = `Se connecter avec ${LIBELLE_PASSKEY.avec}`;
  bouton.hidden = false;
  $("ouNumero").hidden = false;
  // Défi préparé tout de suite (Safari : la fenêtre Face ID doit s'ouvrir
  // pendant le toucher, sans attendre le serveur).
  setTimeout(preparerConnexionPasskey, 300);
  bouton.addEventListener("click", async () => {
    erreur("");
    erreurPasskey("");
    boutonChargement(bouton, true, "Connexion");
    try {
      if (await connexionPasskey()) return apresConnexion();
      boutonChargement(bouton, false);
    } catch (err) {
      boutonChargement(bouton, false);
      const m = messagePasskey(err);
      if (m) erreurPasskey(m);
      saisieAutomatique();
    }
  });
  saisieAutomatique();
}

// Saisie automatique (facultative) : sur un appareil où une passkey Bokki a
// déjà servi, toucher le champ Téléphone la propose directement. Seulement
// là, pour ne pas demander un défi au serveur à chaque visite sans raison.
async function saisieAutomatique() {
  if (!passkeysLocales().length || !(await conditionnelleDisponible())) return;
  tel.setAttribute("autocomplete", tel.dataset.autocompletePasskey);
  try {
    if (await connexionPasskey({ conditionnelle: true })) apresConnexion();
  } catch (err) {
    const m = messagePasskey(err);
    if (m) erreurPasskey(m);
  }
}

// ---------- Passkey : proposition après connexion ----------
// Une seule fois par appareil, juste après une connexion par téléphone (ou
// Google) réussie, si l'appareil le permet et n'a pas encore de passkey.
const CLE_OFFRE = "bokki-passkey-proposee";
async function apresConnexionFraiche() {
  arreterPasskey();
  let dejaProposee = true;
  try { dejaProposee = localStorage.getItem(CLE_OFFRE) === "1"; } catch { /* stockage indisponible : on ne propose pas */ }
  if (dejaProposee || passkeysLocales().length || !(await passkeyDisponible())) return apresConnexion();
  try { localStorage.setItem(CLE_OFFRE, "1"); } catch { /* ignore */ }
  preparerActivationPasskey();
  const { long } = LIBELLE_PASSKEY;
  $("offrePasskeyTexte").textContent = `Activez la connexion par ${long} : plus besoin de numéro ni de code sur cet appareil. Rien ne quitte l’appareil : Bokki ne voit jamais votre visage ni votre empreinte.`;
  $("activerOffrePasskey").querySelector("span").textContent = `Activer la connexion par ${LIBELLE_PASSKEY.court}`;
  $("carte").hidden = true;
  $("offrePasskey").hidden = false;
  $("titreOffrePasskey").focus();
}

$("plusTardPasskey").addEventListener("click", () => apresConnexion());
$("activerOffrePasskey").addEventListener("click", async () => {
  const bouton = $("activerOffrePasskey");
  const msg = $("erreurOffrePasskey");
  msg.hidden = true;
  boutonChargement(bouton, true, "Activation");
  try {
    await activerPasskey();
    apresConnexion();
  } catch (err) {
    boutonChargement(bouton, false);
    // Déjà active sur cet appareil : rien à faire de plus.
    if (err?.name === "InvalidStateError") return apresConnexion();
    const m = messagePasskey(err, "activation");
    msg.textContent = m || "Activation impossible pour le moment.";
    msg.hidden = false;
    $("plusTardPasskey").textContent = "Continuer";
  }
});
