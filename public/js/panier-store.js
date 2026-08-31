// Panier : état local au navigateur, pas de compte client donc pas de
// synchronisation multi-appareil pour l'instant (KAN-75+ pourra migrer vers
// Firestore plus tard si un compte client apparaît). Une seule clé
// localStorage, structure { articles: [{ produitId, varianteId, nom, image,
// prixUnitaire, quantite }] } — varianteId normalisé à null (pas undefined)
// pour que deux lignes du même produit sans variante soient bien reconnues
// comme identiques.
const STORAGE_KEY = "makiti-panier";

function lirePanier() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    return { articles: Array.isArray(data?.articles) ? data.articles : [] };
  } catch (err) {
    console.error(err);
    return { articles: [] };
  }
}

function ecrirePanier(panier) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(panier));
  } catch (err) {
    console.error(err);
  }
  return panier;
}

function memeLigne(article, produitId, varianteId) {
  return article.produitId === produitId && (article.varianteId || null) === (varianteId || null);
}

export function getPanier() {
  return lirePanier();
}

// Incrémente la quantité si le même produit+variante est déjà dans le
// panier, ajoute une nouvelle ligne sinon.
export function ajouterArticle({ produitId, varianteId, nom, image, prixUnitaire, quantite }) {
  const panier = lirePanier();
  const qte = Math.max(1, Number(quantite) || 1);
  const existant = panier.articles.find((a) => memeLigne(a, produitId, varianteId));
  if (existant) {
    existant.quantite += qte;
  } else {
    panier.articles.push({
      produitId,
      varianteId: varianteId || null,
      nom: nom || "",
      image: image || null,
      prixUnitaire: Number(prixUnitaire) || 0,
      quantite: qte,
    });
  }
  return ecrirePanier(panier);
}

export function retirerArticle(produitId, varianteId) {
  const panier = lirePanier();
  panier.articles = panier.articles.filter((a) => !memeLigne(a, produitId, varianteId));
  return ecrirePanier(panier);
}

// quantite <= 0 retire la ligne plutôt que de laisser une quantité nulle.
export function modifierQuantite(produitId, varianteId, quantite) {
  const qte = Math.max(0, Number(quantite) || 0);
  if (qte === 0) return retirerArticle(produitId, varianteId);
  const panier = lirePanier();
  const existant = panier.articles.find((a) => memeLigne(a, produitId, varianteId));
  if (existant) existant.quantite = qte;
  return ecrirePanier(panier);
}

export function viderPanier() {
  return ecrirePanier({ articles: [] });
}

export function compterArticles() {
  return lirePanier().articles.reduce((somme, a) => somme + (Number(a.quantite) || 0), 0);
}

export function montantTotalPanier() {
  return lirePanier().articles.reduce((somme, a) => somme + (Number(a.quantite) || 0) * (Number(a.prixUnitaire) || 0), 0);
}
