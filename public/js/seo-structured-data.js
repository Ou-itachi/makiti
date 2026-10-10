// Données structurées communes et fil d'Ariane pour les pages éditoriales.
// Les coordonnées ci-dessous doivent rester identiques au NAP affiché.
const canonicalUrl = document.querySelector('link[rel="canonical"]')?.href || location.href;
const pageUrl = new URL(canonicalUrl);
const pageNames = {
  "/": "Accueil",
  "/a-propos": "À propos de Bokki",
  "/faq": "Questions fréquentes",
  "/contact": "Contact",
  "/demande-produit": "Demander un produit",
  "/comment-ca-marche": "Comment ça marche",
  "/temoignages": "Témoignages clients",
  "/legal": "Mentions légales et conditions de vente",
};
const pageName = pageNames[pageUrl.pathname] || document.querySelector("h1")?.textContent.trim() || document.title;
const business = {
    "@type": ["Organization", "LocalBusiness"],
    "@id": "https://bokki.shop/#organization",
    name: "Bokki",
    url: "https://bokki.shop/",
    logo: "https://bokki.shop/assets/bokki-512.png",
    image: "https://bokki.shop/assets/og-bokki.jpg",
    description: "Bokki est un site qui permet de commander des produits en ligne et de se faire livrer.",
    slogan: "Un site simple pour commander en ligne.",
    telephone: "+224629897084",
    email: "contact@bokki.shop",
    priceRange: "GNF",
    currenciesAccepted: "GNF",
    paymentAccepted: "Espèces à la livraison",
    areaServed: [
      { "@type": "City", name: "Conakry" },
      { "@type": "Country", name: "Guinée" },
    ],
    knowsAbout: ["Boutique en ligne en Guinée", "Paiement à la livraison", "Téléphones", "Ordinateurs", "Énergie solaire", "Mode"],
    openingHoursSpecification: [
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: "08:00", closes: "19:00" },
      { "@type": "OpeningHoursSpecification", dayOfWeek: "Saturday", opens: "09:00", closes: "17:00" },
    ],
    contactPoint: {
      "@type": "ContactPoint",
      telephone: "+224629897084",
      email: "contact@bokki.shop",
      contactType: "service client",
      availableLanguage: "French",
      url: "https://wa.me/224629897084",
    },
    sameAs: [
      "https://www.facebook.com/share/1D4AZPtAfy/",
      "https://wa.me/224629897084",
    ],
  };
const existingBusiness = [...document.querySelectorAll('script[type="application/ld+json"]')].some((node) => {
  try {
    const data = JSON.parse(node.textContent);
    const nodes = Array.isArray(data["@graph"]) ? data["@graph"] : [data];
    return nodes.some((item) => item["@id"] === "https://bokki.shop/#organization");
  } catch {
    return false;
  }
});
const graph = [
  ...(existingBusiness ? [] : [business]),
  {
    "@type": "BreadcrumbList",
    itemListElement: pageUrl.pathname === "/"
      ? [{ "@type": "ListItem", position: 1, name: "Accueil", item: "https://bokki.shop/" }]
      : [
          { "@type": "ListItem", position: 1, name: "Accueil", item: "https://bokki.shop/" },
          { "@type": "ListItem", position: 2, name: pageName, item: canonicalUrl },
        ],
  },
];
const schema = document.createElement("script");
schema.id = "pageStructuredData";
schema.type = "application/ld+json";
schema.textContent = JSON.stringify({ "@context": "https://schema.org", "@graph": graph });
document.head.append(schema);
