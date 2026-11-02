// Mon compte (maquette Compte.html), visible uniquement une fois connecté :
// sinon, redirection vers /connexion (brief §5.1). Le bloc parrainage et
// « Mes réductions » de la maquette sont pour la phase 7 (non codés).
import { clientCourant, deconnexion, profilClient, mesCommandesClient } from "./session-client.js";
import { normaliserTelephone, telephoneLocal, memoriserCoordonnees } from "./commande-store.js";
import { boutonChargement } from "./bouton-chargement.js";
import { escapeHTML, nomProduit, prixProduit, aDesVariantes, PLACEHOLDER_IMG } from "./carte-produit.js";
import { chargerFavoris, coeurHTML, brancherCoeurs } from "./favoris.js";
import { lireProduit } from "./donnees.js";
import { brancherBrouillon } from "./brouillon.js";
import { moneyHTML, onCurrencyChange, refreshCurrencyPrices } from "./currency-display.js";
import { articlesDe } from "./commande-utils.js";
import { STATUTS_EN_COURS, pastilleStatut, premiereImage, totalAPayer } from "./suivi-commun.js";

const LIBELLE_STATUT = { nouvelle: "En attente de confirmation", non_joignable: "Nous n’arrivons pas à vous joindre", confirmee: "Confirmée", en_negociation: "Confirmée", en_livraison: "En livraison" };

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
  // Suivre une commande : la commande en cours la plus récente.
  const enCours = commandes.find((o) => STATUTS_EN_COURS.includes(o.statut));
  if (enCours) {
    $("suivreTexte").innerHTML = `Votre commande en cours : ${escapeHTML(enCours.numero)} · <b class="statut-txt">${escapeHTML(LIBELLE_STATUT[enCours.statut] || "En cours")}</b>`;
    $("suivreLien").href = `/suivi?numero=${encodeURIComponent(enCours.numero)}`;
  } else {
    $("suivreTexte").textContent = "Aucune commande en cours. Retrouvez une commande avec son numéro BK et votre code.";
  }
  $("compte").removeAttribute("aria-busy");
  afficherFavoris().catch((err) => {
    console.warn("Favoris non chargés :", err);
    $("listeFavoris").innerHTML = `<span class="small muted">Favoris indisponibles pour le moment.</span>`;
  });
}

// ---------- Mes favoris ----------
const MAX_FAVORIS = 12;
async function afficherFavoris() {
  const ids = await chargerFavoris();
  $("nFavoris").textContent = ids.length;
  if (!ids.length) {
    $("listeFavoris").innerHTML = `<span class="small muted">Touchez le cœur d’un produit pour le retrouver ici.</span>`;
    return;
  }
  // Fiches lues via le cache du téléphone (affichage aussi hors connexion).
  const docs = await Promise.all(ids.slice(0, MAX_FAVORIS).map((id) => lireProduit(id).catch(() => null)));
  const produits = docs.filter(Boolean);
  $("listeFavoris").innerHTML = produits.map((p) => {
    const img = (p.miniaturesEntieres && p.imagesSmall?.[0]) || p.images?.[0] || PLACEHOLDER_IMG;
    return `
      <article class="fav-item">
        <a class="col g6" href="/produit?id=${encodeURIComponent(p.id)}">
          <span class="thumb fav-thumb"><img src="${escapeHTML(img)}" alt="" loading="lazy" decoding="async" width="132" height="104"/></span>
          <span class="small strong fav-nom">${escapeHTML(nomProduit(p))}</span>
          <span class="small muted">${aDesVariantes(p) ? "Dès " : ""}${moneyHTML(prixProduit(p))}</span>
        </a>
        ${coeurHTML(p.id, nomProduit(p))}
      </article>`;
  }).join("") || `<span class="small muted">Vos produits favoris ne sont plus disponibles.</span>`;
  brancherCoeurs($("listeFavoris"));
}
// Un favori retiré ici disparaît de la liste.
addEventListener("bokki:favoris", (e) => {
  $("nFavoris").textContent = e.detail.ids.size;
  $("listeFavoris").querySelectorAll(".fav-item").forEach((el) => {
    if (!e.detail.ids.has(el.querySelector("[data-fav]").dataset.fav)) el.remove();
  });
});

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
    // Modification commencée puis interrompue : reprise telle quelle.
    brouillonCoords.restaurer();
    $("fNom").focus();
  }
}
$("modifier").addEventListener("click", () => ouvrirForm($("formCoords").hidden));
const brouillonCoords = brancherBrouillon($("formCoords"), "coordonnees-compte");
$("annuler").addEventListener("click", () => { brouillonCoords.effacer(); ouvrirForm(false); });
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
    brouillonCoords.effacer();
    ouvrirForm(false);
  } catch (e2) {
    err.textContent = e2?.message || "Enregistrement impossible. Réessayez.";
    err.hidden = false;
  } finally {
    boutonChargement($("enregistrer"), false);
  }
});
