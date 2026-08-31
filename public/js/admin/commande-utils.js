// Une commande peut contenir plusieurs articles (schéma introduit pour préparer
// le panier, KAN-75+) ou un seul produit à plat (schéma historique, toujours
// présent sur les commandes créées avant cette évolution — jamais migré
// rétroactivement). Ces accesseurs unifient la lecture des deux formats pour
// que chaque écran admin n'ait qu'une seule forme à afficher. Remplace les
// implémentations dupliquées de montant() dans commandes.js, commande-detail.js,
// etiquettes-livraison.js, corbeille-commandes.js et dashboard.js.

export function articlesDe(commande) {
  if (Array.isArray(commande.articles) && commande.articles.length) return commande.articles;
  if (!commande.produitId) return [];
  const quantite = commande.quantite || 1;
  return [
    {
      produitId: commande.produitId,
      varianteId: commande.varianteId || null,
      nom: commande.produitNom,
      image: commande.produitImage || null,
      varianteLibelle: commande.varianteLibelle || null,
      quantite,
      prixUnitaire: quantite ? (commande.prixInitial || 0) / quantite : commande.prixInitial || 0,
      prixInitial: commande.prixInitial || 0,
    },
  ];
}

export function montant(commande) {
  if (commande.prixConvenu != null) return commande.prixConvenu;
  if (commande.montantTotal != null) return commande.montantTotal;
  return commande.prixInitial || 0;
}

// Total AVANT négociation (prixConvenu exclu) — sert à détecter si une
// négociation a eu lieu (commande.prixConvenu !== montantBrut) et à afficher
// ce montant d'origine.
export function montantBrut(commande) {
  return commande.montantTotal ?? commande.prixInitial ?? 0;
}

export function resumeArticles(commande) {
  const articles = articlesDe(commande);
  if (!articles.length) return "—";
  return articles.map((a) => `${a.nom} ×${a.quantite}`).join(" + ");
}
