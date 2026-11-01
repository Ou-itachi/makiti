// Commande, étape 2 : livraison (maquette Commande.html). Un seul formulaire
// pour le panier et l'achat direct ; le serveur (creerCommande) revérifie
// chaque produit et recalcule tous les prix.
import { appelPublic, messageErreurAppel, memoriserRecapCommande } from "./firebase-config.js";
import { boutonChargement } from "./bouton-chargement.js";
import { ajouterCommande } from "./mes-commandes-store.js";
import { moneyHTML, onCurrencyChange } from "./currency-display.js";
import { getPanier, viderPanier } from "./panier-store.js";
import { escapeHTML, PLACEHOLDER_IMG } from "./carte-produit.js";
import { lireCommande, terminerCommande, lireCoordonnees, memoriserCoordonnees, telephoneLocal } from "./commande-store.js";
import { REGIONS, fraisPour } from "./livraison.js";

const $ = (id) => document.getElementById(id);
const creerCommande = appelPublic("creerCommande");
const commande = lireCommande();

function articles() {
  if (!commande) return [];
  return commande.source === "direct" ? commande.articles : getPanier().articles;
}

if (!commande || !articles().length) location.replace("/panier");
else if (!commande.tel) location.replace("/commande/identification");

// Préremplissage (coordonnées mémorisées sur l'appareil)
const coords = lireCoordonnees();
$("nom").value = coords.nom || "";
if (REGIONS.includes(coords.region)) $("region").value = coords.region;
$("quartier").value = coords.quartier || "";
$("repere").value = coords.repere || "";
$("telRappel").innerHTML = commande?.tel ? `Téléphone : <b>${escapeHTML(commande.tel.startsWith("+224") ? `+224 ${telephoneLocal(commande.tel)}` : commande.tel)}</b> · <a href="/commande/identification">modifier</a>` : "";

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
    });
    memoriserCoordonnees({ tel: commande.tel, nom, region, quartier, repere });
    ajouterCommande(result.data.id, result.data.codeLivraison, commande.tel);
    memoriserRecapCommande(result.data);
    if (commande.source === "panier") viderPanier();
    terminerCommande();
    location.href = `/confirmation?id=${encodeURIComponent(result.data.id)}`;
  } catch (err) {
    erreur(messageErreurAppel(err, "Impossible d’enregistrer la commande. Vérifiez votre connexion et réessayez."));
    boutonChargement(bouton, false);
  }
});

// Un champ signalé redevient normal dès qu'il est corrigé.
$("form").addEventListener("input", (e) => {
  if (e.target.getAttribute("aria-invalid")) e.target.removeAttribute("aria-invalid");
});
