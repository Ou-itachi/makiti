// Adresses des fiches produit (mise à jour n°2, référencement) :
//   /produit/<nom-du-produit>-<4 premiers caractères de l'identifiant>
//   ex. « Dell Latitude 5410 » (18D2WDbg…) → /produit/dell-latitude-5410-18d2
// Le suffixe évite que deux produits du même nom partagent une adresse, et
// permet de retrouver le produit si son nom change (redirection 301 par la
// fonction pageProduit). SOURCE UNIQUE : copiée telle quelle dans
// functions/prerender/slug.mjs au déploiement des fonctions (même calcul
// côté serveur, vérifié par tests/parcours.mjs).
export function slugTexte(texte) {
  return String(texte || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`´]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70)
    .replace(/-+$/, "");
}

export function slugProduit(id, nom) {
  const base = slugTexte(nom);
  const suffixe = String(id || "").slice(0, 4).toLowerCase();
  return base ? `${base}-${suffixe}` : String(id || "");
}

// Sans nom connu : /produit/<id>, redirigé en 301 vers la bonne adresse.
export function urlProduit(id, nom) {
  return `/produit/${encodeURIComponent(nom ? slugProduit(id, nom) : String(id || ""))}`;
}
