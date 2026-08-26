import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import * as crypto from "crypto";

initializeApp();
setGlobalOptions({ region: "europe-west1", maxInstances: 10 });

const db = getFirestore();

// Un utilisateur authentifié n'est pas forcément un admin — voir
// firestore.rules pour le même contrôle côté règles. Ici c'est nécessaire
// en plus, car le SDK Admin utilisé par les Cloud Functions ne passe pas
// par firestore.rules : chaque fonction réservée à l'équipe doit vérifier
// elle-même l'appartenance à la liste blanche `admins/{uid}`.
async function assertAdmin(uid: string | undefined): Promise<void> {
  if (!uid) {
    throw new HttpsError("unauthenticated", "Réservé à l'équipe Makitti.");
  }
  const adminSnap = await db.collection("admins").doc(uid).get();
  if (!adminSnap.exists) {
    throw new HttpsError("permission-denied", "Réservé à l'équipe Makitti.");
  }
}

// Statuts pour lesquels le code de livraison d'une commande est encore "actif"
// (donc à exclure lors de la génération d'un nouveau code pour éviter tout
// doublon en cours). Une fois livrée ou retournée, la commande est classée et
// son ancien code peut être réutilisé sans risque de confusion.
const STATUTS_CODE_ACTIF = ["nouvelle", "confirmee", "en_livraison", "en_negociation"];

interface CreerCommandeData {
  produitId: string;
  varianteId?: string;
  quantite: number;
  clientNom: string;
  clientTel: string;
  ville: string;
  quartier: string;
  repere?: string;
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

// Génèrent le code/numéro ET vérifient leur unicité À L'INTÉRIEUR de la même
// transaction que l'écriture finale de la commande (voir creerCommande) :
// sans ça, deux commandes créées à quelques millisecondes d'intervalle
// pourraient toutes les deux passer la vérification avant qu'aucune n'ait
// écrit, et se retrouver avec le même code actif ou le même numéro — un
// simple Promise.all + set() séparé ne protège pas contre cette course.
// tx.get(query) fait participer la requête elle-même aux garanties de la
// transaction : si un autre appel commite un document qui la ferait matcher
// entre-temps, Firestore fait échouer/réessayer cette transaction.
async function candidatCodeLivraisonUnique(
  tx: FirebaseFirestore.Transaction,
  longueur: number
): Promise<string> {
  for (let tentative = 0; tentative < 25; tentative++) {
    const code = genererCodeChiffres(longueur);
    const conflit = await tx.get(
      db
        .collection("commandes")
        .where("codeLivraison", "==", code)
        .where("statut", "in", STATUTS_CODE_ACTIF)
        .limit(1)
    );
    if (conflit.empty) return code;
  }
  throw new HttpsError(
    "resource-exhausted",
    "Impossible de générer un code de livraison unique, réessaie."
  );
}

async function candidatNumeroCommandeUnique(
  tx: FirebaseFirestore.Transaction
): Promise<string> {
  const annee = new Date().getFullYear();
  for (let tentative = 0; tentative < 25; tentative++) {
    const suffixe = String(crypto.randomInt(0, 100000)).padStart(5, "0");
    const numero = `MK-${annee}-${suffixe}`;
    const conflit = await tx.get(
      db.collection("commandes").where("numero", "==", numero).limit(1)
    );
    if (conflit.empty) return numero;
  }
  throw new HttpsError(
    "resource-exhausted",
    "Impossible de générer un numéro de commande unique, réessaie."
  );
}

export const creerCommande = onCall<CreerCommandeData>(async (request) => {
  const data = request.data;

  const clientNom = (data.clientNom || "").trim();
  const clientTel = (data.clientTel || "").trim();
  const ville = (data.ville || "").trim();
  const quartier = (data.quartier || "").trim();
  const repere = (data.repere || "").trim();
  const produitId = (data.produitId || "").trim();
  const quantite = Math.floor(Number(data.quantite));

  if (!clientNom) throw new HttpsError("invalid-argument", "Le nom complet est obligatoire.");
  if (!clientTel) throw new HttpsError("invalid-argument", "Le numéro de téléphone est obligatoire.");
  if (!ville) throw new HttpsError("invalid-argument", "Ville de livraison invalide.");
  if (!quartier) throw new HttpsError("invalid-argument", "Le quartier est obligatoire.");
  if (!produitId) throw new HttpsError("invalid-argument", "Produit manquant.");
  if (!Number.isFinite(quantite) || quantite < 1) {
    throw new HttpsError("invalid-argument", "Quantité invalide.");
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

  const produitRef = db.collection("produits").doc(produitId);
  const produitSnap = await produitRef.get();
  if (!produitSnap.exists) {
    throw new HttpsError("not-found", "Ce produit n'existe plus.");
  }
  const produit = produitSnap.data()!;

  // Le prix ne vient JAMAIS d'une valeur envoyée par le client : soit de la
  // variante précise choisie (chaque variante porte son propre prix), soit
  // de caracteristiques.prix pour les catégories sans variantes. Un
  // varianteId manquant sur un produit qui a des variantes est un rejet, pas
  // un prix par défaut silencieux.
  //
  // Pas de stock : Makiti n'a pas d'entrepôt, les produits sont pris en
  // dépôt-vente chez le fournisseur et commandés sans limite de quantité
  // ici — voir produits.js/produit-detail.js côté affichage.
  const variantesSnap = await produitRef.collection("variantes").limit(1).get();
  const aDesVariantes = !variantesSnap.empty;

  let prixUnitaire: number;
  let varianteId: string | null = null;
  let varianteLibelle: string | null = null;

  if (aDesVariantes) {
    const varianteIdDemandee = (data.varianteId || "").trim();
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

  // Délai affiché au client : celui configuré pour sa région si l'admin l'a
  // renseigné, sinon un repli générique.
  const DELAI_PAR_DEFAUT = "3 jours";

  const produitNom = produit.infosGenerales?.nom || produit.nom || "";
  const longueurCode = await longueurCodeConfiguree();
  const commandeRef = db.collection("commandes").doc();

  const { codeLivraison, numero } = await db.runTransaction(async (tx) => {
    // Toutes les lectures de la transaction (candidats code + numéro)
    // doivent précéder l'écriture finale — c'est cette écriture, à
    // l'intérieur de la même transaction que les vérifications d'unicité,
    // qui ferme la course entre deux commandes créées presque en même temps.
    const codeLivraison = await candidatCodeLivraisonUnique(tx, longueurCode);
    const numero = await candidatNumeroCommandeUnique(tx);

    tx.set(commandeRef, {
      numero,
      clientNom,
      clientTel,
      ville,
      quartier,
      repere: repere || null,
      produitId,
      produitNom,
      produitImage: (Array.isArray(produit.images) && produit.images[0]) || null,
      varianteId,
      varianteLibelle,
      quantite,
      prixInitial: prixUnitaire * quantite,
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

    return { codeLivraison, numero };
  });

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
  token: string;
}

// Écrit exclusivement via cette fonction (SDK Admin, contourne firestore.rules)
// — même logique que creerAvis/enregistrerPaiementFournisseur : la règle
// `commandes` interdit toute écriture client directe (allow update: if
// isAdmin()), donc le client anonyme n'a aucun autre moyen d'associer son
// jeton FCM à sa commande. Pas d'assertAdmin ici : c'est bien le client, pas
// l'équipe Makiti, qui appelle cette fonction depuis la page de suivi.
export const enregistrerTokenNotification = onCall<EnregistrerTokenNotificationData>(async (request) => {
  const commandeId = (request.data.commandeId || "").trim();
  const token = (request.data.token || "").trim();

  if (!commandeId) throw new HttpsError("invalid-argument", "Commande manquante.");
  if (!token) throw new HttpsError("invalid-argument", "Jeton de notification manquant.");

  const commandeRef = db.collection("commandes").doc(commandeId);
  const snap = await commandeRef.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Cette commande n'existe plus.");
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
    corps: "Un agent Makitti souhaite échanger avec vous au sujet de votre commande.",
  },
  en_livraison: { titre: "Commande en livraison", corps: "Votre commande est en route vers vous." },
  livree: { titre: "Commande livrée", corps: "Votre commande a été livrée. Merci d'avoir choisi Makitti !" },
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
        fcmOptions: { link: `https://makiti-gn.web.app/suivi.html?id=${event.params.commandeId}` },
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
  note: number;
  commentaire?: string;
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
    if (commande.statut !== "livree") {
      throw new HttpsError(
        "failed-precondition",
        "Un avis ne peut être laissé que pour une commande livrée."
      );
    }
    if (commande.avisSoumis) {
      throw new HttpsError("already-exists", "Un avis a déjà été envoyé pour cette commande.");
    }

    tx.set(avisRef, {
      produitId: commande.produitId || null,
      produitNom: commande.produitNom || "",
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
// Montant dû aux fournisseurs (dépôt-vente) : Makiti doit au fournisseur le
// prix d'achat (coût) de chaque unité vendue de son produit — pas le prix de
// vente client, dont Makiti garde la différence comme marge. `fournisseurs/
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

async function prixAchatCommande(
  commandeData: FirebaseFirestore.DocumentData,
  tx: FirebaseFirestore.Transaction
): Promise<number> {
  const produitId = commandeData.produitId;
  if (!produitId) return 0;

  // Le prix d'achat ne vit jamais sur le document produit/variante lui-même
  // (lisible publiquement, catalogue) mais dans une sous-collection admin
  // dédiée produits/{id}/interne/achat — voir firestore.rules.
  const achatSnap = await tx.get(db.collection("produits").doc(produitId).collection("interne").doc("achat"));
  if (!achatSnap.exists) return 0;
  const achat = achatSnap.data()!;

  if (commandeData.varianteId) {
    return Number(achat.parVariante?.[commandeData.varianteId]) || 0;
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
  // client) et exposerait sinon le prix d'achat/la marge exacte de Makiti à
  // quiconque connaît un numéro de commande.
  const interneRef = commandeRef.collection("interne").doc("fournisseur");

  await db.runTransaction(async (tx) => {
    const commandeSnap = await tx.get(commandeRef);
    if (!commandeSnap.exists) return;
    const commande = commandeSnap.data()!;
    const interneSnap = await tx.get(interneRef);
    const interne = interneSnap.data();

    // Idempotence face aux relectures (retries) d'un même événement, ou à
    // un événement qui arriverait après qu'un événement suivant ait déjà
    // traité la transition : on ne recrédite/redébite jamais un état déjà
    // reflété par ce drapeau.
    const dejaComptabilise = !!interne?.comptabilise;
    if (devientLivree && dejaComptabilise) return;
    if (quitteLivree && !dejaComptabilise) return;

    // Toutes les lectures de la transaction doivent précéder ses écritures.
    const fournisseurId = await fournisseurIdDuProduit(commande.produitId, tx);
    if (!fournisseurId) return;

    let montant: number;
    if (devientLivree) {
      const prixAchat = await prixAchatCommande(commande, tx);
      const quantite = Number(commande.quantite) || 0;
      montant = prixAchat * quantite;
      if (montant <= 0) return;
    } else {
      // On annule exactement le montant précédemment crédité (pas un
      // recalcul), au cas où le prix d'achat du produit aurait changé
      // depuis — sinon le solde dériverait.
      montant = Number(interne?.montant) || 0;
      if (montant <= 0) return;
    }

    const fournisseurRef = db.collection("fournisseurs").doc(fournisseurId);
    tx.update(fournisseurRef, { montantDu: FieldValue.increment(devientLivree ? montant : -montant) });
    tx.set(
      interneRef,
      {
        comptabilise: devientLivree,
        montant: devientLivree ? montant : FieldValue.delete(),
      },
      { merge: true }
    );
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
// [debut, fin[, part Makiti = prix vente - prix achat - frais livreur.
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
  partMakiti: number;
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

  const lignes: LigneRepartition[] = [];
  for (const docSnap of commandesSnap.docs) {
    const c = docSnap.data();
    const quantite = Number(c.quantite) || 0;
    const venteTotale = Number(c.prixConvenu != null ? c.prixConvenu : c.prixInitial) || 0;

    let prixAchatUnitaire = 0;
    if (c.produitId) {
      const achat = await getAchat(c.produitId);
      prixAchatUnitaire = c.varianteId
        ? Number(achat?.parVariante?.[c.varianteId]) || 0
        : Number(achat?.prixAchat) || 0;
    }
    const prixAchat = prixAchatUnitaire * quantite;

    let fraisLivreur = 0;
    if (c.livreurId) {
      const livreur = await getLivreur(c.livreurId);
      fraisLivreur = livreur ? Number(livreur.fraisParLivraison) || 0 : 0;
    }

    lignes.push({
      id: docSnap.id,
      numero: c.numero || "",
      produitId: c.produitId || null,
      produitNom: c.produitNom || "",
      quantite,
      venteTotale,
      prixAchat,
      fraisLivreur,
      partMakiti: venteTotale - prixAchat - fraisLivreur,
    });
  }

  const totaux = lignes.reduce(
    (acc, l) => ({
      venteTotale: acc.venteTotale + l.venteTotale,
      prixAchat: acc.prixAchat + l.prixAchat,
      fraisLivreur: acc.fraisLivreur + l.fraisLivreur,
      partMakiti: acc.partMakiti + l.partMakiti,
    }),
    { venteTotale: 0, prixAchat: 0, fraisLivreur: 0, partMakiti: 0 }
  );

  // Top produits de la période : classés par quantité vendue, nom repris
  // directement de la commande (déjà dénormalisé), pas de lecture produit
  // supplémentaire nécessaire.
  const parProduit = new Map<string, { nom: string; quantite: number }>();
  for (const l of lignes) {
    if (!l.produitId) continue;
    const entree = parProduit.get(l.produitId) || { nom: l.produitNom, quantite: 0 };
    entree.quantite += l.quantite;
    parProduit.set(l.produitId, entree);
  }
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

  // writeBatch est plafonné à 500 opérations : découpage par précaution,
  // même si le volume réel de la corbeille reste très en dessous en pratique.
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 450) {
    const batch = db.batch();
    docs.slice(i, i + 450).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
});
