// Première étape de la commande selon la situation du client.
// Phase 3 (sans comptes) : toujours l'identification par téléphone.
// (La phase 6 y ajoute : client connecté → directement la livraison.)
export async function lienEtapeCommande() {
  return "/commande/identification";
}
