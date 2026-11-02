// Accueil : « Ils ont commandé chez Bokki ». Derniers avis laissés après
// livraison (collection « avis », écrite seulement par la fonction creerAvis :
// uniquement de vrais clients, commande livrée). Rien n'est affiché tant
// qu'il n'y a aucun avis : jamais de faux témoignages. Chargé seulement à
// l'approche de la section (aucun coût pour qui ne descend pas).
import { escapeHTML } from "./carte-produit.js";
import { lireDerniersAvis } from "./donnees.js";
import { urlProduit } from "./slug.js";

const section = document.getElementById("avisAccueil");
const CLE = "bokki-cache-avis-accueil";
const MAX = 8;

const etoiles = (n) => "★".repeat(n) + "☆".repeat(5 - n);
function nomCourt(nom) {
  const p = String(nom || "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "Client Bokki";
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0].toUpperCase()}.` : p[0];
}
function dateCourte(ms) {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function carte(a) {
  const n = Math.max(1, Math.min(5, Math.round(Number(a.note) || 0)));
  const nom = nomCourt(a.clientNom);
  const produit = a.produitNom
    ? a.produitId
      ? `<a class="av-produit" href="${escapeHTML(urlProduit(a.produitId, a.produitNom))}">${escapeHTML(a.produitNom)}</a>`
      : `<span class="av-produit">${escapeHTML(a.produitNom)}</span>`
    : "";
  return `
    <article class="av-carte">
      <span class="stars" role="img" aria-label="${n} sur 5">${etoiles(n)}</span>
      ${a.commentaire ? `<p class="av-texte">« ${escapeHTML(a.commentaire)} »</p>` : `<p class="av-texte av-sans">Note laissée sans commentaire.</p>`}
      <div class="av-pied">
        <span class="avatar" aria-hidden="true">${escapeHTML(nom[0] || "B")}</span>
        <div class="col"><b>${escapeHTML(nom)}</b><span>${escapeHTML(dateCourte(a.t))} · Client vérifié</span></div>
      </div>
      ${produit}
    </article>`;
}

function rendre(liste, moyenne, total) {
  if (!liste.length) { section.hidden = true; return; }
  document.getElementById("avMoyenne").textContent = moyenne.toFixed(1).replace(".", ",");
  document.getElementById("avEtoiles").textContent = etoiles(Math.round(moyenne));
  document.getElementById("avNombre").textContent = `${total} avis de clients livrés`;
  document.getElementById("avRail").innerHTML = liste.map(carte).join("");
  section.hidden = false;
}

async function charger() {
  try {
    const c = JSON.parse(sessionStorage.getItem(CLE) || "null");
    if (c && Date.now() - c.t < 10 * 60 * 1000) { rendre(c.liste, c.moyenne, c.total); return; }
  } catch { /* ignore */ }
  try {
    const tous = (await lireDerniersAvis(40)).map((a) => ({
      note: a.note, commentaire: a.commentaire || "", clientNom: a.clientNom, produitNom: a.produitNom, produitId: a.produitId,
      t: Date.parse(a.dateCreation) || 0,
    }));
    const moyenne = tous.length ? tous.reduce((s, a) => s + (Number(a.note) || 0), 0) / tous.length : 0;
    // Les avis avec un commentaire d'abord (plus parlants), puis les plus récents.
    const liste = [...tous].sort((a, b) => (Number(Boolean(b.commentaire)) - Number(Boolean(a.commentaire))) || b.t - a.t).slice(0, MAX);
    rendre(liste, moyenne, tous.length);
    try { sessionStorage.setItem(CLE, JSON.stringify({ t: Date.now(), liste, moyenne, total: tous.length })); } catch { /* ignore */ }
  } catch (err) {
    console.warn("Avis non chargés :", err);
    section.hidden = true;
  }
}

if (section) {
  if ("IntersectionObserver" in window) {
    const obs = new IntersectionObserver((entrees) => {
      if (entrees.some((e) => e.isIntersecting)) { obs.disconnect(); charger(); }
    }, { rootMargin: "600px 0px" });
    obs.observe(section.parentElement || section);
  } else charger();
}
