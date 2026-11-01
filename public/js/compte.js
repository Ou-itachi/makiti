// Mon compte (maquette Compte.html), visible uniquement une fois connecté :
// sinon, redirection vers /connexion (brief §5.1). Le bloc parrainage et
// « Mes réductions » de la maquette sont pour la phase 7 (non codés).
import { clientCourant, deconnexion, profilClient, mesCommandesClient } from "./session-client.js";
import { normaliserTelephone, telephoneLocal, memoriserCoordonnees } from "./commande-store.js";
import { boutonChargement } from "./bouton-chargement.js";
import { escapeHTML } from "./carte-produit.js";
import { moneyHTML, onCurrencyChange, refreshCurrencyPrices } from "./currency-display.js";
import { articlesDe } from "./commande-utils.js";
import { STATUTS_EN_COURS, pastilleStatut, premiereImage, totalAPayer } from "./suivi-commun.js";

const $ = (id) => document.getElementById(id);
const REGIONS = [...$("fRegion").options].map((o) => o.value);
let profil = null;

const user = await clientCourant();
if (!user) {
  location.replace("/connexion");
} else {
  initialiser().catch((err) => {
    console.warn("Compte non chargé :", err);
    $("dernieres").innerHTML = `<p class="error" role="alert">Impossible de charger votre compte. Vérifiez votre connexion et rechargez la page.</p>`;
  });
}

const telAffiche = (t) => (t ? (t.startsWith("+224") ? `+224 ${telephoneLocal(t)}` : t) : "");

function afficherProfil(p) {
  profil = p;
  const prenom = (p.nom || user.displayName || "").trim().split(/\s+/)[0] || "";
  $("bonjour").textContent = prenom ? `Bonjour, ${prenom}` : "Bonjour";
  $("initiale").textContent = (prenom[0] || "B").toUpperCase();
  $("identifiant").textContent = p.fournisseur === "google" ? (p.email || "Compte Google") : telAffiche(p.telephone);
  $("cTel").textContent = telAffiche(p.telephoneLivraison) || "—";
  $("cNom").textContent = p.nom || "—";
  $("cRegion").textContent = p.region || "—";
  $("cQuartier").textContent = p.quartier || "—";
  // Le téléphone d'un compte téléphone est son identifiant : non modifiable ici.
  $("champTel").hidden = p.fournisseur === "telephone";
  // Préremplissage des commandes sur cet appareil.
  memoriserCoordonnees({
    ...(p.telephoneLivraison ? { tel: p.telephoneLivraison } : {}),
    ...(p.nom ? { nom: p.nom } : {}),
    ...(p.region ? { region: p.region } : {}),
    ...(p.quartier ? { quartier: p.quartier } : {}),
    ...(p.repere ? { repere: p.repere } : {}),
  });
}

function ligneCommande(o) {
  const articles = articlesDe(o);
  const autres = articles.length - 1;
  return `
    <a class="row g10 mc-mini" href="/suivi?numero=${encodeURIComponent(o.numero)}">
      <span class="thumb"><img src="${escapeHTML(premiereImage(o))}" alt="" width="64" height="64" loading="lazy"/></span>
      <div class="col g6">
        <b class="mc-nom">${escapeHTML(articles[0]?.nom || "Commande")}</b>
        <span class="small muted">${autres > 0 ? `+${autres} article${autres > 1 ? "s" : ""}` : "1 article"} · ${escapeHTML(o.numero)}</span>
        <b class="small">${moneyHTML(totalAPayer(o))}</b>
      </div>
      ${pastilleStatut(o.statut)}
    </a>`;
}

async function initialiser() {
  const [p, commandes] = await Promise.all([profilClient(), mesCommandesClient()]);
  afficherProfil(p);
  $("nCommandes").textContent = commandes.length;
  $("nEnCours").textContent = commandes.filter((o) => STATUTS_EN_COURS.includes(o.statut)).length;
  $("dernieres").innerHTML = commandes.length
    ? commandes.slice(0, 3).map(ligneCommande).join("")
    : `<div class="empty"><b>Pas encore de commande</b><a class="btn btn-primary btn-sm" href="/catalogue">Voir les produits</a></div>`;
  $("compte").removeAttribute("aria-busy");
}

onCurrencyChange(() => refreshCurrencyPrices());

$("deconnexion").addEventListener("click", async () => {
  boutonChargement($("deconnexion"), true, "Déconnexion");
  await deconnexion().catch(() => undefined);
  location.replace("/");
});

// ---------- Modifier mes coordonnées ----------
function ouvrirForm(ouvert) {
  $("formCoords").hidden = !ouvert;
  $("coords").hidden = ouvert;
  $("modifier").setAttribute("aria-expanded", String(ouvert));
  if (ouvert && profil) {
    $("fNom").value = profil.nom || "";
    $("fTel").value = telephoneLocal(profil.telephoneLivraison || "");
    $("fRegion").value = REGIONS.includes(profil.region) ? profil.region : "Conakry";
    $("fQuartier").value = profil.quartier || "";
    $("fRepere").value = profil.repere || "";
    $("fNom").focus();
  }
}
$("modifier").addEventListener("click", () => ouvrirForm($("formCoords").hidden));
$("annuler").addEventListener("click", () => ouvrirForm(false));
$("formCoords").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("erreurCoords");
  err.hidden = true;
  const maj = { nom: $("fNom").value.trim(), region: $("fRegion").value, quartier: $("fQuartier").value.trim(), repere: $("fRepere").value.trim() };
  if (!$("champTel").hidden && $("fTel").value.trim()) {
    const t = normaliserTelephone($("fTel").value);
    if (!t) { err.textContent = "Numéro de téléphone invalide."; err.hidden = false; return; }
    maj.telephone = t;
  }
  boutonChargement($("enregistrer"), true, "Enregistrement");
  try {
    afficherProfil(await profilClient(maj));
    ouvrirForm(false);
  } catch (e2) {
    err.textContent = e2?.message || "Enregistrement impossible. Réessayez.";
    err.hidden = false;
  } finally {
    boutonChargement($("enregistrer"), false);
  }
});
