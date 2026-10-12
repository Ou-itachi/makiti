// Bouton en cours d'envoi : contenu (texte + icône) remplacé par trois
// points animés (style dans css/base.css), bouton désactivé, annoncé aux
// lecteurs d'écran. Le contenu d'origine est remis tel quel à la fin.
const contenus = new WeakMap();

export function boutonChargement(bouton, actif, libelle = "Envoi en cours") {
  if (!bouton) return;
  if (actif && !contenus.has(bouton)) {
    contenus.set(bouton, bouton.innerHTML);
    // Taille figée : le bouton ne rétrécit pas quand le texte disparaît.
    bouton.style.minWidth = bouton.offsetWidth + "px";
    bouton.style.minHeight = bouton.offsetHeight + "px";
    bouton.innerHTML = "";
    const points = document.createElement("span");
    points.className = "points-chargement";
    points.setAttribute("role", "status");
    points.setAttribute("aria-label", libelle);
    points.innerHTML = "<span></span><span></span><span></span>";
    bouton.appendChild(points);
  } else if (!actif && contenus.has(bouton)) {
    bouton.innerHTML = contenus.get(bouton);
    contenus.delete(bouton);
    bouton.style.minWidth = "";
    bouton.style.minHeight = "";
  }
  bouton.disabled = actif;
  bouton.classList.toggle("en-chargement", actif);
  bouton.setAttribute("aria-busy", actif ? "true" : "false");
}
