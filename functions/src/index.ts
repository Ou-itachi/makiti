import { onCall, HttpsError } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
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
    throw new HttpsError("unauthenticated", "Réservé à l'équipe Makiti.");
  }
  const adminSnap = await db.collection("admins").doc(uid).get();
  if (!adminSnap.exists) {
    throw new HttpsError("permission-denied", "Réservé à l'équipe Makiti.");
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
  livraisonType?: string;
}

function genererCode4Chiffres(): string {
  return String(crypto.randomInt(0, 10000)).padStart(4, "0");
}

async function genererCodeLivraisonUnique(): Promise<string> {
  for (let tentative = 0; tentative < 25; tentative++) {
    const code = genererCode4Chiffres();
    const conflit = await db
      .collection("commandes")
      .where("codeLivraison", "==", code)
      .where("statut", "in", STATUTS_CODE_ACTIF)
      .limit(1)
      .get();
    if (conflit.empty) return code;
  }
  throw new HttpsError(
    "resource-exhausted",
    "Impossible de générer un code de livraison unique, réessaie."
  );
}

async function genererNumeroCommandeUnique(): Promise<string> {
  const annee = new Date().getFullYear();
  for (let tentative = 0; tentative < 25; tentative++) {
    const suffixe = String(crypto.randomInt(0, 100000)).padStart(5, "0");
    const numero = `MK-${annee}-${suffixe}`;
    const conflit = await db
      .collection("commandes")
      .where("numero", "==", numero)
      .limit(1)
      .get();
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
  const livraisonType = data.livraisonType === "premium" ? "premium" : "standard";

  if (!clientNom) throw new HttpsError("invalid-argument", "Le nom complet est obligatoire.");
  if (!clientTel) throw new HttpsError("invalid-argument", "Le numéro de téléphone est obligatoire.");
  if (!ville) throw new HttpsError("invalid-argument", "Ville de livraison invalide.");
  if (!quartier) throw new HttpsError("invalid-argument", "Le quartier est obligatoire.");
  if (!produitId) throw new HttpsError("invalid-argument", "Produit manquant.");
  if (!Number.isFinite(quantite) || quantite < 1) {
    throw new HttpsError("invalid-argument", "Quantité invalide.");
  }

  const zoneSnap = await db.collection("zones").where("ville", "==", ville).limit(1).get();
  if (zoneSnap.empty) {
    throw new HttpsError("invalid-argument", "Ville de livraison invalide.");
  }
  const zone = zoneSnap.docs[0].data();

  const produitRef = db.collection("produits").doc(produitId);
  const produitSnap = await produitRef.get();
  if (!produitSnap.exists) {
    throw new HttpsError("not-found", "Ce produit n'existe plus.");
  }
  const produit = produitSnap.data()!;

  // Le prix et le stock ne viennent JAMAIS d'une valeur envoyée par le
  // client : soit de la variante précise choisie (chaque variante porte son
  // propre prix + stock), soit de caracteristiques.prix/stock pour les
  // catégories sans variantes. Un varianteId manquant sur un produit qui a
  // des variantes est un rejet, pas un prix par défaut silencieux.
  const variantesSnap = await produitRef.collection("variantes").limit(1).get();
  const aDesVariantes = !variantesSnap.empty;

  let prixUnitaire: number;
  let stockDisponible: number;
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
    stockDisponible = Number(variante.stock) || 0;
    varianteId = varianteSnap.id;
    varianteLibelle = variante.libelle || null;
  } else {
    // Repli sur l'ancien schéma plat (prixVente/stock) pour les produits pas
    // encore migrés vers infosGenerales/caracteristiques — aucune migration
    // de données n'est faite dans ce ticket, ce repli évite de casser la
    // commande de produits existants tant qu'ils n'ont pas été recréés dans
    // le nouveau format.
    const caracteristiques = produit.caracteristiques || {};
    prixUnitaire = Number(caracteristiques.prix ?? produit.prixVente) || 0;
    stockDisponible = Number(caracteristiques.stock ?? produit.stock) || 0;
  }

  if (stockDisponible < quantite) {
    throw new HttpsError(
      "failed-precondition",
      `Stock insuffisant (${stockDisponible} disponible${stockDisponible > 1 ? "s" : ""}).`
    );
  }

  const [codeLivraison, numero] = await Promise.all([
    genererCodeLivraisonUnique(),
    genererNumeroCommandeUnique(),
  ]);

  // Livraison standard gratuite. En Premium, le frais vient du tableau
  // Zones & livraison (admin), jamais d'une valeur envoyée par le client.
  const fraisLivraison = livraisonType === "premium" ? Number(zone.frais) || 0 : 0;

  const produitNom = produit.infosGenerales?.nom || produit.nom || "";

  const commandeRef = db.collection("commandes").doc();
  await commandeRef.set({
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
    prixInitial: prixUnitaire * quantite + fraisLivraison,
    prixConvenu: null,
    livraisonType,
    fraisLivraison,
    delaiEstime: zone.delai || null,
    statut: "nouvelle",
    codeLivraison,
    livreurId: null,
    dateCreation: FieldValue.serverTimestamp(),
    dateLivraison: null,
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
  if (!/^\d{4}$/.test(code)) {
    throw new HttpsError("invalid-argument", "Le code doit contenir 4 chiffres.");
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
