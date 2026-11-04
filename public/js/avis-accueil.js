// Accueil : « Ils nous font confiance ». Les avis les plus récents notés 4 ou
// 5 étoiles (2 sur téléphone, 3 sur ordinateur). Collection « avis », écrite
// seulement par la fonction creerAvis : de vrais clients livrés. Rien n'est
// affiché tant qu'il n'y en a pas : jamais de faux témoignages. Chargé
// seulement à l'approche de la section (aucun coût pour qui ne descend pas).
import { escapeHTML } from "./carte-produit.js";
import { lireDerniersAvis } from "./donnees.js";

const section = document.getElementById("avisAccueil");
const CLE = "bokki-cache-avis-confiance";
const MAX = 3;

const ETOILE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12 2.5l2.9 6.2 6.8.8-5 4.6 1.4 6.7-6.1-3.4-6.1 3.4 1.4-6.7-5-4.6 6.8-.8z"/></svg>';

function identite(nom) {
  const p = String(nom || "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return { nom: "Client Bokki", initiales: "B" };
  const initialeNom = p.length > 1 ? p[p.length - 1][0].toUpperCase() : "";
  return { nom: initialeNom ? `${p[0]} ${initialeNom}.` : p[0], initiales: `${p[0][0].toUpperCase()}${initialeNom}` };
}

function carte(a) {
  const n = Math.max(1, Math.min(5, Math.round(Number(a.note) || 0)));
  const { nom, initiales } = identite(a.clientNom);
  return `
    <article class="rv">
      <span class="rv-av" aria-hidden="true">${escapeHTML(initiales)}</span>
      <div class="col g6">
        <span class="rv-stars" role="img" aria-label="${n} sur 5">${ETOILE.repeat(n)}</span>
        ${a.commentaire ? `<p class="rv-texte">« ${escapeHTML(a.commentaire)} »</p>` : ""}
        <span class="rv-auteur"><b>${escapeHTML(nom)}</b>${a.ville ? ` · ${escapeHTML(a.ville)}` : ""}</span>
      </div>
    </article>`;
}

function rendre(liste) {
  if (!liste.length) { section.hidden = true; return; }
  document.getElementById("avRail").innerHTML = liste.map(carte).join("");
  section.hidden = false;
}

async function charger() {
  try {
    const c = JSON.parse(sessionStorage.getItem(CLE) || "null");
    if (c && Date.now() - c.t < 10 * 60 * 1000) { rendre(c.liste); return; }
  } catch { /* ignore */ }
  try {
    // lireDerniersAvis : du plus récent au plus ancien.
    const liste = (await lireDerniersAvis(40)).filter((a) => Number(a.note) >= 4).slice(0, MAX)
      .map(({ note, commentaire, clientNom, ville }) => ({ note, commentaire: commentaire || "", clientNom, ville: ville || "" }));
    rendre(liste);
    try { sessionStorage.setItem(CLE, JSON.stringify({ t: Date.now(), liste })); } catch { /* ignore */ }
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
