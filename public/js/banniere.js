// Bannière d'accueil (mise à jour n°4). Le texte reste fixe, seul le visuel
// change : 1. carte de la Guinée, 2. la femme, la Nimba et la ville, 3. « Elle
// commande ». La scène 2 est dans la page (premier affichage, sans JavaScript
// ou « moins de mouvement ») ; les scènes 1 et 3 sont montées ensuite depuis
// <template id="bkScenes">.
//
// Boucle : scène 1 3 s, scène 2 2 s, scène 3 5 s. Trois points indiquent la
// scène en cours ; un toucher sur un point ou un glissement du doigt force une
// scène. Avec « moins de mouvement », la scène 2 reste seule, sans points.
//
// Aperçu local : ?scene=1, 2 ou 3 fige la bannière sur cette scène.
const visuel = document.getElementById("heroVisuel");
const modele = document.getElementById("bkScenes");
const reduit = matchMedia("(prefers-reduced-motion: reduce)").matches;
const local = ["localhost", "127.0.0.1"].includes(location.hostname);
const apercu = local ? Number(new URLSearchParams(location.search).get("scene")) : 0;
const fige = [1, 2, 3].includes(apercu);
const DUREES = { 1: 3000, 2: 2000, 3: 5000 };
const GLISSEMENT_MIN = 40; // px
const scenes = visuel ? [1, 2, 3].map((n) => visuel.querySelector(`.bk-s${n}`)) : [];

let finJeu = 0;
let minuteur = 0;
let echeance = 0; // fin prévue de la scène en cours
let reste = 0; // temps restant quand la bannière est en pause
let courante = 0;
let enPause = false;
let points = [];

function pause(oui) {
  enPause = oui;
  visuel.classList.toggle("hv-pause", oui);
  majCarte();
  programmer();
}

// La carte (SMIL) ne tourne que pendant sa scène.
function majCarte() {
  const carte = visuel.querySelector(".hv-carte-svg");
  try {
    if (!carte) return;
    if (enPause || reduit || courante !== 1) carte.pauseAnimations();
    else carte.unpauseAnimations();
  } catch { /* SVG pas encore prêt */ }
}

// Animations en pause hors écran (batterie des téléphones d'entrée de gamme).
function brancherPause() {
  let visible = true;
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
  courante = n;
  visuel.dataset.scene = n;
  scenes.forEach((s, i) => s.classList.toggle("on", i === n - 1));
  points.forEach((p, i) => {
    p.classList.toggle("on", i === n - 1);
    p.setAttribute("aria-pressed", String(i === n - 1));
  });
  // L'animation de la scène 3 repart du début à chaque entrée, et reste en
  // place pendant le fondu de sortie (.6 s).
  clearTimeout(finJeu);
  if (n === 3) {
    // Retour rapide sur la scène : l'animation repart bien du début.
    scenes[2].classList.remove("joue");
    void scenes[2].offsetWidth;
    scenes[2].classList.add("joue");
  }
  else finJeu = setTimeout(() => scenes[2].classList.remove("joue"), 600);
  majCarte();
}

function programmer() {
  clearTimeout(minuteur);
  if (fige || !courante) return;
  const maintenant = Date.now();
  if (enPause) {
    // L'animation s'arrête là où elle est : on garde le temps qu'il lui reste.
    if (echeance) reste = Math.max(0, echeance - maintenant);
    echeance = 0;
    return;
  }
  const delai = reste || (echeance > maintenant ? echeance - maintenant : DUREES[courante]);
  reste = 0;
  echeance = maintenant + delai;
  minuteur = setTimeout(() => aller(courante % 3 + 1), delai);
}

function aller(n) {
  echeance = 0;
  reste = 0;
  montrer(n);
  programmer();
}

function creerPoints() {
  const boite = document.createElement("div");
  boite.className = "bk-dots";
  points = [1, 2, 3].map((n) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "bk-dot";
    b.setAttribute("aria-label", `Afficher la scène ${n} de la bannière`);
    b.addEventListener("click", () => aller(n));
    boite.append(b);
    return b;
  });
  visuel.append(boite);
}

function brancherGlissement() {
  let depart = null;
  visuel.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    depart = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  visuel.addEventListener("touchend", (e) => {
    if (!depart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - depart.x;
    const dy = t.clientY - depart.y;
    depart = null;
    if (Math.abs(dx) < GLISSEMENT_MIN || Math.abs(dx) < Math.abs(dy)) return;
    aller(dx < 0 ? courante % 3 + 1 : (courante + 1) % 3 + 1);
  }, { passive: true });
}

function demarrer() {
  creerPoints();
  brancherGlissement();
  aller(1);
}

// Squelette de la photo de la scène 2 tant qu'elle n'est pas arrivée.
const femme = document.getElementById("heroFemme");
if (visuel && femme && !femme.complete) {
  visuel.classList.add("hv-charge");
  const fin = () => visuel.classList.remove("hv-charge");
  femme.addEventListener("load", fin, { once: true });
  femme.addEventListener("error", fin, { once: true });
}

if (visuel && modele && !(reduit && !fige)) {
  monterScenes();
  brancherPause();
  if (fige) montrer(apercu);
  else if (document.readyState === "complete") demarrer();
  else addEventListener("load", demarrer, { once: true });
}
