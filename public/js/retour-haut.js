// Bouton « Retour en haut » (accueil et catalogue) : apparaît après un long
// défilement.
const SEUIL = 1200; // px défilés
const bouton = document.createElement("button");
bouton.type = "button";
bouton.className = "retour-haut";
bouton.hidden = true;
bouton.setAttribute("aria-label", "Revenir en haut de la page");
bouton.innerHTML = '<svg class="i" aria-hidden="true"><use href="/assets/icons.svg?v=2#i-chevron-down"/></svg>';
bouton.addEventListener("click", () => {
  const doux = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  scrollTo({ top: 0, behavior: doux ? "smooth" : "auto" });
});
document.body.append(bouton);
let attente = false;
addEventListener("scroll", () => {
  if (attente) return;
  attente = true;
  requestAnimationFrame(() => {
    attente = false;
    bouton.hidden = scrollY < SEUIL;
  });
}, { passive: true });
