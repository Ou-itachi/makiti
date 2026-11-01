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
