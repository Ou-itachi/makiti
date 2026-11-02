// Fil d'Ariane des pages éditoriales. Les données de Bokki (organisation,
// contacts) sont écrites dans chaque page par tools/partials.cjs depuis
// tools/faits-bokki.json (source unique).
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
const graph = [
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
