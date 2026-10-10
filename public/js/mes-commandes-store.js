// Sans compte client, "mes commandes" = les commandes passées depuis ce
// navigateur : chaque ID est retenu ici juste après confirmation.js, puis
// relu par mes-commandes.js. Un seul get() par commande (jamais de list()),
// cohérent avec firestore.rules qui interdit les requêtes list publiques
// sur `commandes` pour ne pas exposer le code de livraison d'un client à un
// autre.
const STORAGE_KEY = "bokki-mes-commandes";
const MAX_ENTRIES = 50;

export function ajouterCommande(id, code = "", telephone = "") {
  if (!id) return;
  if (code || telephone) {
    try {
      if (code) sessionStorage.setItem(`bokki-commande-code:${id}`, String(code));
      if (telephone) sessionStorage.setItem(`bokki-commande-tel:${id}`, String(telephone));
    } catch (err) { console.error(err); }
  }
  try {
    const commandes = getCommandes();
    const existante = commandes.find((c) => c.id === id);
    if (existante) {
      if (code) existante.code = String(code);
    } else {
      commandes.unshift({ id, code: String(code || "") });
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(commandes.slice(0, MAX_ENTRIES)));
  } catch (err) {
    console.error(err);
  }
}

// Le code de livraison est conservé uniquement sur l'appareil qui a passé la
// commande, pour que l'historique puisse appeler la fonction de suivi protégée.
export function enregistrerAccesCommande(id, code) {
  if (!id || !/^\d{4}$|^\d{6}$/.test(String(code || ""))) return;
  ajouterCommande(id, code);
}

export function getCommandes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const values = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(values)) return [];
    return values.map((value) => typeof value === "string" ? { id: value, code: "" } : {
      id: String(value?.id || ""), code: String(value?.code || ""),
    }).filter((value) => value.id);
  } catch (err) {
    console.error(err);
    return [];
  }
}

export function getCodeCommande(id) {
  const stored = getCommandes().find((commande) => commande.id === id)?.code;
  if (stored) return stored;
  try { return sessionStorage.getItem(`bokki-commande-code:${id}`) || ""; }
  catch { return ""; }
}

export function getTelephoneCommande(id) {
  try { return sessionStorage.getItem(`bokki-commande-tel:${id}`) || ""; }
  catch { return ""; }
}

export function getCommandeIds() {
  return getCommandes().map((commande) => commande.id);
}
