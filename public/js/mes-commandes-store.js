// « Mes commandes » sans compte : les commandes passées (ou retrouvées) depuis
// cet appareil. Chaque entrée garde l'ID, le numéro BK, le code de livraison
// et le téléphone, pour rappeler la fonction de suivi protégée
// (obtenirSuiviCommande vérifie code + téléphone). Jamais de list() Firestore :
// firestore.rules interdit la lecture publique de `commandes`.
// Phase 6 (comptes clients) : la liste viendra aussi du compte connecté.
const STORAGE_KEY = "bokki-mes-commandes";
const MAX_ENTRIES = 50;

function lire() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const values = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(values)) return [];
    return values
      .map((v) => (typeof v === "string"
        ? { id: v, code: "", tel: "", numero: "" }
        : { id: String(v?.id || ""), code: String(v?.code || ""), tel: String(v?.tel || ""), numero: String(v?.numero || "") }))
      .filter((v) => v.id);
  } catch {
    return [];
  }
}

function ecrire(commandes) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(commandes.slice(0, MAX_ENTRIES)));
  } catch (err) {
    console.warn("Historique des commandes non enregistré :", err);
  }
}

export function ajouterCommande(id, code = "", telephone = "", numero = "") {
  if (!id) return;
  const commandes = lire();
  let e = commandes.find((c) => c.id === id);
  if (!e) {
    e = { id, code: "", tel: "", numero: "" };
    commandes.unshift(e);
  }
  if (code) e.code = String(code);
  if (telephone) e.tel = String(telephone);
  if (numero) e.numero = String(numero);
  ecrire(commandes);
}

export function getCommandes() {
  return lire();
}

export function trouverParNumero(numero) {
  const n = String(numero || "").toUpperCase();
  return lire().find((c) => c.numero && c.numero.toUpperCase() === n) || null;
}

export function getCodeCommande(id) {
  return lire().find((c) => c.id === id)?.code || "";
}

export function getTelephoneCommande(id) {
  const tel = lire().find((c) => c.id === id)?.tel;
  if (tel) return tel;
  // Anciennes entrées : le téléphone n'était gardé que pour la session.
  try { return sessionStorage.getItem(`bokki-commande-tel:${id}`) || ""; } catch { return ""; }
}
