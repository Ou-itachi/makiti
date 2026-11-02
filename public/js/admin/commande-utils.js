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

// Réductions de parrainage enregistrées par creerCommande (jamais saisies
// ici) : réduction du filleul (reductionParrainage, pourcentParrainage) et
// crédit parrainage utilisé (reductionCredit). À la charge de Bokki.
export function reductionTotale(commande) {
  return Math.max(0, Number(commande.reductionParrainage) || 0) + Math.max(0, Number(commande.reductionCredit) || 0);
}

// Montant à encaisser : prix convenu au téléphone (final, réductions déjà
// prises en compte par l'agent), sinon total des articles moins réductions.
export function montant(commande) {
  if (commande.prixConvenu != null) return commande.prixConvenu;
  return Math.max(0, montantBrut(commande) - reductionTotale(commande));
}

// Montant avant négociation : total des articles, réductions déduites.
export function montantNet(commande) {
  return Math.max(0, montantBrut(commande) - reductionTotale(commande));
}

// Libellé « Réduction parrainage (5 %) ».
export function libelleReductionParrainage(commande) {
  const pc = Number(commande.pourcentParrainage) || 0;
  return "Réduction parrainage" + (pc ? ` (${String(pc).replace(".", ",")} %)` : "");
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

// Frais de livraison « à confirmer » : ville non reconnue à la commande
// (creerCommande enregistre fraisLivraison null + fraisAConfirmer). L'agent
// les annonce au client puis les saisit sur la fiche de la commande.
// Anciennes commandes : fraisLivraison numérique (0 = gratuite).
export function fraisAConfirmer(commande) {
  return commande?.fraisAConfirmer === true && typeof commande.fraisLivraison !== "number";
}
export function libelleFrais(commande) {
  if (fraisAConfirmer(commande)) return "Frais à confirmer";
  const f = Number(commande?.fraisLivraison) || 0;
  return f ? `${f.toLocaleString("fr-FR").replace(/[  ,]/g, " ")} GNF` : "Gratuite";
}

// Téléphone client au format international : « +224622123456 »,
// « +33612345678 » (enregistrés ainsi par le site). Anciennes saisies sans
// indicatif (9 chiffres commençant par 6) : Guinée. Sert aux liens tel: et
// WhatsApp (wa.me attend l'indicatif, sans « + »).
export function telephoneInternational(tel) {
  const brut = String(tel || "").trim();
  const chiffres = brut.replace(/\D/g, "");
  if (!chiffres) return "";
  if (brut.startsWith("+")) return "+" + chiffres;
  if (chiffres.startsWith("00")) return "+" + chiffres.slice(2);
  if (/^6\d{8}$/.test(chiffres)) return "+224" + chiffres;
  if (/^2246\d{8}$/.test(chiffres)) return "+" + chiffres;
  return brut;
}
export function lienTel(tel) {
  return "tel:" + telephoneInternational(tel);
}
export function lienWhatsApp(tel) {
  return "https://wa.me/" + telephoneInternational(tel).replace(/\D/g, "");
}
