// Sans compte client, "mes commandes" = les commandes passées depuis ce
// navigateur : chaque ID est retenu ici juste après confirmation.js, puis
// relu par mes-commandes.js. Un seul get() par commande (jamais de list()),
// cohérent avec firestore.rules qui interdit les requêtes list publiques
// sur `commandes` pour ne pas exposer le code de livraison d'un client à un
// autre.
const STORAGE_KEY = "makiti-mes-commandes";
const MAX_ENTRIES = 50;

export function ajouterCommande(id) {
  if (!id) return;
  try {
    const ids = getCommandeIds();
    if (ids.includes(id)) return;
    ids.unshift(id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(0, MAX_ENTRIES)));
  } catch (err) {
    console.error(err);
  }
}

export function getCommandeIds() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids : [];
  } catch (err) {
    console.error(err);
    return [];
  }
}
