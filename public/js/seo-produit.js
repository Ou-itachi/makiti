// Référencement d'une fiche produit (mise à jour n°2) : titre, description,
// image de partage et données structurées. SOURCE UNIQUE, utilisée à
// l'identique par le pré-rendu (functions/prerender/coeur.mjs) et par la
// page elle-même (js/fiche-produit.js), pour que le HTML reçu par Google et
// la page affichée disent exactement la même chose.
import { slugProduit } from "./slug.js";

export const SITE = "https://bokki.shop";

const espaces = (n) => Math.round(n).toLocaleString("fr-FR").replace(/[  ,]/g, " ");

function nettoyer(texte) {
  return String(texte || "").replace(/\s+/g, " ").trim();
}

// Coupe proprement : fin de phrase si possible, sinon fin de mot + « … ».
export function couper(texte, max) {
  const t = nettoyer(texte);
  if (t.length <= max) return t;
  const morceau = t.slice(0, max + 1);
  const phrase = morceau.lastIndexOf(". ");
  if (phrase > max * 0.55) return morceau.slice(0, phrase + 1);
  const mot = morceau.lastIndexOf(" ");
  return (mot > 0 ? morceau.slice(0, mot) : morceau.slice(0, max)).replace(/[\s,;:.–-]+$/, "") + "…";
}

// Prix affichable : le plus bas (variantes comprises) et s'il varie.
export function prixDe(p, variantes = []) {
  const prixV = variantes.map((v) => Number(v.prix)).filter((x) => x > 0);
  if (prixV.length) return { min: Math.min(...prixV), max: Math.max(...prixV), nb: prixV.length };
  const p0 = Number(p.caracteristiques?.prix ?? p.prixVente ?? 0) || 0;
  const pMin = Number(p.caracteristiques?.prixMin) || 0;
  if (p0 > 0) return { min: p0, max: p0, nb: 1 };
  if (pMin > 0) return { min: pMin, max: pMin, nb: 1, aPartirDe: true };
  return { min: 0, max: 0, nb: 0 };
}

// infos : { nom, categorie, slugCategorie }
export function seoProduit(p, { nom, categorie, slugCategorie }, variantes = [], avis = []) {
  const url = `${SITE}/produit/${encodeURIComponent(slugProduit(p.id, nom))}`;
  const prix = prixDe(p, variantes);
  const varie = prix.max > prix.min || prix.aPartirDe;
  const prixTexte = prix.min > 0 ? `${varie ? "dès " : ""}${espaces(prix.min)} GNF` : "";
  const titre = `${nom}${prixTexte ? ` – ${prixTexte}` : ""} | Bokki Guinée`;

  // Description propre à chaque fiche : début de la description du produit,
  // puis prix et conditions (jamais un texte commun à toutes les fiches seul).
  const marque = p.infosGenerales?.marque;
  const propre = nettoyer(p.infosGenerales?.description ?? p.description ?? "");
  const fin = `${prixTexte ? `${prixTexte[0].toUpperCase()}${prixTexte.slice(1)}, ` : ""}paiement à la livraison en Guinée.`;
  const debut = propre || `${nom}${marque && !nom.toLowerCase().includes(String(marque).toLowerCase()) ? ` de ${marque}` : ""}${categorie ? `, rayon ${categorie.toLowerCase()}` : ""}, disponible chez Bokki.`;
  const place = 158 - fin.length - 1;
  const description = `${couper(debut, Math.max(60, place))} ${fin}`;
  const alt = (i, total) => `${nom}${total > 1 ? `, photo ${i + 1} sur ${total}` : ""}`;

  // ---- Données structurées ----
  const images = (p.images || []).filter((u) => typeof u === "string" && /^https:\/\//.test(u));
  // Livraison : gratuite à Conakry, en général 24 à 48 h (tools/faits-bokki.json).
  // Autres régions : frais selon la région, annoncés avant la livraison (non
  // balisés : pas de montant fixe).
  const livraisonConakry = {
    "@type": "OfferShippingDetails",
    shippingRate: { "@type": "MonetaryAmount", value: 0, currency: "GNF" },
    shippingDestination: { "@type": "DefinedRegion", addressCountry: "GN", addressRegion: "Conakry" },
    deliveryTime: {
      "@type": "ShippingDeliveryTime",
      handlingTime: { "@type": "QuantitativeValue", minValue: 0, maxValue: 1, unitCode: "DAY" },
      transitTime: { "@type": "QuantitativeValue", minValue: 1, maxValue: 2, unitCode: "DAY" },
    },
  };
  const base = { url, priceCurrency: "GNF", availability: "https://schema.org/InStock", itemCondition: "https://schema.org/NewCondition", seller: { "@id": `${SITE}/#organization` }, shippingDetails: livraisonConakry };
  const offers = prix.nb > 1 && prix.max > prix.min
    ? { "@type": "AggregateOffer", ...base, lowPrice: prix.min, highPrice: prix.max, offerCount: prix.nb }
    : prix.min > 0 ? { "@type": "Offer", ...base, price: prix.min } : undefined;
  const produitLD = {
    "@type": "Product", "@id": `${url}#product`, name: nom, url,
    description: couper(propre || debut, 500), category: categorie || undefined, sku: p.id,
    image: images.length ? images : undefined,
    brand: marque ? { "@type": "Brand", name: marque } : undefined,
    offers,
  };
  // Notes : seulement les vrais avis affichés sur la fiche (clients livrés).
  const notes = avis.filter((a) => Number(a.note) >= 1 && Number(a.note) <= 5);
  if (notes.length) {
    const moyenne = notes.reduce((t, a) => t + Number(a.note), 0) / notes.length;
    produitLD.aggregateRating = { "@type": "AggregateRating", ratingValue: Math.round(moyenne * 10) / 10, reviewCount: notes.length, bestRating: 5, worstRating: 1 };
    produitLD.review = notes.slice(0, 5).map((a) => ({
      "@type": "Review",
      author: { "@type": "Person", name: nettoyer(a.clientNom) || "Client Bokki" },
      reviewRating: { "@type": "Rating", ratingValue: Number(a.note), bestRating: 5, worstRating: 1 },
      reviewBody: nettoyer(a.commentaire) || undefined,
      datePublished: typeof a.dateCreation === "string" ? a.dateCreation.slice(0, 10) : undefined,
    }));
  }
  const jsonld = {
    "@context": "https://schema.org",
    "@graph": [
      produitLD,
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Accueil", item: `${SITE}/` },
        { "@type": "ListItem", position: 2, name: categorie || "Catalogue", item: slugCategorie ? `${SITE}/categorie/${slugCategorie}` : `${SITE}/catalogue` },
        { "@type": "ListItem", position: 3, name: nom, item: url },
      ] },
    ],
  };
  return { url, titre, description, alt, jsonld, prix, avis };
}
