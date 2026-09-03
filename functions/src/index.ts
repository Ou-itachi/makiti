import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import * as crypto from "crypto";

initializeApp();
// maxInstances 40 (au lieu de 10) : marge pour un pic de lancement. Les
// fonctions v2 gèrent en plus la concurrence par instance ; 40 plafonne
// aussi une éventuelle dérive de coût. creerCommande ne fait plus de
// requête-dans-transaction, la latence par appel reste basse même en pic.
setGlobalOptions({ region: "europe-west1", maxInstances: 40 });

const db = getFirestore();

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

// Statuts pour lesquels le code de livraison d'une commande est encore "actif"
// (donc à exclure lors de la génération d'un nouveau code pour éviter tout
// doublon en cours). Une fois livrée ou retournée, la commande est classée et
// son ancien code peut être réutilisé sans risque de confusion.
const STATUTS_CODE_ACTIF = ["nouvelle", "confirmee", "en_livraison", "en_negociation"];

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

async function reserverCodeLivraison(longueur: number, commandeId: string): Promise<string> {
  for (let tentative = 0; tentative < 40; tentative++) {
    const code = genererCodeChiffres(longueur);
    try {
      await db.collection("codesActifs").doc(code).create({
        commandeId,
        dateCreation: FieldValue.serverTimestamp(),
      });
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

  return {
    produitId,
    varianteId,
    nom: produit.infosGenerales?.nom || produit.nom || "",
    image: (Array.isArray(produit.images) && produit.images[0]) || null,
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

export const creerCommande = onCall<CreerCommandeData>(async (request) => {
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
  const zonesSnap = await db.collection("zones").get();
  const zone = zonesSnap.docs
    .map((d) => d.data())
    .find((z) => normaliseVille(z.ville) === normaliseVille(ville));

  const articles = await Promise.all(articlesInput.map(resoudreArticle));
  const montantTotal = articles.reduce((somme, a) => somme + a.prixInitial, 0);
  const produitIds = [...new Set(articles.map((a) => a.produitId))];

  // Délai affiché au client : celui configuré pour sa région si l'admin l'a
  // renseigné, sinon un repli générique.
  const DELAI_PAR_DEFAUT = "3 jours";

  const longueurCode = await longueurCodeConfiguree();
  const commandeRef = db.collection("commandes").doc();

  // Numéro dérivé de l'ID (aucune contention) + code réservé atomiquement :
  // voir le bloc de commentaires plus haut.
  const numero = numeroDepuisId(commandeRef.id);
  const codeLivraison = await reserverCodeLivraison(longueurCode, commandeRef.id);

  // L'écriture finale est un simple set() sur un doc auto-ID unique : aucune
  // contention avec les autres commandes créées en même temps.
  try {
    await commandeRef.set({
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
      delaiEstime: (zone && zone.delai) || DELAI_PAR_DEFAUT,
      statut: "nouvelle",
      codeLivraison,
      livreurId: null,
      dateCreation: FieldValue.serverTimestamp(),
      dateLivraison: null,
    });
  } catch (err) {
    // La commande n'a pas pu être écrite : on libère le code réservé pour
    // ne pas "brûler" un code actif sans commande derrière. (Le numéro, lui,
    // reste consommé — un trou dans la séquence est sans conséquence.)
    await db.collection("codesActifs").doc(codeLivraison).delete().catch(() => undefined);
    throw err;
  }

  return {
    id: commandeRef.id,
    numero,
    codeLivraison,
  };
});

interface ValiderCodeLivraisonData {
  commandeId: string;
  code: string;
}

// Statuts à partir desquels une commande peut être marquée "livrée". Une
// commande déjà livrée, retournée, ou pas encore en livraison ne doit pas
// pouvoir être validée par ce chemin.
const STATUTS_VALIDABLES = ["en_livraison"];

export const validerCodeLivraison = onCall<ValiderCodeLivraisonData>(async (request) => {
  await assertAdmin(request.auth?.uid);

  const commandeId = (request.data.commandeId || "").trim();
  const code = (request.data.code || "").trim();

  if (!commandeId) throw new HttpsError("invalid-argument", "Commande manquante.");
  // 4 ou 6 chiffres : la longueur configurée peut avoir changé depuis que
  // cette commande précise a été créée (chaque commande garde le code tel
  // qu'il a été généré à l'époque) — la comparaison exacte juste en dessous
  // (commande.codeLivraison !== code) reste la vraie vérification, ceci
  // n'est qu'un rejet rapide des saisies manifestement mal formées.
  if (!/^\d{4}$|^\d{6}$/.test(code)) {
    throw new HttpsError("invalid-argument", "Le code doit contenir 4 ou 6 chiffres.");
  }

  const commandeRef = db.collection("commandes").doc(commandeId);
  const snap = await commandeRef.get();
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
  token: string;
}

// Écrit exclusivement via cette fonction (SDK Admin, contourne firestore.rules)
// — même logique que creerAvis/enregistrerPaiementFournisseur : la règle
// `commandes` interdit toute écriture client directe. Pas d'assertAdmin ici :
// c'est le client, pas l'équipe Bokki, qui appelle depuis la page de suivi.
//
// SÉCURITÉ : commandes.get est public (suivi par lien), donc un tiers qui
// obtient un lien de suivi connaît le commandeId. Sans autre preuve, il
// pourrait détourner les notifications de statut du vrai client (ou les
// couper). On exige donc AUSSI le code de livraison à 4/6 chiffres, qui n'est
// affiché qu'au vrai client sur sa page de confirmation/suivi.
export const enregistrerTokenNotification = onCall<EnregistrerTokenNotificationData>(async (request) => {
  const commandeId = (request.data.commandeId || "").trim();
  const code = (request.data.code || "").trim();
  const token = (request.data.token || "").trim();

  if (!commandeId) throw new HttpsError("invalid-argument", "Commande manquante.");
  if (!token || token.length > 4096) {
    throw new HttpsError("invalid-argument", "Jeton de notification invalide.");
  }

  const commandeRef = db.collection("commandes").doc(commandeId);
  const snap = await commandeRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Cette commande n'existe plus.");
  }
  if (String(snap.data()!.codeLivraison) !== code) {
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
export const creerAvis = onCall<CreerAvisData>(async (request) => {
  const commandeId = (request.data.commandeId || "").trim();
  const code = (request.data.code || "").trim();
  const note = Math.round(Number(request.data.note));
  const commentaire = (request.data.commentaire || "").trim().slice(0, COMMENTAIRE_MAX_LONGUEUR);

  if (!commandeId) throw new HttpsError("invalid-argument", "Commande manquante.");
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
    // commandes.get est public (suivi par lien) : sans le code de livraison,
    // un tiers ayant récupéré un lien de suivi pourrait publier un faux avis
    // sous le nom du vrai client. Le code n'est affiché qu'au vrai client.
    if (String(commande.codeLivraison) !== code) {
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
  // dédiée (admin uniquement), jamais sur le document commandes lui-même —
  // celui-ci est lisible publiquement (allow get: if true, pour le suivi
  // client) et exposerait sinon le prix d'achat/la marge exacte de Bokki à
  // quiconque connaît un numéro de commande.
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

  const commandesSnap = await db
    .collection("commandes")
    .where("dateCreation", ">=", debut)
    .where("dateCreation", "<", fin)
    .get();

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
