// Commande en cours (étapes 1 et 2) et coordonnées mémorisées.
// • sessionStorage « bokki-commande » : { source: "panier" | "direct",
//   articles: [...] (achat direct seulement), tel } — propre à l'onglet ;
// • localStorage « bokki-coordonnees » : { tel, nom, region, quartier, repere }
//   pour préremplir la commande suivante sur cet appareil (en attendant les
//   comptes, puis en plus des comptes).
const CLE_COMMANDE = "bokki-commande";
const CLE_COORDS = "bokki-coordonnees";

function lire(stockage, cle) {
  try {
    const v = JSON.parse(stockage.getItem(cle) || "null");
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}
function ecrire(stockage, cle, valeur) {
  try {
    stockage.setItem(cle, JSON.stringify(valeur));
  } catch {
    /* stockage indisponible (navigation privée) : on continue sans mémoriser */
  }
}

// articles (achat direct) : [{ produitId, varianteId, varianteLibelle, quantite, nom, image, prixUnitaire }]
export function demarrerCommande(source, articles = null) {
  const ancienne = lireCommande();
  ecrire(sessionStorage, CLE_COMMANDE, { source, articles: source === "direct" ? articles : null, tel: ancienne?.tel || null });
}
export function lireCommande() {
  const c = lire(sessionStorage, CLE_COMMANDE);
  if (!c || !["panier", "direct"].includes(c.source)) return null;
  if (c.source === "direct" && !Array.isArray(c.articles)) return null;
  return c;
}
export function majCommande(champs) {
  const c = lireCommande();
  if (c) ecrire(sessionStorage, CLE_COMMANDE, { ...c, ...champs });
}
export function terminerCommande() {
  try { sessionStorage.removeItem(CLE_COMMANDE); } catch { /* rien */ }
}

export function lireCoordonnees() {
  return lire(localStorage, CLE_COORDS) || {};
}
export function memoriserCoordonnees(coords) {
  ecrire(localStorage, CLE_COORDS, { ...lireCoordonnees(), ...coords });
}

// Téléphone : 9 chiffres guinéens (6XX XX XX XX) avec +224 implicite, ou
// numéro international complet commençant par « + ». Renvoie « +224… » ou null.
export function normaliserTelephone(saisie) {
  const brut = String(saisie || "").trim();
  if (brut.startsWith("+")) {
    const chiffres = brut.slice(1).replace(/[\s().-]/g, "");
    return /^\d{8,15}$/.test(chiffres) ? `+${chiffres}` : null;
  }
  let chiffres = brut.replace(/[\s().-]/g, "");
  if (chiffres.startsWith("00224")) chiffres = chiffres.slice(5);
  else if (chiffres.startsWith("224") && chiffres.length === 12) chiffres = chiffres.slice(3);
  return /^6\d{8}$/.test(chiffres) ? `+224${chiffres}` : null;
}
export function telephoneLocal(tel) {
  return String(tel || "").startsWith("+224") ? tel.slice(4).replace(/(\d{3})(\d{2})(\d{2})(\d{2})/, "$1 $2 $3 $4") : tel || "";
}
