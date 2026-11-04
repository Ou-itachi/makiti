// Accueil : « Promotions et recommandés », puis « Sélection du moment »
// (ventes sur 30 jours, puis date), sans répéter les mêmes produits.
import { suivrePub } from "./suivi-pub.js";
import { afficherRecemment } from "./recemment.js";
import { carteProduitHTML, carteSqueletteHTML, brancherCartes } from "./carte-produit.js";
import { onCurrencyChange, refreshCurrencyPrices } from "./currency-display.js";
import { niveauReseau } from "./reseau.js";
import { requeteProduits } from "./donnees.js";
import { prixCarte } from "./promo.js";

// Anciens liens (avant la page catalogue) : /?q=… et /?categorie=…
const params = new URLSearchParams(location.search);
if (params.get("q")) location.replace(`/catalogue?q=${encodeURIComponent(params.get("q"))}`);
else if (params.get("categorie")) location.replace(`/categorie/${encodeURIComponent(params.get("categorie"))}`);

suivrePub();
const rail = document.getElementById("selection");
// Toujours le même nombre de produits dans la requête (une seule entrée de
// cache, même hors ligne) ; en réseau lent on n'en affiche que 4 (moins de
// photos). 16 : de quoi remplir la sélection après retrait des produits déjà
// affichés plus haut.
const NOMBRE = 16;
const AFFICHES = niveauReseau() === "lent" ? 4 : 8;
let produits = [];
let dejaEnHaut = new Set();

// Cartes déjà écrites dans la page (pré-rendu) : gardées telles quelles.
if (!rail.querySelector(".pc")) rail.innerHTML = Array.from({ length: 4 }, carteSqueletteHTML).join("");
brancherCartes(rail, (id) => produits.find((p) => p.id === id));

function message(html) {
  rail.innerHTML = `<p class="empty" role="status">${html}</p>`;
  rail.removeAttribute("aria-busy");
}

function afficher(liste) {
  produits = liste;
  if (!produits.length) return message("Les premiers produits arrivent bientôt.");
  const visibles = produits.filter((p) => !dejaEnHaut.has(p.id)).slice(0, AFFICHES);
  // Même liste qu'à l'écran (cache puis réseau) : rien à redessiner.
  const ids = visibles.map((p) => [p.id, p.caracteristiques?.prix ?? p.caracteristiques?.prixMin, prixCarte(p).prix, p.meilleureVente, p.nbAvis, p.noteMoyenne, p.images?.[0]].join("~")).join("|");
  if (rail.dataset.ids === ids) return;
  rail.dataset.ids = ids;
  rail.innerHTML = visibles.map((p, i) => carteProduitHTML(p, { eager: i < 2 })).join("");
  rail.removeAttribute("aria-busy");
}

// Produits vus affichés tout de suite (cache du téléphone), puis remplacés
// par la liste fraîche. Tri indisponible, ou liste incomplète (calcul
// quotidien pas encore passé) : complétée par les plus récents.
async function chargerSelection() {
  let selection = [];
  try {
    selection = await requeteProduits({ selection: true, limite: NOMBRE }, (liste) => { if (liste.length) afficher(liste); });
  } catch (err) {
    console.warn("Tri de la sélection indisponible", err);
  }
  if (selection.length >= NOMBRE) return;
  const dejaLa = new Set(selection.map((p) => p.id));
  await requeteProduits({ recents: true, limite: NOMBRE }, (liste) => afficher([...selection, ...liste.filter((p) => !dejaLa.has(p.id))]));
}

chargerSelection().catch((err) => {
  console.warn("Sélection indisponible", err);
  if (produits.length) return;
  rail.innerHTML = `<div class="empty" role="status"><p>${navigator.onLine === false ? "Vous êtes hors ligne et aucun produit n’a encore été vu sur ce téléphone." : "Les produits n’ont pas pu être chargés (réseau lent ou coupé)."}</p><button type="button" class="btn btn-secondary btn-sm" id="reessayerSelection">Réessayer</button></div>`;
  rail.removeAttribute("aria-busy");
  document.getElementById("reessayerSelection").addEventListener("click", () => location.reload());
});

// Produits en promotion (en cours) et produits recommandés. Aucun : section
// cachée. Fautes de réseau sans effet sur le reste de la page.
const sectionVedette = document.getElementById("vedette");
const railVedette = document.getElementById("vedetteRail");
let vedettes = [];
let promos = [];
let recommandes = [];
brancherCartes(railVedette, (id) => vedettes.find((p) => p.id === id));

function afficherVedettes() {
  const parId = new Map([...promos.filter((p) => { const { prix, normal } = prixCarte(p); return normal > prix; }), ...recommandes].map((p) => [p.id, p]));
  vedettes = [...parId.values()].slice(0, AFFICHES);
  sectionVedette.hidden = !vedettes.length;
  railVedette.innerHTML = vedettes.map((p) => carteProduitHTML(p)).join("");
  dejaEnHaut = new Set(vedettes.map((p) => p.id));
  if (produits.length) afficher(produits);
}
requeteProduits({ vrai: "promo.actif", limite: NOMBRE }, (liste) => { promos = liste; afficherVedettes(); }).catch((err) => console.warn("Promotions indisponibles", err));
requeteProduits({ vrai: "epingle", limite: NOMBRE }, (liste) => { recommandes = liste; afficherVedettes(); }).catch((err) => console.warn("Recommandés indisponibles", err));

afficherRecemment(document.getElementById("recemment"), document.getElementById("recRail"));

onCurrencyChange(() => { refreshCurrencyPrices(rail); refreshCurrencyPrices(railVedette); });
