// Page « Commande enregistrée » (maquette Confirmation.html).
// Affiche tout de suite le récapitulatif renvoyé par creerCommande
// (sessionStorage), puis rafraîchit depuis le serveur (statut à jour).
import { suivreAchat } from "./suivi-pub.js";
import { appelPublic, lireRecapCommande, messageErreurAppel } from "./fonctions.js";
import { getCodeCommande, getTelephoneCommande, ajouterCommande } from "./mes-commandes-store.js";
import { initPushNotifications } from "./push-notifications.js";
import { onCurrencyChange, refreshCurrencyPrices, moneyHTML } from "./currency-display.js";
import { pastilleStatut, friseHTML, codeHTML, recapHTML, totalAPayer, fraisAConfirmer } from "./suivi-commun.js";
import { articlesDe } from "./commande-utils.js";

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get("id") || "";
const lienSuivi = (numero) => "/suivi" + (numero ? "?numero=" + encodeURIComponent(numero) : "?id=" + encodeURIComponent(id));

function afficher(data) {
  $("numero").textContent = data.numero || "—";
  $("code").innerHTML = codeHTML(data.codeLivraison);
  $("statut").innerHTML = pastilleStatut(data.statut);
  $("frise").innerHTML = friseHTML(data);
  $("delai").textContent = data.delaiEstime ? "Livraison estimée : " + data.delaiEstime : "";
  $("recap").innerHTML = recapHTML(data, "Total");
  $("aPayer").innerHTML = `${moneyHTML(totalAPayer(data))}${fraisAConfirmer(data) ? " + frais de livraison (annoncés par l’agent)" : ""} à régler à la livraison, en espèces ou par Orange Money.`;
  $("lienSuivi").href = lienSuivi(data.numero);
  // Code de parrainage saisi : appliqué, ou refusé avec la raison (la
  // commande passe toujours). Message renvoyé par creerCommande seulement.
  if (data.parrainage?.message) {
    $("parrainageMsg").textContent = data.parrainage.message;
    $("parrainageMsg").className = data.parrainage.applique ? "note-green small" : "card-soft small";
    $("parrainageMsg").hidden = false;
  }
  $("contenu-commande").removeAttribute("aria-busy");
}

onCurrencyChange(() => refreshCurrencyPrices());

$("copier").addEventListener("click", async () => {
  const num = $("numero").textContent;
  const etiquette = $("copier").querySelector("span");
  try {
    await navigator.clipboard.writeText(num);
    etiquette.textContent = "Copié";
  } catch {
    // Presse-papiers indisponible (http, ancien navigateur) : sélection du texte.
    const r = document.createRange();
    r.selectNodeContents($("numero"));
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    etiquette.textContent = "Sélectionné";
  }
  setTimeout(() => { etiquette.textContent = "Copier"; }, 1800);
});

if (!id) {
  location.replace("/mes-commandes");
} else {
  const code = getCodeCommande(id);
  const telephone = getTelephoneCommande(id);
  const recap = lireRecapCommande(id);
  if (recap) {
    afficher(recap);
    if (recap.numero) ajouterCommande(id, "", "", recap.numero);
    suivreAchat(id, articlesDe(recap).map((a) => ({ produitId: a.produitId, nom: a.nom, prixUnitaire: a.prixInitial, quantite: a.quantite })), totalAPayer(recap));
  }
  if (!code || !telephone) {
    // Autre appareil ou historique effacé : le suivi demandera le code.
    if (!recap) location.replace(lienSuivi(""));
  } else {
    initPushNotifications(id, code, telephone, $("notif"));
    appelPublic("obtenirSuiviCommande")({ commandeId: id, code, telephone })
      .then(({ data }) => afficher({ fraisLivraison: recap?.fraisLivraison, fraisAConfirmer: recap?.fraisAConfirmer, ...data }))
      .catch((err) => {
        console.warn("Rafraîchissement de la commande impossible :", err);
        if (!recap) {
          $("erreur").textContent = messageErreurAppel(err, "Impossible de charger la commande. Réessayez.");
          $("erreur").hidden = false;
        }
      });
  }
}
