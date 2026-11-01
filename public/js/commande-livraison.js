// Commande, étape 2 : livraison (maquette Commande.html). Un seul formulaire
// pour le panier et l'achat direct ; le serveur (creerCommande) revérifie
// chaque produit et recalcule tous les prix.
import { appelPublic, messageErreurAppel, memoriserRecapCommande } from "./firebase-config.js";
import { boutonChargement } from "./bouton-chargement.js";
import { ajouterCommande } from "./mes-commandes-store.js";
import { moneyHTML, onCurrencyChange } from "./currency-display.js";
import { getPanier, viderPanier } from "./panier-store.js";
import { escapeHTML, PLACEHOLDER_IMG } from "./carte-produit.js";
import { lireCommande, terminerCommande, lireCoordonnees, memoriserCoordonnees, telephoneLocal, normaliserTelephone, majCommande } from "./commande-store.js";
import { clientCourant, profilClient, connexionJeton } from "./session-client.js";
import { REGIONS, fraisPour } from "./livraison.js";

const $ = (id) => document.getElementById(id);
const creerCommande = appelPublic("creerCommande");
const commande = lireCommande();

function articles() {
  if (!commande) return [];
  return commande.source === "direct" ? commande.articles : getPanier().articles;
}

// Client connecté (Google ou téléphone) : étape 1 sautée, coordonnées du
// compte préremplies. Sans session ni téléphone : retour à l'étape 1.
const client = commande ? await clientCourant() : null;
if (!commande || !articles().length) location.replace("/panier");
else if (!commande.tel && !client) location.replace("/commande/identification");

function preremplir(c) {
  if (c.nom) $("nom").value = c.nom;
  if (REGIONS.includes(c.region)) $("region").value = c.region;
  if (c.quartier) $("quartier").value = c.quartier;
  if (c.repere) $("repere").value = c.repere;
}
preremplir(lireCoordonnees());

function afficherTel() {
  const t = commande?.tel;
  // Compte Google (ou téléphone inconnu) : le numéro se saisit ici.
  $("champTel").hidden = Boolean(t);
  $("telRappel").innerHTML = t
    ? `Téléphone : <b>${escapeHTML(t.startsWith("+224") ? `+224 ${telephoneLocal(t)}` : t)}</b>${client ? "" : ` · <a href="/commande/identification">modifier</a>`}`
    : "";
}
if (client) {
  // Retour : l'étape 1 n'a pas lieu d'être pour un client connecté.
  $("retour").href = commande?.source === "direct" && commande.articles?.[0]?.produitId ? `/produit?id=${encodeURIComponent(commande.articles[0].produitId)}` : "/panier";
  if (commande?.codePersonnel) majCommande({ codePersonnel: null });
  profilClient().then((p) => {
    preremplir(p);
    if (!commande.tel && p.telephoneLivraison) {
      commande.tel = p.telephoneLivraison;
      majCommande({ tel: p.telephoneLivraison });
    }
    afficherTel();
    render();
  }).catch((err) => console.warn("Profil non chargé :", err));
}
afficherTel();

// Réveille la fonction serveur pendant que le client remplit le formulaire.
setTimeout(() => creerCommande.prechauffer?.(), 600);

function render() {
  const liste = articles();
  $("articles").innerHTML = liste.map((a) => `
    <div class="mini">
      <span class="thumb"><img src="${escapeHTML(a.image || PLACEHOLDER_IMG)}" alt="" width="52" height="52" loading="lazy"/></span>
      <div class="col"><span class="small strong">${escapeHTML(a.nom || "Produit")}</span>${a.varianteLibelle ? `<span class="small muted">${escapeHTML(a.varianteLibelle)}</span>` : ""}<span class="small muted">${a.quantite} × ${moneyHTML(a.prixUnitaire)}</span></div>
    </div>`).join("");
  const sousTotal = liste.reduce((s, a) => s + (Number(a.prixUnitaire) || 0) * (Number(a.quantite) || 0), 0);
  const region = $("region").value;
  const frais = fraisPour(region);
  $("sousTotal").innerHTML = moneyHTML(sousTotal);
  if (region === "Conakry") $("frais").textContent = "Gratuite (Conakry)";
  else if (frais == null) $("frais").textContent = "Annoncés avant la livraison";
  else $("frais").innerHTML = `${moneyHTML(frais)}<span class="small muted" style="display:block;font-weight:500;text-align:right">confirmés par l’agent</span>`;
  $("total").innerHTML = moneyHTML(sousTotal + (frais || 0));
  const note = $("noteLivraison");
  note.querySelector("b").textContent = region === "Conakry" ? "Livraison gratuite à Conakry" : `Livraison vers ${region}`;
  note.querySelector(".small").textContent = region === "Conakry"
    ? "Autres régions : les frais vous sont annoncés avant la livraison."
    : "Frais selon la région : l’agent Bokki vous les confirme avant la livraison.";
}
$("region").addEventListener("change", render);
onCurrencyChange(render);
if (commande) render();

function erreur(msg, champ) {
  $("erreur").textContent = msg;
  $("erreur").hidden = !msg;
  document.querySelectorAll("#form [aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
  if (champ) {
    champ.setAttribute("aria-invalid", "true");
    champ.focus();
  }
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nom = $("nom").value.trim();
  const region = $("region").value;
  const quartier = $("quartier").value.trim();
  const repere = $("repere").value.trim();
  if (!commande.tel) {
    const t = normaliserTelephone($("tel").value);
    if (!t) return erreur("Indiquez un numéro de téléphone valide (ex. 622 12 34 56).", $("tel"));
    commande.tel = t;
    majCommande({ tel: t });
  }
  if (nom.length < 2) return erreur("Indiquez votre nom complet.", $("nom"));
  if (!REGIONS.includes(region)) return erreur("Choisissez une région.", $("region"));
  if (!quartier) return erreur("Indiquez votre quartier.", $("quartier"));
  const liste = articles();
  if (!liste.length) return erreur("Votre commande est vide.");
  erreur("");
  const bouton = $("confirmer");
  boutonChargement(bouton, true, "Envoi de la commande");
  try {
    const result = await creerCommande({
      articles: liste.map((a) => ({ produitId: a.produitId, varianteId: a.varianteId || null, quantite: a.quantite })),
      clientNom: nom,
      clientTel: commande.tel,
      ville: region,
      quartier,
      repere,
      // Nouveau client : son code personnel crée le compte avec la commande.
      ...(!client && commande.codePersonnel ? { codePersonnel: commande.codePersonnel } : {}),
    });
    // Compte tout juste créé : session ouverte sur cet appareil.
    if (result.data.jetonConnexion) await connexionJeton(result.data.jetonConnexion).catch((e) => console.warn("Session non ouverte :", e));
    memoriserCoordonnees({ tel: commande.tel, nom, region, quartier, repere });
    ajouterCommande(result.data.id, result.data.codeLivraison, commande.tel, result.data.numero);
    memoriserRecapCommande(result.data);
    if (commande.source === "panier") viderPanier();
    terminerCommande();
    location.href = `/confirmation?id=${encodeURIComponent(result.data.id)}`;
  } catch (err) {
    if (err?.code === "functions/already-exists") {
      // Le numéro a déjà un compte : il faut entrer son code à l'étape 1.
      majCommande({ codePersonnel: null });
      $("erreur").innerHTML = `${escapeHTML(err.message)} <a class="link" href="/commande/identification">Revenir à l’étape 1</a>`;
      $("erreur").hidden = false;
    } else {
      erreur(messageErreurAppel(err, "Impossible d’enregistrer la commande. Vérifiez votre connexion et réessayez."));
    }
    boutonChargement(bouton, false);
  }
});

// Un champ signalé redevient normal dès qu'il est corrigé.
$("form").addEventListener("input", (e) => {
  if (e.target.getAttribute("aria-invalid")) e.target.removeAttribute("aria-invalid");
});
