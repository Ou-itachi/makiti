import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated, onDocumentUpdated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldPath, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import * as crypto from "crypto";

initializeApp();
// maxInstances 40 (au lieu de 10) : marge pour un pic de lancement. Les
// fonctions v2 gèrent en plus la concurrence par instance ; 40 plafonne
// aussi une éventuelle dérive de coût. creerCommande ne fait plus de
// requête-dans-transaction, la latence par appel reste basse même en pic.
setGlobalOptions({ region: "europe-west1", maxInstances: 40 });

const db = getFirestore();
let sitemapMemoire: { xml: string; expireAt: number } | null = null;

// Sitemap dynamique : les fiches sont générées côté navigateur à partir de
// Firestore, donc un sitemap statique ne peut pas suivre les ajouts produits.
// Seuls les champs publics sont lus et aucun détail client n'est exposé.
export const sitemap = onRequest({ maxInstances: 1, concurrency: 1 }, async (_request, response) => {
  response.set("Cache-Control", "public, max-age=300, s-maxage=3600");
  response.set("Content-Type", "application/xml; charset=utf-8");
  if (sitemapMemoire && sitemapMemoire.expireAt > Date.now()) {
    response.status(200).send(sitemapMemoire.xml);
    return;
  }
  try {
    const products = await db.collection("produits")
      .orderBy(FieldPath.documentId())
      .limit(49000)
      .get();
    const escapeXml = (value: string) => value.replace(/[<>&'\"]/g, (char) => ({
      "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;",
    }[char] || char));
    const pages = [
      ["https://bokki.shop/", "1.0"],
      ["https://bokki.shop/a-propos", "0.8"],
      ["https://bokki.shop/comment-ca-marche", "0.8"],
      ["https://bokki.shop/faq", "0.7"],
      ["https://bokki.shop/contact", "0.7"],
      ["https://bokki.shop/temoignages", "0.6"],
      ["https://bokki.shop/demande-produit", "0.6"],
      ["https://bokki.shop/legal", "0.3"],
    ];
    const urls = pages.map(([loc, priority]) =>
      `<url><loc>${loc}</loc><changefreq>weekly</changefreq><priority>${priority}</priority></url>`
    );
    const categories = ["telephones", "ordinateurs", "tablettes", "televisions", "electronique", "energie", "vetements", "chaussures", "voitures"];
    for (const category of categories) {
      urls.push(`<url><loc>https://bokki.shop/categorie/${category}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`);
    }
    for (const product of products.docs) {
      const data = product.data();
      const timestamp = data.dateModification || data.dateCreation || product.updateTime;
      const lastmod = timestamp?.toDate?.().toISOString().slice(0, 10);
      const loc = `https://bokki.shop/produit?id=${encodeURIComponent(product.id)}`;
      urls.push(`<url><loc>${escapeXml(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}<changefreq>weekly</changefreq><priority>0.8</priority></url>`);
    }
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`;
    sitemapMemoire = { xml, expireAt: Date.now() + 60 * 60 * 1000 };
    response.status(200).send(xml);
  } catch (error) {
    console.error("Génération du sitemap impossible", error);
    response.status(503).send("<?xml version=\"1.0\"?><urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\"/>");
  }
});

// Domaine public du site, utilisé pour le lien "cliquer pour suivre" des
// notifications push. À basculer sur "https://bokki.shop" une fois le
// domaine personnalisé actif (KAN-61) — le .web.app continue de fonctionner
// en attendant.
const SITE_URL = "https://bokki.shop";

// Un utilisateur authentifié n'est pas forcément un admin — voir
// firestore.rules pour le même contrôle côté règles. Ici c'est nécessaire
// en plus, car le SDK Admin utilisé par les Cloud Functions ne passe pas
// par firestore.rules : chaque fonction réservée à l'équipe doit vérifier
// elle-même l'appartenance à la liste blanche `admins/{uid}`.
async function assertAdmin(uid: string | undefined): Promise<void> {
  if (!uid) {
    throw new HttpsError("unauthenticated", "Réservé à l'équipe Bokki.");
  }
  const adminSnap = await db.collection("admins").doc(uid).get();
  if (!adminSnap.exists) {
    throw new HttpsError("permission-denied", "Réservé à l'équipe Bokki.");
  }
}

// Préchauffage : le site appelle la fonction avec { prechauffage: true }
// quand le client commence à remplir le formulaire (ou quand l'admin ouvre
// ses commandes). Cela réveille une instance (démarrage à froid de 2 à 5 s)
// AVANT le vrai clic, qui est alors traité sans attente. Répond aussitôt :
// aucune lecture, aucune écriture, pas de quota anti-abus consommé.
function estPrechauffage(data: unknown): boolean {
  return Boolean(data && typeof data === "object" && (data as { prechauffage?: unknown }).prechauffage === true);
}

// Limite les points d'entrée publics par IP. L'adresse brute n'est jamais
// conservée; les compteurs expirent via purgerRateLimits ci-dessous.
async function limiterAppelPublic(request: { rawRequest: { ip?: string; headers: Record<string, unknown> } }, cle: string, maximum: number, fenetreMs: number): Promise<void> {
  // Ne jamais utiliser directement X-Forwarded-For en repli : un appelant
  // peut fournir cet en-tête et contourner la limite par IP. Si la plateforme
  // ne fournit exceptionnellement pas d'IP, le compartiment partagé est plus
  // sûr qu'une valeur contrôlée par le client.
  const ip = request.rawRequest.ip || "ip-indisponible";
  const id = crypto.createHash("sha256").update(`${cle}:${ip}`).digest("hex");
  const ref = db.collection("limitesAppels").doc(id);
  const maintenant = Date.now();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const debut = Number(snap.data()?.debutMs) || maintenant;
    const compte = maintenant - debut >= fenetreMs ? 0 : Number(snap.data()?.compte) || 0;
    if (compte >= maximum) {
      throw new HttpsError("resource-exhausted", "Trop de tentatives. Réessayez plus tard.");
    }
    const nouveauDebut = compte === 0 ? maintenant : debut;
    tx.set(ref, { debutMs: nouveauDebut, compte: compte + 1, expireAt: new Date(nouveauDebut + fenetreMs * 2) });
  });
}

// App Check sur les fonctions publiques (commande, suivi, avis, demandes,
// notifications). Déploiement en 2 temps, sinon les clients dont le service
// worker sert encore l'ancien firebase-config.js (sans App Check) seraient
// bloqués par "Unauthenticated" :
//  1. false : déployer hosting + functions, surveiller Firebase Console >
//     App Check > APIs > Cloud Functions (part de requêtes vérifiées).
//  2. Quand ~100 % du trafic est vérifié (quelques jours) : passer à true et
//     redéployer uniquement les functions.
// Les fonctions admin n'exigent pas App Check : Firebase Auth + assertAdmin
// suffisent, et un échec reCAPTCHA (bloqueur, réseau lent) ne doit pas
// bloquer le tableau de bord ni les paiements fournisseurs.
const EXIGER_APP_CHECK = false;

interface ObtenirSuiviData { commandeId: string; code: string; telephone: string; }

function telephoneNormalise(value: unknown): string {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.startsWith("224") && digits.length > 9 ? digits.slice(3) : digits;
}

// Seuls les champs nécessaires au suivi quittent le serveur. Le téléphone,
// l'adresse, le repère et les tokens restent privés dans commandes/{id}.
export const obtenirSuiviCommande = onCall<ObtenirSuiviData>({ maxInstances: 10, enforceAppCheck: EXIGER_APP_CHECK }, async (request) => {
  await limiterAppelPublic(request, "suivi", 60, 10 * 60 * 1000);
  const commandeId = String(request.data?.commandeId || "").trim();
  const code = String(request.data?.code || "").trim();
  const telephone = telephoneNormalise(request.data?.telephone);
  if (!/^[A-Za-z0-9]{20}$/.test(commandeId) || !/^(?:\d{4}|\d{6})$/.test(code) || !/^\d{6,12}$/.test(telephone)) {
    throw new HttpsError("invalid-argument", "Identifiants de commande invalides.");
  }
  const snap = await db.collection("commandes").doc(commandeId).get();
  if (!snap.exists || String(snap.data()?.codeLivraison) !== code || telephoneNormalise(snap.data()?.clientTel) !== telephone) {
    throw new HttpsError("permission-denied", "Numéro de commande ou code incorrect.");
  }
  const c = snap.data()!;
  const articles = articlesDeCommande(c).map((a) => ({
    produitId: a.produitId || null,
    nom: String(a.nom || "").slice(0, 200),
    image: typeof (a as any).image === "string" ? (a as any).image : null,
    varianteId: (a as any).varianteId || null,
    varianteLibelle: String((a as any).varianteLibelle || "").slice(0, 200),
    quantite: Number(a.quantite) || 1,
    prixInitial: Number((a as any).prixInitial) || (Number((a as any).prixUnitaire) || 0) * (Number(a.quantite) || 1),
  }));
  return {
    numero: c.numero || "", codeLivraison: c.codeLivraison, statut: c.statut,
    articles, montantTotal: Number(c.montantTotal) || Number(c.prixInitial) || 0,
    prixConvenu: c.prixConvenu ?? null, delaiEstime: c.delaiEstime || "",
    dateCreation: c.dateCreation?.toDate?.().toISOString() || null,
    dateLivraison: c.dateLivraison?.toDate?.().toISOString() || null,
    avisSoumis: c.avisSoumis || null,
  };
});

interface CreerDemandeProduitData {
  nom: string; quantite: number; categorie: string; description?: string;
  clientNom: string; clientTel: string;
  images?: { mimeType: string; base64: string }[];
}

function typeImageValide(bytes: Buffer, mime: string): boolean {
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/gif") return bytes.subarray(0, 6).toString("ascii").match(/^GIF8[79]a$/) !== null;
  if (mime === "image/webp") return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (mime === "image/heic" || mime === "image/heif") {
    const marqueur = bytes.subarray(4, 16).toString("ascii");
    return marqueur.includes("ftyp") && /hei[cf]|mif1|msf1/.test(bytes.subarray(8, 16).toString("ascii"));
  }
  return false;
}

export const creerDemandeProduit = onCall<CreerDemandeProduitData>({ maxInstances: 5, enforceAppCheck: EXIGER_APP_CHECK }, async (request) => {
  await limiterAppelPublic(request, "demande-produit", 15, 60 * 60 * 1000);
  const d = request.data || {};
  const nom = String(d.nom || "").trim().slice(0, 200);
  const clientNom = String(d.clientNom || "").trim().slice(0, 120);
  const clientTel = String(d.clientTel || "").trim().slice(0, 30);
  const categorie = String(d.categorie || "").trim().slice(0, 80);
  const description = String(d.description || "").trim().slice(0, 1000);
  const quantite = Math.floor(Number(d.quantite));
  const images = Array.isArray(d.images) ? d.images : [];
  if (!nom || !clientNom || !/^[\d+\s().-]{8,30}$/.test(clientTel) || (clientTel.match(/\d/g) || []).length < 6 || !Number.isInteger(quantite) || quantite < 1 || quantite > 99 || images.length > 5) {
    throw new HttpsError("invalid-argument", "Les informations de la demande sont invalides.");
  }
  const demandeRef = db.collection("demandesProduits").doc();
  const chemins: string[] = [];
  const bucket = getStorage().bucket();
  try {
    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      if (typeof image?.base64 !== "string" || image.base64.length > 960_000) {
        throw new HttpsError("invalid-argument", "Chaque photo doit rester sous 700 Ko après compression.");
      }
      const bytes = Buffer.from(image.base64, "base64");
      if (bytes.length > 700 * 1024 || !typeImageValide(bytes, image.mimeType)) {
        throw new HttpsError("invalid-argument", "Une photo est invalide ou trop volumineuse.");
      }
      const extension = ({ "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/heic": "heic", "image/heif": "heif" } as Record<string, string>)[image.mimeType];
      if (!extension) throw new HttpsError("invalid-argument", "Format de photo non accepté.");
      const chemin = `demandes-produits/${demandeRef.id}/${i}.${extension}`;
      chemins.push(chemin);
      await bucket.file(chemin).save(bytes, { resumable: false, metadata: { contentType: image.mimeType } });
    }
    await demandeRef.set({ nom, quantite, categorie, description: description || null, photos: chemins, clientNom, clientTel, statut: "nouvelle", dateCreation: FieldValue.serverTimestamp() });
  } catch (error) {
    await Promise.all(chemins.map((chemin) => bucket.file(chemin).delete().catch(() => undefined)));
    throw error;
  }
  return { success: true, demandeId: demandeRef.id };
});

// Statuts pour lesquels le code de livraison d'une commande est encore "actif"
// (donc à exclure lors de la génération d'un nouveau code pour éviter tout
// doublon en cours). Une fois livrée ou retournée, la commande est classée et
// son ancien code peut être réutilisé sans risque de confusion.
const STATUTS_CODE_ACTIF = ["nouvelle", "confirmee", "en_livraison", "en_negociation", "non_joignable"];

interface ArticleCommandeInput {
  produitId: string;
  varianteId?: string;
  quantite: number;
}

// Un client dont le Service Worker sert encore l'ancien order.js en cache
// (fichiers .js servis cache-first, voir public/sw.js) peut continuer à
// envoyer l'ancien format à plat pendant un moment après ce déploiement —
// produitId/varianteId/quantite restent acceptés en plus de articles[],
// normalisés en un tableau à un seul élément juste en dessous.
interface CreerCommandeData {
  // Appel de préchauffage (voir estPrechauffage) : aucun autre champ.
  prechauffage?: boolean;
  articles?: ArticleCommandeInput[];
  produitId?: string;
  varianteId?: string;
  quantite?: number;
  clientNom: string;
  clientTel: string;
  ville: string;
  quartier: string;
  repere?: string;
}

const MAX_ARTICLES_PAR_COMMANDE = 30;

// Longueur configurée par l'admin (onglet "Code de livraison" des
// paramètres, parametres/livraison.longueurCode) — relue à chaque
// génération, jamais mise en cache, pour qu'un changement de réglage
// s'applique immédiatement à la toute prochaine commande. Repli sur 4 si le
// document n'existe pas encore ou contient une valeur hors des deux options
// proposées à l'admin (4 ou 6).
async function longueurCodeConfiguree(): Promise<number> {
  const snap = await db.collection("parametres").doc("livraison").get();
  const longueur = Number(snap.data()?.longueurCode);
  return longueur === 6 ? 6 : 4;
}

function genererCodeChiffres(longueur: number): string {
  return String(crypto.randomInt(0, 10 ** longueur)).padStart(longueur, "0");
}

// ---------------------------------------------------------------------------
// Unicité numéro + code de livraison SANS requête-dans-transaction.
//
// L'ancienne implémentation faisait `tx.get(query commandes where numero==X)`
// et `tx.get(query commandes where codeLivraison==X)` À L'INTÉRIEUR de la
// transaction qui écrit aussi dans `commandes`. Une `tx.get(requête)` fait
// dépendre TOUT le résultset de la transaction : sous 100 commandes créées
// en même temps, chaque commit invalide les requêtes de toutes les
// transactions en vol → tempête de retries, latence de plusieurs secondes,
// et échecs `aborted`. Anti-pattern Firestore documenté.
//
// Nouvelle approche :
//  • numéro  = dérivé de l'ID auto-généré du document commande (déjà unique
//    par construction) : `BK-{année}-{6 derniers caractères de l'ID}`. Aucune
//    lecture, aucune écriture, aucune contention — juste un formatage. Un
//    compteur séquentiel serait un point chaud (Firestore limite ~1 écriture/
//    seconde sur un même document : 100 commandes d'un coup le saturent).
//  • code    = `codesActifs/{code}.create()` — échoue atomiquement si le doc
//    existe déjà (already-exists) → on retente un autre code. Écritures sur
//    des chemins DISTINCTS (un par code) : aucune contention entre elles,
//    seules les vraies collisions déclenchent un retry. Le doc est supprimé
//    quand la commande quitte un statut "actif" (voir libererCodeLivraison).
// ---------------------------------------------------------------------------
function numeroDepuisId(commandeId: string): string {
  const annee = new Date().getFullYear();
  const suffixe = commandeId.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase();
  return `BK-${annee}-${suffixe}`;
}

// Réserve un code unique ET écrit la commande en un seul aller-retour
// (batch atomique) : create() sur codesActifs/{code} échoue si le code est
// déjà pris par une commande active, et dans ce cas rien n'est écrit — on
// retire un autre code. Avant : deux écritures successives + un nettoyage
// du code en cas d'échec de la seconde.
async function ecrireCommandeAvecCode(
  longueur: number,
  commandeRef: FirebaseFirestore.DocumentReference,
  donnees: Record<string, unknown>
): Promise<string> {
  for (let tentative = 0; tentative < 40; tentative++) {
    const code = genererCodeChiffres(longueur);
    const batch = db.batch();
    batch.create(db.collection("codesActifs").doc(code), {
      commandeId: commandeRef.id,
      dateCreation: FieldValue.serverTimestamp(),
    });
    batch.set(commandeRef, { ...donnees, codeLivraison: code });
    try {
      await batch.commit();
      return code;
    } catch (err: unknown) {
      // already-exists (code gRPC 6 / string "already-exists") : ce code est
      // déjà pris par une commande active, on en tire un autre. Toute autre
      // erreur remonte.
      const c = (err as { code?: number | string })?.code;
      if (c !== 6 && c !== "already-exists") throw err;
    }
  }
  throw new HttpsError(
    "resource-exhausted",
    "Impossible de générer un code de livraison unique, réessaie."
  );
}

interface ArticleResolu {
  produitId: string;
  varianteId: string | null;
  nom: string;
  image: string | null;
  varianteLibelle: string | null;
  quantite: number;
  prixUnitaire: number;
  prixInitial: number;
}

// Résout un article envoyé par le client (produitId/varianteId/quantite)
// en une ligne complète, prix compris. Le prix ne vient JAMAIS d'une valeur
// envoyée par le client : soit de la variante précise choisie (chaque
// variante porte son propre prix), soit de caracteristiques.prix pour les
// catégories sans variantes. Un varianteId manquant sur un produit qui a des
// variantes est un rejet, pas un prix par défaut silencieux.
//
// Pas de stock : Bokki n'a pas d'entrepôt, les produits sont pris en
// dépôt-vente chez le fournisseur et commandés sans limite de quantité ici —
// voir produits.js/produit-detail.js côté affichage.
const QUANTITE_MAX_PAR_ARTICLE = 999;

async function resoudreArticle(input: ArticleCommandeInput): Promise<ArticleResolu> {
  const produitId = (input.produitId || "").trim();
  const quantite = Math.floor(Number(input.quantite));

  if (!produitId || produitId.length > 200) {
    throw new HttpsError("invalid-argument", "Produit manquant.");
  }
  if (!Number.isFinite(quantite) || quantite < 1 || quantite > QUANTITE_MAX_PAR_ARTICLE) {
    throw new HttpsError("invalid-argument", "Quantité invalide.");
  }

  const produitRef = db.collection("produits").doc(produitId);
  const produitSnap = await produitRef.get();
  if (!produitSnap.exists) {
    throw new HttpsError("not-found", "Un des produits de la commande n'existe plus.");
  }
  const produit = produitSnap.data()!;

  const variantesSnap = await produitRef.collection("variantes").limit(1).get();
  const aDesVariantes = !variantesSnap.empty;

  let prixUnitaire: number;
  let varianteId: string | null = null;
  let varianteLibelle: string | null = null;

  if (aDesVariantes) {
    const varianteIdDemandee = (input.varianteId || "").trim();
    if (!varianteIdDemandee) {
      throw new HttpsError("invalid-argument", "Sélectionnez une variante (options) avant de commander.");
    }
    const varianteSnap = await produitRef.collection("variantes").doc(varianteIdDemandee).get();
    if (!varianteSnap.exists) {
      throw new HttpsError("not-found", "Cette variante n'existe plus, rechargez la page.");
    }
    const variante = varianteSnap.data()!;
    prixUnitaire = Number(variante.prix) || 0;
    varianteId = varianteSnap.id;
    varianteLibelle = variante.libelle || null;
  } else {
    // Repli sur l'ancien schéma plat (prixVente) pour les produits pas
    // encore migrés vers infosGenerales/caracteristiques — aucune migration
    // de données n'est faite dans ce ticket, ce repli évite de casser la
    // commande de produits existants tant qu'ils n'ont pas été recréés dans
    // le nouveau format.
    const caracteristiques = produit.caracteristiques || {};
    prixUnitaire = Number(caracteristiques.prix ?? produit.prixVente) || 0;
  }

  if (!Number.isFinite(prixUnitaire) || prixUnitaire <= 0 || prixUnitaire > Number.MAX_SAFE_INTEGER) {
    throw new HttpsError("failed-precondition", "Le prix de ce produit est invalide. Contactez-nous avant de commander.");
  }
  if (!Number.isSafeInteger(prixUnitaire * quantite)) {
    throw new HttpsError("failed-precondition", "Le montant de cet article dépasse la limite autorisée.");
  }

  return {
    produitId,
    varianteId,
    nom: produit.infosGenerales?.nom || produit.nom || "",
    // Vignette 480 px si disponible : cette image n'est affichée qu'en petit
    // (suivi, confirmation, mes commandes, admin). L'originale (jusqu'à
    // 1600 px) coûtait plusieurs centaines de Ko par article sur mobile.
    image: (Array.isArray(produit.imagesSmall) && typeof produit.imagesSmall[0] === "string" && produit.imagesSmall[0])
      || (Array.isArray(produit.images) && produit.images[0]) || null,
    varianteLibelle,
    quantite,
    prixUnitaire,
    prixInitial: prixUnitaire * quantite,
  };
}

// Plafonds de longueur sur les chaînes envoyées par le client : creerCommande
// est un point d'entrée NON authentifié (le client commande sans compte).
// Sans plafond, rien n'empêche d'écrire des champs énormes (coût Firestore,
// pollution du tableau de bord admin). Ces limites sont larges pour un usage
// normal et strictes face à un abus.
const LIMITES_TEXTE = { nom: 120, tel: 30, ville: 80, quartier: 120, repere: 300 };

function champBorne(valeur: unknown, max: number): string {
  return String(valeur ?? "").trim().slice(0, max);
}

export const creerCommande = onCall<CreerCommandeData>({ maxInstances: 10, enforceAppCheck: EXIGER_APP_CHECK }, async (request) => {
  if (estPrechauffage(request.data)) return { pret: true };
  // Le contrôle anti-abus part en parallèle des lectures ci-dessous (qui
  // n'écrivent rien) : il est attendu avant toute écriture.
  const limite = limiterAppelPublic(request, "commande", 60, 60 * 60 * 1000);
  limite.catch(() => undefined); // évite un rejet non géré si une validation échoue avant
  const data = request.data;

  const clientNom = champBorne(data.clientNom, LIMITES_TEXTE.nom);
  const clientTel = champBorne(data.clientTel, LIMITES_TEXTE.tel);
  const ville = champBorne(data.ville, LIMITES_TEXTE.ville);
  const quartier = champBorne(data.quartier, LIMITES_TEXTE.quartier);
  const repere = champBorne(data.repere, LIMITES_TEXTE.repere);

  if (!clientNom) throw new HttpsError("invalid-argument", "Le nom complet est obligatoire.");
  if (!clientTel) throw new HttpsError("invalid-argument", "Le numéro de téléphone est obligatoire.");
  // Téléphone : au moins 6 chiffres (indicatif + numéro guinéen court accepté),
  // caractères de mise en forme tolérés (+, espaces, tirets, parenthèses).
  if ((clientTel.match(/\d/g) || []).length < 6 || !/^[\d+\s().-]+$/.test(clientTel)) {
    throw new HttpsError("invalid-argument", "Numéro de téléphone invalide.");
  }
  if (!ville) throw new HttpsError("invalid-argument", "Ville de livraison invalide.");
  if (!quartier) throw new HttpsError("invalid-argument", "Le quartier est obligatoire.");

  // Panier (articles[]) ou achat rapide historique (produitId/varianteId/
  // quantite à plat, voir CreerCommandeData) — normalisés ici en un seul
  // tableau, résolu article par article.
  const articlesInput: ArticleCommandeInput[] =
    Array.isArray(data.articles) && data.articles.length
      ? data.articles
      : data.produitId
      ? [{ produitId: data.produitId, varianteId: data.varianteId, quantite: data.quantite ?? 1 }]
      : [];

  if (!articlesInput.length) throw new HttpsError("invalid-argument", "Aucun produit dans la commande.");
  if (articlesInput.length > MAX_ARTICLES_PAR_COMMANDE) {
    throw new HttpsError("invalid-argument", "Trop d'articles dans une seule commande.");
  }

  // Livraison gratuite uniquement (plus de premium payante) : la zone ne
  // sert plus qu'à afficher un délai estimé indicatif au client, jamais un
  // frais. Ville désormais une des 8 régions administratives fixes côté
  // client (produit.html), mais la comparaison reste insensible à la
  // casse/aux espaces au cas où une commande plus ancienne ou une saisie
  // différente existerait encore.
  const normaliseVille = (v: string) => (v || "").trim().toLowerCase();
  // Lectures indépendantes en parallèle (avant : l'une après l'autre).
  const [, zonesSnap, articles, longueurCode] = await Promise.all([
    limite,
    db.collection("zones").get(),
    Promise.all(articlesInput.map(resoudreArticle)),
    longueurCodeConfiguree(),
  ]);
  const zone = zonesSnap.docs
    .map((d) => d.data())
    .find((z) => normaliseVille(z.ville) === normaliseVille(ville));

  const montantTotal = articles.reduce((somme, a) => somme + a.prixInitial, 0);
  if (!Number.isSafeInteger(montantTotal) || montantTotal <= 0) {
    throw new HttpsError("failed-precondition", "Le montant total de la commande est invalide.");
  }
  const produitIds = [...new Set(articles.map((a) => a.produitId))];

  // Délai affiché au client : celui configuré pour sa région si l'admin l'a
  // renseigné, sinon un repli générique.
  const DELAI_PAR_DEFAUT = "3 jours";

  const commandeRef = db.collection("commandes").doc();

  // Numéro dérivé de l'ID (aucune contention) + code réservé atomiquement :
  // voir le bloc de commentaires plus haut.
  const numero = numeroDepuisId(commandeRef.id);
  const delaiEstime = (zone && zone.delai) || DELAI_PAR_DEFAUT;
  // Commande + code de livraison écrits ensemble (un seul aller-retour), sur
  // un doc auto-ID unique : aucune contention avec les autres commandes.
  const codeLivraison = await ecrireCommandeAvecCode(longueurCode, commandeRef, {
    numero,
    clientNom,
    clientTel,
    ville,
    quartier,
    repere: repere || null,
    articles,
    produitIds,
    montantTotal,
    prixConvenu: null,
    livraisonType: "standard",
    fraisLivraison: 0,
    delaiEstime,
    statut: "nouvelle",
    livreurId: null,
    dateCreation: FieldValue.serverTimestamp(),
    dateLivraison: null,
  });

  // Récapitulatif renvoyé au client (mêmes champs que obtenirSuiviCommande) :
  // la page de confirmation s'affiche aussitôt, sans second appel serveur.
  return {
    id: commandeRef.id,
    numero,
    codeLivraison,
    statut: "nouvelle",
    articles,
    montantTotal,
    prixConvenu: null,
    fraisLivraison: 0,
    delaiEstime,
  };
});

interface ValiderCodeLivraisonData {
  prechauffage?: boolean;
  commandeId: string;
  code: string;
}

// Statuts à partir desquels une commande peut être marquée "livrée". Une
// commande déjà livrée, retournée, ou pas encore en livraison ne doit pas
// pouvoir être validée par ce chemin.
const STATUTS_VALIDABLES = ["en_livraison"];

// Cette action de livraison est protégée par Firebase Auth et la liste
// blanche admins/{uid} ci-dessous. Elle n'exige pas App Check afin qu'un
// onglet admin sans jeton App Check ne puisse pas bloquer la confirmation.
export const validerCodeLivraison = onCall<ValiderCodeLivraisonData>(async (request) => {
  if (estPrechauffage(request.data)) return { pret: true };
  const admin = assertAdmin(request.auth?.uid);
  admin.catch(() => undefined);

  const commandeId = String(request.data?.commandeId || "").trim();
  const code = String(request.data?.code || "").trim();

  if (!commandeId) {
    await admin;
    throw new HttpsError("invalid-argument", "Commande manquante.");
  }
  // 4 ou 6 chiffres : la longueur configurée peut avoir changé depuis que
  // cette commande précise a été créée (chaque commande garde le code tel
  // qu'il a été généré à l'époque) — la comparaison exacte juste en dessous
  // (commande.codeLivraison !== code) reste la vraie vérification, ceci
  // n'est qu'un rejet rapide des saisies manifestement mal formées.
  if (!/^\d{4}$|^\d{6}$/.test(code)) {
    await admin;
    throw new HttpsError("invalid-argument", "Le code doit contenir 4 ou 6 chiffres.");
  }

  // Vérification admin et lecture de la commande en parallèle ; rien n'est
  // renvoyé ni écrit avant que la vérification admin ait réussi.
  const commandeRef = db.collection("commandes").doc(commandeId);
  const [, snap] = await Promise.all([admin, commandeRef.get()]);
  if (!snap.exists) {
    throw new HttpsError("not-found", "Cette commande n'existe plus.");
  }
  const commande = snap.data()!;

  if (!STATUTS_VALIDABLES.includes(commande.statut)) {
    throw new HttpsError(
      "failed-precondition",
      `Cette commande est au statut "${commande.statut}" — seules les commandes "en livraison" peuvent être validées.`
    );
  }

  if (commande.codeLivraison !== code) {
    throw new HttpsError("permission-denied", "Code incorrect. Vérifiez auprès du client.");
  }

  await commandeRef.update({
    statut: "livree",
    dateLivraison: FieldValue.serverTimestamp(),
  });

  return { success: true };
});

interface EnregistrerTokenNotificationData {
  commandeId: string;
  code: string;
  telephone: string;
  token: string;
}

// Écrit exclusivement via cette fonction (SDK Admin, contourne firestore.rules)
// — même logique que creerAvis/enregistrerPaiementFournisseur : la règle
// `commandes` interdit toute écriture client directe. Pas d'assertAdmin ici :
// c'est le client, pas l'équipe Bokki, qui appelle depuis la page de suivi.
//
// Le suivi et les actions client exigent le code de livraison ET le téléphone
// de la commande. L'identifiant seul ne donne aucun accès au document.
export const enregistrerTokenNotification = onCall<EnregistrerTokenNotificationData>({ maxInstances: 5, enforceAppCheck: EXIGER_APP_CHECK }, async (request) => {
  await limiterAppelPublic(request, "notification", 20, 60 * 60 * 1000);
  const commandeId = (request.data.commandeId || "").trim();
  const code = (request.data.code || "").trim();
  const telephone = telephoneNormalise(request.data.telephone);
  const token = (request.data.token || "").trim();

  if (!commandeId || !/^\d{6,12}$/.test(telephone)) throw new HttpsError("invalid-argument", "Commande ou téléphone invalide.");
  if (!token || token.length > 4096) {
    throw new HttpsError("invalid-argument", "Jeton de notification invalide.");
  }

  const commandeRef = db.collection("commandes").doc(commandeId);
  const snap = await commandeRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Cette commande n'existe plus.");
  }
  if (String(snap.data()!.codeLivraison) !== code || telephoneNormalise(snap.data()!.clientTel) !== telephone) {
    throw new HttpsError("permission-denied", "Code de livraison incorrect.");
  }

  await commandeRef.update({ fcmToken: token });
  return { success: true };
});

// Messages envoyés au client à chaque changement de statut de sa commande.
// "nouvelle" n'y figure pas : le client est déjà sur la page de confirmation
// au moment où sa commande est créée, une notification serait redondante.
const NOTIF_STATUT: Record<string, { titre: string; corps: string } | undefined> = {
  confirmee: { titre: "Commande confirmée", corps: "Votre commande a été confirmée par téléphone." },
  en_negociation: {
    titre: "Un agent vous contacte",
    corps: "Un agent Bokki souhaite échanger avec vous au sujet de votre commande.",
  },
  en_livraison: { titre: "Commande en livraison", corps: "Votre commande est en route vers vous." },
  livree: { titre: "Commande livrée", corps: "Votre commande a été livrée. Merci d'avoir choisi Bokki !" },
  retournee: { titre: "Commande retournée", corps: "Votre commande a été marquée comme retournée." },
};

// Déclencheur séparé de onCommandeStatutChange (qui ne réagit qu'aux
// transitions livrée/non-livrée pour le solde fournisseur) : ici on réagit à
// TOUT changement de statut ayant un message associé, indépendamment de la
// logique financière.
export const envoyerNotificationStatutCommande = onDocumentUpdated("commandes/{commandeId}", async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;
  if (before.statut === after.statut) return;

  const token: string | undefined = after.fcmToken;
  if (!token) return;

  const message = NOTIF_STATUT[after.statut];
  if (!message) return;

  try {
    await getMessaging().send({
      token,
      notification: { title: message.titre, body: message.corps },
      webpush: {
        fcmOptions: { link: `${SITE_URL}/suivi.html?id=${event.params.commandeId}` },
      },
    });
  } catch (err: unknown) {
    // Un jeton expiré/désinstallé ne doit jamais bloquer la mise à jour de
    // statut elle-même (ce trigger est asynchrone, mais on évite quand même
    // de réessayer indéfiniment sur un jeton mort) — on le supprime pour que
    // la prochaine visite du client sur la page de suivi puisse en réémettre un.
    console.error("Échec envoi notification :", err);
    const code = (err as { code?: string })?.code;
    if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
      await event.data!.after.ref.update({ fcmToken: FieldValue.delete() }).catch(() => {});
    }
  }
});

interface CreerAvisData {
  commandeId: string;
  code: string;
  telephone: string;
  note: number;
  commentaire?: string;
}

interface ArticleCommandeStocke {
  produitId?: string;
  varianteId?: string | null;
  quantite?: number;
  nom?: string;
}

// Lit la liste d'articles d'une commande, quel que soit son schéma :
// articles[] (introduit pour préparer le panier, KAN-75+) sur les commandes
// créées depuis cette évolution, ou repli sur les champs à plat
// (produitId/varianteId/quantite/produitNom) pour toutes les commandes
// créées avant — jamais migrées rétroactivement. Utilisé par creerAvis,
// onCommandeStatutChange et repartitionFinanciere.
function articlesDeCommande(commande: FirebaseFirestore.DocumentData): ArticleCommandeStocke[] {
  if (Array.isArray(commande.articles) && commande.articles.length) return commande.articles;
  if (!commande.produitId) return [];
  return [
    {
      produitId: commande.produitId,
      varianteId: commande.varianteId || null,
      quantite: commande.quantite || 1,
      nom: commande.produitNom || "",
    },
  ];
}

const COMMENTAIRE_MAX_LONGUEUR = 1000;

// Passe exclusivement par cette fonction (firestore.rules bloque toute
// création client directe sur `avis`) pour trois raisons qu'une règle seule
// ne peut pas garantir : (1) valider que `note` est bien un entier 1-5,
// (2) dériver produit/nom depuis la VRAIE commande plutôt que de faire
// confiance à des valeurs envoyées par le client (empêche un avis pour un
// produit/nom arbitraire), (3) empêcher plusieurs avis pour la même
// commande via une transaction atomique. Le document `avis` public
// n'écrit jamais commandeId — sinon une simple liste de la collection
// (publique, nécessaire pour la page Témoignages) donnerait l'ID de
// commande, donc l'accès à commandes.get() (public), donc au
// nom/téléphone/adresse du client.
export const creerAvis = onCall<CreerAvisData>({ maxInstances: 5, enforceAppCheck: EXIGER_APP_CHECK }, async (request) => {
  await limiterAppelPublic(request, "avis", 20, 60 * 60 * 1000);
  const commandeId = (request.data.commandeId || "").trim();
  const code = (request.data.code || "").trim();
  const telephone = telephoneNormalise(request.data.telephone);
  const note = Math.round(Number(request.data.note));
  const commentaire = (request.data.commentaire || "").trim().slice(0, COMMENTAIRE_MAX_LONGUEUR);

  if (!commandeId || !/^\d{6,12}$/.test(telephone)) throw new HttpsError("invalid-argument", "Commande ou téléphone invalide.");
  if (!Number.isInteger(note) || note < 1 || note > 5) {
    throw new HttpsError("invalid-argument", "La note doit être un entier entre 1 et 5.");
  }

  const commandeRef = db.collection("commandes").doc(commandeId);
  const avisRef = db.collection("avis").doc();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(commandeRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "Cette commande n'existe plus.");
    }
    const commande = snap.data()!;
    // L'identifiant seul ne suffit pas : le code et le téléphone du client
    // sont également vérifiés avant l'écriture de l'avis.
    if (String(commande.codeLivraison) !== code || telephoneNormalise(commande.clientTel) !== telephone) {
      throw new HttpsError("permission-denied", "Code de livraison incorrect.");
    }
    if (commande.statut !== "livree") {
      throw new HttpsError(
        "failed-precondition",
        "Un avis ne peut être laissé que pour une commande livrée."
      );
    }
    if (commande.avisSoumis) {
      throw new HttpsError("already-exists", "Un avis a déjà été envoyé pour cette commande.");
    }

    // Une commande à plusieurs articles n'a pas de produit unique à noter —
    // pas de UX "choisir quel produit noter" conçue pour l'instant (aucun
    // panier ne peut encore créer une telle commande en pratique), donc
    // rejet propre plutôt qu'un avis attribué arbitrairement au premier article.
    const articlesCommande = articlesDeCommande(commande);
    if (articlesCommande.length > 1) {
      throw new HttpsError(
        "failed-precondition",
        "Cette commande contient plusieurs articles — laisser un avis n'est pas encore possible dans ce cas."
      );
    }
    const articleUnique = articlesCommande[0];

    tx.set(avisRef, {
      produitId: articleUnique?.produitId || null,
      produitNom: articleUnique?.nom || "",
      clientNom: commande.clientNom || "",
      note,
      commentaire,
      dateCreation: FieldValue.serverTimestamp(),
    });
    tx.update(commandeRef, {
      avisSoumis: { note, commentaire },
    });
  });

  return { success: true, note, commentaire };
});

// ============================================================================
// Montant dû aux fournisseurs (dépôt-vente) : Bokki doit au fournisseur le
// prix d'achat (coût) de chaque unité vendue de son produit — pas le prix de
// vente client, dont Bokki garde la différence comme marge. `fournisseurs/
// {id}.montantDu` est un solde couru, maintenu uniquement côté serveur (voir
// firestore.rules : le client ne peut jamais l'écrire directement) par deux
// mécanismes :
//  1. onCommandeStatutChange (ci-dessous) : crédite montantDu quand une
//     commande passe à "livree" (quelle que soit la manière dont ce
//     changement arrive — validerCodeLivraison ou changement de statut
//     manuel par l'admin), et le débite si une commande déjà livrée est
//     ensuite requalifiée (ex. retour après livraison).
//  2. enregistrerPaiementFournisseur (plus bas) : débite montantDu quand
//     l'admin enregistre un reversement réel au fournisseur.
// ============================================================================

async function prixAchatArticle(
  article: ArticleCommandeStocke,
  tx: FirebaseFirestore.Transaction
): Promise<number> {
  const produitId = article.produitId;
  if (!produitId) return 0;

  // Le prix d'achat ne vit jamais sur le document produit/variante lui-même
  // (lisible publiquement, catalogue) mais dans une sous-collection admin
  // dédiée produits/{id}/interne/achat — voir firestore.rules.
  const achatSnap = await tx.get(db.collection("produits").doc(produitId).collection("interne").doc("achat"));
  if (!achatSnap.exists) return 0;
  const achat = achatSnap.data()!;

  if (article.varianteId) {
    return Number(achat.parVariante?.[article.varianteId]) || 0;
  }
  return Number(achat.prixAchat) || 0;
}

async function fournisseurIdDuProduit(
  produitId: string | undefined,
  tx: FirebaseFirestore.Transaction
): Promise<string | null> {
  if (!produitId) return null;
  const produitSnap = await tx.get(db.collection("produits").doc(produitId));
  if (!produitSnap.exists) return null;
  return produitSnap.data()!.fournisseurId || null;
}

export const onCommandeStatutChange = onDocumentUpdated("commandes/{commandeId}", async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;
  if (before.statut === after.statut) return;

  const devientLivree = after.statut === "livree" && before.statut !== "livree";
  const quitteLivree = before.statut === "livree" && after.statut !== "livree";
  if (!devientLivree && !quitteLivree) return;

  const commandeRef = event.data!.after.ref;
  // État interne de comptabilisation fournisseur : dans une sous-collection
  // dédiée (admin uniquement), jamais sur le document commandes lui-même,
  // pour ne jamais exposer le prix d'achat/la marge exacte de Bokki.
  //
  // Une commande peut désormais contenir des articles de fournisseurs
  // différents (panier, KAN-75+) : la comptabilisation devient une map par
  // fournisseur (interne/fournisseurs, pluriel) plutôt qu'un montant unique.
  // L'ancien doc singulier (interne/fournisseur) déjà écrit sur des
  // commandes livrées avant cette évolution n'est pas touché/migré — voir
  // dashboard.js côté lecture, qui sait retomber dessus.
  const interneRef = commandeRef.collection("interne").doc("fournisseurs");

  await db.runTransaction(async (tx) => {
    const commandeSnap = await tx.get(commandeRef);
    if (!commandeSnap.exists) return;
    const commande = commandeSnap.data()!;
    const articles = articlesDeCommande(commande);
    if (!articles.length) return;

    const interneSnap = await tx.get(interneRef);
    const parFournisseur = (interneSnap.data()?.parFournisseur || {}) as Record<
      string,
      { comptabilise?: boolean; montant?: number }
    >;

    // Toutes les lectures de la transaction doivent précéder ses écritures :
    // on résout fournisseur + prix d'achat de chaque article avant de
    // décider quoi créditer/débiter, et on agrège par fournisseur (deux
    // articles du même fournisseur dans la même commande ne doivent créditer
    // qu'une seule fois ce fournisseur, pour le total des deux).
    const montantParFournisseur = new Map<string, number>();
    for (const article of articles) {
      const fournisseurId = await fournisseurIdDuProduit(article.produitId, tx);
      if (!fournisseurId) continue;
      let montantArticle = 0;
      if (devientLivree) {
        const prixAchat = await prixAchatArticle(article, tx);
        montantArticle = prixAchat * (Number(article.quantite) || 0);
      }
      montantParFournisseur.set(fournisseurId, (montantParFournisseur.get(fournisseurId) || 0) + montantArticle);
    }

    const misAJour: Record<string, { comptabilise: boolean; montant?: number }> = {};

    if (devientLivree) {
      // Idempotence face aux relectures (retries) d'un même événement, ou à
      // un événement qui arriverait après qu'un événement suivant ait déjà
      // traité la transition : on ne recrédite jamais un fournisseur déjà
      // reflété par son drapeau comptabilise pour cette commande.
      for (const [fournisseurId, montant] of montantParFournisseur) {
        if (parFournisseur[fournisseurId]?.comptabilise || montant <= 0) continue;
        tx.update(db.collection("fournisseurs").doc(fournisseurId), { montantDu: FieldValue.increment(montant) });
        misAJour[fournisseurId] = { comptabilise: true, montant };
      }
    } else {
      // On annule exactement le montant précédemment crédité par
      // fournisseur (pas un recalcul), au cas où un prix d'achat aurait
      // changé depuis — sinon le solde dériverait.
      for (const [fournisseurId, entree] of Object.entries(parFournisseur)) {
        if (!entree?.comptabilise) continue;
        const montant = Number(entree.montant) || 0;
        if (montant <= 0) continue;
        tx.update(db.collection("fournisseurs").doc(fournisseurId), { montantDu: FieldValue.increment(-montant) });
        misAJour[fournisseurId] = { comptabilise: false };
      }
    }

    if (!Object.keys(misAJour).length) return;
    tx.set(interneRef, { parFournisseur: { ...parFournisseur, ...misAJour } }, { merge: true });
  });
});

// Libère le code de livraison (supprime codesActifs/{code}) dès qu'une
// commande quitte un statut "actif" (livrée, retournée, annulée…), pour que
// ce code puisse être réattribué à une future commande — exactement la
// portée de l'ancienne vérification `where statut in STATUTS_CODE_ACTIF`.
export const libererCodeLivraison = onDocumentUpdated("commandes/{commandeId}", async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after || before.statut === after.statut) return;

  const etaitActif = STATUTS_CODE_ACTIF.includes(before.statut);
  const estActif = STATUTS_CODE_ACTIF.includes(after.statut);
  if (etaitActif && !estActif && after.codeLivraison) {
    await db.collection("codesActifs").doc(String(after.codeLivraison)).delete().catch(() => undefined);
  }
});

interface EnregistrerPaiementFournisseurData {
  fournisseurId: string;
  montant: number;
  date?: string;
  note?: string;
}

export const enregistrerPaiementFournisseur = onCall<EnregistrerPaiementFournisseurData>(async (request) => {
  await assertAdmin(request.auth?.uid);

  const fournisseurId = (request.data.fournisseurId || "").trim();
  const montant = Number(request.data.montant);
  const date = (request.data.date || "").trim();
  const note = (request.data.note || "").trim();

  if (!fournisseurId) throw new HttpsError("invalid-argument", "Fournisseur manquant.");
  if (!Number.isFinite(montant) || montant <= 0) {
    throw new HttpsError("invalid-argument", "Le montant doit être supérieur à 0.");
  }

  const fournisseurRef = db.collection("fournisseurs").doc(fournisseurId);
  const paiementRef = db.collection("paiementsFournisseurs").doc();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(fournisseurRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "Ce fournisseur n'existe plus.");
    }
    const fournisseur = snap.data()!;
    const montantDu = Number(fournisseur.montantDu) || 0;
    if (montant > montantDu) {
      throw new HttpsError(
        "failed-precondition",
        // toLocaleString("fr-FR") ne produit l'espace française que si
        // l'environnement Node embarque les données ICU complètes — pas
        // garanti selon la plateforme de déploiement des Cloud Functions.
        // Même filet de sécurité que fmt() côté client (voir produits.js,
        // commandes.js…) : on force l'espace nous-mêmes plutôt que de
        // dépendre d'un fallback silencieux vers la virgule.
        `Le montant dépasse le montant dû (${Math.round(montantDu).toLocaleString("fr-FR").replace(/,/g, " ")} GNF restants).`
      );
    }

    tx.set(paiementRef, {
      fournisseurId,
      fournisseurNom: fournisseur.nom || "",
      montant,
      date: date || null,
      note,
      dateCreation: FieldValue.serverTimestamp(),
    });
    tx.update(fournisseurRef, { montantDu: FieldValue.increment(-montant) });
  });

  return { success: true, paiementId: paiementRef.id };
});

// ============================================================================
// Relevé financier (tableau de bord admin, période navigable — jour d'origine
// généralisé à mois/plage/année) : pour chaque commande créée dans la période
// [debut, fin[, part Bokki = prix vente - prix achat - frais livreur.
// Calculée ici (Cloud Function, SDK Admin) plutôt que côté client pour ne
// jamais exposer prixAchat / fraisParLivraison bruts au front — seuls les
// montants dérivés (déjà agrégés) traversent le réseau.
// ============================================================================

interface LigneRepartition {
  id: string;
  numero: string;
  produitId: string | null;
  produitNom: string;
  quantite: number;
  venteTotale: number;
  prixAchat: number;
  fraisLivreur: number;
  partBokki: number;
}

interface RepartitionFinanciereData {
  debutISO: string;
  finISO: string;
}

const TOP_PRODUITS_LIMITE = 5;

export const repartitionFinanciere = onCall<RepartitionFinanciereData>(async (request) => {
  await assertAdmin(request.auth?.uid);

  const debut = new Date(request.data?.debutISO);
  const fin = new Date(request.data?.finISO);
  if (isNaN(debut.getTime()) || isNaN(fin.getTime()) || fin <= debut) {
    throw new HttpsError("invalid-argument", "Période invalide.");
  }
  if (fin.getTime() - debut.getTime() > 366 * 24 * 60 * 60 * 1000) {
    throw new HttpsError("invalid-argument", "La période ne peut pas dépasser 12 mois.");
  }

  const commandesSnap = await db
    .collection("commandes")
    .where("dateCreation", ">=", debut)
    .where("dateCreation", "<", fin)
    .limit(1001)
    .get();
  if (commandesSnap.size > 1000) {
    throw new HttpsError("resource-exhausted", "Plus de 1 000 commandes dans cette période. Réduisez la plage sélectionnée.");
  }

  // Dédoublonne les lectures : plusieurs commandes de la période portent
  // souvent sur le même produit ou le même livreur.
  const achats = new Map<string, FirebaseFirestore.DocumentData | null>();
  const livreurs = new Map<string, FirebaseFirestore.DocumentData | null>();

  // Prix d'achat : sous-collection admin produits/{id}/interne/achat, jamais
  // sur le document produit/variante lui-même (lisible publiquement).
  async function getAchat(produitId: string) {
    if (!achats.has(produitId)) {
      const snap = await db.collection("produits").doc(produitId).collection("interne").doc("achat").get();
      achats.set(produitId, snap.exists ? snap.data()! : null);
    }
    return achats.get(produitId) ?? null;
  }
  async function getLivreur(livreurId: string) {
    if (!livreurs.has(livreurId)) {
      const snap = await db.collection("livreurs").doc(livreurId).get();
      livreurs.set(livreurId, snap.exists ? snap.data()! : null);
    }
    return livreurs.get(livreurId) ?? null;
  }

  const articlesPeriode = commandesSnap.docs.flatMap((d) => articlesDeCommande(d.data()));
  const idsProduits = [...new Set(articlesPeriode.map((a) => a.produitId).filter((id): id is string => !!id))];
  const idsLivreurs = [...new Set(commandesSnap.docs.map((d) => d.data().livreurId).filter((id): id is string => !!id))];
  // Précharge les références distinctes en parallèle : évite une attente
  // réseau par produit/livreur pendant le calcul de chaque commande.
  const references = [
    ...idsProduits.map((id) => () => getAchat(id)),
    ...idsLivreurs.map((id) => () => getLivreur(id)),
  ];
  for (let i = 0; i < references.length; i += 100) {
    await Promise.all(references.slice(i, i + 100).map((charger) => charger()));
  }

  // Top produits de la période : agrégé par article (une commande à
  // plusieurs articles compte pour chacun de ses produits), nom repris
  // directement de l'article (déjà dénormalisé), pas de lecture produit
  // supplémentaire nécessaire.
  const parProduit = new Map<string, { nom: string; quantite: number }>();

  const lignes: LigneRepartition[] = [];
  for (const docSnap of commandesSnap.docs) {
    const c = docSnap.data();
    const articles = articlesDeCommande(c);
    const quantiteTotale = articles.reduce((somme, a) => somme + (Number(a.quantite) || 0), 0);
    const venteTotale = Number(c.prixConvenu != null ? c.prixConvenu : (c.montantTotal ?? c.prixInitial)) || 0;

    // prixAchat et top produits somment sur les articles (potentiellement
    // plusieurs fournisseurs/produits par commande) ; venteTotale/
    // fraisLivreur/partBokki restent des montants au niveau de la commande
    // entière (le prix négocié, prixConvenu, est un total, pas par article).
    let prixAchat = 0;
    for (const a of articles) {
      if (!a.produitId) continue;
      const achat = await getAchat(a.produitId);
      const prixAchatUnitaire = a.varianteId
        ? Number(achat?.parVariante?.[a.varianteId]) || 0
        : Number(achat?.prixAchat) || 0;
      prixAchat += prixAchatUnitaire * (Number(a.quantite) || 0);

      const entree = parProduit.get(a.produitId) || { nom: a.nom || "", quantite: 0 };
      entree.quantite += Number(a.quantite) || 0;
      parProduit.set(a.produitId, entree);
    }

    let fraisLivreur = 0;
    if (c.livreurId) {
      const livreur = await getLivreur(c.livreurId);
      fraisLivreur = livreur ? Number(livreur.fraisParLivraison) || 0 : 0;
    }

    lignes.push({
      id: docSnap.id,
      numero: c.numero || "",
      produitId: articles[0]?.produitId || null,
      produitNom: articles.length > 1 ? `${articles.length} articles` : articles[0]?.nom || "",
      quantite: quantiteTotale,
      venteTotale,
      prixAchat,
      fraisLivreur,
      partBokki: venteTotale - prixAchat - fraisLivreur,
    });
  }

  const totaux = lignes.reduce(
    (acc, l) => ({
      venteTotale: acc.venteTotale + l.venteTotale,
      prixAchat: acc.prixAchat + l.prixAchat,
      fraisLivreur: acc.fraisLivreur + l.fraisLivreur,
      partBokki: acc.partBokki + l.partBokki,
    }),
    { venteTotale: 0, prixAchat: 0, fraisLivreur: 0, partBokki: 0 }
  );

  const topProduits = [...parProduit.entries()]
    .map(([produitId, v]) => ({ produitId, nom: v.nom, quantite: v.quantite }))
    .sort((a, b) => b.quantite - a.quantite)
    .slice(0, TOP_PRODUITS_LIMITE);

  return { totaux, nombreCommandes: lignes.length, topProduits };
});

// ============================================================================
// Corbeille des commandes livrées : l'admin peut envoyer une commande livrée
// à la corbeille (commandes.js / commande-detail.js, updateDoc côté client —
// simple champ, pas besoin d'une Cloud Function pour ça, déjà couvert par
// firestore.rules). Cette tâche planifiée purge définitivement ce qui y est
// resté plus de 30 jours, une fois par jour.
// ============================================================================

const JOURS_RETENTION_CORBEILLE = 30;

export const purgerCorbeilleCommandes = onSchedule("every 24 hours", async () => {
  const seuil = new Date();
  seuil.setDate(seuil.getDate() - JOURS_RETENTION_CORBEILLE);

  const snap = await db
    .collection("commandes")
    .where("corbeille", "==", true)
    .where("dateCorbeille", "<=", seuil)
    .get();

  if (snap.empty) return;

  // recursiveDelete : supprime AUSSI les sous-collections de chaque commande
  // (commandes/{id}/interne/*). Un simple batch.delete() sur le document
  // laissait ces sous-documents orphelins indéfiniment dans Firestore.
  for (const d of snap.docs) {
    await db.recursiveDelete(d.ref);
  }
});

// Nettoie les compteurs temporaires du limiteur sans dépendre de l'activation
// d'une politique TTL dans la console Firebase.
export const purgerRateLimits = onSchedule("every 24 hours", async () => {
  const seuil = new Date();
  for (;;) {
    const snap = await db.collection("limitesAppels").where("expireAt", "<=", seuil).limit(400).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < 400) return;
  }
});

// Synchronise le "badge admin" (custom claim) sur le compte Auth à chaque
// ajout/retrait dans la liste blanche admins/{uid}.
//
// Pourquoi : les règles Cloud Storage vérifient l'admin via
// `request.auth.token.admin` (un champ du jeton), et NON via
// `firestore.exists(admins/...)`. L'appel Firestore-depuis-Storage
// ("cross-service rules") exige une permission IAM supplémentaire qui
// n'est pas accordée automatiquement lors d'un `firebase deploy` en ligne
// de commande — d'où des uploads refusés (storage/unauthorized) pour de
// vrais admins. Le custom claim, lui, est dans le jeton : aucune
// dépendance externe, ça marche toujours.
//
// La liste blanche admins/{uid} reste la source de vérité (c'est là qu'on
// ajoute/retire un admin) ; ce trigger propage juste l'info vers le jeton.
// firestore.rules continue d'utiliser la liste directement (pas de
// cross-service là-bas, donc pas de souci).
//
// Effet : après ajout, l'admin doit se reconnecter (ou attendre ~1h que
// son jeton se rafraîchisse) pour que le claim apparaisse.
export const synchroniserBadgeAdmin = onDocumentWritten("admins/{uid}", async (event) => {
  const uid = event.params.uid;
  const estAdmin = event.data?.after?.exists === true;
  try {
    const user = await getAuth().getUser(uid);
    const claimsActuels = user.customClaims || {};
    if (!!claimsActuels.admin === estAdmin) return; // déjà à jour
    await getAuth().setCustomUserClaims(uid, { ...claimsActuels, admin: estAdmin || undefined });
    console.info(`[Bokki] badge admin ${estAdmin ? "posé" : "retiré"} pour ${uid}`);
  } catch (err) {
    // Compte Auth pas encore créé au moment où le doc admins/ est écrit :
    // pas bloquant, l'admin devra juste se reconnecter une fois son compte
    // et son claim en place.
    console.warn(`[Bokki] synchroniserBadgeAdmin: ${uid} — ${(err as Error).message}`);
  }
});

// ---------------------------------------------------------------------------
// Notifications push de l'équipe : « nouvelle commande »
// ---------------------------------------------------------------------------
// Chaque admin peut, depuis Paramètres > Notifications, activer les
// notifications push sur son appareil. Le jeton FCM est stocké dans
// admins/{uid}.fcmTokens (tableau — plusieurs appareils par personne).
// admins/{uid} est fermé à toute lecture/écriture client (firestore.rules),
// donc l'écriture passe forcément par ces fonctions (SDK Admin).

interface TokenAdminData {
  token: string;
}

export const enregistrerTokenAdmin = onCall<TokenAdminData>(async (request) => {
  await assertAdmin(request.auth?.uid);
  const token = (request.data.token || "").trim();
  if (!token || token.length > 4096) {
    throw new HttpsError("invalid-argument", "Jeton de notification invalide.");
  }
  await db
    .collection("admins")
    .doc(request.auth!.uid)
    .set({ fcmTokens: FieldValue.arrayUnion(token) }, { merge: true });
  return { success: true };
});

export const supprimerTokenAdmin = onCall<TokenAdminData>(async (request) => {
  await assertAdmin(request.auth?.uid);
  const token = (request.data.token || "").trim();
  if (!token) return { success: true };
  await db
    .collection("admins")
    .doc(request.auth!.uid)
    .set({ fcmTokens: FieldValue.arrayRemove(token) }, { merge: true });
  return { success: true };
});

// À la création d'une commande : une notification push à toute l'équipe qui
// a activé l'option. Respecte l'interrupteur global « Nouvelle commande »
// (Paramètres > Notifications, doc parametres/notifications) — absent = actif.
// Les jetons morts (app désinstallée, navigateur nettoyé) sont purgés au
// passage pour ne pas retenter indéfiniment.
export const notifierAdminsNouvelleCommande = onDocumentCreated(
  "commandes/{commandeId}",
  async (event) => {
    const commande = event.data?.data();
    if (!commande) return;

    const paramSnap = await db.doc("parametres/notifications").get();
    if (paramSnap.exists && paramSnap.data()?.nouvelleCommande === false) return;

    const adminsSnap = await db.collection("admins").get();
    const parDoc = new Map<string, string[]>();
    const tousJetons: string[] = [];
    adminsSnap.forEach((d) => {
      const liste = d.data().fcmTokens;
      if (Array.isArray(liste)) {
        const propres = liste.filter((t): t is string => typeof t === "string" && t.length > 0);
        parDoc.set(d.id, propres);
        tousJetons.push(...propres);
      }
    });

    const uniques = [...new Set(tousJetons)];
    if (!uniques.length) return;

    const montant = Number(commande.prixConvenu ?? commande.montantTotal ?? 0);
    const montantTxt = montant
      ? montant.toLocaleString("fr-FR").replace(/,/g, " ") + " GNF"
      : "montant à confirmer";
    const lieu = [commande.ville, commande.quartier].filter(Boolean).join(", ");
    const corps = [`${commande.clientNom || "Client"}`, montantTxt, lieu].filter(Boolean).join(" · ");

    const reponse = await getMessaging().sendEach(
      uniques.map((token) => ({
        token,
        notification: {
          title: `Nouvelle commande ${commande.numero || ""}`.trim(),
          body: corps,
        },
        webpush: {
          fcmOptions: {
            link: `${SITE_URL}/admin/commande-detail.html?id=${event.params.commandeId}`,
          },
        },
      }))
    );

    const morts = new Set<string>();
    reponse.responses.forEach((r, i) => {
      const code = r.error?.code;
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token"
      ) {
        morts.add(uniques[i]);
      }
    });
    if (!morts.size) return;

    await Promise.all(
      adminsSnap.docs.map((d) => {
        const liste = parDoc.get(d.id) || [];
        const nettoye = liste.filter((t) => !morts.has(t));
        return nettoye.length !== liste.length
          ? d.ref.update({ fcmTokens: nettoye })
          : Promise.resolve();
      })
    );
  }
);
