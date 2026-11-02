// Témoignages (maquette Temoignages.html) : avis laissés après livraison
// (collection « avis », écrite uniquement par la fonction creerAvis).
import { escapeHTML } from "./carte-produit.js";
import { lireDerniersAvis } from "./donnees.js";

const $ = (id) => document.getElementById(id);

const dateFr = (ts) => {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
};
const etoilesTexte = (n) => "★".repeat(n) + "☆".repeat(5 - n);
// Confidentialité : « Mariama Diallo » devient « Mariama D. ».
function nomCourt(nom) {
  const parties = String(nom || "").trim().split(/\s+/).filter(Boolean);
  if (!parties.length) return "Client Bokki";
  return parties.length > 1 ? `${parties[0]} ${parties[parties.length - 1][0].toUpperCase()}.` : parties[0];
}

function carte(a) {
  const n = Math.max(0, Math.min(5, Math.round(Number(a.note) || 0)));
  const nom = nomCourt(a.clientNom);
  const produit = a.produitNom
    ? a.produitId
      ? `<a class="link small" href="/produit?id=${encodeURIComponent(a.produitId)}">${escapeHTML(a.produitNom)}</a>`
      : `<span class="small muted">${escapeHTML(a.produitNom)}</span>`
    : "";
  return `
    <article class="card col g10">
      <div class="row g10">
        <span class="ico ico-blue avatar" aria-hidden="true">${escapeHTML(nom[0] || "B")}.</span>
        <div class="col"><b>${escapeHTML(nom)}</b><span class="small muted">${escapeHTML(dateFr(a.dateCreation))} · Client vérifié</span></div>
      </div>
      <span class="stars" role="img" aria-label="${n} sur 5">${etoilesTexte(n)}</span>
      ${a.commentaire ? `<p class="muted t-texte">${escapeHTML(a.commentaire)}</p>` : `<p class="muted small"><em>Aucun commentaire laissé.</em></p>`}
      ${produit}
    </article>`;
}

try {
  const avis = await lireDerniersAvis(100);
  $("tListe").removeAttribute("aria-busy");
  if (!avis.length) {
    $("tListe").innerHTML = "";
    $("tVide").hidden = false;
    $("tNombre").textContent = "Aucun avis pour le moment";
  } else {
    const moyenne = avis.reduce((s, a) => s + (Number(a.note) || 0), 0) / avis.length;
    $("tMoyenne").textContent = moyenne.toFixed(1).replace(".", ",");
    $("tEtoiles").textContent = etoilesTexte(Math.round(moyenne));
    $("tNombre").textContent = `${avis.length === 100 ? "100 derniers avis" : avis.length + " avis"}, laissés après livraison`;
    $("tListe").innerHTML = avis.map(carte).join("");
  }
} catch (err) {
  console.warn("Avis non chargés :", err);
  $("tListe").removeAttribute("aria-busy");
  $("tListe").innerHTML = "";
  $("tVide").hidden = false;
  $("tVide").querySelector("b").textContent = "Impossible de charger les avis pour le moment";
  $("tNombre").textContent = "";
}
