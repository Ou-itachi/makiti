// Accueil : « Sélection du moment » (derniers produits ajoutés, Firestore).
import { carteProduitHTML, carteSqueletteHTML, brancherCartes } from "./carte-produit.js";
import { onCurrencyChange, refreshCurrencyPrices } from "./currency-display.js";
import { niveauReseau } from "./reseau.js";
import { requeteProduits } from "./donnees.js";

// Anciens liens (avant la page catalogue) : /?q=… et /?categorie=…
const params = new URLSearchParams(location.search);
if (params.get("q")) location.replace(`/catalogue?q=${encodeURIComponent(params.get("q"))}`);
else if (params.get("categorie")) location.replace(`/categorie/${encodeURIComponent(params.get("categorie"))}`);

const rail = document.getElementById("selection");
// Toujours 8 produits dans la requête (une seule entrée de cache, même hors
// ligne) ; en réseau lent on n'en affiche que 4 (moins de photos).
const NOMBRE = 8;
const AFFICHES = niveauReseau() === "lent" ? 4 : 8;
let produits = [];

rail.innerHTML = Array.from({ length: 4 }, carteSqueletteHTML).join("");
brancherCartes(rail, (id) => produits.find((p) => p.id === id));

function message(html) {
  rail.innerHTML = `<p class="empty" role="status">${html}</p>`;
  rail.removeAttribute("aria-busy");
}

function afficher(liste) {
  produits = liste;
  if (!produits.length) return message("Les premiers produits arrivent bientôt.");
  // Même liste qu'à l'écran (cache puis réseau) : rien à redessiner.
  const ids = produits.slice(0, AFFICHES).map((p) => p.id + (p.caracteristiques?.prix ?? p.caracteristiques?.prixMin ?? "") + (p.images?.[0] || "")).join("|");
  if (rail.dataset.ids === ids) return;
  rail.dataset.ids = ids;
  rail.innerHTML = produits.slice(0, AFFICHES).map((p, i) => carteProduitHTML(p, { eager: i < 2 })).join("");
  rail.removeAttribute("aria-busy");
}

// Derniers produits vus affichés tout de suite (cache du téléphone), puis
// remplacés par la liste fraîche.
requeteProduits({ recents: true, limite: NOMBRE }, (liste) => afficher(liste)).catch((err) => {
  console.warn("Sélection indisponible", err);
  if (produits.length) return;
  rail.innerHTML = `<div class="empty" role="status"><p>${navigator.onLine === false ? "Vous êtes hors ligne et aucun produit n’a encore été vu sur ce téléphone." : "Les produits n’ont pas pu être chargés (réseau lent ou coupé)."}</p><button type="button" class="btn btn-secondary btn-sm" id="reessayerSelection">Réessayer</button></div>`;
  rail.removeAttribute("aria-busy");
  document.getElementById("reessayerSelection").addEventListener("click", () => location.reload());
});

onCurrencyChange(() => refreshCurrencyPrices(rail));
