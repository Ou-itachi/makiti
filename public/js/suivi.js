// « Où est mon colis ? » (maquette Suivi.html).
// Une commande se retrouve avec numéro BK + code de livraison + téléphone,
// depuis n'importe quel appareil. Anciens liens « /suivi?id=… » (SMS,
// notifications) toujours acceptés.
import { appelPublic, messageErreurAppel, erreurReseau } from "./fonctions.js";
import { boutonChargement } from "./bouton-chargement.js";
import { initPushNotifications } from "./push-notifications.js";
import { ajouterCommande, getCodeCommande, getTelephoneCommande, trouverParNumero } from "./mes-commandes-store.js";
import { normaliserTelephone, telephoneLocal, lireCoordonnees } from "./commande-store.js";
import { onCurrencyChange, refreshCurrencyPrices } from "./currency-display.js";
import { pastilleStatut, friseHTML, codeHTML, recapHTML, dateCourte } from "./suivi-commun.js";
import { brancherBrouillon } from "./brouillon.js";

const $ = (id) => document.getElementById(id);
const obtenirSuivi = appelPublic("obtenirSuiviCommande");
const creerAvis = appelPublic("creerAvis", { idempotente: false });
// Saisies gardées sur le téléphone (coupure, rechargement) : recherche et avis.
const brouillonRecherche = brancherBrouillon(document.getElementById("form"), "suivi", { ecraser: false });
const brouillonAvis = brancherBrouillon(document.getElementById("avisTexte")?.parentElement, "avis");

const RE_NUMERO = /^BK-\d{4}-[A-Z0-9]{6}$/;
// Longueur du code : 4 ou 6 chiffres selon parametres/livraison.longueurCode
// (réglable dans l'admin). Les deux sont acceptés ici.
const RE_CODE = /^(?:\d{4}|\d{6})$/;

let courant = null; // { id, code, telephone }

function normaliserNumero(v) {
  let s = String(v || "").toUpperCase().replace(/\s+/g, "");
  // « BK2026A1B2C3 » ou « 2026-A1B2C3 » tapés sans tirets / sans préfixe.
  const m = s.match(/^(?:BK)?-?(\d{4})-?([A-Z0-9]{6})$/);
  if (m) s = `BK-${m[1]}-${m[2]}`;
  return s;
}

function erreur(texte) {
  $("erreur").textContent = texte || "";
  $("erreur").hidden = !texte;
}

function marquer(champ, invalide) {
  if (invalide) champ.setAttribute("aria-invalid", "true");
  else champ.removeAttribute("aria-invalid");
}

function afficher(data) {
  $("vide").hidden = true;
  $("detail").hidden = false;
  $("dNumero").textContent = data.numero || "Commande";
  $("dDate").textContent = data.dateCreation ? "Commandée le " + dateCourte(data.dateCreation).replace(/^Aujourd’hui, /, "aujourd’hui à ") : "";
  $("dStatut").innerHTML = pastilleStatut(data.statut);
  $("dFrise").innerHTML = friseHTML(data);
  $("dDelai").textContent = data.delaiEstime && data.statut !== "livree" ? "Livraison estimée : " + data.delaiEstime : "";
  $("dCode").innerHTML = codeHTML(data.codeLivraison);
  $("dRecap").innerHTML = recapHTML(data, data.statut === "livree" ? "Total payé" : "À payer à la livraison");
  // Avis : seulement une fois livrée.
  $("avis").hidden = data.statut !== "livree";
  if (data.avisSoumis) avisFait(data.avisSoumis.note, data.avisSoumis.commentaire);
}

// Dernier suivi vu de chaque commande, gardé sur le téléphone : affiché
// hors connexion (avec le même code et le même téléphone uniquement).
const CLE_CACHE = "bokki-cache-suivi";
function cacheSuivi() {
  try { return JSON.parse(localStorage.getItem(CLE_CACHE) || "[]"); } catch { return []; }
}
function memoriserSuivi(data, code, telephone) {
  const liste = cacheSuivi().filter((e) => e.data.id !== data.id);
  liste.unshift({ data, code, telephone, t: Date.now() });
  try { localStorage.setItem(CLE_CACHE, JSON.stringify(liste.slice(0, 10))); } catch { /* stockage plein */ }
}
function suiviEnCache({ commandeId, numero, code, telephone }) {
  return cacheSuivi().find((e) => (e.data.id === commandeId || (numero && e.data.numero === numero)) && e.code === code && e.telephone === telephone)?.data || null;
}

async function charger({ id, numero, code, telephone }, { silencieux = false } = {}) {
  const local = !id && numero ? trouverParNumero(numero) : null;
  const commandeId = id || local?.id || "";
  const charge = commandeId ? { commandeId, code, telephone } : { numero, code, telephone };
  try {
    const { data } = await obtenirSuivi(charge);
    const idFinal = data.id || commandeId;
    courant = { id: idFinal, code, telephone };
    if (idFinal) ajouterCommande(idFinal, code, telephone, data.numero);
    afficher(data);
    if (idFinal) memoriserSuivi({ ...data, id: idFinal }, code, telephone);
    if (idFinal) initPushNotifications(idFinal, code, telephone, $("notif"));
    if (data.numero && !silencieux) history.replaceState(null, "", "/suivi?numero=" + encodeURIComponent(data.numero));
    erreur("");
    return true;
  } catch (err) {
    const enCache = erreurReseau(err) ? suiviEnCache({ commandeId, numero, code, telephone }) : null;
    if (enCache) {
      courant = { id: enCache.id, code, telephone };
      afficher(enCache);
      dispatchEvent(new CustomEvent("bokki:donnees-cache"));
      erreur("");
      return true;
    }
    if (silencieux) return false;
    console.warn("Suivi impossible :", err);
    const code = err?.code || "";
    erreur(
      code === "functions/permission-denied" ? "Numéro de commande, code ou téléphone incorrect."
      : code === "functions/invalid-argument" ? "Vérifiez le numéro (BK-AAAA-XXXXXX), le code et le téléphone."
      : code === "functions/resource-exhausted" ? "Trop de tentatives. Réessayez dans quelques minutes."
      : messageErreurAppel(err, "Impossible de retrouver la commande. Vérifiez votre connexion et réessayez.")
    );
    return false;
  }
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  erreur("");
  const numero = normaliserNumero($("numero").value);
  const code = $("code").value.replace(/\D/g, "");
  const tel = normaliserTelephone($("tel").value);
  marquer($("numero"), !RE_NUMERO.test(numero));
  marquer($("code"), !RE_CODE.test(code));
  marquer($("tel"), !tel);
  if (!RE_NUMERO.test(numero)) { erreur("Le numéro de commande ressemble à BK-2026-A1B2C3."); $("numero").focus(); return; }
  if (!RE_CODE.test(code)) { erreur("Le code de livraison fait 4 ou 6 chiffres."); $("code").focus(); return; }
  if (!tel) { erreur("Numéro de téléphone invalide (ex. 620 00 00 00)."); $("tel").focus(); return; }
  $("numero").value = numero;
  const bouton = $("chercher");
  boutonChargement(bouton, true, "Recherche de la commande");
  const ok = await charger({ numero, code, telephone: tel });
  if (ok) brouillonRecherche.effacer();
  boutonChargement(bouton, false);
  if (ok && matchMedia("(max-width: 899px)").matches) $("resultat").scrollIntoView({ behavior: "smooth", block: "start" });
});

$("voirCode").addEventListener("click", () => {
  const ouvert = $("voirCode").getAttribute("aria-expanded") === "true";
  $("voirCode").setAttribute("aria-expanded", String(!ouvert));
  $("blocCode").hidden = ouvert;
});

// ---------- Avis (commande livrée) ----------
let note = 0;
function avisFait(n, texte) {
  $("avisForm").hidden = true;
  $("avisFait").hidden = false;
  $("avisFaitNote").textContent = "★".repeat(n) + "☆".repeat(5 - n);
  $("avisFaitNote").setAttribute("aria-label", `${n} sur 5`);
  $("avisFaitTexte").textContent = texte || "";
}
$("etoiles").addEventListener("click", (e) => {
  const b = e.target.closest(".star-btn");
  if (!b) return;
  note = Number(b.dataset.star);
  $("etoiles").querySelectorAll(".star-btn").forEach((x) => {
    const on = Number(x.dataset.star) <= note;
    x.classList.toggle("on", on);
    x.setAttribute("aria-pressed", String(Number(x.dataset.star) === note));
  });
});
$("avisEnvoyer").addEventListener("click", async () => {
  $("avisErreur").hidden = true;
  if (note < 1) { $("avisErreur").textContent = "Choisissez une note de 1 à 5 étoiles."; $("avisErreur").hidden = false; return; }
  if (!courant?.id) return;
  const commentaire = $("avisTexte").value.trim();
  boutonChargement($("avisEnvoyer"), true, "Envoi de l’avis");
  try {
    await creerAvis({ commandeId: courant.id, code: courant.code, telephone: courant.telephone, note, commentaire });
    brouillonAvis.effacer();
    avisFait(note, commentaire);
  } catch (err) {
    $("avisErreur").textContent = "Avis non enregistré : " + messageErreurAppel(err, "réessayez.");
    $("avisErreur").hidden = false;
  } finally {
    boutonChargement($("avisEnvoyer"), false);
  }
});

onCurrencyChange(() => refreshCurrencyPrices());

// ---------- Démarrage ----------
const params = new URLSearchParams(location.search);
const idParam = params.get("id") || "";
const numeroParam = normaliserNumero(params.get("numero") || "");
const coord = lireCoordonnees();
if (coord?.tel) $("tel").value = telephoneLocal(coord.tel);
if (numeroParam) $("numero").value = numeroParam;

const connu = idParam
  ? { id: idParam, code: getCodeCommande(idParam), tel: getTelephoneCommande(idParam) }
  : numeroParam ? trouverParNumero(numeroParam) : null;
if (connu?.code && connu?.tel) {
  $("code").value = connu.code;
  $("tel").value = telephoneLocal(connu.tel);
  charger({ id: connu.id, code: connu.code, telephone: connu.tel });
}

// Rafraîchit le statut toutes les 2 minutes tant que la page est visible.
setInterval(() => {
  if (courant?.id && document.visibilityState === "visible") charger({ id: courant.id, ...courant }, { silencieux: true });
}, 120000);
