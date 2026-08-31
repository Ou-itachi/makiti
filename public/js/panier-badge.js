// Compteur du panier dans le header : #panierBadge est une pastille commune
// à toute page qui reprend ce header (aujourd'hui seule produit.html
// l'affiche). onPanierChange réagit aussi bien à un ajout fait sur cette
// page qu'à un ajout fait dans un autre onglet du même navigateur.
import { compterArticles, onPanierChange } from "./panier-store.js";

function actualiserBadge() {
  const badge = document.getElementById("panierBadge");
  if (!badge) return;
  const n = compterArticles();
  badge.textContent = n > 99 ? "99+" : String(n);
  badge.hidden = n === 0;
}

actualiserBadge();
onPanierChange(actualiserBadge);
