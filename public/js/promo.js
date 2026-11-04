// Promotions (mise à jour n°4) : qu'un produit soit en promotion, et à quel
// prix, se décide ici pour tout le site, y compris le pré-rendu. Même règle
// côté serveur dans functions/src/index.ts (promoActive, prixApresPromo) :
// c'est le serveur qui fixe le prix d'une commande.
//
// Champs : produit.promo { actif, prix, prixNormal?, fin } et, pour un produit
// à variantes, variante.prixPromo. promo.prix et promo.prixNormal résument
// alors la variante la moins chère (pour les cartes).

// fin : chaîne ISO (API REST, pré-rendu) ou Timestamp (SDK).
function finMs(fin) {
  if (typeof fin?.toMillis === "function") return fin.toMillis();
  return Date.parse(fin);
}

export function promoActive(p, maintenant = Date.now()) {
  const promo = p?.promo;
  if (!promo || promo.actif !== true) return false;
  if (promo.fin == null) return true;
  const fin = finMs(promo.fin);
  return Number.isFinite(fin) && fin > maintenant;
}

export function prixPaye(prixNormal, prixPromo, active) {
  const promo = Number(prixPromo);
  return active && Number.isFinite(promo) && promo > 0 && promo < prixNormal ? promo : prixNormal;
}

const prixDeBase = (p) => Number(p.caracteristiques?.prixMin ?? p.caracteristiques?.prix ?? p.prixVente ?? 0) || 0;

// Prix d'une carte (sans lire les variantes) : { prix, normal }.
export function prixCarte(p) {
  const base = prixDeBase(p);
  const normal = Number(p.promo?.prixNormal) || base;
  const prix = prixPaye(normal, p.promo?.prix, promoActive(p));
  return prix < normal ? { prix, normal } : { prix: base, normal: base };
}

// Prix de la fiche : { prix, normal, des }. choisie : la variante sélectionnée.
export function prixFiche(p, variantes = [], choisie = null) {
  const active = promoActive(p);
  const ligne = (v) => {
    const normal = Number(v.prix) || 0;
    return { prix: prixPaye(normal, v.prixPromo, active), normal };
  };
  if (choisie) return { ...ligne(choisie), des: false };
  if (variantes.length) {
    const lignes = variantes.map(ligne);
    return { ...lignes.reduce((a, b) => (b.prix < a.prix ? b : a)), des: true };
  }
  return { ...prixCarte(p), des: p.caracteristiques?.prixMin != null };
}

// money : moneyHTML de currency-display.js.
export function prixFicheHTML(money, { prix, normal }) {
  const montant = money(prix);
  if (!(normal > prix)) return montant;
  return `<span class="p-promo-ligne"><span class="p-promo-badge pc-promo">Promotion</span><span class="p-now">${montant}</span><s class="p-old">${money(normal)}</s><span class="p-eco">−${money(normal - prix)}</span></span>`;
}
