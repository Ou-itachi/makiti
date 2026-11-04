// Panier et commande : le prix gardé sur le téléphone peut dater d'avant le
// début ou la fin d'une promotion. Il est relu ici pour afficher le prix
// réellement payé (creerCommande le recalcule de toute façon côté serveur).
// Sans réseau, ou produit introuvable : le prix connu est conservé.
import { lireProduit, lireVariantes } from "./donnees.js";
import { prixFiche } from "./promo.js";

async function prixActuel(a) {
  const p = await lireProduit(a.produitId);
  if (!p) return null;
  if (!a.varianteId) return prixFiche(p).prix;
  const v = (await lireVariantes(a.produitId)).find((x) => x.id === a.varianteId);
  return v ? prixFiche(p, [], v).prix : null;
}

export async function articlesAuPrixActuel(articles) {
  return Promise.all(articles.map(async (a) => {
    const prix = await prixActuel(a).catch(() => null);
    return prix > 0 ? { ...a, prixUnitaire: prix } : a;
  }));
}
