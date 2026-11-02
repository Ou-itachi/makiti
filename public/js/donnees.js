// Lecture des données publiques du catalogue (produits, variantes, avis),
// pensée pour le réseau guinéen : 2G/3G lente, coupures, Android d'entrée
// de gamme.
//
// • API REST de Firestore (un simple fetch, 1 aller-retour) au lieu du SDK
//   Firebase (≈ 190 Ko de JavaScript et plusieurs allers-retours avant la
//   première donnée). Le SDK n'est chargé qu'en secours, si l'API REST
//   refuse la requête (App Check imposé un jour sur Firestore, par ex.).
// • Cache sur le téléphone (localStorage) : la dernière version connue
//   s'affiche tout de suite — y compris hors connexion — puis est remplacée
//   par la version fraîche dès qu'elle arrive.
// • Délai maximum par requête et nouvelles tentatives automatiques.
import { reseauLent } from "./reseau.js";

// Émulateurs (localhost seulement, ?emulator=1 mémorisé) : mêmes règles que
// firebase-base.js, qui n'est plus chargé sur les pages du catalogue.
const PROJET = (() => {
  const prod = { id: "makiti-gn", hote: "https://firestore.googleapis.com" };
  try {
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
    const p = new URLSearchParams(location.search);
    if (!local || p.get("emulator") === "0") {
      localStorage.removeItem("bokki-emulator");
      return prod;
    }
    if (p.get("emulator") === "1") localStorage.setItem("bokki-emulator", "1");
    if (localStorage.getItem("bokki-emulator") === "1") return { id: "demo-bokki", hote: "http://127.0.0.1:8080" };
  } catch { /* stockage indisponible */ }
  return prod;
})();
const RACINE = `projects/${PROJET.id}/databases/(default)/documents`;
const API = `${PROJET.hote}/v1/${RACINE}`;

// ---------- Réseau : délai maximum + nouvelles tentatives ----------
export class ErreurReseau extends Error {
  constructor(message, { statut = 0, horsLigne = false } = {}) {
    super(message);
    this.statut = statut;
    this.horsLigne = horsLigne;
  }
}
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

// fetch() borné dans le temps, réessayé 2 fois (3 essais) en cas de coupure,
// d'expiration du délai ou d'erreur serveur 5xx/429. Délai plus long en
// réseau lent (une réponse de 20 Ko à 50 Ko/s prend déjà ~3 s).
export async function fetchFiable(url, options = {}, { essais = 3, delai } = {}) {
  const max = delai ?? (reseauLent() ? 20000 : 12000);
  let derniere;
  for (let i = 0; i < essais; i++) {
    if (i) await attendre(800 * 2 ** (i - 1) + Math.random() * 400);
    if (navigator.onLine === false) {
      derniere = new ErreurReseau("Hors connexion", { horsLigne: true });
      // Inutile d'épuiser les essais : on attend un peu le retour du réseau.
      await Promise.race([attendre(3000), new Promise((r) => addEventListener("online", r, { once: true }))]);
      continue;
    }
    const ctrl = new AbortController();
    const minuterie = setTimeout(() => ctrl.abort(), max);
    try {
      const rep = await fetch(url, { ...options, signal: ctrl.signal });
      if (rep.ok) return rep;
      derniere = new ErreurReseau(`HTTP ${rep.status}`, { statut: rep.status });
      if (rep.status < 500 && rep.status !== 429) throw derniere; // erreur définitive
    } catch (err) {
      if (err instanceof ErreurReseau && err.statut && err.statut < 500 && err.statut !== 429) throw err;
      derniere = err instanceof ErreurReseau ? err : new ErreurReseau(err?.name === "AbortError" ? "Délai dépassé" : "Réseau indisponible");
    } finally {
      clearTimeout(minuterie);
    }
  }
  throw derniere;
}

// ---------- Décodage du format REST de Firestore ----------
function valeur(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue; // chaîne ISO
  if ("nullValue" in v) return null;
  if ("mapValue" in v) return champs(v.mapValue.fields);
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(valeur);
  if ("referenceValue" in v) return v.referenceValue;
  if ("geoPointValue" in v) return v.geoPointValue;
  return null;
}
function champs(f = {}) {
  const o = {};
  for (const [k, v] of Object.entries(f)) o[k] = valeur(v);
  return o;
}
function documentREST(d) {
  const id = d.name.split("/").pop();
  // __nom : chemin complet (curseur de pagination), non affiché.
  return { id, ...champs(d.fields), __nom: d.name };
}
// Documents issus du SDK (secours) : mêmes formes que l'API REST (dates ISO).
function documentSDK(d) {
  const brut = d.data();
  const conv = (x) => {
    if (x && typeof x.toDate === "function") return x.toDate().toISOString();
    if (Array.isArray(x)) return x.map(conv);
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, conv(v)]));
    return x;
  };
  return { id: d.id, ...conv(brut), __nom: `${RACINE}/${d.ref.path}` };
}

// ---------- Secours : SDK Firebase (chargé seulement si besoin) ----------
let sdk = null;
function chargerSDK() {
  sdk ||= Promise.all([
    import("./firebase-base.js"),
    import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js"),
  ]).then(([{ db }, fs]) => ({ db, fs }));
  return sdk;
}
const refuseParREST = (err) => err instanceof ErreurReseau && [401, 403].includes(err.statut);

// ---------- Cache sur le téléphone ----------
// Produits : un seul objet { id: { d: document, t: date } }, plafonné aux
// MAX_CACHE plus récents. Listes : { clé: { ids, t } }.
const CLE_PRODUITS = "bokki-cache-produits";
const CLE_LISTES = "bokki-cache-listes";
const CLE_SOUS = "bokki-cache-sous"; // variantes / avis par produit
const MAX_CACHE = 250;
function lire(cle) {
  try { return JSON.parse(localStorage.getItem(cle) || "{}") || {}; } catch { return {}; }
}
function ecrire(cle, obj) {
  try { localStorage.setItem(cle, JSON.stringify(obj)); return true; } catch { return false; }
}
function elaguer(obj, max) {
  const cles = Object.keys(obj);
  if (cles.length <= max) return obj;
  cles.sort((a, b) => (obj[b].t || 0) - (obj[a].t || 0));
  return Object.fromEntries(cles.slice(0, max).map((k) => [k, obj[k]]));
}
function memoriserProduits(liste) {
  if (!liste.length) return;
  const cache = lire(CLE_PRODUITS);
  const t = Date.now();
  for (const p of liste) cache[p.id] = { d: p, t };
  // Stockage plein : on garde moitié moins de produits.
  if (!ecrire(CLE_PRODUITS, elaguer(cache, MAX_CACHE))) ecrire(CLE_PRODUITS, elaguer(cache, MAX_CACHE / 2));
}
export function produitEnCache(id) {
  return lire(CLE_PRODUITS)[id]?.d || null;
}
function listeEnCache(cle) {
  const l = lire(CLE_LISTES)[cle];
  if (!l) return null;
  const produits = lire(CLE_PRODUITS);
  const docs = l.ids.map((id) => produits[id]?.d).filter(Boolean);
  return docs.length === l.ids.length ? { docs, t: l.t, extra: l.extra } : null;
}
function memoriserListe(cle, docs, extra) {
  memoriserProduits(docs);
  const listes = lire(CLE_LISTES);
  listes[cle] = { ids: docs.map((p) => p.id), t: Date.now(), ...(extra != null ? { extra } : {}) };
  ecrire(CLE_LISTES, elaguer(listes, 30));
}
function sousEnCache(cle) {
  return lire(CLE_SOUS)[cle]?.d ?? null;
}
function memoriserSous(cle, d) {
  const s = lire(CLE_SOUS);
  s[cle] = { d, t: Date.now() };
  ecrire(CLE_SOUS, elaguer(s, 60));
}

// Données affichées depuis le cache faute de réseau : signalé à la page
// (bandeau « hors ligne »), voir reseau.js.
function signalerCache() {
  dispatchEvent(new CustomEvent("bokki:donnees-cache"));
}

// Stratégie commune : cache immédiat (si présent) → réseau → cache à jour.
// rappel(docs, { source: "cache" | "reseau" }) peut être appelé deux fois.
// Renvoie la version réseau, ou celle du cache si le réseau échoue ; lève
// l'erreur seulement si rien n'est disponible.
// secours() : à défaut d'entrée exacte, ce que le téléphone connaît déjà
// (utilisé seulement si le réseau échoue).
async function avecCache({ cache, reseau, memoriser, rappel, secours }) {
  const enCache = cache();
  if (enCache != null) rappel?.(enCache, { source: "cache" });
  try {
    const frais = await reseau();
    memoriser(frais);
    rappel?.(frais, { source: "reseau" });
    return frais;
  } catch (err) {
    const repli = enCache ?? secours?.() ?? null;
    if (repli != null) {
      if (enCache == null) rappel?.(repli, { source: "cache" });
      signalerCache();
      return repli;
    }
    throw err;
  }
}

// ---------- Requêtes ----------
async function runQuery(structuredQuery, parent = API) {
  const rep = await fetchFiable(`${parent}:runQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery }),
  });
  const lignes = await rep.json();
  return lignes.filter((l) => l.document).map((l) => documentREST(l.document));
}
const champ = (fieldPath) => ({ fieldPath });
const egal = (fieldPath, v) => ({ fieldFilter: { field: champ(fieldPath), op: "EQUAL", value: { stringValue: v } } });

// Produits : { recents: true } (tri par date décroissante) et/ou
// { categorie: "Téléphones" }, limite, apres (dernier produit de la page
// précédente, tri récent seulement).
export function requeteProduits({ recents = false, categorie = null, limite = 24, apres = null } = {}, rappel) {
  // Clé sans la limite : la taille de page varie avec le réseau, la même
  // liste doit rester retrouvable hors connexion.
  const cle = `p:${recents ? "r" : ""}:${categorie || ""}`;
  const reseau = async () => {
    try {
      const q = { from: [{ collectionId: "produits" }], limit: limite };
      if (categorie) q.where = egal("infosGenerales.categorie", categorie);
      if (recents) {
        q.orderBy = [{ field: champ("dateCreation"), direction: "DESCENDING" }, { field: champ("__name__"), direction: "DESCENDING" }];
        if (apres) q.startAt = { values: [{ timestampValue: apres.dateCreation }, { referenceValue: apres.__nom }], before: false };
      }
      return await runQuery(q);
    } catch (err) {
      if (!refuseParREST(err)) throw err;
      const { db, fs } = await chargerSDK();
      const clauses = [];
      if (categorie) clauses.push(fs.where("infosGenerales.categorie", "==", categorie));
      if (recents) {
        clauses.push(fs.orderBy("dateCreation", "desc"));
        if (apres) clauses.push(fs.startAfter(await fs.getDoc(fs.doc(db, "produits", apres.id))));
      }
      clauses.push(fs.limit(limite));
      const snap = await fs.getDocs(fs.query(fs.collection(db, "produits"), ...clauses));
      return snap.docs.map(documentSDK);
    }
  };
  // Pages suivantes : pas de cache (seule la 1re page s'affiche hors ligne).
  if (apres) return reseau().then((docs) => { memoriserProduits(docs); return docs; });
  return avecCache({
    cache: () => listeEnCache(cle)?.docs.slice(0, limite) ?? null,
    reseau,
    memoriser: (docs) => memoriserListe(cle, docs),
    rappel,
    // Liste jamais vue (catégorie pas encore ouverte) : les produits déjà
    // vus sur ce téléphone qui correspondent, les plus récents d'abord.
    secours: () => {
      const tous = Object.values(lire(CLE_PRODUITS)).map((e) => e.d)
        .filter((p) => !categorie || (p.infosGenerales?.categorie ?? p.categorie) === categorie)
        .sort((a, b) => String(b.dateCreation || "").localeCompare(String(a.dateCreation || "")));
      return tous.length ? tous.slice(0, limite) : null;
    },
  });
}

// Nombre total de produits (catalogue « Tout »).
export async function compterProduits() {
  try {
    const rep = await fetchFiable(`${API}:runAggregationQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ structuredAggregationQuery: { structuredQuery: { from: [{ collectionId: "produits" }] }, aggregations: [{ alias: "n", count: {} }] } }),
    }, { essais: 2 });
    const [l] = await rep.json();
    return Number(l?.result?.aggregateFields?.n?.integerValue ?? NaN) || null;
  } catch {
    return null;
  }
}

// Un produit (null s'il n'existe pas).
export function lireProduit(id, rappel) {
  return avecCache({
    cache: () => produitEnCache(id),
    reseau: async () => {
      try {
        const rep = await fetchFiable(`${API}/produits/${encodeURIComponent(id)}`, {}, {});
        return documentREST(await rep.json());
      } catch (err) {
        if (err instanceof ErreurReseau && err.statut === 404) return null;
        if (!refuseParREST(err)) throw err;
        const { db, fs } = await chargerSDK();
        const d = await fs.getDoc(fs.doc(db, "produits", id));
        return d.exists() ? documentSDK(d) : null;
      }
    },
    memoriser: (p) => p && memoriserProduits([p]),
    rappel,
  });
}

// Variantes d'un produit.
export function lireVariantes(id, rappel) {
  return avecCache({
    cache: () => sousEnCache(`v:${id}`),
    reseau: async () => {
      try {
        const rep = await fetchFiable(`${API}/produits/${encodeURIComponent(id)}/variantes?pageSize=100`);
        const j = await rep.json();
        return (j.documents || []).map(documentREST);
      } catch (err) {
        if (!refuseParREST(err)) throw err;
        const { db, fs } = await chargerSDK();
        const snap = await fs.getDocs(fs.collection(db, "produits", id, "variantes"));
        return snap.docs.map(documentSDK);
      }
    },
    memoriser: (l) => memoriserSous(`v:${id}`, l),
    rappel,
  });
}

// Avis d'un produit (les plus récents d'abord).
export function lireAvis(id, limite = 50, rappel) {
  return avecCache({
    cache: () => sousEnCache(`a:${id}`),
    reseau: async () => {
      try {
        return await runQuery({
          from: [{ collectionId: "avis" }],
          where: egal("produitId", id),
          orderBy: [{ field: champ("dateCreation"), direction: "DESCENDING" }],
          limit: limite,
        });
      } catch (err) {
        if (!refuseParREST(err)) throw err;
        const { db, fs } = await chargerSDK();
        const snap = await fs.getDocs(fs.query(fs.collection(db, "avis"), fs.where("produitId", "==", id), fs.orderBy("dateCreation", "desc"), fs.limit(limite)));
        return snap.docs.map(documentSDK);
      }
    },
    memoriser: (l) => memoriserSous(`a:${id}`, l),
    rappel,
  });
}

// ---------- Préchargement (fiche au toucher / survol, similaires visibles) ----------
// Désactivé quand le réseau est très lent ou l'économiseur de données actif.
export function prechargementPermis() {
  const c = navigator.connection;
  if (c?.saveData) return false;
  if (c?.effectiveType === "slow-2g") return false;
  return navigator.onLine !== false;
}
const dejaPrecharges = new Map();
export function prechargerProduit(id) {
  if (!id || !prechargementPermis()) return;
  const t = dejaPrecharges.get(id);
  if (t && Date.now() - t < 5 * 60 * 1000) return; // déjà frais
  dejaPrecharges.set(id, Date.now());
  // Produit déjà frais dans le cache (liste qui vient d'arriver) : inutile
  // de le relire. Variantes : seulement en réseau correct.
  const enCache = lire(CLE_PRODUITS)[id];
  if (!enCache || Date.now() - enCache.t > 5 * 60 * 1000) lireProduit(id).catch(() => dejaPrecharges.delete(id));
  if (!reseauLent() && sousEnCache(`v:${id}`) == null) lireVariantes(id).catch(() => {});
}
