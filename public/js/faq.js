// FAQ (maquette Faq.html) : accordéon accessible, filtres par thème et
// recherche plein texte (sans accents ni casse).
const liste = document.getElementById("faqListe");
const recherche = document.getElementById("faqRecherche");
const filtres = document.getElementById("faqFiltres");
const vide = document.getElementById("faqVide");
let categorie = "";

const simplifier = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function ouvrir(acc, ouvert) {
  const q = acc.querySelector(".acc-q");
  q.setAttribute("aria-expanded", String(ouvert));
  acc.querySelector(".acc-a").hidden = !ouvert;
}

liste.addEventListener("click", (e) => {
  const q = e.target.closest(".acc-q");
  if (!q) return;
  ouvrir(q.closest(".acc"), q.getAttribute("aria-expanded") !== "true");
});

function appliquer() {
  const terme = simplifier(recherche.value.trim());
  // Tous les mots doivent être présents (« code livraison » trouve
  // « le code de livraison »).
  const mots = terme.split(/\s+/).filter((m) => m.length > 1);
  let n = 0;
  liste.querySelectorAll(".acc").forEach((acc) => {
    const ok = (!categorie || acc.dataset.cat === categorie) && (!mots.length || mots.every((m) => simplifier(acc.textContent).includes(m)));
    acc.hidden = !ok;
    if (ok) n++;
    // Une recherche ouvre les réponses trouvées ; sans recherche, tout se referme.
    ouvrir(acc, Boolean(ok && terme));
  });
  vide.hidden = n > 0;
}

filtres.addEventListener("click", (e) => {
  const b = e.target.closest(".chip");
  if (!b) return;
  categorie = b.dataset.cat;
  filtres.querySelectorAll(".chip").forEach((x) => {
    x.classList.toggle("on", x === b);
    x.setAttribute("aria-pressed", String(x === b));
  });
  appliquer();
});
recherche.addEventListener("input", appliquer);

// Lien direct vers une question : /faq#faq-q3
let cible = null;
try { cible = location.hash ? document.querySelector(location.hash) : null; } catch { /* ancre invalide */ }
if (cible?.classList.contains("acc-q")) ouvrir(cible.closest(".acc"), true);
