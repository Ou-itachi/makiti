// Favoris (brief §5.5, maquettes Produit / Catalogue / Main / Compte).
// Stockage : clients/{uid}/favoris/{produitId} = { ajouteLe } (Firestore,
// règles : titulaire seul ; écritures mises en file hors ligne par le SDK).
// Un miroir local des identifiants (localStorage) permet d'afficher les
// cœurs pleins sur les listes SANS charger Firebase Auth sur chaque page.
// Non connecté : l'appui sur le cœur ouvre /connexion ; le favori est
// ajouté juste après la connexion (ajouterFavoriEnAttente).
import { toast } from "./toast.js";

const CLE = "bokki-favoris"; // { uid, ids: [] }
const CLE_SESSION = "bokki-session"; // uid connecté (posé par session-client.js)
const CLE_ATTENTE = "bokki-favori-attente";

const lire = (k, s = localStorage) => { try { return JSON.parse(s.getItem(k) || "null"); } catch { return null; } };
const ecrire = (k, v, s = localStorage) => { try { s.setItem(k, JSON.stringify(v)); } catch { /* stockage plein ou bloqué */ } };

export function sessionLocale() {
  try { return localStorage.getItem(CLE_SESSION) || ""; } catch { return ""; }
}

export function idsFavoris() {
  const m = lire(CLE);
  return new Set(m && m.uid === sessionLocale() ? m.ids : []);
}
function memoriser(ids) {
  ecrire(CLE, { uid: sessionLocale(), ids: [...ids] });
  dispatchEvent(new CustomEvent("bokki:favoris", { detail: { ids: new Set(ids) } }));
}

const COEUR = `<svg class="i" aria-hidden="true"><use href="/assets/icons.svg?v=2#i-heart"/></svg>`;
export function coeurHTML(id, nom, classe = "fav") {
  const on = idsFavoris().has(id);
  return `<button type="button" class="${classe}${on ? " on" : ""}" data-fav="${String(id).replace(/"/g, "")}" aria-pressed="${on}" aria-label="${on ? "Retirer" : "Ajouter"} ${String(nom || "ce produit").replace(/"/g, "&quot;")} ${on ? "des" : "aux"} favoris">${COEUR}</button>`;
}

function etat(btn, on) {
  btn.classList.toggle("on", on);
  btn.setAttribute("aria-pressed", String(on));
  btn.setAttribute("aria-label", (btn.getAttribute("aria-label") || "").replace(/^(Ajouter|Retirer)/, on ? "Retirer" : "Ajouter").replace(/ (aux|des) favoris$/, on ? " des favoris" : " aux favoris"));
}

let fs = null;
async function outils() {
  fs ||= Promise.all([import("./session-client.js"), import("./carte-produit.js")]).then(async ([session, carte]) => {
    const { db, fs: f } = await carte.chargerFirestore();
    return { session, db, f };
  });
  return fs;
}

function versConnexion(id) {
  ecrire(CLE_ATTENTE, id, sessionStorage);
  location.href = "/connexion?retour=" + encodeURIComponent(location.pathname + location.search);
}

export async function basculerFavori(id, btn) {
  if (!id) return;
  if (!sessionLocale()) return versConnexion(id);
  const ids = idsFavoris();
  const on = !ids.has(id);
  // Affichage immédiat (optimiste), annulé si l'écriture est refusée.
  on ? ids.add(id) : ids.delete(id);
  memoriser(ids);
  document.querySelectorAll(`[data-fav="${CSS.escape(id)}"]`).forEach((b) => etat(b, on));
  toast(`<span>${on ? "Ajouté aux favoris" : "Retiré des favoris"}</span>`);
  try {
    const { session, db, f } = await outils();
    const user = await session.clientCourant();
    if (!user) return versConnexion(id);
    const ref = f.doc(db, "clients", user.uid, "favoris", id);
    // Hors ligne : l'écriture part dans la file du SDK ; on n'attend pas le serveur.
    const ecriture = on ? f.setDoc(ref, { ajouteLe: f.serverTimestamp() }) : f.deleteDoc(ref);
    if (navigator.onLine) await ecriture;
    else ecriture.catch((e) => console.warn("Favori non synchronisé :", e));
  } catch (err) {
    console.warn("Favori non enregistré :", err);
    on ? ids.delete(id) : ids.add(id);
    memoriser(ids);
    document.querySelectorAll(`[data-fav="${CSS.escape(id)}"]`).forEach((b) => etat(b, !on));
  }
}

// Délégation : un seul écouteur par conteneur (cartes ajoutées ensuite comprises).
export function brancherCoeurs(conteneur = document) {
  if (conteneur.__coeurs) return;
  conteneur.__coeurs = true;
  conteneur.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fav]");
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    basculerFavori(b.dataset.fav, b);
  });
}
// Synchronise les cœurs déjà affichés quand la liste change (autre onglet, synchro).
addEventListener("bokki:favoris", (e) => {
  document.querySelectorAll("[data-fav]").forEach((b) => etat(b, e.detail.ids.has(b.dataset.fav)));
});
addEventListener("storage", (e) => {
  if (e.key === CLE || e.key === CLE_SESSION) dispatchEvent(new CustomEvent("bokki:favoris", { detail: { ids: idsFavoris() } }));
});

// Liste complète depuis Firestore (plus récents d'abord) ; met à jour le miroir.
export async function chargerFavoris() {
  const { session, db, f } = await outils();
  const user = await session.clientCourant();
  if (!user) return [];
  const snap = await f.getDocs(f.collection(db, "clients", user.uid, "favoris"));
  const liste = snap.docs
    .map((d) => ({ id: d.id, t: d.data().ajouteLe?.toMillis?.() || Date.now() }))
    .sort((a, b) => b.t - a.t)
    .map((x) => x.id);
  memoriser(liste);
  return liste;
}

// Après connexion : ajoute le favori demandé avant la connexion.
export async function ajouterFavoriEnAttente() {
  const id = lire(CLE_ATTENTE, sessionStorage);
  if (!id) return;
  try { sessionStorage.removeItem(CLE_ATTENTE); } catch { /* rien */ }
  const { session } = await outils();
  const user = await session.clientCourant();
  if (!user) return;
  try { localStorage.setItem(CLE_SESSION, user.uid); } catch { /* rien */ }
  const ids = idsFavoris();
  if (ids.has(id)) return;
  await basculerFavori(id);
}
