import { onCall, HttpsError } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import * as crypto from "crypto";

initializeApp();
setGlobalOptions({ region: "europe-west1", maxInstances: 10 });

const db = getFirestore();

const VILLES_VALIDES = ["Conakry", "Kindia", "Kankan", "Labé"];

// Statuts pour lesquels le code de livraison d'une commande est encore "actif"
// (donc à exclure lors de la génération d'un nouveau code pour éviter tout
// doublon en cours). Une fois livrée ou retournée, la commande est classée et
// son ancien code peut être réutilisé sans risque de confusion.
const STATUTS_CODE_ACTIF = ["nouvelle", "confirmee", "en_livraison", "en_negociation"];

interface CreerCommandeData {
  produitId: string;
  quantite: number;
  clientNom: string;
  clientTel: string;
  ville: string;
  quartier: string;
  repere?: string;
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

  if (!clientNom) throw new HttpsError("invalid-argument", "Le nom complet est obligatoire.");
  if (!clientTel) throw new HttpsError("invalid-argument", "Le numéro de téléphone est obligatoire.");
  if (!VILLES_VALIDES.includes(ville)) {
    throw new HttpsError("invalid-argument", "Ville de livraison invalide.");
  }
  if (!quartier) throw new HttpsError("invalid-argument", "Le quartier est obligatoire.");
  if (!produitId) throw new HttpsError("invalid-argument", "Produit manquant.");
  if (!Number.isFinite(quantite) || quantite < 1) {
    throw new HttpsError("invalid-argument", "Quantité invalide.");
  }

  const produitRef = db.collection("produits").doc(produitId);
  const produitSnap = await produitRef.get();
  if (!produitSnap.exists) {
    throw new HttpsError("not-found", "Ce produit n'existe plus.");
  }
  const produit = produitSnap.data()!;

  if (typeof produit.stock === "number" && produit.stock < quantite) {
    throw new HttpsError(
      "failed-precondition",
      `Stock insuffisant (${produit.stock} disponible${produit.stock > 1 ? "s" : ""}).`
    );
  }

  const [codeLivraison, numero] = await Promise.all([
    genererCodeLivraisonUnique(),
    genererNumeroCommandeUnique(),
  ]);

  const commandeRef = db.collection("commandes").doc();
  await commandeRef.set({
    numero,
    clientNom,
    clientTel,
    ville,
    quartier,
    repere: repere || null,
    produitId,
    produitNom: produit.nom || "",
    produitImage: (Array.isArray(produit.images) && produit.images[0]) || null,
    quantite,
    prixInitial: (produit.prixVente || 0) * quantite,
    prixConvenu: null,
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
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Réservé à l'équipe Makiti.");
  }

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
