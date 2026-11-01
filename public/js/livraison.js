// Régions de livraison et frais affichés au client.
//
// ⚠ VALEURS PROVISOIRES (à fournir par le propriétaire, voir le brief §5.3).
// Pour les changer : modifier FRAIS_LIVRAISON ci-dessous ET la table
// FRAIS_LIVRAISON_PAR_REGION de functions/src/index.ts (le serveur fait foi :
// il enregistre fraisLivraison sur la commande). Un frais saisi dans l'admin
// (collection « zones », champ « frais ») prime côté serveur.
// null = « frais annoncés avant la livraison » (aucun montant affiché).
export const REGIONS = ["Conakry", "Boké", "Faranah", "Kankan", "Kindia", "Labé", "Mamou", "Nzérékoré"];

export const FRAIS_LIVRAISON = {
  Conakry: 0,
  Kindia: 50000,
  Boké: 75000,
  Mamou: 75000,
  Labé: 100000,
  Faranah: 100000,
  Kankan: 125000,
  Nzérékoré: 150000,
};

// Message unique (brief §3) — à réutiliser tel quel partout.
export const MESSAGE_LIVRAISON = "Gratuite à Conakry ; autres régions : frais selon la région, annoncés avant la livraison";

export function fraisPour(region) {
  const f = FRAIS_LIVRAISON[region];
  return typeof f === "number" ? f : null;
}
