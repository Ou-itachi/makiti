// Bannière d'accueil (mise à jour n°4). Le texte reste fixe, seul le visuel
// change : 1. carte de la Guinée, 2. la femme, la Nimba et la ville, 3. « Elle
// commande ». La scène 2 est dans la page (premier affichage, sans JavaScript
// ou « moins de mouvement ») ; les scènes 1 et 3 sont montées ensuite depuis
// <template id="bkScenes">.
//
// Aperçu local : ?scene=1, 2 ou 3 fige la bannière sur cette scène.
const visuel = document.getElementById("heroVisuel");
const modele = document.getElementById("bkScenes");
const reduit = matchMedia("(prefers-reduced-motion: reduce)").matches;
const local = ["localhost", "127.0.0.1"].includes(location.hostname);
const apercu = local ? Number(new URLSearchParams(location.search).get("scene")) : 0;
const scenes = visuel ? [1, 2, 3].map((n) => visuel.querySelector(`.bk-s${n}`)) : [];

function pause(oui) {
  visuel.classList.toggle("hv-pause", oui);
  const carte = visuel.querySelector(".hv-carte-svg");
  try {
    if (carte) { if (oui || reduit) carte.pauseAnimations(); else carte.unpauseAnimations(); }
  } catch { /* SVG pas encore prêt */ }
}

// Animations en pause hors écran (batterie des téléphones d'entrée de gamme).
function brancherPause() {
  let visible = true;
  pause(false);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((e) => { visible = e[0].isIntersecting; pause(!visible || document.hidden); }).observe(visuel);
  }
  document.addEventListener("visibilitychange", () => pause(document.hidden || !visible));
}

function monterScenes() {
  scenes[0].append(modele.content.querySelector(".hv-carte"));
  scenes[2].append(modele.content.querySelector(".hero-live"));
}

function montrer(n) {
  visuel.dataset.scene = n;
  scenes.forEach((s, i) => s.classList.toggle("on", i === n - 1));
}

if (visuel && modele && !(reduit && !apercu)) {
  monterScenes();
  if ([1, 2, 3].includes(apercu)) montrer(apercu);
  brancherPause();
}
