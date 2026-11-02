// Mon compte (maquette Compte.html), visible uniquement une fois connecté :
// sinon, redirection vers /connexion (brief §5.1). Bloc parrainage : code,
// offre (pourcentages réglés dans l'admin), filleuls et crédit, tout renvoyé
// par profilClient (rien n'est calculé ici).
import { clientCourant, deconnexion, profilClient, mesCommandesClient } from "./session-client.js";
import { telephoneAffiche, memoriserCoordonnees, brancherIndicatif } from "./commande-store.js";
import { VILLES_SUGGEREES } from "./livraison.js";
import { boutonChargement } from "./bouton-chargement.js";
import { escapeHTML, nomProduit, prixProduit, aDesVariantes, PLACEHOLDER_IMG } from "./carte-produit.js";
import { chargerFavoris, coeurHTML, brancherCoeurs } from "./favoris.js";
import { lireProduit } from "./donnees.js";
import { brancherBrouillon } from "./brouillon.js";
import { moneyHTML, onCurrencyChange, refreshCurrencyPrices } from "./currency-display.js";
import { articlesDe } from "./commande-utils.js";
import { STATUTS_EN_COURS, pastilleStatut, premiereImage, totalAPayer } from "./suivi-commun.js";
import { PASSKEYS_ACTIVES, passkeyDisponible, passkeysLocales, LIBELLE_PASSKEY, listerPasskeys, preparerActivationPasskey, activerPasskey, supprimerPasskey, messagePasskey } from "./passkey.js";

const LIBELLE_STATUT = { nouvelle: "En attente de confirmation", non_joignable: "Nous n’arrivons pas à vous joindre", confirmee: "Confirmée", en_negociation: "Confirmée", en_preparation: "En préparation", en_livraison: "En livraison" };

const $ = (id) => document.getElementById(id);
// Ville écrite librement (suggestions discrètes) ; stockée dans le champ
// historique « region » du profil.
$("villesSuggerees").innerHTML = VILLES_SUGGEREES.map((v) => `<option value="${escapeHTML(v)}"></option>`).join("");
const telLivraison = brancherIndicatif($("fTel"));
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

const telAffiche = telephoneAffiche;

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
  const [p, commandes] = await Promise.all([profilClient(null, { avecParrainage: true }), mesCommandesClient()]);
  afficherProfil(p);
  afficherParrainage(p);
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
  afficherPasskeys().catch((err) => console.warn("Passkeys non chargées :", err));
  afficherFavoris().catch((err) => {
    console.warn("Favoris non chargés :", err);
    $("listeFavoris").innerHTML = `<span class="small muted">Favoris indisponibles pour le moment.</span>`;
  });
}

// ---------- Parrainage ----------
const pc = (n) => `${String(n).replace(".", ",")} %`;
const gnf = (n) => `${Math.round(Number(n) || 0).toLocaleString("fr-FR").replace(/[\u202f\u00a0,]/g, " ")} GNF`;
function afficherParrainage(p) {
  const pr = p.parrainage;
  if (!pr?.code) return;
  const pf = pr.actif ? Number(pr.pourcentFilleul) || 0 : 0;
  const pp = pr.actif ? Number(pr.pourcentParrain) || 0 : 0;
  // Titre : l'offre d'abord, en grand (pourcentages lus des réglages).
  $("titreParrain").innerHTML = pf && pp
    ? (pf === pp
      ? `Parrainez un proche : il gagne <em>${pc(pf)}</em>, vous aussi <em>${pc(pp)}</em> !`
      : `Parrainez un proche : il gagne <em>${pc(pf)}</em>, et vous <em>${pc(pp)}</em> !`)
    : pf ? `Parrainez un proche : il gagne <em>${pc(pf)}</em> sur sa 1<sup>re</sup> commande !`
    : pp ? `Parrainez un proche : vous gagnez <em>${pc(pp)}</em> quand il commande !`
    : "Partagez votre code Bokki";
  $("parrainDuo").hidden = !(pf || pp);
  $("duoFilleul").hidden = !pf;
  $("duoParrain").hidden = !pp;
  $("pcFilleul").textContent = pc(pf);
  $("pcParrain").textContent = pc(pp);
  $("parrainPhrase").innerHTML = pf && pp
    ? `Il a ${pc(pf)} de réduction sur sa 1<sup>re</sup> commande, et vous recevez ${pc(pp)} de réduction dès qu’elle est livrée.`
    : pf ? `Il a ${pc(pf)} de réduction sur sa 1<sup>re</sup> commande avec votre code.`
    : pp ? `Vous recevez ${pc(pp)} de réduction dès que sa 1<sup>re</sup> commande est livrée.`
    : "Faites découvrir Bokki à vos proches avec votre code.";
  const plafonds = [];
  if (pf && pr.plafondFilleul > 0) plafonds.push(pf && pp && pr.plafondFilleul === pr.plafondParrain ? `Réductions plafonnées à ${gnf(pr.plafondFilleul)} chacune.` : `Réduction de votre proche plafonnée à ${gnf(pr.plafondFilleul)}.`);
  if (pp && pr.plafondParrain > 0 && !(pf && pr.plafondFilleul === pr.plafondParrain)) plafonds.push(`Votre réduction plafonnée à ${gnf(pr.plafondParrain)} par proche.`);
  $("parrainPlafond").textContent = plafonds.join(" ");
  $("parrainPlafond").hidden = !plafonds.length;
  $("codeParrain").textContent = pr.code;
  // Anti-triche : un code ne sert qu'après une 1re commande livrée du parrain.
  $("parrainInactif").hidden = pr.codeActif !== false;
  const texte = (pf
    ? `Commande sur Bokki et paie à la livraison, partout en Guinée : ${pc(pf)} de réduction sur ta 1re commande avec mon code ${pr.code}`
    : `Commande sur Bokki et paie à la livraison, partout en Guinée. Mon code de parrainage : ${pr.code}`) + ` 👉 ${pr.lien}`;
  $("partagerWa").href = `https://wa.me/?text=${encodeURIComponent(texte)}`;
  const credit = Number(p.creditParrainage) || 0;
  $("parrainCredit").hidden = credit <= 0;
  $("creditTexte").textContent = `${gnf(credit)} de réduction sur votre prochaine commande`;
  const n = Number(pr.filleulsLivres) || 0;
  $("parrainStats").textContent = n
    ? `${n} proche${n > 1 ? "s" : ""} parrainé${n > 1 ? "s" : ""} (commande livrée)${pr.gains > 0 ? ` · ${gnf(pr.gains)} gagnés` : ""}`
    : "Aucun proche parrainé pour le moment.";
  $("parrainage").hidden = false;
}
$("copierCode").addEventListener("click", async () => {
  const etiquette = $("copierCode").querySelector("span");
  try {
    await navigator.clipboard.writeText($("codeParrain").textContent);
    etiquette.textContent = "Copié";
  } catch {
    // Presse-papiers indisponible : sélection du code.
    const r = document.createRange();
    r.selectNodeContents($("codeParrain"));
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    etiquette.textContent = "Sélectionné";
  }
  setTimeout(() => { etiquette.textContent = "Copier"; }, 1800);
});

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

// ---------- Connexion par passkey (Face ID / empreinte) ----------
// Section visible si l'appareil le permet (bouton « Activer ») ou si le
// compte a déjà des passkeys (liste, suppression possible même depuis un
// appareil qui n'en gère pas).
let etatPasskeys = { passkeys: [], userHandle: "" };
let passkeyIci = false;
const dateCourte = (iso) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "");
function messagesPasskey(erreur = "", ok = "") {
  $("erreurPasskey").textContent = erreur;
  $("erreurPasskey").hidden = !erreur;
  $("okPasskey").textContent = ok;
  $("okPasskey").hidden = !ok;
}
function rendrePasskeys(dispo) {
  const locales = passkeysLocales();
  const liste = etatPasskeys.passkeys;
  passkeyIci = liste.some((p) => locales.includes(p.id));
  $("listePasskeys").innerHTML = liste.map((p) => {
    const ici = locales.includes(p.id);
    const details = [`Activée le ${dateCourte(p.dateCreation)}`, p.derniereUtilisation ? `utilisée le ${dateCourte(p.derniereUtilisation)}` : ""].filter(Boolean).join(" · ");
    return `
      <li class="pk-item">
        <div class="col">
          <b class="small">${escapeHTML(p.appareil)}${ici ? ` <span class="pk-ici">· cet appareil</span>` : ""}</b>
          <span class="hint">${escapeHTML(details)}</span>
        </div>
        <button type="button" class="pk-suppr" data-suppr="${escapeHTML(p.id)}" aria-label="Retirer ${escapeHTML(p.appareil)}, ${escapeHTML(details)}"><svg class="i" aria-hidden="true"><use href="/assets/icons.svg?v=2#i-trash"/></svg></button>
      </li>`;
  }).join("");
  $("activerPasskey").hidden = !dispo || passkeyIci;
  if (dispo && !passkeyIci) preparerActivationPasskey();
}
let passkeyDispo = false;
async function afficherPasskeys() {
  if (!PASSKEYS_ACTIVES) return; // désactivé : ni carte ni appel serveur
  const [dispo, liste] = await Promise.all([passkeyDisponible(), listerPasskeys().catch(() => null)]);
  passkeyDispo = dispo;
  if (liste) etatPasskeys = liste;
  if (!dispo && !etatPasskeys.passkeys.length) return;
  if (dispo) {
    const { court, long } = LIBELLE_PASSKEY;
    $("titrePasskeys").textContent = `Connexion par ${court}`;
    $("activerPasskey").querySelector("span").textContent = `Activer la connexion par ${long}`;
  }
  rendrePasskeys(dispo);
  $("passkeys").hidden = false;
}
$("activerPasskey").addEventListener("click", async () => {
  const bouton = $("activerPasskey");
  messagesPasskey();
  boutonChargement(bouton, true, "Activation");
  try {
    await activerPasskey();
    boutonChargement(bouton, false);
    etatPasskeys = await listerPasskeys().catch(() => etatPasskeys);
    rendrePasskeys(passkeyDispo);
    messagesPasskey("", `C’est activé ! La prochaine fois, touchez « Se connecter avec ${LIBELLE_PASSKEY.avec} » sur la page de connexion.`);
  } catch (err) {
    boutonChargement(bouton, false);
    messagesPasskey(messagePasskey(err, "activation"));
  }
});
$("listePasskeys").addEventListener("click", async (e) => {
  const bouton = e.target.closest("[data-suppr]");
  if (!bouton) return;
  const id = bouton.dataset.suppr;
  const cle = etatPasskeys.passkeys.find((p) => p.id === id);
  if (!confirm(`Retirer « ${cle?.appareil || "cet appareil"} » ? Il ne pourra plus vous connecter sans numéro ni code.`)) return;
  messagesPasskey();
  bouton.disabled = true;
  try {
    const restantes = etatPasskeys.passkeys.filter((p) => p.id !== id).map((p) => p.id);
    await supprimerPasskey(id, { restantes, userHandle: etatPasskeys.userHandle });
    etatPasskeys = { ...etatPasskeys, passkeys: etatPasskeys.passkeys.filter((p) => p.id !== id) };
    rendrePasskeys(passkeyDispo);
    messagesPasskey("", "Appareil retiré.");
    if (!passkeyDispo && !etatPasskeys.passkeys.length) $("passkeys").hidden = true;
  } catch (err) {
    bouton.disabled = false;
    messagesPasskey(messagePasskey(err, "suppression") || "Suppression impossible. Réessayez.");
  }
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
    telLivraison.definir(profil.telephoneLivraison || "");
    $("fVille").value = profil.region || "";
    $("fQuartier").value = profil.quartier || "";
    $("fRepere").value = profil.repere || "";
    // Modification commencée puis interrompue : reprise telle quelle.
    brouillonCoords.restaurer();
    telLivraison.actualiser();
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
  const maj = { nom: $("fNom").value.trim(), region: $("fVille").value.trim(), quartier: $("fQuartier").value.trim(), repere: $("fRepere").value.trim() };
  if (maj.region.length < 2) { err.textContent = "Indiquez votre ville."; err.hidden = false; $("fVille").focus(); return; }
  if (!$("champTel").hidden && $("fTel").value.trim()) {
    const t = telLivraison.valeur();
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
