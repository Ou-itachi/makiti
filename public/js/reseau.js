// Qualité du réseau du téléphone : "lent" | "moyen" | "rapide".
//
// Le site s'adapte comme les apps sociales : en connexion lente, vignettes
// seulement, moins de produits par page, photo HD seulement à la demande.
//
// Sources, de la plus fiable à la moins fiable :
//  1. Mode "économie de données" du téléphone (navigator.connection.saveData)
//     → toujours "lent".
//  2. navigator.connection.effectiveType/downlink (Chrome Android, la grande
//     majorité des clients). Absent sur iPhone (Safari).
//  3. Mesure réelle : temps de réponse de la page et débit des fichiers déjà
//     téléchargés (Performance API, fonctionne aussi sur iPhone). Mémorisée
//     dans localStorage pour que la visite suivante démarre déjà adaptée.
// Sans aucun signal : "moyen" (vignettes d'abord, HD ensuite).

const CLE_MESURE = "bokki-reseau-mesure";
const ecouteurs = new Set();

function depuisConnexion() {
  const c = navigator.connection;
  if (!c) return null;
  if (c.saveData) return "lent";
  const type = c.effectiveType;
  if (type === "slow-2g" || type === "2g") return "lent";
  if (type === "3g") return "moyen";
  // "4g" annoncé mais débit réel faible (réseau saturé) : downlink en Mb/s.
  if (typeof c.downlink === "number" && c.downlink > 0) {
    if (c.downlink < 0.7) return "lent";
    if (c.downlink < 2) return "moyen";
  }
  return type ? "rapide" : null;
}

function mesurerDebit() {
  try {
    const nav = performance.getEntriesByType("navigation")[0];
    // Latence : délai entre l'envoi de la requête et le premier octet de la
    // page. Très parlant sur les réseaux mobiles chargés, même petits fichiers.
    const latence = nav && nav.responseStart > 0 ? nav.responseStart - nav.requestStart : null;
    // Débit : fichiers de même origine d'au moins 15 Ko vraiment téléchargés
    // (transferSize 0 = servi depuis le cache, ne mesure rien).
    let octets = 0;
    let duree = 0;
    for (const e of performance.getEntriesByType("resource")) {
      const taille = e.transferSize || 0;
      const temps = e.responseEnd - e.responseStart;
      if (taille >= 15000 && temps > 0) {
        octets += taille;
        duree += temps;
      }
    }
    const kbps = duree > 0 ? (octets * 8) / duree : null; // bits/ms = kb/s
    if (latence == null && kbps == null) return null;
    return { latence, kbps, date: Date.now() };
  } catch {
    return null;
  }
}

function depuisMesure(m) {
  if (!m) return null;
  if ((m.kbps != null && m.kbps < 400) || (m.latence != null && m.latence > 1800)) return "lent";
  if ((m.kbps != null && m.kbps < 2000) || (m.latence != null && m.latence > 700)) return "moyen";
  return m.kbps != null ? "rapide" : null;
}

function lireMesureMemorisee() {
  try {
    const m = JSON.parse(localStorage.getItem(CLE_MESURE) || "null");
    // Une mesure de plus de 6 h ne décrit plus le réseau actuel.
    return m && Date.now() - m.date < 6 * 3600 * 1000 ? m : null;
  } catch {
    return null;
  }
}

function memoriserMesure(m) {
  try {
    localStorage.setItem(CLE_MESURE, JSON.stringify(m));
  } catch {
    /* stockage indisponible (navigation privée) : on garde la mesure en mémoire */
  }
}

let niveau = depuisConnexion() || depuisMesure(lireMesureMemorisee()) || "moyen";

function changerNiveau(nouveau) {
  if (!nouveau || nouveau === niveau) return;
  niveau = nouveau;
  document.documentElement.dataset.reseau = niveau;
  ecouteurs.forEach((fn) => {
    try { fn(niveau); } catch (e) { console.error(e); }
  });
}

document.documentElement.dataset.reseau = niveau;

navigator.connection?.addEventListener?.("change", () => changerNiveau(depuisConnexion()));

// Mesure réelle une fois la page chargée (les fichiers ont alors été
// téléchargés) : utilisée telle quelle sur iPhone, et sur Android seulement
// pour durcir le niveau si le réseau est en réalité plus lent qu'annoncé.
function mesurerApresChargement() {
  const m = mesurerDebit();
  if (!m) return;
  memoriserMesure(m);
  const mesure = depuisMesure(m);
  const annonce = depuisConnexion();
  const ordre = { lent: 0, moyen: 1, rapide: 2 };
  if (!annonce) changerNiveau(mesure);
  else if (mesure && ordre[mesure] < ordre[annonce]) changerNiveau(mesure);
}
if (document.readyState === "complete") setTimeout(mesurerApresChargement, 0);
else addEventListener("load", () => setTimeout(mesurerApresChargement, 0), { once: true });

export function niveauReseau() {
  return niveau;
}
export function reseauLent() {
  return niveau === "lent";
}
export function reseauRapide() {
  return niveau === "rapide";
}
export function surChangementReseau(fn) {
  ecouteurs.add(fn);
  return () => ecouteurs.delete(fn);
}

// Charge `url` en arrière-plan et appelle `fn` une fois l'image complète en
// cache : permet d'afficher la vignette tout de suite, puis de la remplacer
// par la HD sans écran vide entre les deux.
export function prechargerImage(url, fn) {
  const img = new Image();
  img.decoding = "async";
  img.onload = () => fn(url);
  img.src = url;
  return () => { img.onload = null; img.src = ""; };
}

// --- Bandeau discret (connexion lente / hors connexion) ----------------------
let bandeau = null;
function afficherBandeau(texte, duree) {
  if (!document.body) return;
  if (!bandeau) {
    bandeau = document.createElement("div");
    bandeau.className = "reseau-bandeau";
    bandeau.setAttribute("role", "status");
    document.body.appendChild(bandeau);
  }
  bandeau.textContent = texte;
  bandeau.hidden = false;
  clearTimeout(bandeau._timer);
  if (duree) bandeau._timer = setTimeout(() => { bandeau.hidden = true; }, duree);
}
function masquerBandeau() {
  if (bandeau) bandeau.hidden = true;
}

function annoncerModeLeger() {
  try {
    if (sessionStorage.getItem("bokki-reseau-annonce")) return;
    sessionStorage.setItem("bokki-reseau-annonce", "1");
  } catch { /* ignore */ }
  afficherBandeau("Connexion lente : images allégées pour aller plus vite.", 5000);
}

if (niveau === "lent") annoncerModeLeger();
surChangementReseau((n) => { if (n === "lent") annoncerModeLeger(); });

addEventListener("offline", () => afficherBandeau("Hors connexion : les pages déjà vues restent disponibles."));
addEventListener("online", () => {
  masquerBandeau();
  afficherBandeau("Connexion rétablie.", 2500);
});
if (navigator.onLine === false) {
  addEventListener("DOMContentLoaded", () => afficherBandeau("Hors connexion : les pages déjà vues restent disponibles."), { once: true });
}
