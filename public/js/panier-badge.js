// Compteur du panier : met à jour toutes les pastilles [data-panier-badge]
// (header — #panierBadge — et barre d'onglets mobile) ainsi que le nom
// accessible des liens panier [data-panier-lien]. onPanierChange réagit
// aussi bien à un ajout fait sur cette page qu'à un ajout fait dans un
// autre onglet du même navigateur.
import { compterArticles, onPanierChange } from "./panier-store.js";
// Détection de la qualité du réseau + bandeau "connexion lente / hors
// connexion" : ce module est chargé sur toutes les pages client.
import "./reseau.js";

function actualiserBadge() {
  const n = compterArticles();
  const texte = n > 99 ? "99+" : String(n);
  document.querySelectorAll("[data-panier-badge]").forEach((badge) => {
    badge.textContent = texte;
    badge.hidden = n === 0;
  });
  const nom = n === 0 ? "Panier" : `Panier, ${n} article${n > 1 ? "s" : ""}`;
  document.querySelectorAll("[data-panier-lien]").forEach((lien) => {
    lien.setAttribute("aria-label", nom);
  });
}

actualiserBadge();
onPanierChange(actualiserBadge);

// Commande en attente d'envoi (réseau coupé à « Confirmer ma commande ») :
// renvoyée automatiquement au retour du réseau, depuis n'importe quelle
// page. Le module n'est chargé que s'il y a une commande en attente.
try {
  if (localStorage.getItem("bokki-commande-attente")) {
    import("./commande-attente.js").then((m) => m.surveillerAttente({ discret: location.pathname === "/commande/livraison" }));
  }
} catch { /* stockage indisponible */ }

// Lien de parrainage (bokki.shop/?parrain=CODE, partagé depuis Mon compte) :
// le code est gardé sur le téléphone et préremplit le champ « Code de
// parrainage » de la commande. Simple préremplissage : c'est creerCommande
// qui vérifie le code (et qu'il s'agit bien d'une première commande).
try {
  const params = new URLSearchParams(location.search);
  const code = (params.get("parrain") || "").toUpperCase().replace(/[\s-]/g, "");
  if (params.has("parrain")) {
    if (/^[A-HJ-NP-Z2-9]{6}$/.test(code)) localStorage.setItem("bokki-parrain", code);
    params.delete("parrain");
    const reste = params.toString();
    history.replaceState(history.state, "", location.pathname + (reste ? `?${reste}` : "") + location.hash);
  }
} catch { /* stockage indisponible : le client peut saisir le code */ }
