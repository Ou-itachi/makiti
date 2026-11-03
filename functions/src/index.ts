import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated, onDocumentUpdated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
import { logger } from "firebase-functions";
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import * as crypto from "crypto";
import * as path from "path";
import * as zlib from "zlib";
import { Worker } from "worker_threads";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/server";

initializeApp();
// maxInstances 40 (au lieu de 10) : marge pour un pic de lancement. Les
// fonctions v2 gèrent en plus la concurrence par instance ; 40 plafonne
// aussi une éventuelle dérive de coût. creerCommande ne fait plus de
// requête-dans-transaction, la latence par appel reste basse même en pic.
setGlobalOptions({ region: "europe-west1", maxInstances: 40 });

const db = getFirestore();
// import() réel d'un module ES (.mjs) depuis ce code compilé en CommonJS.
const importerModule = new Function("p", "return import(p)") as (p: string) => Promise<any>;
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
      ["https://bokki.shop/livraison", "0.8"],
      ["https://bokki.shop/faq", "0.7"],
      // /conseils : à ajouter au premier article publié (noindex tant que vide).
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
    // Fiches : adresse /produit/<nom>-<xxxx> (public/js/slug.js), date de
    // dernière modification, et photos (extension image du sitemap).
    const { slugProduit } = await importerModule(require("url").pathToFileURL(path.join(__dirname, "..", "prerender", "slug.mjs")).href);
    for (const product of products.docs) {
      const data = product.data();
      const timestamp = data.dateModification || data.dateCreation || product.updateTime;
      const lastmod = timestamp?.toDate?.().toISOString().slice(0, 10);
      const nom = data.infosGenerales?.nom ?? data.nom ?? "";
      const loc = `https://bokki.shop/produit/${encodeURIComponent(slugProduit(product.id, nom))}`;
      const images = (Array.isArray(data.images) ? data.images : []).filter((u: unknown) => typeof u === "string" && u.startsWith("https://")).slice(0, 10);
      const balisesImages = images.map((u: string) => `<image:image><image:loc>${escapeXml(u)}</image:loc></image:image>`).join("");
      urls.push(`<url><loc>${escapeXml(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}<changefreq>weekly</changefreq><priority>0.8</priority>${balisesImages}</url>`);
    }
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${urls.join("")}</urlset>`;
    sitemapMemoire = { xml, expireAt: Date.now() + 60 * 60 * 1000 };
    response.status(200).send(xml);
  } catch (error) {
    logger.error("Génération du sitemap impossible", error);
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

// Commandes par numéro : au plus 5 envois différents en 24 h.
async function limiterCommandesTelephone(clientTel: string, idEnvoi: string): Promise<void> {
  const tel = clientTel.replace(/\D/g, "").slice(-9);
  if (tel.length < 8) return;
  const id = /^[A-Za-z0-9_-]{16,64}$/.test(idEnvoi) ? idEnvoi : crypto.randomUUID();
  const ref = db.collection("limitesAppels").doc("tel_" + crypto.createHash("sha256").update("commandes:" + tel).digest("hex").slice(0, 40));
  const maintenant = Date.now();
  await db.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data();
    const recent = d && maintenant - Number(d.debutMs) < 24 * 3600 * 1000;
    const ids: string[] = recent && Array.isArray(d!.ids) ? d!.ids : [];
    if (ids.includes(id)) return;
    if (ids.length >= 5) throw new HttpsError("resource-exhausted", "Vous avez déjà passé plusieurs commandes aujourd'hui. Contactez Bokki sur WhatsApp pour en passer une autre.");
    const debut = recent ? Number(d!.debutMs) : maintenant;
    tx.set(ref, { debutMs: debut, ids: [...ids, id], expireAt: new Date(debut + 48 * 3600 * 1000) });
  });
}

// Code de livraison deviné par essais (audit sécurité, point 4) : au plus
// ESSAIS_CODE_COMMANDE erreurs par commande en 24 h, toutes fonctions
// confondues (suivi, avis, notifications). La limite par IP seule se
// contourne en changeant d'adresse.
const ESSAIS_CODE_COMMANDE = 10;
function refEssaisCommande(cle: string) {
  return db.collection("limitesAppels").doc("cmd_" + crypto.createHash("sha256").update(cle).digest("hex").slice(0, 40));
}
async function verifierEssaisCommande(cle: string): Promise<void> {
  const d = (await refEssaisCommande(cle).get()).data();
  if (d && Number(d.echecs) >= ESSAIS_CODE_COMMANDE && Date.now() - Number(d.debutMs) < 24 * 3600 * 1000) {
    throw new HttpsError("resource-exhausted", "Trop d'essais pour cette commande. Réessayez demain ou contactez Bokki sur WhatsApp.");
  }
}
async function noterEchecCommande(cle: string): Promise<void> {
  const ref = refEssaisCommande(cle);
  const maintenant = Date.now();
  await db.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data();
    const recent = d && maintenant - Number(d.debutMs) < 24 * 3600 * 1000;
    const debut = recent ? Number(d!.debutMs) : maintenant;
    tx.set(ref, { debutMs: debut, echecs: (recent ? Number(d!.echecs) || 0 : 0) + 1, expireAt: new Date(debut + 48 * 3600 * 1000) });
  }).catch((e) => logger.warn("Compteur d'essais de commande non mis à jour", e));
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

// Identifiant de commande accepté par les fonctions publiques : jamais de
// « / » (doc() suivrait alors un chemin de sous-collection). Large exprès
// (64 caractères) pour ne pas refuser une ancienne commande.
const ID_COMMANDE = /^[A-Za-z0-9_-]{1,64}$/;
// Code de livraison : 4 ou 6 chiffres (voir longueurCodeConfiguree).
const CODE_LIVRAISON = /^(?:\d{4}|\d{6})$/;

interface ObtenirSuiviData { commandeId?: string; numero?: string; code: string; telephone: string; }

function telephoneNormalise(value: unknown): string {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.startsWith("224") && digits.length > 9 ? digits.slice(3) : digits;
}

// Seuls les champs nécessaires au suivi quittent le serveur. Le téléphone,
// l'adresse, le repère et les tokens restent privés dans commandes/{id}.
// Deux façons de retrouver une commande :
//  • commandeId (lien de suivi, appareil qui a passé la commande) ;
//  • numero « BK-AAAA-XXXXXX » (refonte : formulaire « Où est mon colis ? »,
//    utilisable depuis un autre téléphone). Requête d'égalité sur un seul
//    champ : index automatique, aucun index composite à créer. Le numéro
//    seul ne suffit jamais : code ET téléphone doivent correspondre.
export const obtenirSuiviCommande = onCall<ObtenirSuiviData>({ maxInstances: 10, enforceAppCheck: EXIGER_APP_CHECK }, async (request) => {
  await limiterAppelPublic(request, "suivi", 60, 10 * 60 * 1000);
  const commandeId = String(request.data?.commandeId || "").trim();
  const numero = String(request.data?.numero || "").trim().toUpperCase().replace(/\s+/g, "");
  const code = String(request.data?.code || "").trim();
  const telephone = telephoneNormalise(request.data?.telephone);
  const parId = /^[A-Za-z0-9]{20}$/.test(commandeId);
  const parNumero = !parId && /^BK-\d{4}-[A-Z0-9]{6}$/.test(numero);
  if ((!parId && !parNumero) || !/^(?:\d{4}|\d{6})$/.test(code) || !/^\d{6,15}$/.test(telephone)) {
    throw new HttpsError("invalid-argument", "Identifiants de commande invalides.");
  }
  const cleEssais = parId ? "id:" + commandeId : "num:" + numero;
  await verifierEssaisCommande(cleEssais);
  const correspond = (d: FirebaseFirestore.DocumentData | undefined) =>
    !!d && String(d.codeLivraison) === code && telephoneNormalise(d.clientTel) === telephone;
  let snap: FirebaseFirestore.DocumentSnapshot | undefined;
  if (parId) {
    const s = await db.collection("commandes").doc(commandeId).get();
    if (s.exists && correspond(s.data())) snap = s;
  } else {
    const q = await db.collection("commandes").where("numero", "==", numero).limit(5).get();
    snap = q.docs.find((d) => correspond(d.data()));
  }
  if (!snap) {
    await noterEchecCommande(cleEssais);
    throw new HttpsError("permission-denied", "Numéro de commande, code ou téléphone incorrect.");
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
    id: snap.id,
    numero: c.numero || "", codeLivraison: c.codeLivraison, statut: c.statut,
    ...fraisPublics(c),
    articles, montantTotal: Number(c.montantTotal) || Number(c.prixInitial) || 0,
    prixConvenu: c.prixConvenu ?? null, delaiEstime: c.delaiEstime || "",
    ...reductionsPubliques(c),
    dateCreation: c.dateCreation?.toDate?.().toISOString() || null,
    dateLivraison: c.dateLivraison?.toDate?.().toISOString() || null,
    avisSoumis: c.avisSoumis || null,
  };
});

// Réductions d'une commande (parrainage, crédit) visibles par le client :
// montants seulement, jamais l'identité du parrain.
function reductionsPubliques(c: FirebaseFirestore.DocumentData) {
  return {
    reductionParrainage: Math.max(0, Number(c.reductionParrainage) || 0),
    pourcentParrainage: Math.max(0, Number(c.pourcentParrainage) || 0),
    reductionCredit: Math.max(0, Number(c.reductionCredit) || 0),
  };
}

// Total des réductions enregistrées sur une commande (0 si aucune).
function reductionTotale(c: FirebaseFirestore.DocumentData): number {
  return Math.max(0, Number(c.reductionParrainage) || 0) + Math.max(0, Number(c.reductionCredit) || 0);
}

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
// « en_preparation » (colis préparé après confirmation, avant le départ du
// livreur) : le code reste actif, la commande n'est pas encore livrée.
const STATUTS_CODE_ACTIF = ["nouvelle", "confirmee", "en_preparation", "en_livraison", "en_negociation", "non_joignable"];

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
  // Identifiant unique choisi par le téléphone pour CET envoi (commande sans
  // perte) : renvoyé tel quel à chaque nouvelle tentative après une coupure,
  // il garantit qu'une commande n'est jamais enregistrée deux fois.
  idEnvoi?: string;
  // Code de parrainage saisi par le client (facultatif, ou lien ?parrain=).
  codeParrainage?: string;
  // Identifiant aléatoire de l'appareil (localStorage « bokki-appareil »).
  appareil?: string;
}

const MAX_ARTICLES_PAR_COMMANDE = 30;

// ---------------------------------------------------------------------------
// Commande sans perte (réseau coupé à « Confirmer ma commande »)
//
// Le téléphone garde la commande et la renvoie au retour du réseau, avec le
// même idEnvoi. Si la 1re tentative avait en fait abouti (seule la réponse
// s'est perdue), envoisCommandes/{idEnvoi} contient déjà le récapitulatif :
// on le renvoie au lieu de créer une 2e commande. Deux tentatives
// simultanées : la 2e attend la fin de la 1re. Documents purgés après
// 7 jours (purgerRateLimits). Collection fermée côté client (règles).
// ---------------------------------------------------------------------------
const ID_ENVOI = /^[A-Za-z0-9_-]{16,64}$/;
const ENVOI_BLOQUE_MS = 2 * 60 * 1000; // tentative « en cours » considérée comme abandonnée
const ENVOI_GARDE_MS = 7 * 24 * 3600 * 1000;

type ResultatEnvoi =
  | { etat: "libre" }
  | { etat: "fait"; recap: Record<string, unknown>; uid: string | null; compteCree: boolean };

// Réserve idEnvoi pour cette tentative, ou renvoie le résultat déjà connu.
async function reserverEnvoi(idEnvoi: string): Promise<ResultatEnvoi> {
  const ref = db.collection("envoisCommandes").doc(idEnvoi);
  for (let attente = 0; attente < 12; attente++) {
    const r = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.data();
      if (d?.etat === "fait") return { etat: "fait" as const, recap: d.recap, uid: d.uid ?? null, compteCree: !!d.compteCree };
      const debut = (d?.debut as Timestamp | undefined)?.toMillis?.() ?? 0;
      if (d?.etat === "en-cours" && Date.now() - debut < ENVOI_BLOQUE_MS) return { etat: "attendre" as const };
      tx.set(ref, { etat: "en-cours", debut: Timestamp.now(), expireAt: Timestamp.fromMillis(Date.now() + ENVOI_GARDE_MS) });
      return { etat: "libre" as const };
    });
    if (r.etat !== "attendre") return r;
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new HttpsError("unavailable", "Votre commande est déjà en cours d'envoi. Patientez un instant.");
}

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
// ⚠ FRAIS DE LIVRAISON PROVISOIRES (GNF) — montants à fournir par le
// propriétaire (brief §5.3).
// ⚠ TABLES DUPLIQUÉES dans public/js/livraison.js (FRAIS_LIVRAISON,
// VILLES_PAR_REGION, regionDeVille) : GARDER LES DEUX ALIGNÉES.
// Le client écrit sa VILLE librement ; on en déduit la région (table
// ci-dessous) puis les frais de la région. Un champ « frais » sur un
// document zones/{id} dont la « ville » correspond à la ville tapée OU à la
// région déduite prime toujours. Ville non reconnue et sans zone : frais
// « à confirmer » (fraisLivraison null + fraisAConfirmer), jamais 0.
const FRAIS_LIVRAISON_PAR_REGION: Record<string, number> = {
  Conakry: 0,
  Kindia: 50000,
  Boké: 75000,
  Mamou: 75000,
  Labé: 100000,
  Faranah: 100000,
  Kankan: 125000,
  Nzérékoré: 150000,
};
// Villes, préfectures, sous-préfectures et (pour Conakry) communes et
// quartiers connus → région.
const VILLES_PAR_REGION: Record<string, string[]> = {
  Conakry: [
    "Conakry", "Kaloum", "Dixinn", "Matam", "Ratoma", "Matoto", "Kipé", "Kipe Dadia", "Lambanyi", "Lambandji",
    "Sonfonia", "Sonfonia Gare", "Kagbélen", "Nongo", "Taouyah", "Koloma", "Hamdallaye", "Bambeto", "Cosa",
    "Kaporo", "Kaporo Rails", "Kobaya", "Yattayah", "Simbaya", "Gbessia", "Tombo", "Coronthie", "Boulbinet",
    "Almamya", "Sandervalia", "Coléah", "Landréah", "Dabompa", "Enta", "Yimbaya", "Sangoyah",
    "Kakimbo", "Wanindara", "Tombolia", "Lansanaya", "Dabondy", "Kissosso", "Bonfi",
    "Camayenne", "Kenien", "Hermakono", "Démoudoula", "Koléah", "Dixinn Port",
  ],
  Kindia: ["Kindia", "Coyah", "Dubréka", "Forécariah", "Télimélé", "Friguiagbé", "Maneah", "Kouria", "Mambia", "Wonkifong", "Benty", "Kolenté", "Sinta", "Tanéné"],
  Boké: ["Boké", "Kamsar", "Sangarédi", "Boffa", "Fria", "Gaoual", "Koundara", "Kolaboui", "Tougnifili", "Dabiss", "Kanfarandé", "Tormelin"],
  Mamou: ["Mamou", "Dalaba", "Pita", "Timbo", "Ouré Kaba", "Soyah", "Téliko", "Bodié", "Kankalabé", "Timbi Madina", "Ditinn"],
  Labé: ["Labé", "Koubia", "Lélouma", "Mali", "Mali Ville", "Tougué", "Popodara", "Dara Labé", "Kouramangui", "Yembéring", "Sannou"],
  Faranah: ["Faranah", "Dabola", "Dinguiraye", "Kissidougou", "Banian", "Tiro", "Marela", "Banko", "Selouma"],
  Kankan: ["Kankan", "Kérouané", "Kouroussa", "Mandiana", "Siguiri", "Kintinian", "Baro", "Norassoba", "Banankoro", "Doko", "Niandankoro", "Tokounou"],
  Nzérékoré: ["Nzérékoré", "Beyla", "Guéckédou", "Lola", "Macenta", "Yomou", "Diécké", "Bossou", "Sérédou", "Bounouma", "Koropara", "Sinko"],
};

// « Nzérékoré », « N'ZEREKORE », « nzerekore » → « nzerekore ».
function cleVille(texte: unknown): string {
  return String(texte || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
const INDEX_VILLES = new Map<string, string>();
for (const [region, villes] of Object.entries(VILLES_PAR_REGION)) {
  for (const v of villes) INDEX_VILLES.set(cleVille(v), region);
}
// Région déduite de la ville tapée, ou null. Texte entier, puis chaque mot
// en partant du dernier (« Kipé, Conakry »). Même logique que livraison.js.
function regionDeVille(ville: string): string | null {
  const entiere = cleVille(ville);
  if (!entiere) return null;
  if (INDEX_VILLES.has(entiere)) return INDEX_VILLES.get(entiere)!;
  // Mot par mot (dernier d'abord) ; un nom hors Conakry l'emporte sur un
  // quartier de Conakry : « Labé Hamdallaye » → Labé, pas Conakry (gratuit).
  let conakry: string | null = null;
  for (const mot of String(ville).split(/[\s,;/()]+/).reverse()) {
    const r = INDEX_VILLES.get(cleVille(mot));
    if (r && r !== "Conakry") return r;
    if (r) conakry = r;
  }
  return conakry;
}

// Frais d'une commande vus par le client (suivi, mes commandes) : null +
// fraisAConfirmer tant que l'agent ne les a pas saisis dans l'admin.
// Anciennes commandes : fraisLivraison numérique, inchangé.
function fraisPublics(c: FirebaseFirestore.DocumentData) {
  const aConfirmer = c.fraisAConfirmer === true && typeof c.fraisLivraison !== "number";
  return { fraisLivraison: aConfirmer ? null : Number(c.fraisLivraison) || 0, fraisAConfirmer: aConfirmer };
}

const LIMITES_TEXTE = { nom: 120, tel: 30, ville: 80, quartier: 120, repere: 300 };

function champBorne(valeur: unknown, max: number): string {
  return String(valeur ?? "").trim().slice(0, max);
}

// ---------------------------------------------------------------------------
// Parrainage
//
// Chaque client qui a un compte reçoit un code court (6 caractères, sans
// 0/O/1/I pour éviter les confusions à la dictée), créé à la première
// demande (profilClient) : clients/{uid}.codeParrainage + index
// codesParrainage/{code} → { uid } pour retrouver le parrain.
//
// Filleul : code saisi au moment de commander (ou lien ?parrain=CODE).
// Vérifié ICI, jamais côté client : code connu, pas son propre code (ni même
// compte ni même téléphone), première commande. Réduction = pourcentFilleul %
// du total des articles (hors livraison), arrondie à la centaine de GNF
// inférieure, plafonnée à plafondFilleul. Un code refusé ne bloque JAMAIS la
// commande : elle passe sans réduction et la réponse explique pourquoi.
// parrainages/{téléphone du filleul} (créé dans la même transaction que la
// commande) garantit qu'un même numéro n'est parrainé qu'une seule fois,
// même avec deux commandes envoyées en même temps.
//
// Parrain : quand la commande du filleul passe « livrée »
// (suiviParrainageCommande), il reçoit pourcentParrain % du total des
// articles de cette commande (même arrondi, plafond plafondParrain) en crédit
// (clients/{uid}.creditParrainage), déduit automatiquement de sa prochaine
// commande passée en étant connecté. Crédit utilisé rendu si cette commande
// est retournée (ou mise à la corbeille sans avoir été livrée).
//
// Réglages : parametres/parrainage (admin, page Paramètres). Collections
// codesParrainage et parrainages fermées aux clients (firestore.rules).
// ---------------------------------------------------------------------------
interface ParametresParrainage {
  actif: boolean;
  pourcentFilleul: number;
  pourcentParrain: number;
  plafondFilleul: number;
  plafondParrain: number;
  // Filleuls récompensés au plus par parrain et par mois (0 = sans limite).
  maxFilleulsParMois: number;
}
const PARRAINAGE_DEFAUT: ParametresParrainage = {
  actif: true, pourcentFilleul: 5, pourcentParrain: 5, plafondFilleul: 100000, plafondParrain: 100000,
  maxFilleulsParMois: 10,
};
const POURCENT_PARRAINAGE_MAX = 50;
const ALPHABET_PARRAINAGE = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_PARRAINAGE = /^[A-HJ-NP-Z2-9]{6}$/;

function pourcentBorne(valeur: unknown, defaut: number): number {
  const n = Number(valeur);
  if (valeur === undefined || valeur === null || valeur === "" || !Number.isFinite(n)) return defaut;
  return Math.min(POURCENT_PARRAINAGE_MAX, Math.max(0, n));
}
function plafondBorne(valeur: unknown, defaut: number): number {
  const n = Number(valeur);
  if (valeur === undefined || valeur === null || valeur === "" || !Number.isFinite(n)) return defaut;
  return Math.max(0, Math.floor(n));
}

// Relu à chaque usage (jamais mis en cache) : un réglage modifié dans
// l'admin s'applique dès la commande suivante. Valeurs par défaut si le
// document n'existe pas encore.
async function parametresParrainage(): Promise<ParametresParrainage> {
  const d = (await db.collection("parametres").doc("parrainage").get()).data() || {};
  return {
    actif: d.actif === undefined ? PARRAINAGE_DEFAUT.actif : d.actif === true,
    pourcentFilleul: pourcentBorne(d.pourcentFilleul, PARRAINAGE_DEFAUT.pourcentFilleul),
    pourcentParrain: pourcentBorne(d.pourcentParrain, PARRAINAGE_DEFAUT.pourcentParrain),
    plafondFilleul: plafondBorne(d.plafondFilleul, PARRAINAGE_DEFAUT.plafondFilleul),
    plafondParrain: plafondBorne(d.plafondParrain, PARRAINAGE_DEFAUT.plafondParrain),
    maxFilleulsParMois: Math.min(1000, plafondBorne(d.maxFilleulsParMois, PARRAINAGE_DEFAUT.maxFilleulsParMois)),
  };
}

// pourcent % de base, arrondi à la centaine de GNF inférieure, plafonné.
function montantPourcent(base: number, pourcent: number, plafond: number): number {
  if (!(base > 0) || !(pourcent > 0)) return 0;
  const brut = Math.floor((base * pourcent) / 100 / 100) * 100;
  return Math.max(0, Math.min(brut, plafond));
}

// « bk7 m2q », « https://bokki.shop/?parrain=BK7M2Q » → « BK7M2Q ».
function normaliserCodeParrainage(valeur: unknown): string {
  let brut = String(valeur ?? "").trim().slice(0, 300);
  const lien = brut.match(/[?&]parrain=([^&#\s]+)/i);
  if (lien) {
    try { brut = decodeURIComponent(lien[1]); } catch { brut = lien[1]; } // « %E0 » mal formé : jamais d'erreur
  }
  return brut.toUpperCase().replace(/[\s-]/g, "").slice(0, 20);
}

function nouveauCodeParrainage(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += ALPHABET_PARRAINAGE[crypto.randomInt(0, ALPHABET_PARRAINAGE.length)];
  return code;
}

// Code du client (créé s'il n'en a pas encore). Transaction : deux appels
// simultanés ne peuvent pas créer deux codes pour le même compte, ni deux
// comptes recevoir le même code (l'index est relu dans la transaction).
async function obtenirCodeParrainage(uid: string): Promise<string> {
  const clientRef = db.collection("clients").doc(uid);
  return db.runTransaction(async (tx) => {
    const client = await tx.get(clientRef);
    const existant = client.data()?.codeParrainage;
    if (typeof existant === "string" && CODE_PARRAINAGE.test(existant)) return existant;
    for (let essai = 0; essai < 8; essai++) {
      const code = nouveauCodeParrainage();
      const indexRef = db.collection("codesParrainage").doc(code);
      if ((await tx.get(indexRef)).exists) continue;
      tx.set(indexRef, { uid, dateCreation: FieldValue.serverTimestamp() });
      tx.set(clientRef, { codeParrainage: code }, { merge: true });
      return code;
    }
    throw new HttpsError("resource-exhausted", "Code de parrainage indisponible pour le moment. Réessayez.");
  });
}

// Formats sous lesquels un même numéro a pu être enregistré sur une commande
// (« +224622… » envoyé par le site actuel, anciennes saisies sans « + »).
function variantesTelephone(cle: string): string[] {
  const v = new Set<string>(["+" + cle, cle]);
  if (cle.startsWith("224") && cle.length === 12) {
    const local = cle.slice(3);
    v.add(local);
    v.add(local.replace(/(\d{3})(\d{2})(\d{2})(\d{2})/, "$1 $2 $3 $4"));
    v.add("00" + cle);
  }
  return [...v].slice(0, 10);
}

// ---------------------------------------------------------------------------
// Anti-triche du parrainage (un client avec plusieurs puces qui se parraine
// lui-même). Tout est décidé ici, jamais côté navigateur :
//  1. le parrain doit avoir au moins une commande LIVRÉE (hors corbeille),
//     sur son compte ou sur un de ses numéros ;
//  2. même appareil : identifiant aléatoire gardé par le navigateur
//     (localStorage « bokki-appareil »), envoyé avec chaque commande et à la
//     connexion, mémorisé sur la commande (appareil) et sur le profil
//     (clients/{uid}.appareils, 10 derniers) ;
//  3. même adresse (ville + quartier + repère normalisés), ou même prénom
//     dans le même quartier, que le profil du parrain ou ses commandes
//     récentes ;
//  → refus poli : la commande passe sans réduction.
//  4. signaux faibles (même ville et même quartier, numéro de la même
//     tranche, même adresse IP — conservée seulement hachée) : réduction
//     accordée, mais commande marquée parrainageAVerifier + parrainageRaison
//     pour l'agent qui appelle le client (il peut annuler la réduction,
//     voir annulerReductionParrainage) ;
//  5. plafond de filleuls récompensés par parrain et par mois
//     (maxFilleulsParMois), appliqué à la livraison (suiviParrainageCommande).
// ---------------------------------------------------------------------------
const MESSAGE_PARRAINAGE_IMPOSSIBLE = "Ce code de parrainage ne peut pas être utilisé pour cette commande : votre commande est enregistrée sans réduction.";
const MESSAGE_PARRAIN_INACTIF = "Ce code n’est pas encore actif : votre commande est enregistrée sans réduction.";
const APPAREILS_MAX = 10;
const IPS_MAX = 10;
const ADRESSES_PARRAIN_MAX = 20;

// Identifiant d'appareil envoyé par le navigateur (UUID, ou repli
// hexadécimal) : borné et validé, null sinon.
const FORMAT_APPAREIL = /^[a-z0-9-]{16,64}$/;
function appareilValide(valeur: unknown): string | null {
  const v = String(valeur ?? "").trim().toLowerCase();
  return FORMAT_APPAREIL.test(v) ? v : null;
}

// Empreinte de l'adresse IP de l'appel (jamais l'adresse elle-même).
function empreinteIp(request: { rawRequest?: { ip?: string } }): string | null {
  const ip = request.rawRequest?.ip;
  if (!ip) return null;
  return crypto.createHmac("sha256", "bokki-parrainage-ip").update(ip).digest("hex").slice(0, 32);
}

// « Kipé  Centre », « kipe-centre », « KIPÉ centre. » → « kipe centre ».
function texteNormalise(valeur: unknown): string {
  return String(valeur ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().slice(0, 300);
}

interface AdresseComparable { ville: string; quartier: string; repere: string; prenom: string }
function adresseComparable(ville: unknown, quartier: unknown, repere: unknown, nom: unknown): AdresseComparable {
  return {
    ville: texteNormalise(ville),
    quartier: texteNormalise(quartier),
    repere: texteNormalise(repere),
    prenom: texteNormalise(nom).split(" ")[0] || "",
  };
}

// Proximité entre l'adresse du filleul et une adresse du parrain :
//  « identique » (même ville, quartier et repère, repère renseigné) ;
//  « prenom-quartier » (même prénom dans la même ville et le même quartier) ;
//  « quartier » (même ville et même quartier seulement : signal faible) ;
//  null sinon.
type ProximiteAdresse = "identique" | "prenom-quartier" | "quartier" | null;
function comparerAdresses(f: AdresseComparable, p: AdresseComparable): ProximiteAdresse {
  if (!f.ville || !f.quartier || f.ville !== p.ville || f.quartier !== p.quartier) return null;
  if (f.repere && f.repere === p.repere) return "identique";
  if (f.prenom && f.prenom === p.prenom) return "prenom-quartier";
  return "quartier";
}

// Deux numéros (clés « 224622123456 ») différents mais de la même tranche
// (seuls les 3 derniers chiffres changent : puces achetées ensemble).
function memeTranche(a: string, b: string): boolean {
  return !!a && !!b && a !== b && a.length === b.length && a.length >= 9 && a.slice(0, -3) === b.slice(0, -3);
}

// Mémorise l'appareil et l'empreinte IP sur le profil (plus récents en
// tête, listes courtes). N'écrit que si quelque chose change ; ne lève
// jamais (simple information pour l'anti-triche).
async function memoriserAppareil(uid: string, appareil: string | null, ipHash: string | null): Promise<void> {
  if (!appareil && !ipHash) return;
  try {
    const ref = db.collection("clients").doc(uid);
    const d = (await ref.get()).data() || {};
    const liste = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") as string[] : []);
    const appareils = liste(d.appareils);
    const ips = liste(d.ipsHachees);
    const champs: Record<string, unknown> = {};
    if (appareil && appareils[0] !== appareil) {
      champs.appareils = [appareil, ...appareils.filter((x) => x !== appareil)].slice(0, APPAREILS_MAX);
    }
    if (ipHash && ips[0] !== ipHash) {
      champs.ipsHachees = [ipHash, ...ips.filter((x) => x !== ipHash)].slice(0, IPS_MAX);
    }
    if (Object.keys(champs).length) await ref.set(champs, { merge: true });
  } catch (e) {
    logger.error("Appareil non mémorisé :", e);
  }
}

// Commandes (hors corbeille) d'un compte : par uid et par ses numéros.
async function commandesDuCompte(uid: string, tels: string[]): Promise<FirebaseFirestore.DocumentData[]> {
  const variantes = [...new Set(tels.flatMap((t) => variantesTelephone(t)))].slice(0, 30);
  const [parUid, parTel] = await Promise.all([
    db.collection("commandes").where("uid", "==", uid).limit(50).get(),
    variantes.length ? db.collection("commandes").where("clientTel", "in", variantes).limit(50).get() : Promise.resolve(null),
  ]);
  const vues = new Map<string, FirebaseFirestore.DocumentData>();
  for (const d of [...parUid.docs, ...(parTel?.docs || [])]) {
    if (d.data().corbeille !== true) vues.set(d.id, d.data());
  }
  return [...vues.values()];
}

// Numéro VÉRIFIÉ d'un compte : seulement celui du compte téléphone
// (tel_<numéro>, protégé par le mot de passe). Le téléphone de livraison du
// profil est déclaratif : il ne doit pas suffire à activer un parrainage
// avec les commandes livrées de quelqu'un d'autre (audit sécurité, point 6).
function telsVerifies(uid: string): string[] {
  const cle = uid.startsWith("tel_") ? cleTelephone("+" + uid.slice(4)) : null;
  return cle ? [cle] : [];
}

// Numéros connus d'un profil client (clés sans « + »).
function telsDuProfil(p: FirebaseFirestore.DocumentData, uid: string): string[] {
  const tels = [p.telephone, p.telephoneLivraison].map((t) => cleTelephone(t)).filter(Boolean) as string[];
  if (uid.startsWith("tel_")) {
    const cle = cleTelephone("+" + uid.slice(4));
    if (cle) tels.push(cle);
  }
  return [...new Set(tels)];
}

// Code « actif » : au moins une commande livrée (hors corbeille).
function aUneCommandeLivree(commandes: FirebaseFirestore.DocumentData[]): boolean {
  return commandes.some((c) => c.statut === "livree");
}

// Ce que l'on sait du filleul au moment de la commande.
interface ContexteFilleul {
  clientNom: string; ville: string; quartier: string; repere: string;
  appareil: string | null; ipHash: string | null;
}

type VerificationParrainage =
  | { ok: true; code: string; parrainUid: string; cle: string; reduction: number; pourcent: number; aVerifier: string[] }
  | { ok: false; code: string; message: string; motif: string };

// Vérifications hors transaction (requêtes). La seule course possible
// (deux premières commandes simultanées) est fermée par parrainages/{cle},
// créé dans la transaction de la commande. « motif » : raison interne,
// enregistrée sur la commande pour l'admin, jamais montrée au client.
async function verifierParrainage(
  code: string,
  clientTel: string,
  uidConnecte: string | null,
  montantArticles: number,
  params: ParametresParrainage,
  ctx: ContexteFilleul
): Promise<VerificationParrainage> {
  const refus = (message: string, motif: string): VerificationParrainage => ({ ok: false, code, message, motif });
  if (!params.actif) return refus("Le parrainage n’est pas disponible pour le moment : votre commande est enregistrée sans réduction.", "parrainage désactivé");
  if (!CODE_PARRAINAGE.test(code)) return refus("Code de parrainage inconnu : votre commande est enregistrée sans réduction.", "code inconnu");
  const cle = cleTelephone(clientTel);
  if (!cle) return refus("Code de parrainage non appliqué (numéro de téléphone non reconnu).", "numéro non reconnu");
  const indexSnap = await db.collection("codesParrainage").doc(code).get();
  const parrainUid = String(indexSnap.data()?.uid || "");
  if (!parrainUid) return refus("Code de parrainage inconnu : votre commande est enregistrée sans réduction.", "code inconnu");
  if (parrainUid === uidConnecte || parrainUid === `tel_${cle}`) {
    return refus("Vous ne pouvez pas utiliser votre propre code de parrainage.", "son propre code");
  }
  const variantes = variantesTelephone(cle);
  const [parrainSnap, parTel, parUid, dejaParraine] = await Promise.all([
    db.collection("clients").doc(parrainUid).get(),
    db.collection("commandes").where("clientTel", "in", variantes).limit(20).get(),
    uidConnecte ? db.collection("commandes").where("uid", "==", uidConnecte).limit(20).get() : Promise.resolve(null),
    db.collection("parrainages").doc(cle).get(),
  ]);
  const p = parrainSnap.data() || {};
  const telsParrain = telsDuProfil(p, parrainUid);
  if (telsParrain.includes(cle)) return refus("Vous ne pouvez pas utiliser votre propre code de parrainage.", "son propre code (même numéro)");
  const anciennes = [...parTel.docs, ...(parUid?.docs || [])].filter((d) => d.data().corbeille !== true);
  if (anciennes.length || dejaParraine.exists) {
    return refus("Le code de parrainage est réservé à la première commande : votre commande est enregistrée sans réduction.", "pas une première commande");
  }

  // 1. Le parrain doit être un vrai client (une commande livrée).
  const commandesParrain = await commandesDuCompte(parrainUid, telsVerifies(parrainUid));
  if (!aUneCommandeLivree(commandesParrain)) return refus(MESSAGE_PARRAIN_INACTIF, "le parrain n’a encore aucune commande livrée");

  // 2. Même appareil que le parrain.
  if (ctx.appareil) {
    const appareilsParrain = new Set<string>([
      ...(Array.isArray(p.appareils) ? p.appareils : []),
      ...commandesParrain.map((c) => c.appareil),
    ].filter((x) => typeof x === "string"));
    if (appareilsParrain.has(ctx.appareil)) return refus(MESSAGE_PARRAINAGE_IMPOSSIBLE, "même appareil (téléphone ou navigateur) que le parrain");
  }

  // 3. Même adresse / même personne (profil + commandes récentes).
  const filleul = adresseComparable(ctx.ville, ctx.quartier, ctx.repere, ctx.clientNom);
  const recentes = [...commandesParrain]
    .sort((a, b) => (b.dateCreation?.toMillis?.() || 0) - (a.dateCreation?.toMillis?.() || 0))
    .slice(0, ADRESSES_PARRAIN_MAX);
  const adressesParrain = [
    adresseComparable(p.region, p.quartier, p.repere, p.nom),
    ...recentes.map((c) => adresseComparable(c.ville, c.quartier, c.repere, c.clientNom)),
  ];
  const proximites = new Set(adressesParrain.map((a) => comparerAdresses(filleul, a)));
  if (proximites.has("identique")) return refus(MESSAGE_PARRAINAGE_IMPOSSIBLE, "même adresse de livraison que le parrain (ville, quartier, repère)");
  // Même prénom + même quartier : signal seulement (prénoms très courants en
  // Guinée, un refus pénaliserait de vrais voisins homonymes).

  // 4. Signaux faibles : parrainage accepté, contrôle humain demandé.
  const aVerifier: string[] = [];
  if (proximites.has("prenom-quartier")) aVerifier.push("même prénom, même ville et même quartier que le parrain");
  else if (proximites.has("quartier")) aVerifier.push("même ville et même quartier que le parrain");
  const clesParrain = new Set<string>([...telsParrain, ...commandesParrain.map((c) => cleTelephone(c.clientTel) || "")].filter(Boolean));
  if ([...clesParrain].some((t) => memeTranche(t, cle))) aVerifier.push("numéro très proche de celui du parrain (même tranche)");
  if (ctx.ipHash) {
    const ipsParrain = new Set<string>([
      ...(Array.isArray(p.ipsHachees) ? p.ipsHachees : []),
      ...commandesParrain.map((c) => c.ipHash),
    ].filter((x) => typeof x === "string"));
    if (ipsParrain.has(ctx.ipHash)) aVerifier.push("même connexion internet (adresse IP) que le parrain");
  }
  return {
    ok: true, code, parrainUid, cle,
    reduction: montantPourcent(montantArticles, params.pourcentFilleul, params.plafondFilleul),
    pourcent: params.pourcentFilleul,
    aVerifier,
  };
}

interface ReductionsCommande {
  codeLivraison: string;
  reductionParrainage: number;
  pourcentParrainage: number;
  reductionCredit: number;
  parrainageRefuse: string | null;
}

// Variante transactionnelle de ecrireCommandeAvecCode, utilisée seulement
// quand une réduction est en jeu (code de parrainage valide ou crédit
// disponible) : la commande, son code de livraison, le marqueur
// parrainages/{cle} et le débit du crédit sont écrits ensemble, ou pas du
// tout. Le code de livraison est relu dans la transaction (pas de create()
// qui échouerait sans distinguer quelle écriture est en conflit).
async function ecrireCommandeAvecReductions(
  longueur: number,
  commandeRef: FirebaseFirestore.DocumentReference,
  donnees: Record<string, unknown> & { montantTotal: number },
  parrainage: Extract<VerificationParrainage, { ok: true }> | null,
  uidCredit: string | null
): Promise<ReductionsCommande> {
  for (let tentative = 0; tentative < 40; tentative++) {
    const code = genererCodeChiffres(longueur);
    const resultat = await db.runTransaction(async (tx): Promise<ReductionsCommande | null> => {
      const codeRef = db.collection("codesActifs").doc(code);
      const parrainageRef = parrainage ? db.collection("parrainages").doc(parrainage.cle) : null;
      const clientRef = uidCredit ? db.collection("clients").doc(uidCredit) : null;
      // Toutes les lectures avant les écritures.
      const [codeSnap, parrainageSnap, clientSnap] = await Promise.all([
        tx.get(codeRef),
        parrainageRef ? tx.get(parrainageRef) : Promise.resolve(null),
        clientRef ? tx.get(clientRef) : Promise.resolve(null),
      ]);
      if (codeSnap.exists) return null; // code déjà pris : on en tire un autre
      let parrainageRefuse: string | null = null;
      const parrainageOk = !!parrainage && !parrainageSnap?.exists;
      if (parrainage && !parrainageOk) {
        parrainageRefuse = "Le code de parrainage est réservé à la première commande : votre commande est enregistrée sans réduction.";
      }
      const total = donnees.montantTotal;
      const reductionParrainage = parrainageOk ? Math.min(parrainage!.reduction, total) : 0;
      const creditDispo = Math.max(0, Math.floor(Number(clientSnap?.data()?.creditParrainage) || 0));
      const reductionCredit = Math.min(creditDispo, total - reductionParrainage);

      tx.create(codeRef, { commandeId: commandeRef.id, dateCreation: FieldValue.serverTimestamp() });
      if (parrainageOk) {
        tx.create(parrainageRef!, {
          parrainUid: parrainage!.parrainUid, code: parrainage!.code,
          commandeId: commandeRef.id, uid: donnees.uid ?? null,
          dateCreation: FieldValue.serverTimestamp(),
        });
      }
      if (reductionCredit > 0) {
        tx.update(clientRef!, { creditParrainage: creditDispo - reductionCredit });
      }
      const champs: Record<string, unknown> = {};
      if (parrainageOk) {
        Object.assign(champs, {
          codeParrainage: parrainage!.code, parrainUid: parrainage!.parrainUid,
          reductionParrainage, pourcentParrainage: parrainage!.pourcent,
        });
        // Signal faible (voir « Anti-triche du parrainage ») : l'agent
        // vérifie avant la livraison et peut annuler la réduction.
        if (parrainage!.aVerifier.length) {
          champs.parrainageAVerifier = true;
          champs.parrainageRaison = parrainage!.aVerifier.join(" ; ");
        }
      } else if (parrainage) {
        champs.parrainageRefus = { code: parrainage.code, motif: "numéro déjà parrainé (commande simultanée)" };
      }
      if (reductionCredit > 0) champs.reductionCredit = reductionCredit;
      if (reductionParrainage + reductionCredit > 0) champs.reductionTotale = reductionParrainage + reductionCredit;
      tx.set(commandeRef, { ...donnees, ...champs, codeLivraison: code });
      return {
        codeLivraison: code, reductionParrainage,
        pourcentParrainage: parrainageOk ? parrainage!.pourcent : 0,
        reductionCredit, parrainageRefuse,
      };
    });
    if (resultat) return resultat;
  }
  throw new HttpsError("resource-exhausted", "Impossible de générer un code de livraison unique, réessaie.");
}

export const creerCommande = onCall<CreerCommandeData>({ maxInstances: 10, enforceAppCheck: EXIGER_APP_CHECK }, async (request) => {
  if (estPrechauffage(request.data)) return { pret: true };
  const idEnvoi = String(request.data?.idEnvoi ?? "").trim();
  const avecIdEnvoi = ID_ENVOI.test(idEnvoi);
  // Nouvelle tentative d'un envoi déjà abouti : même réponse, aucune
  // nouvelle commande (ni nouveau compte, ni compteur anti-abus).
  if (avecIdEnvoi) {
    const snap = await db.collection("envoisCommandes").doc(idEnvoi).get();
    const d = snap.data();
    if (d?.etat === "fait") {
      const jeton = d.compteCree && d.uid && !request.auth ? await getAuth().createCustomToken(d.uid, { client: true }) : null;
      return { ...d.recap, jetonConnexion: jeton };
    }
  }
  // Le contrôle anti-abus part en parallèle des lectures ci-dessous (qui
  // n'écrivent rien) : il est attendu avant toute écriture.
  const limite = limiterAppelPublic(request, "commande", 60, 60 * 60 * 1000);
  limite.catch(() => undefined); // évite un rejet non géré si une validation échoue avant
  const data = request.data;

  const clientNom = champBorne(data.clientNom, LIMITES_TEXTE.nom);
  const clientTel = champBorne(data.clientTel, LIMITES_TEXTE.tel);
  // Comptes clients (refonte phase 6) : client connecté (Google ou
  // téléphone) → commande rattachée à son uid. Client non connecté qui a
  // choisi un code personnel à l'étape 1 → le compte est créé ici, avec la
  // commande, et un jeton de connexion est renvoyé.
  const uidConnecte = request.auth?.uid || null;
  const codePersonnel = String((data as { codePersonnel?: unknown }).codePersonnel ?? "").trim();
  if (!uidConnecte && codePersonnel) {
    if (!/^\d{4}$/.test(codePersonnel)) throw new HttpsError("invalid-argument", "Le mot de passe doit faire 4 chiffres.");
    if (codeTropSimple(codePersonnel)) throw new HttpsError("invalid-argument", "Ce mot de passe est trop simple. Choisissez-en un autre.");
  }
  // Au plus 5 commandes par numéro en 24 h (audit sécurité, point 5) :
  // la limite par IP seule se contourne en changeant d'adresse.
  // Un même envoi renvoyé après une coupure (même idEnvoi) ne compte qu'une fois.
  await limiterCommandesTelephone(String(clientTel), String((data as { idEnvoi?: unknown }).idEnvoi ?? ""));
  const ville = champBorne(data.ville, LIMITES_TEXTE.ville);
  const quartier = champBorne(data.quartier, LIMITES_TEXTE.quartier);
  const repere = champBorne(data.repere, LIMITES_TEXTE.repere);

  if (!clientNom) throw new HttpsError("invalid-argument", "Le prénom est obligatoire.");
  if (!clientTel) throw new HttpsError("invalid-argument", "Le numéro de téléphone est obligatoire.");
  // Téléphone : au moins 6 chiffres (indicatif + numéro guinéen court accepté),
  // caractères de mise en forme tolérés (+, espaces, tirets, parenthèses).
  if ((clientTel.match(/\d/g) || []).length < 6 || !/^[\d+\s().-]+$/.test(clientTel)) {
    throw new HttpsError("invalid-argument", "Numéro de téléphone invalide.");
  }
  if (!ville) throw new HttpsError("invalid-argument", "Indiquez votre ville.");
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

  // Zone de livraison (admin, collection « zones ») : délai estimé et,
  // si renseigné, frais. Correspondance sur la ville tapée par le client,
  // sinon sur la région déduite (regionDeVille), insensible aux accents,
  // à la casse, aux espaces et aux tirets. Anciennes commandes / anciens
  // clients : ville = une des 8 régions, qui reste reconnue telle quelle.
  const region = regionDeVille(ville);
  // Lectures indépendantes en parallèle (avant : l'une après l'autre).
  const [, zonesSnap, articles, longueurCode] = await Promise.all([
    limite,
    db.collection("zones").get(),
    Promise.all(articlesInput.map(resoudreArticle)),
    longueurCodeConfiguree(),
  ]);
  const zonesListe = zonesSnap.docs.map((d) => d.data());
  const zone = zonesListe.find((z) => cleVille(z.ville) === cleVille(ville))
    || (region ? zonesListe.find((z) => cleVille(z.ville) === cleVille(region)) : undefined);

  const montantTotal = articles.reduce((somme, a) => somme + a.prixInitial, 0);
  if (!Number.isSafeInteger(montantTotal) || montantTotal <= 0) {
    throw new HttpsError("failed-precondition", "Le montant total de la commande est invalide.");
  }
  const produitIds = [...new Set(articles.map((a) => a.produitId))];

  // Parrainage (voir le bloc « Parrainage » plus haut) et crédit du client
  // connecté : lectures seulement, avant toute écriture. Une erreur ici ne
  // doit jamais empêcher la commande : on continue alors sans réduction.
  const codeParrainage = normaliserCodeParrainage(data.codeParrainage);
  const appareil = appareilValide(data.appareil);
  const ipHash = empreinteIp(request);
  let verification: VerificationParrainage | null = null;
  let creditConnu = 0;
  try {
    const [params, clientSnap] = await Promise.all([
      codeParrainage ? parametresParrainage() : Promise.resolve(null),
      uidConnecte ? db.collection("clients").doc(uidConnecte).get() : Promise.resolve(null),
    ]);
    creditConnu = Math.max(0, Math.floor(Number(clientSnap?.data()?.creditParrainage) || 0));
    if (codeParrainage && params) {
      verification = await verifierParrainage(codeParrainage, clientTel, uidConnecte, montantTotal, params, {
        clientNom, ville, quartier, repere, appareil, ipHash,
      });
    }
  } catch (e) {
    logger.error("Parrainage non vérifié :", e);
    if (codeParrainage) verification = { ok: false, code: codeParrainage, message: "Le code de parrainage n’a pas pu être vérifié : votre commande est enregistrée sans réduction.", motif: "vérification impossible (erreur serveur)" };
  }

  // Délai affiché au client : celui configuré pour sa région si l'admin l'a
  // renseigné, sinon un repli générique.
  const DELAI_PAR_DEFAUT = "3 jours";

  const commandeRef = db.collection("commandes").doc();

  // Commande sans perte : réservation de idEnvoi juste avant les écritures.
  if (avecIdEnvoi) {
    const dejaFait = await reserverEnvoi(idEnvoi);
    if (dejaFait.etat === "fait") {
      const jeton = dejaFait.compteCree && dejaFait.uid && !request.auth ? await getAuth().createCustomToken(dejaFait.uid, { client: true }) : null;
      return { ...dejaFait.recap, jetonConnexion: jeton };
    }
  }
  try {
  // Compte à créer avec cette commande (client non connecté + code choisi).
  let uidCommande: string | null = uidConnecte;
  let jetonConnexion: string | null = null;
  if (!uidConnecte && codePersonnel) {
    const cle = cleTelephone(clientTel);
    if (!cle) throw new HttpsError("invalid-argument", "Numéro de téléphone invalide.");
    uidCommande = await creerCompteTelephone(cle, codePersonnel);
    jetonConnexion = await getAuth().createCustomToken(uidCommande, { client: true });
  }

  // Numéro dérivé de l'ID (aucune contention) + code réservé atomiquement :
  // voir le bloc de commentaires plus haut.
  const numero = numeroDepuisId(commandeRef.id);
  const delaiEstime = (zone && zone.delai) || DELAI_PAR_DEFAUT;
  // Frais de livraison : montant saisi dans l'admin pour la zone (champ
  // « frais ») s'il existe, sinon celui de la région déduite (Conakry : 0).
  // Ville inconnue : null + fraisAConfirmer (annoncés par l'agent, saisis
  // ensuite dans l'admin) — surtout pas 0 (livraison gratuite partout).
  const fraisZone = Number(zone?.frais);
  const fraisRegion = region != null ? FRAIS_LIVRAISON_PAR_REGION[region] : undefined;
  const fraisLivraison: number | null = zone?.frais != null && zone.frais !== "" && Number.isSafeInteger(fraisZone) && fraisZone >= 0
    ? fraisZone
    : typeof fraisRegion === "number" ? fraisRegion : null;
  const fraisAConfirmer = fraisLivraison == null;
  // Commande + code de livraison écrits ensemble (un seul aller-retour), sur
  // un doc auto-ID unique : aucune contention avec les autres commandes.
  // Avec une réduction en jeu (parrainage valide, crédit disponible) :
  // transaction, pour que le crédit débité et la commande aillent ensemble.
  const donneesCommande = {
    numero,
    clientNom,
    clientTel,
    ville,
    // Région déduite de la ville tapée (null si inconnue).
    region,
    quartier,
    repere: repere || null,
    uid: uidCommande,
    articles,
    produitIds,
    montantTotal,
    prixConvenu: null,
    livraisonType: "standard",
    fraisLivraison,
    fraisAConfirmer,
    delaiEstime,
    statut: "nouvelle",
    livreurId: null,
    dateCreation: FieldValue.serverTimestamp(),
    dateLivraison: null,
    // Anti-triche du parrainage : appareil et empreinte de l'IP (jamais
    // l'adresse elle-même). Jamais renvoyés au client.
    appareil,
    ipHash,
    // Code refusé : raison interne, visible seulement dans l'admin.
    ...(verification && !verification.ok ? { parrainageRefus: { code: verification.code, motif: verification.motif } } : {}),
  };
  const parrainageValide = verification?.ok ? verification : null;
  const avecReductions = !!parrainageValide || (!!uidConnecte && creditConnu > 0);
  const ecrit: ReductionsCommande = avecReductions
    ? await ecrireCommandeAvecReductions(longueurCode, commandeRef, donneesCommande, parrainageValide, uidConnecte)
    : {
      codeLivraison: await ecrireCommandeAvecCode(longueurCode, commandeRef, donneesCommande),
      reductionParrainage: 0, pourcentParrainage: 0, reductionCredit: 0, parrainageRefuse: null,
    };
  const { codeLivraison, reductionParrainage, pourcentParrainage, reductionCredit } = ecrit;
  // Message affiché au client sur la confirmation (code refusé ou appliqué).
  let parrainage: { applique: boolean; message: string } | null = null;
  if (verification && !verification.ok) parrainage = { applique: false, message: verification.message };
  else if (ecrit.parrainageRefuse) parrainage = { applique: false, message: ecrit.parrainageRefuse };
  else if (parrainageValide) {
    parrainage = {
      applique: true,
      message: reductionParrainage > 0
        ? "Code de parrainage appliqué : la réduction est déduite de votre total."
        : "Code de parrainage enregistré.",
    };
  }

  // Coordonnées mémorisées sur le compte (préremplissage des commandes
  // suivantes). Un échec ici ne doit jamais faire échouer la commande.
  if (uidCommande) {
    const telCle = cleTelephone(clientTel);
    await db.collection("clients").doc(uidCommande).set({
      // « region » : nom de champ historique, contient la VILLE tapée.
      nom: clientNom, region: ville, quartier, repere: repere || null,
      ...(telCle ? { telephoneLivraison: "+" + telCle } : {}),
      derniereCommande: FieldValue.serverTimestamp(),
    }, { merge: true }).catch((e) => logger.error("Profil client non mis à jour :", e));
    await memoriserAppareil(uidCommande, appareil, ipHash);
  }

  // Récapitulatif renvoyé au client (mêmes champs que obtenirSuiviCommande) :
  // la page de confirmation s'affiche aussitôt, sans second appel serveur.
  const recap = {
    id: commandeRef.id,
    numero,
    codeLivraison,
    statut: "nouvelle",
    articles,
    montantTotal,
    prixConvenu: null,
    fraisLivraison,
    fraisAConfirmer,
    delaiEstime,
    reductionParrainage,
    pourcentParrainage,
    reductionCredit,
    parrainage,
  };
  if (avecIdEnvoi) {
    await db.collection("envoisCommandes").doc(idEnvoi).set({
      etat: "fait", recap, uid: uidCommande, compteCree: !!jetonConnexion,
      commandeId: commandeRef.id, fin: FieldValue.serverTimestamp(),
      expireAt: Timestamp.fromMillis(Date.now() + ENVOI_GARDE_MS),
    }).catch((e) => logger.error("Envoi non marqué comme fait :", e));
  }
  return { jetonConnexion, ...recap };
  } catch (err) {
    // Échec avant la fin : la réservation est levée pour qu'une nouvelle
    // tentative puisse aboutir.
    if (avecIdEnvoi) await db.collection("envoisCommandes").doc(idEnvoi).delete().catch(() => undefined);
    throw err;
  }
});

// ---------------------------------------------------------------------------
// Comptes clients (refonte phase 6)
//
// Deux façons de se connecter :
//  • Google : Firebase Auth côté navigateur (fournisseur Google à activer
//    dans la console Firebase) ;
//  • téléphone + code personnel à 4 chiffres : vérifié ICI, puis jeton
//    personnalisé (createCustomToken → signInWithCustomToken). Le compte
//    « tel_<numéro> » est créé à la première commande (creerCommande).
//
// codesClients/{numéro E.164 sans « + »} : { uid, hash, sel, essais,
// bloqueJusqua } — jamais lisible ni modifiable par un client (règles :
// tout refusé). Le code n'est jamais stocké en clair (scrypt + sel).
// 5 essais ratés → blocage (CODE_BLOCAGES_MS, de plus en plus long). Un code de 4 chiffres reste
// devinable hors ligne si la base fuitait : la protection repose sur le
// blocage et le secret de cette collection.
// clients/{uid} : profil (nom, téléphone, région, quartier, repère).
//
// IAM : createCustomToken exige que le compte de service des fonctions ait
// le rôle « Créateur de jetons du compte de service » (signBlob).
// ---------------------------------------------------------------------------
const CODE_ESSAIS_MAX = 5;
// Blocage de plus en plus long à chaque série de 5 erreurs (audit sécurité,
// point 1) : 15 min, 1 h, puis 24 h. Remis à zéro au premier code juste.
// Au plus ~20 essais par jour sur un numéro (≈ 9 900 codes possibles).
const CODE_BLOCAGES_MS = [15 * 60 * 1000, 60 * 60 * 1000, 24 * 3600 * 1000];

// « 622 12 34 56 », « +224622123456 », « 00224… » → « 224622123456 ».
function cleTelephone(valeur: unknown): string | null {
  const brut = String(valeur || "").trim();
  let chiffres = brut.replace(/\D/g, "");
  if (brut.startsWith("+")) return /^\d{8,15}$/.test(chiffres) ? chiffres : null;
  if (chiffres.startsWith("00")) chiffres = chiffres.slice(2);
  if (/^6\d{8}$/.test(chiffres)) return "224" + chiffres;
  if (/^2246\d{8}$/.test(chiffres)) return chiffres;
  return null;
}

// Refuse 0000, 1111, 1234, 4321, 0123, 1212, 1122…
function codeTropSimple(code: string): boolean {
  const d = code.split("").map(Number);
  if (new Set(d).size === 1) return true;
  const pas = d[1] - d[0];
  if ((pas === 1 || pas === -1) && d.every((x, i) => i === 0 || x - d[i - 1] === pas)) return true;
  if (d[0] === d[2] && d[1] === d[3]) return true; // 1212
  if (d[0] === d[1] && d[2] === d[3]) return true; // 1122
  return false;
}

function hacherCode(code: string, sel: string): string {
  return crypto.scryptSync(code, sel, 32, { N: 16384, r: 8, p: 1 }).toString("hex");
}

function codeCorrect(code: string, sel: string, hash: string): boolean {
  const attendu = Buffer.from(hash, "hex");
  const calcule = Buffer.from(hacherCode(code, sel), "hex");
  return attendu.length === calcule.length && crypto.timingSafeEqual(attendu, calcule);
}

// Crée (ou réactive après « code oublié ») le compte téléphone. Échoue si
// un code est déjà défini pour ce numéro : il faut alors se connecter.
async function creerCompteTelephone(cle: string, code: string): Promise<string> {
  const ref = db.collection("codesClients").doc(cle);
  const uid = `tel_${cle}`;
  const sel = crypto.randomBytes(16).toString("hex");
  const hash = hacherCode(code, sel);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.data()?.hash) {
      throw new HttpsError("already-exists", "Ce numéro a déjà un compte Bokki. Entrez votre mot de passe pour continuer.");
    }
    if (snap.exists) {
      throw new HttpsError("failed-precondition", "Votre mot de passe a été réinitialisé. Contactez Bokki sur WhatsApp pour recevoir votre code provisoire.");
    }
    tx.set(ref, { uid: snap.data()?.uid || uid, hash, sel, essais: 0, bloqueJusqua: null, dateMaj: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(db.collection("clients").doc(snap.data()?.uid || uid), {
      telephone: "+" + cle, fournisseur: "telephone", dateCreation: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  return (await ref.get()).data()?.uid || uid;
}

interface IdentifierClientData { telephone: string; code: string; prechauffage?: boolean; appareil?: string; }

// Étape 1 de la commande et page Connexion.
//  → { etat: "connecte", jeton } : code correct ;
//  → { etat: "nouveau" } : aucun compte pour ce numéro (le code choisi est
//    valable ; le compte sera créé avec la première commande) ;
//  → { etat: "reinitialise", jeton } : un agent a réinitialisé le code, le
//    nouveau code saisi est enregistré.
export const identifierClient = onCall<IdentifierClientData>({ maxInstances: 10, enforceAppCheck: EXIGER_APP_CHECK }, async (request) => {
  if (estPrechauffage(request.data)) return { pret: true };
  await limiterAppelPublic(request, "identification", 30, 10 * 60 * 1000);
  const cle = cleTelephone(request.data?.telephone);
  const code = String(request.data?.code ?? "").trim();
  if (!cle) throw new HttpsError("invalid-argument", "Numéro de téléphone invalide.");
  if (!/^\d{4}$/.test(code)) throw new HttpsError("invalid-argument", "Le mot de passe doit faire 4 chiffres.");
  const ref = db.collection("codesClients").doc(cle);
  const snap = await ref.get();
  const d = snap.data();
  if (!snap.exists || !d?.hash) {
    if (codeTropSimple(code)) throw new HttpsError("invalid-argument", "Ce mot de passe est trop simple (ex. 1234, 0000). Choisissez-en un autre.");
    if (!snap.exists) return { etat: "nouveau" };
    // Ancien état « réinitialisé sans code » (avant le code provisoire) :
    // plus repris par le premier venu (audit sécurité, point 2).
    throw new HttpsError("failed-precondition", "Votre mot de passe a été réinitialisé. Contactez Bokki sur WhatsApp pour recevoir votre code provisoire.");
  }
  // Vérification + compteur d'essais dans une transaction (deux essais
  // simultanés ne peuvent pas contourner la limite).
  const resultat = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const v = s.data()!;
    const maintenant = Date.now();
    const bloque = v.bloqueJusqua?.toMillis?.() || 0;
    if (bloque > maintenant) {
      return { bloque: Math.ceil((bloque - maintenant) / 60000) };
    }
    if (codeCorrect(code, v.sel, v.hash)) {
      tx.update(ref, { essais: 0, bloqueJusqua: null, blocages: 0 });
      return { uid: String(v.uid) };
    }
    const essais = (Number(v.essais) || 0) + 1;
    if (essais >= CODE_ESSAIS_MAX) {
      const blocages = Number(v.blocages) || 0;
      const duree = CODE_BLOCAGES_MS[Math.min(blocages, CODE_BLOCAGES_MS.length - 1)];
      tx.update(ref, { essais: 0, blocages: blocages + 1, bloqueJusqua: new Date(maintenant + duree) });
      return { bloque: Math.ceil(duree / 60000) };
    }
    tx.update(ref, { essais });
    return { restants: CODE_ESSAIS_MAX - essais };
  });
  if ("bloque" in resultat) {
    const minutes = resultat.bloque ?? 15;
    const attente = minutes >= 120 ? `${Math.round(minutes / 60)} h` : `${minutes} min`;
    throw new HttpsError("resource-exhausted", `Trop d'essais. Réessayez dans ${attente}, ou demandez « Code oublié ».`);
  }
  if ("restants" in resultat) {
    throw new HttpsError("permission-denied", `Mot de passe incorrect. Encore ${resultat.restants} essai${(resultat.restants ?? 0) > 1 ? "s" : ""}.`);
  }
  await memoriserAppareil(resultat.uid!, appareilValide(request.data?.appareil), empreinteIp(request));
  return { etat: "connecte", jeton: await getAuth().createCustomToken(resultat.uid!, { client: true }) };
});

interface ProfilClientData {
  maj?: { nom?: string; region?: string; quartier?: string; repere?: string; telephone?: string };
  // true : renvoie aussi le bloc parrainage (code créé à la première demande).
  parrainage?: boolean;
  // Identifiant aléatoire de l'appareil (anti-triche du parrainage).
  appareil?: string;
}

// Profil du client connecté (lecture, et modification des coordonnées).
export const profilClient = onCall<ProfilClientData>({ maxInstances: 10, enforceAppCheck: EXIGER_APP_CHECK }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Connectez-vous pour voir votre compte.");
  const ref = db.collection("clients").doc(uid);
  const maj = request.data?.maj;
  if (maj) {
    const champs: Record<string, unknown> = {};
    if (maj.nom !== undefined) champs.nom = champBorne(maj.nom, LIMITES_TEXTE.nom);
    if (maj.quartier !== undefined) champs.quartier = champBorne(maj.quartier, LIMITES_TEXTE.quartier);
    if (maj.repere !== undefined) champs.repere = champBorne(maj.repere, LIMITES_TEXTE.repere) || null;
    // « region » : nom de champ historique, contient désormais la VILLE
    // écrite librement par le client (ou une des 8 régions, anciens profils).
    if (maj.region !== undefined) {
      const ville = champBorne(maj.region, LIMITES_TEXTE.ville);
      if (ville.length < 2) throw new HttpsError("invalid-argument", "Indiquez votre ville.");
      champs.region = ville;
    }
    if (maj.telephone !== undefined) {
      const cle = cleTelephone(maj.telephone);
      if (!cle) throw new HttpsError("invalid-argument", "Numéro de téléphone invalide.");
      champs.telephoneLivraison = "+" + cle;
    }
    await ref.set({ ...champs, dateMaj: FieldValue.serverTimestamp() }, { merge: true });
  }
  // Code de parrainage créé à la première demande (page Mon compte).
  const avecParrainage = request.data?.parrainage === true;
  const [, params] = await Promise.all([
    avecParrainage ? obtenirCodeParrainage(uid) : Promise.resolve(null),
    avecParrainage ? parametresParrainage() : Promise.resolve(null),
    memoriserAppareil(uid, appareilValide(request.data?.appareil), empreinteIp(request)),
  ]);
  const p = (await ref.get()).data() || {};
  // Code actif seulement après une première commande livrée (anti-triche).
  // Erreur de lecture : on n'affiche pas la mention plutôt que d'échouer.
  const codeActif = avecParrainage
    ? await commandesDuCompte(uid, telsVerifies(uid)).then(aUneCommandeLivree).catch(() => true)
    : true;
  const parrainage = avecParrainage && params ? {
    code: p.codeParrainage || null,
    lien: p.codeParrainage ? `${SITE_URL}/?parrain=${p.codeParrainage}` : null,
    actif: params.actif,
    pourcentFilleul: params.pourcentFilleul,
    pourcentParrain: params.pourcentParrain,
    plafondFilleul: params.plafondFilleul,
    plafondParrain: params.plafondParrain,
    // false : « Votre code sera actif après votre première commande livrée ».
    codeActif,
    filleulsLivres: Math.max(0, Number(p.nbFilleulsLivres) || 0),
    gains: Math.max(0, Number(p.gainsParrainage) || 0),
  } : null;
  return {
    uid,
    fournisseur: uid.startsWith("tel_") ? "telephone" : "google",
    nom: p.nom || request.auth?.token?.name || "",
    email: request.auth?.token?.email || null,
    telephone: p.telephone || null,
    telephoneLivraison: p.telephoneLivraison || p.telephone || null,
    region: p.region || "",
    quartier: p.quartier || "",
    repere: p.repere || "",
    // Crédit parrainage disponible (déduit de la prochaine commande).
    creditParrainage: Math.max(0, Math.floor(Number(p.creditParrainage) || 0)),
    // Déjà commandé : le champ « code de parrainage » n'est plus proposé.
    aDejaCommande: !!p.derniereCommande,
    parrainage,
  };
});

// Commandes rattachées au compte connecté (projection identique au suivi).
// Requête d'égalité sur un seul champ (uid) : index automatique ; tri côté
// serveur en mémoire (50 au plus), pas d'index composite.
export const mesCommandesClient = onCall({ maxInstances: 10, enforceAppCheck: EXIGER_APP_CHECK }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Connectez-vous pour voir vos commandes.");
  const snap = await db.collection("commandes").where("uid", "==", uid).limit(50).get();
  const commandes = snap.docs
    .filter((d) => d.data().corbeille !== true)
    .map((d) => {
      const c = d.data();
      return {
        id: d.id,
        numero: c.numero || "", codeLivraison: c.codeLivraison, statut: c.statut,
        ...fraisPublics(c),
        articles: articlesDeCommande(c).map((a) => ({
          produitId: a.produitId || null,
          nom: String(a.nom || "").slice(0, 200),
          image: typeof (a as any).image === "string" ? (a as any).image : null,
          varianteLibelle: String((a as any).varianteLibelle || "").slice(0, 200),
          quantite: Number(a.quantite) || 1,
          prixInitial: Number((a as any).prixInitial) || 0,
        })),
        montantTotal: Number(c.montantTotal) || Number(c.prixInitial) || 0,
        prixConvenu: c.prixConvenu ?? null, delaiEstime: c.delaiEstime || "",
        ...reductionsPubliques(c),
        telephone: c.clientTel || "",
        dateCreation: c.dateCreation?.toDate?.().toISOString() || null,
        dateLivraison: c.dateLivraison?.toDate?.().toISOString() || null,
      };
    })
    .sort((a, b) => String(b.dateCreation || "").localeCompare(String(a.dateCreation || "")));
  return { commandes };
});

// ---------------------------------------------------------------------------
// Connexion par passkey (WebAuthn : Face ID / Touch ID, empreinte ou
// verrouillage de l'écran Android, Windows Hello)
//
// Le client connecté (Google ou téléphone) enregistre depuis « Mon compte »
// une clé d'accès « découvrable » (resident key) liée à bokki.shop. Ensuite,
// sur la page Connexion, le téléphone la propose sans rien taper : la
// signature est vérifiée ICI, puis jeton personnalisé (mêmes claims que
// identifierClient) → signInWithCustomToken, comme la connexion téléphone.
//
// passkeys/{credentialId base64url} : { uid, publicKey (base64url), counter,
//   transports, appareil (libellé lisible), aaguid, sauvegardee,
//   dateCreation, derniereUtilisation }. L'ID du document est l'identifiant
//   de la clé : retrouvée directement à la connexion, sans index.
// webauthnChallenges/{id aléatoire} : { challenge, type ("enregistrement" |
//   "connexion"), uid (enregistrement), rpID, expireAt } — 5 minutes, usage
//   unique (supprimé dès qu'il est présenté, réussite ou échec), purgé
//   chaque jour par purgerRateLimits.
// Les deux collections sont fermées à tout client (firestore.rules) : rien
// ne passe ailleurs que par ces fonctions. L'uid vient toujours du serveur
// (request.auth à l'enregistrement, passkeys/{id} à la connexion), jamais du
// navigateur.
//
// RP : bokki.shop (valable aussi pour www.bokki.shop). Une passkey est liée
// au domaine : elle ne marche pas sur makiti-gn.web.app (le bouton y est
// masqué côté navigateur). En local, UNIQUEMENT dans l'émulateur Functions :
// rpID « localhost », origine http://localhost:5055 (tools/serveur-local.cjs).
// ---------------------------------------------------------------------------
const PASSKEY_RP_NAME = "Bokki";
const PASSKEY_RP_ID = "bokki.shop";
const PASSKEY_ORIGINES = ["https://bokki.shop", "https://www.bokki.shop"];
const PASSKEY_ORIGINE_LOCALE = "http://localhost:5055";
const PASSKEY_DEFI_MS = 5 * 60 * 1000;
const PASSKEY_MAX_PAR_COMPTE = 10;
// Identifiant de clé (base64url) : jamais de « / », longueur bornée (une
// clé fait au plus 1023 octets, soit 1364 caractères en base64url).
const ID_PASSKEY = /^[A-Za-z0-9_-]{16,1400}$/;
const ID_DEFI = /^[a-f0-9]{32}$/;

function emulateurFonctions(): boolean {
  return process.env.FUNCTIONS_EMULATOR === "true";
}

// RP et origines acceptées pour cet appel. L'origine locale n'est jamais
// acceptée en production, même si l'en-tête Origin la prétend.
function configPasskey(request: { rawRequest: { headers: Record<string, unknown> } }): { rpID: string; origines: string[] } {
  if (emulateurFonctions() && String(request.rawRequest.headers.origin || "") === PASSKEY_ORIGINE_LOCALE) {
    return { rpID: "localhost", origines: [PASSKEY_ORIGINE_LOCALE] };
  }
  return { rpID: PASSKEY_RP_ID, origines: PASSKEY_ORIGINES };
}

// Quelques gestionnaires de passkeys connus (AAGUID), pour un libellé clair
// dans « Mon compte ». Inconnu (ou masqué par le navigateur) : appareil seul.
const GESTIONNAIRES_PASSKEY: Record<string, string> = {
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "Trousseau iCloud",
  "dd4ec289-e01d-41c9-bb89-70fa845d4bf2": "Trousseau iCloud",
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Gestionnaire de mots de passe Google",
  "adce0002-35bc-c60a-648b-0b25f1f05503": "Chrome sur Mac",
  "08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
  "6028b017-b1d4-4c02-b4b3-afcdafc96bb2": "Windows Hello",
  "53414d53-554e-4700-0000-000000000000": "Samsung Pass",
};

// Libellé lisible de l'appareil, déduit du user-agent (« iPhone · Safari »).
function libelleAppareil(userAgent: unknown, aaguid?: string): string {
  const ua = String(userAgent || "");
  const appareil = /iPhone/.test(ua) ? "iPhone"
    : /iPad/.test(ua) ? "iPad"
    : /Android/.test(ua) ? (/Mobile/.test(ua) ? "Téléphone Android" : "Tablette Android")
    : /Macintosh|Mac OS X/.test(ua) ? "Mac"
    : /Windows/.test(ua) ? "Ordinateur Windows"
    : /CrOS/.test(ua) ? "Chromebook"
    : /Linux/.test(ua) ? "Ordinateur Linux"
    : "Appareil";
  const navigateur = /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /EdgA?\//.test(ua) ? "Edge"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /Firefox|FxiOS/.test(ua) ? "Firefox"
    : /CriOS|Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : "";
  const gestionnaire = aaguid ? GESTIONNAIRES_PASSKEY[aaguid] : undefined;
  return [appareil, gestionnaire || navigateur].filter(Boolean).join(" · ").slice(0, 80);
}

async function creerDefiPasskey(type: "enregistrement" | "connexion", challenge: string, rpID: string, uid?: string): Promise<string> {
  const id = crypto.randomBytes(16).toString("hex");
  await db.collection("webauthnChallenges").doc(id).set({
    challenge, type, rpID, ...(uid ? { uid } : {}),
    expireAt: new Date(Date.now() + PASSKEY_DEFI_MS),
  });
  return id;
}

// Lit ET supprime le défi (usage unique, même si la vérification échoue
// ensuite) ; vérifie type, expiration et, à l'enregistrement, le compte.
async function consommerDefiPasskey(idDefi: unknown, type: "enregistrement" | "connexion", uid?: string): Promise<{ challenge: string; rpID: string }> {
  const id = String(idDefi || "");
  if (!ID_DEFI.test(id)) throw new HttpsError("invalid-argument", "Demande invalide. Réessayez.");
  const ref = db.collection("webauthnChallenges").doc(id);
  const d = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) tx.delete(ref);
    return snap.data();
  });
  const expire = d?.expireAt?.toMillis?.() || 0;
  if (!d || d.type !== type || (uid !== undefined && d.uid !== uid) || expire < Date.now()) {
    // failed-precondition (pas deadline-exceeded, que fonctions.js prendrait
    // pour une coupure réseau et rejouerait).
    throw new HttpsError("failed-precondition", "Délai dépassé. Réessayez.");
  }
  return { challenge: String(d.challenge), rpID: String(d.rpID) };
}

// Base64url de l'uid : identifiant WebAuthn du compte (userHandle).
const userHandlePasskey = (uid: string) => Buffer.from(uid, "utf8").toString("base64url");

// 1. Options d'enregistrement (client connecté).
export const optionsEnregistrementPasskey = onCall({ maxInstances: 10, enforceAppCheck: EXIGER_APP_CHECK }, async (request) => {
  if (estPrechauffage(request.data)) return { pret: true };
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Connectez-vous d'abord.");
  await limiterAppelPublic(request, "passkey-enregistrement", 30, 60 * 60 * 1000);
  const { rpID } = configPasskey(request);
  const [profilSnap, existantes] = await Promise.all([
    db.collection("clients").doc(uid).get(),
    db.collection("passkeys").where("uid", "==", uid).limit(PASSKEY_MAX_PAR_COMPTE + 1).get(),
  ]);
  if (existantes.size >= PASSKEY_MAX_PAR_COMPTE) {
    throw new HttpsError("resource-exhausted", `${PASSKEY_MAX_PAR_COMPTE} appareils au maximum. Supprimez-en un dans « Mon compte ».`);
  }
  const p = profilSnap.data() || {};
  // Nom affiché par le téléphone dans sa liste de passkeys.
  const identifiant = String(p.telephone || request.auth?.token?.email || p.nom || "Compte Bokki").slice(0, 64);
  const options = await generateRegistrationOptions({
    rpName: PASSKEY_RP_NAME,
    rpID,
    userID: Buffer.from(uid, "utf8"),
    userName: identifiant,
    userDisplayName: String(p.nom || request.auth?.token?.name || identifiant).slice(0, 64),
    attestationType: "none",
    // Déjà enregistrée sur cet appareil : le navigateur le signale
    // (InvalidStateError) au lieu d'en créer une seconde.
    excludeCredentials: existantes.docs.map((d) => ({ id: d.id, transports: d.data().transports || undefined })),
    authenticatorSelection: { residentKey: "required", userVerification: "required", authenticatorAttachment: "platform" },
    timeout: 120000,
  });
  return { idDefi: await creerDefiPasskey("enregistrement", options.challenge, rpID, uid), options };
});

interface EnregistrerPasskeyData { idDefi: string; reponse: RegistrationResponseJSON; }

// 2. Vérification de l'enregistrement : stocke la clé publique.
export const enregistrerPasskey = onCall<EnregistrerPasskeyData>({ maxInstances: 10, enforceAppCheck: EXIGER_APP_CHECK }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Connectez-vous d'abord.");
  const { challenge, rpID } = await consommerDefiPasskey(request.data?.idDefi, "enregistrement", uid);
  const reponse = request.data?.reponse;
  if (!reponse || typeof reponse !== "object" || !ID_PASSKEY.test(String(reponse.id || ""))) {
    throw new HttpsError("invalid-argument", "Réponse de l'appareil invalide.");
  }
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: reponse,
      expectedChallenge: challenge,
      expectedOrigin: configPasskey(request).origines,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (err) {
    logger.warn("Passkey : enregistrement refusé", (err as Error)?.message);
    throw new HttpsError("invalid-argument", "Vérification impossible. Réessayez.");
  }
  if (!verification.verified) throw new HttpsError("invalid-argument", "Vérification impossible. Réessayez.");
  const info = verification.registrationInfo;
  const id = info.credential.id;
  if (!ID_PASSKEY.test(id)) throw new HttpsError("invalid-argument", "Réponse de l'appareil invalide.");
  const ref = db.collection("passkeys").doc(id);
  const appareil = libelleAppareil(request.rawRequest.headers["user-agent"], info.aaguid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    // Même identifiant déjà lié à un AUTRE compte : refus (jamais d'écrasement).
    if (snap.exists && snap.data()?.uid !== uid) throw new HttpsError("already-exists", "Cette clé est déjà utilisée.");
    tx.set(ref, {
      uid,
      publicKey: Buffer.from(info.credential.publicKey).toString("base64url"),
      counter: info.credential.counter,
      transports: (info.credential.transports || []).map(String).slice(0, 8),
      appareil,
      aaguid: info.aaguid,
      sauvegardee: info.credentialBackedUp,
      dateCreation: FieldValue.serverTimestamp(),
      derniereUtilisation: null,
    });
  });
  return { id, appareil };
});

// 3. Options de connexion (public) : sans allowCredentials, le téléphone
// propose lui-même les passkeys Bokki qu'il connaît (clés découvrables).
export const optionsConnexionPasskey = onCall({ maxInstances: 10, enforceAppCheck: EXIGER_APP_CHECK }, async (request) => {
  if (estPrechauffage(request.data)) return { pret: true };
  // Large : la page Connexion prépare un défi à l'ouverture, et beaucoup
  // de clients partagent la même IP (opérateurs mobiles).
  await limiterAppelPublic(request, "passkey-options", 120, 10 * 60 * 1000);
  const { rpID } = configPasskey(request);
  const options = await generateAuthenticationOptions({ rpID, userVerification: "required", timeout: 120000 });
  return { idDefi: await creerDefiPasskey("connexion", options.challenge, rpID), options };
});

interface ConnexionPasskeyData { idDefi: string; reponse: AuthenticationResponseJSON; }

// 4. Vérification de la connexion (public) → jeton personnalisé.
export const connexionPasskey = onCall<ConnexionPasskeyData>({ maxInstances: 10, enforceAppCheck: EXIGER_APP_CHECK }, async (request) => {
  await limiterAppelPublic(request, "passkey-connexion", 30, 10 * 60 * 1000);
  const { challenge, rpID } = await consommerDefiPasskey(request.data?.idDefi, "connexion");
  const reponse = request.data?.reponse;
  const id = String(reponse?.id || "");
  if (!reponse || typeof reponse !== "object" || !ID_PASSKEY.test(id)) {
    throw new HttpsError("invalid-argument", "Réponse de l'appareil invalide.");
  }
  const ref = db.collection("passkeys").doc(id);
  const snap = await ref.get();
  const cle = snap.data();
  if (!cle?.uid) {
    // Supprimée dans « Mon compte » (ou jamais enregistrée) : le navigateur
    // peut l'oublier (signalUnknownCredential côté client).
    throw new HttpsError("not-found", "Cette clé n'est plus reconnue par Bokki. Connectez-vous autrement, puis réactivez-la dans « Mon compte ».");
  }
  const uid = String(cle.uid);
  // L'appareil renvoie l'identifiant de compte enregistré avec la clé.
  if (reponse.response?.userHandle && reponse.response.userHandle !== userHandlePasskey(uid)) {
    throw new HttpsError("permission-denied", "Clé non valable pour ce compte.");
  }
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: reponse,
      expectedChallenge: challenge,
      expectedOrigin: configPasskey(request).origines,
      expectedRPID: rpID,
      credential: { id, publicKey: Buffer.from(String(cle.publicKey), "base64url"), counter: Number(cle.counter) || 0, transports: cle.transports || undefined },
      requireUserVerification: true,
    });
  } catch (err) {
    logger.warn("Passkey : connexion refusée", (err as Error)?.message);
    throw new HttpsError("permission-denied", "Vérification impossible. Réessayez ou connectez-vous autrement.");
  }
  if (!verification.verified) throw new HttpsError("permission-denied", "Vérification impossible. Réessayez ou connectez-vous autrement.");
  await ref.update({
    counter: verification.authenticationInfo.newCounter,
    derniereUtilisation: FieldValue.serverTimestamp(),
  });
  return { jeton: await getAuth().createCustomToken(uid, { client: true }) };
});

// 5. Liste des passkeys du compte connecté (Mon compte).
export const listerPasskeys = onCall({ maxInstances: 10, enforceAppCheck: EXIGER_APP_CHECK }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Connectez-vous d'abord.");
  const snap = await db.collection("passkeys").where("uid", "==", uid).limit(PASSKEY_MAX_PAR_COMPTE * 2).get();
  const passkeys = snap.docs.map((d) => {
    const p = d.data();
    return {
      id: d.id,
      appareil: p.appareil || "Appareil",
      dateCreation: p.dateCreation?.toDate?.().toISOString() || null,
      derniereUtilisation: p.derniereUtilisation?.toDate?.().toISOString() || null,
    };
  }).sort((a, b) => String(b.dateCreation || "").localeCompare(String(a.dateCreation || "")));
  return { passkeys, userHandle: userHandlePasskey(uid) };
});

interface SupprimerPasskeyData { id: string; }

// 6. Suppression d'une passkey du compte connecté (et d'aucun autre).
export const supprimerPasskey = onCall<SupprimerPasskeyData>({ maxInstances: 10, enforceAppCheck: EXIGER_APP_CHECK }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Connectez-vous d'abord.");
  const id = String(request.data?.id || "");
  if (!ID_PASSKEY.test(id)) throw new HttpsError("invalid-argument", "Clé inconnue.");
  const ref = db.collection("passkeys").doc(id);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    if (snap.data()?.uid !== uid) throw new HttpsError("permission-denied", "Clé inconnue.");
    tx.delete(ref);
  });
  return { ok: true };
});

interface ReinitialiserCodeClientData { telephone: string; }

// « Code oublié » : un agent (admin) remplace le code par un code
// provisoire tiré au hasard, qu'il donne au client en l'appelant sur CE
// numéro (ce qui vérifie que c'est bien lui). Avant, le code était effacé
// et le premier venu connaissant le numéro choisissait le nouveau.
export const reinitialiserCodeClient = onCall<ReinitialiserCodeClientData>(async (request) => {
  await assertAdmin(request.auth?.uid);
  const cle = cleTelephone(request.data?.telephone);
  if (!cle) throw new HttpsError("invalid-argument", "Numéro de téléphone invalide.");
  const ref = db.collection("codesClients").doc(cle);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Aucun compte client pour ce numéro.");
  let provisoire = "";
  do provisoire = String(crypto.randomInt(0, 10000)).padStart(4, "0"); while (codeTropSimple(provisoire));
  const sel = crypto.randomBytes(16).toString("hex");
  await ref.update({ hash: hacherCode(provisoire, sel), sel, essais: 0, blocages: 0, bloqueJusqua: null, reinitialisePar: request.auth!.uid, dateMaj: FieldValue.serverTimestamp() });
  return { ok: true, telephone: "+" + cle, code: provisoire };
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
  const commandeId = String(request.data?.commandeId || "").trim();
  const code = String(request.data?.code || "").trim();
  const telephone = telephoneNormalise(request.data?.telephone);
  const token = String(request.data?.token || "").trim();

  // Identifiant sans « / » : sinon doc() viserait un sous-document
  // (ex. commandes/{id}/interne/…) au lieu d'une commande.
  if (!ID_COMMANDE.test(commandeId) || !/^\d{6,15}$/.test(telephone)) throw new HttpsError("invalid-argument", "Commande ou téléphone invalide.");
  if (!CODE_LIVRAISON.test(code)) throw new HttpsError("invalid-argument", "Code de livraison invalide.");
  if (!token || token.length > 4096) {
    throw new HttpsError("invalid-argument", "Jeton de notification invalide.");
  }

  const commandeRef = db.collection("commandes").doc(commandeId);
  await verifierEssaisCommande("id:" + commandeId);
  const snap = await commandeRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Cette commande n'existe plus.");
  }
  if (String(snap.data()!.codeLivraison) !== code || telephoneNormalise(snap.data()!.clientTel) !== telephone) {
    await noterEchecCommande("id:" + commandeId);
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
  en_preparation: { titre: "Commande en préparation", corps: "Votre commande est en cours de préparation." },
  en_livraison: { titre: "Commande en livraison", corps: "Votre commande est en route vers vous." },
  livree: { titre: "Commande livrée", corps: "Merci d'avoir choisi Bokki ! Donnez votre avis en 10 secondes ⭐" },
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
        fcmOptions: { link: `${SITE_URL}/suivi.html?id=${event.params.commandeId}${after.statut === "livree" ? "&avis=1" : ""}` },
      },
    });
  } catch (err: unknown) {
    // Un jeton expiré/désinstallé ne doit jamais bloquer la mise à jour de
    // statut elle-même (ce trigger est asynchrone, mais on évite quand même
    // de réessayer indéfiniment sur un jeton mort) — on le supprime pour que
    // la prochaine visite du client sur la page de suivi puisse en réémettre un.
    logger.error("Échec envoi notification :", err);
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
  const commandeId = String(request.data?.commandeId || "").trim();
  const code = String(request.data?.code || "").trim();
  const telephone = telephoneNormalise(request.data?.telephone);
  const note = Math.round(Number(request.data?.note));
  const commentaire = String(request.data?.commentaire || "").trim().slice(0, COMMENTAIRE_MAX_LONGUEUR);

  if (!ID_COMMANDE.test(commandeId) || !/^\d{6,15}$/.test(telephone)) throw new HttpsError("invalid-argument", "Commande ou téléphone invalide.");
  if (!CODE_LIVRAISON.test(code)) throw new HttpsError("invalid-argument", "Code de livraison invalide.");
  if (!Number.isInteger(note) || note < 1 || note > 5) {
    throw new HttpsError("invalid-argument", "La note doit être un entier entre 1 et 5.");
  }

  const commandeRef = db.collection("commandes").doc(commandeId);
  const avisRef = db.collection("avis").doc();
  await verifierEssaisCommande("id:" + commandeId);

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

    // Commande à plusieurs articles (panier) : l'avis porte sur la commande
    // entière. Il apparaît dans les témoignages et sur l'accueil ; il n'est
    // rattaché à aucune fiche produit (on ne sait pas quel article est noté).
    const articlesCommande = articlesDeCommande(commande);
    const plusieurs = articlesCommande.length > 1;
    const articleUnique = articlesCommande[0];
    const autres = articlesCommande.length - 1;

    tx.set(avisRef, {
      produitId: plusieurs ? null : articleUnique?.produitId || null,
      produitNom: plusieurs
        ? `${articleUnique?.nom || "Commande"} + ${autres} autre${autres > 1 ? "s" : ""} article${autres > 1 ? "s" : ""}`
        : articleUnique?.nom || "",
      clientNom: commande.clientNom || "",
      note,
      commentaire,
      dateCreation: FieldValue.serverTimestamp(),
    });
    tx.update(commandeRef, {
      avisSoumis: { note, commentaire },
    });
  }).catch(async (err) => {
    if (err instanceof HttpsError && err.code === "permission-denied") await noterEchecCommande("id:" + commandeId);
    throw err;
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

// Parrainage, suite d'une commande (voir le bloc « Parrainage » en haut) :
//  1. récompense du parrain quand la commande du filleul devient « livrée »
//     (une seule fois : marqueur recompenseParrain.versee sur la commande,
//     relu dans la transaction). Livrée puis retournée : la récompense est
//     reprise (dans la limite du crédit encore disponible) ;
//  2. crédit utilisé sur cette commande rendu au client si elle est
//     retournée, ou mise à la corbeille sans avoir été livrée (marqueur
//     creditRendu). Une commande restaurée vers un statut actif reprend ce
//     crédit (dans la limite de ce qui reste).
// Ne réagit qu'aux changements de statut ou de corbeille ; ses propres
// écritures (marqueurs) ne changent ni l'un ni l'autre : pas de boucle.
export const suiviParrainageCommande = onDocumentUpdated("commandes/{commandeId}", async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;
  if (before.statut === after.statut && (before.corbeille === true) === (after.corbeille === true)) return;
  if (!after.parrainUid && !(Number(after.reductionCredit) > 0)) return;

  const commandeRef = event.data!.after.ref;
  const params = after.parrainUid ? await parametresParrainage() : null;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(commandeRef);
    if (!snap.exists) return;
    const c = snap.data()!;
    const parrainRef = c.parrainUid ? db.collection("clients").doc(String(c.parrainUid)) : null;
    const reductionCredit = Math.max(0, Math.floor(Number(c.reductionCredit) || 0));
    const acheteurRef = reductionCredit > 0 && c.uid ? db.collection("clients").doc(String(c.uid)) : null;
    // Lectures d'abord (règle des transactions), écritures ensuite.
    const [parrainSnap, acheteurSnap] = await Promise.all([
      parrainRef ? tx.get(parrainRef) : Promise.resolve(null),
      acheteurRef ? tx.get(acheteurRef) : Promise.resolve(null),
    ]);
    const maj: Record<string, unknown> = {};

    // 1. Récompense du parrain. Parrainage annulé par l'admin
    // (annulerReductionParrainage) : jamais de récompense.
    if (parrainRef && params && !c.parrainageAnnule) {
      const rec = (c.recompenseParrain || null) as { montant?: number; versee?: boolean; plafondAtteint?: boolean; mois?: string } | null;
      const livree = c.statut === "livree";
      // Compteur du mois (UTC = heure de Conakry) sur le profil du parrain,
      // relu dans la transaction : deux livraisons simultanées ne peuvent
      // pas dépasser le plafond.
      const compteur = parrainSnap?.data()?.filleulsRecompensesMois as { mois?: string; nb?: number } | undefined;
      if (livree && !rec?.versee) {
        const mois = new Date().toISOString().slice(0, 7);
        const nbMois = compteur?.mois === mois ? Math.max(0, Number(compteur.nb) || 0) : 0;
        if (params.maxFilleulsParMois > 0 && nbMois >= params.maxFilleulsParMois) {
          // Plafond atteint : le filleul garde sa réduction, le parrain
          // n'est pas crédité (marqueur pour l'admin, écrit une seule fois).
          if (!rec?.plafondAtteint) {
            maj.recompenseParrain = { montant: 0, versee: false, plafondAtteint: true, max: params.maxFilleulsParMois, mois, date: FieldValue.serverTimestamp() };
          }
        } else {
          // Nouvelle livraison après une reprise : même montant qu'à l'origine.
          const montant = rec && rec.montant != null && !rec.plafondAtteint
            ? Math.max(0, Number(rec.montant) || 0)
            : params.actif ? montantPourcent(Number(c.montantTotal) || 0, params.pourcentParrain, params.plafondParrain) : 0;
          tx.set(parrainRef, {
            creditParrainage: FieldValue.increment(montant),
            gainsParrainage: FieldValue.increment(montant),
            nbFilleulsLivres: FieldValue.increment(1),
            filleulsRecompensesMois: { mois, nb: nbMois + 1 },
          }, { merge: true });
          maj.recompenseParrain = { montant, versee: true, mois, date: FieldValue.serverTimestamp() };
        }
      } else if (!livree && rec?.versee) {
        const montant = Math.max(0, Number(rec.montant) || 0);
        const credit = Math.max(0, Number(parrainSnap?.data()?.creditParrainage) || 0);
        const reprise: Record<string, unknown> = {
          creditParrainage: Math.max(0, credit - montant),
          gainsParrainage: FieldValue.increment(-montant),
          nbFilleulsLivres: FieldValue.increment(-1),
        };
        // Récompense du mois en cours reprise : une place se libère.
        if (rec.mois && compteur?.mois === rec.mois) {
          reprise.filleulsRecompensesMois = { mois: rec.mois, nb: Math.max(0, (Number(compteur.nb) || 0) - 1) };
        }
        tx.set(parrainRef, reprise, { merge: true });
        maj.recompenseParrain = { montant, versee: false, date: FieldValue.serverTimestamp() };
      }
    }

    // 2. Crédit utilisé sur cette commande.
    if (acheteurRef) {
      const annulee = c.statut === "retournee" || (c.corbeille === true && c.statut !== "livree");
      if (annulee && c.creditRendu !== true) {
        tx.set(acheteurRef, { creditParrainage: FieldValue.increment(reductionCredit) }, { merge: true });
        maj.creditRendu = true;
      } else if (!annulee && c.creditRendu === true) {
        const credit = Math.max(0, Number(acheteurSnap?.data()?.creditParrainage) || 0);
        tx.set(acheteurRef, { creditParrainage: Math.max(0, credit - reductionCredit) }, { merge: true });
        maj.creditRendu = false;
      }
    }

    if (Object.keys(maj).length) tx.update(commandeRef, maj);
  });
});

// Annulation de la réduction de parrainage par l'équipe (commande marquée
// « Parrainage à vérifier », ou doute de l'agent au téléphone), tant que la
// commande n'est pas livrée. En une transaction : réduction du filleul
// retirée (le total à encaisser est recalculé à partir de ces champs),
// récompense future du parrain annulée (marqueur parrainageAnnule, lu par
// suiviParrainageCommande). parrainages/{téléphone} est GARDÉ : ce numéro a
// consommé son parrainage. Le crédit parrainage éventuellement utilisé par
// le client sur cette commande n'est pas touché.
interface AnnulerReductionParrainageData { commandeId: string; }
export const annulerReductionParrainage = onCall<AnnulerReductionParrainageData>(async (request) => {
  await assertAdmin(request.auth?.uid);
  const commandeId = String(request.data?.commandeId ?? "").trim();
  if (!commandeId || commandeId.length > 200 || commandeId.includes("/")) {
    throw new HttpsError("invalid-argument", "Commande manquante.");
  }
  const commandeRef = db.collection("commandes").doc(commandeId);
  return db.runTransaction(async (tx) => {
    // Lectures d'abord (règle des transactions), écritures ensuite.
    const snap = await tx.get(commandeRef);
    if (!snap.exists) throw new HttpsError("not-found", "Commande introuvable.");
    const c = snap.data()!;
    const cle = cleTelephone(c.clientTel);
    const parrainageRef = cle ? db.collection("parrainages").doc(cle) : null;
    const parrainageSnap = parrainageRef ? await tx.get(parrainageRef) : null;

    if (c.parrainageAnnule) return { dejaAnnule: true, reductionAnnulee: 0 };
    if (c.statut === "livree") {
      throw new HttpsError("failed-precondition", "Commande déjà livrée : la réduction de parrainage ne peut plus être annulée.");
    }
    if (!c.parrainUid && !(Number(c.reductionParrainage) > 0)) {
      throw new HttpsError("failed-precondition", "Aucun parrainage sur cette commande.");
    }
    if (c.recompenseParrain?.versee) {
      throw new HttpsError("failed-precondition", "La récompense du parrain a déjà été versée.");
    }
    const reductionAnnulee = Math.max(0, Number(c.reductionParrainage) || 0);
    const reductionCredit = Math.max(0, Number(c.reductionCredit) || 0);
    tx.update(commandeRef, {
      reductionParrainage: 0,
      pourcentParrainage: 0,
      reductionTotale: reductionCredit > 0 ? reductionCredit : FieldValue.delete(),
      parrainageAVerifier: false,
      parrainageAnnule: {
        date: FieldValue.serverTimestamp(),
        par: request.auth!.uid,
        reductionAnnulee,
        parrainUid: c.parrainUid || null,
      },
      recompenseParrain: { montant: 0, versee: false, annulee: true, date: FieldValue.serverTimestamp() },
    });
    if (parrainageSnap?.exists && parrainageSnap.data()?.commandeId === commandeId) {
      tx.update(parrainageRef!, { annule: true, dateAnnulation: FieldValue.serverTimestamp() });
    }
    return { dejaAnnule: false, reductionAnnulee };
  });
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

// minInstances: 0 (explicite) : aucune instance facturée au repos. Le
// premier relevé après une période calme attend le démarrage à froid
// (~3 s), masqué par le cache local du tableau de bord (dashboard.js).
// Passer à 1 pour une instance toujours prête (coût fixe mensuel).
export const repartitionFinanciere = onCall<RepartitionFinanciereData>({ minInstances: 0 }, async (request) => {
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
    // Réductions de parrainage (filleul, crédit du parrain) : à la charge de
    // Bokki, déduites de la vente. Un prix convenu au téléphone est final
    // (l'agent part du montant déjà réduit, voir commande-detail.js).
    const venteTotale = c.prixConvenu != null
      ? Number(c.prixConvenu) || 0
      : Math.max(0, (Number(c.montantTotal ?? c.prixInitial) || 0) - reductionTotale(c));

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
// Purge aussi les envois de commande (commande sans perte) de plus de 7 jours,
// et les défis WebAuthn (passkeys) expirés jamais présentés.
export const purgerRateLimits = onSchedule("every 24 hours", async () => {
  const seuil = new Date();
  for (const collection of ["limitesAppels", "envoisCommandes", "webauthnChallenges"]) {
    for (;;) {
      const snap = await db.collection(collection).where("expireAt", "<=", seuil).limit(400).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      if (snap.size < 400) break;
    }
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
    // Retrait : ses jetons en cours (valables jusqu'à 1 h) sont annulés tout
    // de suite, sinon il pourrait encore envoyer des photos (audit, point 8).
    if (!estAdmin) await getAuth().revokeRefreshTokens(uid);
    console.info(`[Bokki] badge admin ${estAdmin ? "posé" : "retiré"} pour ${uid}`);
  } catch (err) {
    // Compte Auth pas encore créé au moment où le doc admins/ est écrit :
    // pas bloquant, l'admin devra juste se reconnecter une fois son compte
    // et son claim en place.
    logger.warn(`[Bokki] synchroniserBadgeAdmin: ${uid} — ${(err as Error).message}`);
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

    const montant = commande.prixConvenu != null
      ? Number(commande.prixConvenu) || 0
      : Math.max(0, (Number(commande.montantTotal) || 0) - reductionTotale(commande));
    const montantTxt = montant
      ? montant.toLocaleString("fr-FR").replace(/,/g, " ") + " GNF"
      : "montant à confirmer";
    const lieu = [commande.ville, commande.quartier].filter(Boolean).join(", ");
    const fraisTxt = commande.fraisAConfirmer === true && typeof commande.fraisLivraison !== "number" ? "frais de livraison à confirmer" : "";
    const corps = [`${commande.clientNom || "Client"}`, montantTxt, lieu, fraisTxt].filter(Boolean).join(" · ");

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

// ---------- Régénération automatique du pré-rendu (mise à jour n°1) ----------
// Quand un produit (ou une de ses variantes) est ajouté, modifié ou supprimé
// dans l'admin, les pages pré-rendues — accueil, /categorie/<slug>,
// /produit/<id> — sont refaites et publiées sur Firebase Hosting, sans
// attendre le prochain déploiement.
// • Firestore : lecture seule (functions/prerender/coeur.mjs, même code que
//   scripts/prerender.mjs).
// • Hosting : nouvelle version clonée de la version en ligne, où seules ces
//   pages sont remplacées, puis publiée (comme un `firebase deploy`).
// • Les écritures groupées de l'admin (produit + variantes) déclenchent une
//   seule régénération : attente de 45 s, puis une génération couvre tous les
//   changements survenus avant son début.
const SITE_HOSTING = "makiti-gn";
// IndexNow : même clé que public/<clé>.txt (vérifié par tests/parcours.mjs).
const INDEXNOW_CLE = "d3e3dc8638908f59137e178aeb92412e";
async function signalerIndexNow(urls: string[]): Promise<void> {
  if (!urls.length) return;
  try {
    const rep = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: "bokki.shop", key: INDEXNOW_CLE, keyLocation: `https://bokki.shop/${INDEXNOW_CLE}.txt`, urlList: urls.slice(0, 10000) }),
      signal: AbortSignal.timeout(15000),
    });
    if (rep.ok) logger.info(`IndexNow : ${urls.length} adresse(s) signalée(s)`);
    else logger.warn(`IndexNow : HTTP ${rep.status}`);
  } catch (err) {
    logger.warn("IndexNow non envoyé", err);
  }
}
const API_HOSTING = "https://firebasehosting.googleapis.com/v1beta1";
const ATTENTE_REGROUPEMENT_MS = 45_000;
let debutDerniereGeneration = 0;
let fileGeneration: Promise<unknown> = Promise.resolve();

async function appelHosting<T = any>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { access_token: jeton } = await applicationDefault().getAccessToken();
  const rep = await fetch(url.startsWith("http") ? url : `${API_HOSTING}/${url}`, {
    method: init.method || "GET",
    headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!rep.ok) throw new Error(`Hosting ${init.method || "GET"} ${url} : HTTP ${rep.status} ${(await rep.text()).slice(0, 300)}`);
  return (await rep.json()) as T;
}

function genererPagesDansWorker(): Promise<{ fichiers: Record<string, string | Uint8Array>; nbProduits: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "..", "prerender", "travailleur.mjs"), { workerData: { site: "https://bokki.shop" } });
    const minuteur = setTimeout(() => { worker.terminate(); reject(new Error("Pré-rendu : délai dépassé")); }, 180_000);
    worker.once("message", (r: { fichiers?: Record<string, string>; nbProduits?: number; erreur?: string }) => {
      clearTimeout(minuteur);
      worker.terminate();
      if (r.erreur || !r.fichiers) reject(new Error(r.erreur || "Pré-rendu vide"));
      else resolve({ fichiers: r.fichiers, nbProduits: r.nbProduits || 0 });
    });
    worker.once("error", (err) => { clearTimeout(minuteur); reject(err); });
  });
}

async function regenererEtPublier(): Promise<void> {
  // Émulateur : SITE_HOSTING est le vrai site, le projet demo-bokki ne protège
  // pas d'un appel direct à l'API Hosting. Jamais de publication depuis un test.
  if (emulateurFonctions()) {
    logger.info("Émulateur : pré-rendu non publié.");
    return;
  }
  const { fichiers, nbProduits } = await genererPagesDansWorker();
  if (!fichiers["/index.html"] || nbProduits === 0) throw new Error("Pré-rendu incomplet : publication annulée");
  // 1. Version en ligne, clonée sans les pages pré-rendues.
  const canal = await appelHosting<{ release?: { version?: { name?: string } } }>(`sites/${SITE_HOSTING}/channels/live`);
  const versionEnLigne = canal.release?.version?.name;
  if (!versionEnLigne) throw new Error("Version en ligne introuvable");
  let operation = await appelHosting<{ name: string; done?: boolean; error?: unknown; response?: { name?: string } }>(
    `sites/${SITE_HOSTING}/versions:clone`,
    { method: "POST", body: { sourceVersion: versionEnLigne, finalize: false, exclude: { regexes: ["^/index\\.html$", "^/produit/", "^/categorie/", "^/og/"] } } }
  );
  for (let i = 0; !operation.done && i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    operation = await appelHosting(operation.name);
  }
  if (!operation.done || operation.error || !operation.response?.name) throw new Error(`Clonage de la version impossible : ${JSON.stringify(operation.error || "délai dépassé")}`);
  const version = operation.response.name;
  // 2. Pages pré-rendues ajoutées (fichiers gzip, identifiés par leur SHA-256).
  const gz = new Map<string, Buffer>();
  const chemins: Record<string, string> = {};
  for (const [chemin, html] of Object.entries(fichiers)) {
    const contenu = typeof html === "string" ? Buffer.from(html, "utf8") : Buffer.from(html as Uint8Array);
    const donnees = zlib.gzipSync(contenu, { level: 9 });
    const hash = crypto.createHash("sha256").update(donnees).digest("hex");
    gz.set(hash, donnees);
    chemins[chemin] = hash;
  }
  const { uploadRequiredHashes = [], uploadUrl } = await appelHosting<{ uploadRequiredHashes?: string[]; uploadUrl: string }>(
    `${version}:populateFiles`, { method: "POST", body: { files: chemins } }
  );
  const { access_token: jeton } = await applicationDefault().getAccessToken();
  for (const hash of uploadRequiredHashes) {
    const rep = await fetch(`${uploadUrl}/${hash}`, { method: "POST", headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/octet-stream" }, body: gz.get(hash) });
    if (!rep.ok) throw new Error(`Envoi du fichier ${hash} : HTTP ${rep.status}`);
  }
  // 3. Version finalisée puis publiée.
  await appelHosting(`${version}?update_mask=status`, { method: "PATCH", body: { status: "FINALIZED" } });
  await appelHosting(`sites/${SITE_HOSTING}/releases?versionName=${encodeURIComponent(version)}`, {
    method: "POST", body: { message: `Pré-rendu régénéré automatiquement (${nbProduits} produits)` },
  });
  console.log(`Pré-rendu publié : ${Object.keys(fichiers).length} pages, ${uploadRequiredHashes.length} modifiées, ${nbProduits} produits.`);
  // Pages réellement modifiées → signalées aux moteurs (IndexNow).
  const modifies = new Set(uploadRequiredHashes);
  await signalerIndexNow(Object.entries(chemins)
    .filter(([chemin, hash]) => modifies.has(hash) && chemin.endsWith(".html"))
    .map(([chemin]) => `https://bokki.shop${chemin === "/index.html" ? "/" : chemin.replace(/\.html$/, "")}`));
}

export const regenererPrerendu = onDocumentWritten(
  { document: "produits/{chemin=**}", maxInstances: 1, concurrency: 20, cpu: 1, memory: "512MiB", timeoutSeconds: 540, retry: false },
  async (event) => {
    const instant = Date.parse(event.time) || Date.now();
    await new Promise((r) => setTimeout(r, ATTENTE_REGROUPEMENT_MS));
    const tache = fileGeneration.then(async () => {
      // Une génération commencée après ce changement l'a déjà pris en compte.
      if (debutDerniereGeneration > instant) return;
      debutDerniereGeneration = Date.now();
      try {
        await regenererEtPublier();
      } catch (err) {
        logger.error("Régénération du pré-rendu impossible (le site garde la version précédente)", err);
      }
    });
    fileGeneration = tache;
    await tache;
  }
);

// ---------- Collecte : erreurs, vitesse réelle, entonnoir, tests A/B ----------
// Point d'entrée unique /api/collecte (réécriture Hosting, même origine : pas
// de changement de CSP). Le navigateur envoie un petit paquet par page
// (navigator.sendBeacon, js/mesures.js). AUCUNE donnée personnelle : pas
// d'IP, pas de numéro, pas d'identifiant de visiteur ; seulement des
// compteurs du jour dans statistiques/{AAAA-MM-JJ} (lecture admin).
//  - erreurs     → journalisées en ERROR (déclenchent l'alerte e-mail), et
//                  comptées par jour ;
//  - evenements  → entonnoir : vue_accueil, vue_produit, ajout_panier,
//                  debut_commande, commande_validee — par variante A/B ;
//  - vitesse     → LCP / FCP / INP en histogramme (tranches), CLS aussi,
//                  séparés par réseau (4g / 3g / 2g).
const EVENEMENTS_ENTONNOIR = new Set(["vue_accueil", "vue_produit", "ajout_panier", "debut_commande", "commande_validee"]);
const METRIQUES_VITESSE: Record<string, number[]> = {
  // bornes hautes des tranches (ms ; CLS × 1000)
  lcp: [1000, 2500, 4000, 6000, 10000, 20000],
  fcp: [1000, 1800, 3000, 5000, 8000, 15000],
  inp: [100, 200, 500, 1000, 2000],
  cls: [50, 100, 250, 500],
};
const appelsCollecteParIp = new Map<string, { debut: number; n: number }>();

function trancheVitesse(metrique: string, valeur: number): string {
  const bornes = METRIQUES_VITESSE[metrique];
  for (const b of bornes) if (valeur <= b) return "le" + b;
  return "plus";
}

function texteCourt(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max).replace(/[\u0000-\u001f]/g, " ") : "";
}

export const collecte = onRequest({ maxInstances: 3, concurrency: 80, memory: "256MiB", cpu: 1 }, async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (req.method !== "POST") { res.status(405).end(); return; }
  // Limite simple en mémoire (par instance) : 40 paquets / minute / IP.
  const ip = crypto.createHash("sha256").update(req.ip || "?").digest("hex").slice(0, 16);
  const maintenant = Date.now();
  const compte = appelsCollecteParIp.get(ip);
  if (!compte || maintenant - compte.debut > 60_000) appelsCollecteParIp.set(ip, { debut: maintenant, n: 1 });
  else if (++compte.n > 40) { res.status(429).end(); return; }
  if (appelsCollecteParIp.size > 5000) appelsCollecteParIp.clear();

  let paquet: Record<string, unknown>;
  try {
    const brut = typeof req.body === "string" ? req.body : Buffer.isBuffer(req.body) ? req.body.toString("utf8") : req.rawBody?.toString("utf8") || "";
    if (brut.length > 8000) { res.status(413).end(); return; }
    paquet = brut ? JSON.parse(brut) : (req.body as Record<string, unknown>) || {};
  } catch {
    res.status(400).end(); return;
  }
  if (!paquet || typeof paquet !== "object") { res.status(400).end(); return; }

  const variante = paquet.v === "B" ? "B" : "A";
  const reseau = ["4g", "3g", "2g", "slow-2g"].includes(String(paquet.r)) ? String(paquet.r).replace("slow-", "") : "inconnu";
  const page = texteCourt(paquet.p, 80);
  const maj: Record<string, FieldValue> = {};

  const evenements = Array.isArray(paquet.e) ? paquet.e.slice(0, 10) : [];
  for (const ev of evenements) {
    if (typeof ev === "string" && EVENEMENTS_ENTONNOIR.has(ev)) maj[`entonnoir.${ev}.${variante}`] = FieldValue.increment(1);
  }

  const vitesse = paquet.m && typeof paquet.m === "object" ? (paquet.m as Record<string, unknown>) : {};
  for (const [metrique, valeur] of Object.entries(vitesse)) {
    const n = Number(valeur);
    if (!METRIQUES_VITESSE[metrique] || !Number.isFinite(n) || n < 0 || n > 600000) continue;
    const v = metrique === "cls" ? Math.round(n * 1000) : Math.round(n);
    maj[`vitesse.${reseau}.${metrique}.${trancheVitesse(metrique, v)}`] = FieldValue.increment(1);
  }

  const erreurs = Array.isArray(paquet.x) ? paquet.x.slice(0, 3) : [];
  for (const er of erreurs) {
    if (!er || typeof er !== "object") continue;
    const e = er as Record<string, unknown>;
    const message = texteCourt(e.m, 300);
    if (!message) continue;
    maj["erreursClient"] = FieldValue.increment(1);
    logger.error(`ERREUR_CLIENT ${message}`, {
      page,
      source: texteCourt(e.s, 200),
      ligne: Number(e.l) || 0,
      pile: texteCourt(e.k, 1200),
      navigateur: texteCourt(req.get("user-agent"), 160),
      reseau,
      version: texteCourt(paquet.c, 20),
    });
  }

  if (Object.keys(maj).length) {
    const jour = new Date(maintenant + 0).toISOString().slice(0, 10); // Conakry = UTC
    try {
      await db.collection("statistiques").doc(jour).set(maj, { merge: true });
    } catch (err) {
      logger.error("Collecte : écriture des statistiques impossible", err);
    }
  }
  res.status(204).end();
});

// ---------- Adresses des fiches et catégories (mise à jour n°2, référencement) ----------
// Firebase Hosting sert d'abord les pages pré-rendues /produit/<nom>-<xxxx>
// et /categorie/<slug>. Tout le reste de /produit/** et /categorie/**
// arrive ici :
//  • ancienne adresse /produit/<identifiant>, ou nom changé depuis →
//    redirection 301 vers l'adresse actuelle ;
//  • produit tout juste ajouté (page pas encore pré-rendue, ~1 min) →
//    302 vers la page modèle /produit?id=… (non indexée) ;
//  • catégorie connue sans page pré-rendue → page catalogue (200) ;
//  • sinon → vraie page 404 (code 404).
// Calcul de l'adresse : public/js/slug.js, copié dans prerender/slug.mjs.
const CATEGORIES_CONNUES = new Set(["telephones", "ordinateurs", "tablettes", "televisions", "electronique", "energie", "vetements", "chaussures", "voitures"]);
let adressesMemoire: { parSlug: Map<string, string>; parId: Map<string, string>; expireAt: number } | null = null;
let page404Memoire: { html: string; expireAt: number } | null = null;
const pagesMemoire = new Map<string, { html: string; expireAt: number }>();

async function adressesProduits() {
  if (adressesMemoire && adressesMemoire.expireAt > Date.now()) return adressesMemoire;
  const { slugProduit } = await importerModule(require("url").pathToFileURL(path.join(__dirname, "..", "prerender", "slug.mjs")).href);
  const snap = await db.collection("produits").select("infosGenerales.nom", "nom").get();
  const parSlug = new Map<string, string>();
  const parId = new Map<string, string>();
  for (const d of snap.docs) {
    const nom = d.get("infosGenerales.nom") ?? d.get("nom") ?? "";
    const slug = slugProduit(d.id, nom);
    parSlug.set(slug, d.id);
    parId.set(d.id, slug);
  }
  adressesMemoire = { parSlug, parId, expireAt: Date.now() + 2 * 60 * 1000 };
  return adressesMemoire;
}

async function pageDuSite(chemin: string): Promise<string> {
  const m = pagesMemoire.get(chemin);
  if (m && m.expireAt > Date.now()) return m.html;
  const rep = await fetch(`${SITE_URL}${chemin}`, { signal: AbortSignal.timeout(8000) });
  const html = await rep.text();
  pagesMemoire.set(chemin, { html, expireAt: Date.now() + 10 * 60 * 1000 });
  return html;
}

export const pageProduit = onRequest({ maxInstances: 5, concurrency: 80, memory: "256MiB", cpu: 1 }, async (req, res) => {
  const pas404 = async () => {
    res.set("Cache-Control", "public, max-age=60, s-maxage=300");
    try {
      if (!page404Memoire || page404Memoire.expireAt < Date.now()) page404Memoire = { html: await pageDuSite("/404.html"), expireAt: Date.now() + 10 * 60 * 1000 };
      res.status(404).type("html").send(page404Memoire.html);
    } catch {
      res.status(404).type("text").send("Page introuvable");
    }
  };
  try {
    const chemin = decodeURIComponent(req.path).replace(/\.html$/, "").replace(/\/+$/, "");
    const cat = chemin.match(/^\/categorie\/([^/]+)$/)?.[1];
    if (cat !== undefined) {
      if (!CATEGORIES_CONNUES.has(cat)) return pas404();
      res.set("Cache-Control", "public, max-age=60, s-maxage=120");
      res.status(200).type("html").send(await pageDuSite("/catalogue"));
      return;
    }
    const segment = chemin.match(/^\/produit\/([^/]+)$/)?.[1];
    if (!segment) return pas404();
    const { parSlug, parId } = await adressesProduits();
    // Page pré-rendue pas encore publiée pour ce produit tout récent.
    const idExact = parSlug.get(segment);
    if (idExact) {
      res.set("Cache-Control", "no-store");
      res.redirect(302, `/produit?id=${encodeURIComponent(idExact)}`);
      return;
    }
    // Ancienne adresse : identifiant brut, ou nom changé (même suffixe).
    let id = parId.has(segment) ? segment : null;
    if (!id) {
      const suffixe = segment.match(/-([a-z0-9]{4})$/i)?.[1]?.toLowerCase();
      const candidats = suffixe ? [...parId.keys()].filter((k) => k.slice(0, 4).toLowerCase() === suffixe) : [];
      if (candidats.length === 1) id = candidats[0];
    }
    if (id) {
      res.set("Cache-Control", "public, max-age=3600, s-maxage=3600");
      res.redirect(301, `/produit/${encodeURIComponent(parId.get(id)!)}`);
      return;
    }
    return pas404();
  } catch (err) {
    logger.error("pageProduit", err);
    res.set("Cache-Control", "no-store");
    res.status(503).type("text").send("Service momentanément indisponible, réessayez.");
  }
});
