// Mesure des ventes pour les publicités : Google Analytics 4 et Meta Pixel.
// Quatre événements : vue produit, ajout au panier, début de commande,
// commande confirmée. Aucune donnée personnelle n'est envoyée (ni nom, ni
// téléphone, ni adresse) : produits, montants et numéro interne de commande.
//
// Sans identifiant, ce module ne charge rien et n'envoie rien. Hors du vrai
// site (local, émulateur), rien non plus.
//
// TODO(propriétaire) : renseigner les deux identifiants. À faire en même
// temps : mention dans la page Mentions légales, et consentement pour les
// visiteurs de l'Union européenne.
const GA4_ID = ""; // TODO : « G-XXXXXXXXXX » (Google Analytics > Flux de données)
const META_PIXEL_ID = ""; // TODO : 15 à 16 chiffres (Meta Events Manager)

const DEVISE = "GNF";
const CLE_ACHATS = "bokki-pub-achats";
const MAX_ACHATS_RETENUS = 20;
const NOMS = {
  vue_produit: { ga: "view_item", meta: "ViewContent" },
  ajout_panier: { ga: "add_to_cart", meta: "AddToCart" },
  debut_commande: { ga: "begin_checkout", meta: "InitiateCheckout" },
  commande_confirmee: { ga: "purchase", meta: "Purchase" },
};

const actif = () => (GA4_ID || META_PIXEL_ID) && typeof window !== "undefined" && window.location?.hostname === "bokki.shop";

function ajouterScript(src) {
  const s = document.createElement("script");
  s.async = true;
  s.src = src;
  document.head.append(s);
}

// Les événements attendent dans une file ; les scripts arrivent après
// l'affichage de la page pour ne pas la ralentir.
let demarre = false;
function demarrer() {
  if (demarre) return;
  demarre = true;
  if (GA4_ID) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", GA4_ID);
  }
  if (META_PIXEL_ID) {
    const fbq = function () { fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments); };
    fbq.queue = [];
    fbq.loaded = true;
    fbq.version = "2.0";
    window.fbq = window._fbq = fbq;
    fbq("init", META_PIXEL_ID);
    fbq("track", "PageView");
  }
  const charger = () => {
    if (GA4_ID) ajouterScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA4_ID)}`);
    if (META_PIXEL_ID) ajouterScript("https://connect.facebook.net/en_US/fbevents.js");
  };
  const apresChargement = () => ("requestIdleCallback" in window ? requestIdleCallback(charger, { timeout: 3000 }) : setTimeout(charger, 1500));
  if (document.readyState === "complete") apresChargement();
  else addEventListener("load", apresChargement, { once: true });
}

// evenement : clé de NOMS, ou absent pour la seule vue de page.
export function suivrePub(evenement, { articles = [], commandeId = "", total = null } = {}) {
  if (!actif()) return;
  demarrer();
  const noms = NOMS[evenement];
  if (!noms) return;
  const lignes = articles.map((a) => ({ id: String(a.produitId || ""), nom: a.nom || "", prix: Number(a.prixUnitaire) || 0, quantite: Number(a.quantite) || 1 }));
  const valeur = total ?? lignes.reduce((somme, l) => somme + l.prix * l.quantite, 0);
  if (GA4_ID) {
    window.gtag("event", noms.ga, {
      currency: DEVISE,
      value: valeur,
      ...(commandeId ? { transaction_id: commandeId } : {}),
      items: lignes.map((l) => ({ item_id: l.id, item_name: l.nom, price: l.prix, quantity: l.quantite })),
    });
  }
  if (META_PIXEL_ID) {
    window.fbq("track", noms.meta, {
      currency: DEVISE,
      value: valeur,
      content_type: "product",
      content_ids: lignes.map((l) => l.id),
      contents: lignes.map((l) => ({ id: l.id, quantity: l.quantite })),
    }, commandeId ? { eventID: commandeId } : undefined);
  }
}

// Page de confirmation : compte chaque commande une seule fois, même si la
// page est rouverte.
export function suivreAchat(commandeId, articles, total) {
  if (!actif() || !commandeId) return;
  let vus = [];
  try { vus = JSON.parse(localStorage.getItem(CLE_ACHATS) || "[]"); } catch { /* stockage indisponible */ }
  if (vus.includes(commandeId)) return;
  try { localStorage.setItem(CLE_ACHATS, JSON.stringify([commandeId, ...vus].slice(0, MAX_ACHATS_RETENUS))); } catch { /* stockage plein */ }
  suivrePub("commande_confirmee", { articles, commandeId, total });
}
