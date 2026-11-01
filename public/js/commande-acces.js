// Première étape de la commande selon la situation du client (brief §5.1) :
// client connecté → directement l'étape 2 (livraison, préremplie) ;
// sinon → l'identification (Google, ou téléphone + code personnel).
export async function lienEtapeCommande() {
  try {
    const { clientCourant } = await import("./session-client.js");
    if (await clientCourant(3000)) return "/commande/livraison";
  } catch (err) {
    console.warn("Session non vérifiée :", err);
  }
  return "/commande/identification";
}
