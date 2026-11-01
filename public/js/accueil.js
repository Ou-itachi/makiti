// Accueil : « Sélection du moment » (derniers produits ajoutés, Firestore).
import { carteProduitHTML, carteSqueletteHTML, brancherCartes, chargerFirestore } from "./carte-produit.js";
import { onCurrencyChange, refreshCurrencyPrices } from "./currency-display.js";
import { niveauReseau } from "./reseau.js";

// Anciens liens (avant la page catalogue) : /?q=… et /?categorie=…
const params = new URLSearchParams(location.search);
if (params.get("q")) location.replace(`/catalogue?q=${encodeURIComponent(params.get("q"))}`);
else if (params.get("categorie")) location.replace(`/categorie/${encodeURIComponent(params.get("categorie"))}`);

const rail = document.getElementById("selection");
const NOMBRE = niveauReseau() === "lent" ? 4 : 8;
let produits = [];

rail.innerHTML = Array.from({ length: 4 }, carteSqueletteHTML).join("");
brancherCartes(rail, (id) => produits.find((p) => p.id === id));

function message(html) {
  rail.innerHTML = `<p class="empty" role="status">${html}</p>`;
  rail.removeAttribute("aria-busy");
}

const delai = setTimeout(() => {
  if (!produits.length) message('Les produits mettent du temps à arriver. <a href="/catalogue">Ouvrir le catalogue</a>');
}, 8000);

try {
  const { db, fs } = await chargerFirestore();
  const snap = await fs.getDocs(fs.query(fs.collection(db, "produits"), fs.orderBy("dateCreation", "desc"), fs.limit(NOMBRE)));
  clearTimeout(delai);
  produits = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!produits.length) message("Les premiers produits arrivent bientôt.");
  else {
    rail.innerHTML = produits.map((p, i) => carteProduitHTML(p, { eager: i < 2 })).join("");
    rail.removeAttribute("aria-busy");
  }
} catch (err) {
  clearTimeout(delai);
  console.error("Sélection indisponible", err);
  message('Les produits sont momentanément indisponibles. <a href="/catalogue">Réessayer depuis le catalogue</a>');
}

onCurrencyChange(() => refreshCurrencyPrices(rail));
