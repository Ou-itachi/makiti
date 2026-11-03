#!/usr/bin/env node
// Remplit l'émulateur Firestore / Auth pour tester en local (npm run emulateur
// dans un terminal, puis npm run emulateur:donnees dans un autre).
//
// • Produits et variantes : copiés depuis la production par l'API REST
//   publique, en LECTURE seule (mêmes données que le navigateur).
// • Promotions, épingle, commandes livrées, avis, compte admin : FICTIFS,
//   écrits uniquement dans l'émulateur.
//
// Refuse de tourner hors émulateur : les variables *_EMULATOR_HOST sont
// imposées ici et le projet doit commencer par « demo- ».
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
const PROJET = "demo-bokki";
if (!PROJET.startsWith("demo-")) throw new Error("Projet de démonstration obligatoire.");

const admin = require("../functions/node_modules/firebase-admin/lib/index.js");
admin.initializeApp({ projectId: PROJET });
const db = admin.firestore();
const { Timestamp } = admin.firestore;

const PROD = "https://firestore.googleapis.com/v1/projects/makiti-gn/databases/(default)/documents";
const JOUR = 86400000;
const ilYa = (j) => Timestamp.fromMillis(Date.now() - j * JOUR);
const dansJours = (j) => Timestamp.fromMillis(Date.now() + j * JOUR);

function valeur(v) {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return Timestamp.fromDate(new Date(v.timestampValue));
  if ("mapValue" in v) return champs(v.mapValue.fields || {});
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(valeur);
  return null;
}
function champs(f = {}) {
  return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, valeur(v)]));
}
async function lireProd(chemin) {
  const docs = [];
  let page = "";
  do {
    const rep = await fetch(`${PROD}/${chemin}?pageSize=200${page ? `&pageToken=${page}` : ""}`);
    if (!rep.ok) throw new Error(`Lecture production : HTTP ${rep.status}`);
    const j = await rep.json();
    docs.push(...(j.documents || []));
    page = j.nextPageToken || "";
  } while (page);
  return docs.map((d) => ({ id: d.name.split("/").pop(), ...champs(d.fields) }));
}

const CLIENTS = [
  ["Mariama Bah", "Conakry", "Kipé"], ["Ibrahima Sow", "Kindia", "Centre"], ["Aïssatou Diallo", "Labé", "Tata"],
  ["Mamadou Camara", "Conakry", "Ratoma"], ["Fatoumata Barry", "Kankan", "Bordo"], ["Sékou Keita", "Mamou", "Poudrière"],
];
const COMMENTAIRES = [
  "Livré en deux jours, téléphone neuf comme promis. J'ai payé à la réception.",
  "Très bon service, le livreur a appelé avant de venir.",
  "Produit conforme à la photo. Je recommande Bokki.",
  "Commande simple et rapide, merci à l'équipe.",
];

async function principal() {
  const produits = await lireProd("produits");
  if (!produits.length) throw new Error("Aucun produit lu.");
  const variantes = {};
  for (const p of produits) variantes[p.id] = await lireProd(`produits/${p.id}/variantes`);

  const avecV = produits.filter((p) => variantes[p.id].length);
  const sansV = produits.filter((p) => !variantes[p.id].length);

  // Scénarios fictifs : promo active avec fin, promo sans fin, promo expirée,
  // promo sur variantes, produit épinglé.
  const prixDe = (p) => Number(p.caracteristiques?.prix ?? p.prixVente) || 0;
  const arrondi = (n) => Math.round(n / 1000) * 1000;
  const scenarios = {};
  if (sansV[0]) scenarios[sansV[0].id] = { promo: { actif: true, prix: arrondi(prixDe(sansV[0]) * 0.85), fin: dansJours(5) } };
  if (sansV[1]) scenarios[sansV[1].id] = { promo: { actif: true, prix: arrondi(prixDe(sansV[1]) * 0.9), fin: null } };
  if (sansV[2]) scenarios[sansV[2].id] = { promo: { actif: true, prix: arrondi(prixDe(sansV[2]) * 0.8), fin: ilYa(1) } };
  if (sansV[3]) scenarios[sansV[3].id] = { epingle: true };

  // Promotion sur variantes : un produit, toutes ses variantes à -10 %.
  if (avecV[0]) {
    variantes[avecV[0].id].forEach((v) => { v.prixPromo = arrondi(Number(v.prix) * 0.9); });
    const moins = variantes[avecV[0].id].reduce((x, y) => (y.prixPromo < x.prixPromo ? y : x));
    scenarios[avecV[0].id] = { promo: { actif: true, prix: moins.prixPromo, prixNormal: Number(moins.prix), fin: dansJours(10) } };
  }

  const lot = db.bulkWriter();
  for (const p of produits) {
    const { id, ...d } = p;
    lot.set(db.doc(`produits/${id}`), { ...d, ...(scenarios[id] || {}) });
    variantes[id].forEach((v) => {
      const { id: vid, ...dv } = v;
      lot.set(db.doc(`produits/${id}/variantes/${vid}`), dv);
    });
  }

  // Commandes livrées : quantités décroissantes sur 7 produits (classement),
  // plus une commande trop ancienne et une retournée, qui ne doivent pas compter.
  let n = 0;
  const commande = (p, quantite, statut, dateLivraison, extra = {}) => {
    const [clientNom, ville, quartier] = CLIENTS[n % CLIENTS.length];
    n++;
    const v = variantes[p.id][0];
    const prixUnitaire = v ? Number(v.prix) : prixDe(p);
    lot.set(db.collection("commandes").doc(), {
      numero: `BK-TEST-${n}`, clientNom, clientTel: `62400000${n}`, ville, region: ville, quartier,
      articles: [{ produitId: p.id, varianteId: v?.id || null, nom: p.infosGenerales?.nom || "", image: null, varianteLibelle: v?.libelle || null, quantite, prixUnitaire, prixInitial: prixUnitaire * quantite }],
      produitIds: [p.id], montantTotal: prixUnitaire * quantite, prixConvenu: null, statut, codeLivraison: "1234",
      dateCreation: dateLivraison, dateLivraison, ...extra,
    });
  };
  produits.slice(0, 7).forEach((p, i) => commande(p, 7 - i, "livree", ilYa(i + 2)));
  if (produits[7]) commande(produits[7], 50, "livree", ilYa(45)); // hors des 30 jours
  if (produits[8]) commande(produits[8], 50, "retournee", ilYa(3)); // pas livrée

  // Avis : notes variées, un avis à 3 étoiles (exclu de la section d'accueil)
  // et un avis sur plusieurs articles (rattaché à aucun produit).
  [5, 4, 5, 3, 5].forEach((note, i) => {
    const p = produits[i % 2];
    const [clientNom, ville] = CLIENTS[i];
    lot.set(db.collection("avis").doc(), {
      produitId: p.id, produitNom: p.infosGenerales?.nom || "", clientNom, ville, note,
      commentaire: COMMENTAIRES[i % COMMENTAIRES.length], dateCreation: ilYa(i + 1),
    });
  });
  lot.set(db.collection("avis").doc(), {
    produitId: null, produitNom: "Commande + 1 autre article", clientNom: "Kadiatou Bah", ville: "Boké", note: 5,
    commentaire: "Deux articles livrés ensemble, parfait.", dateCreation: ilYa(0.5),
  });
  await lot.close();

  // Compte admin de test (émulateur uniquement).
  const auth = admin.auth();
  const email = "admin@bokki.test";
  const compte = await auth.getUserByEmail(email).catch(() => auth.createUser({ email, password: "bokki-test-1234" }));
  await db.doc(`admins/${compte.uid}`).set({ email });
  await db.doc("parametres/livraison").set({ longueurCode: 4 }, { merge: true });

  console.log(`Émulateur rempli : ${produits.length} produits, ${n} commandes, 6 avis.`);
  console.log(`Admin : ${email} / bokki-test-1234`);
  console.log("Site : http://localhost:5055/?emulator=1  —  Admin : http://localhost:5055/admin/login.html?emulator=1");
}

principal().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
