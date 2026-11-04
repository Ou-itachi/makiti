import { createApp, ref, computed, watch } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { db, functions } from "../firebase-config.js";
import {
  doc,
  getDoc,
  onSnapshot,
  collection,
  query,
  where,
  orderBy,
  limit,
  getCountFromServer,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";

import { FenetreConfirmation } from "./selection-lot.js";
import { FenetrePaiement, etatFournisseur, produitRetire } from "./paiement-fournisseur.js";
import { dateCourte, parPrenom } from "./recus-commun.js";

const commandesARegler = httpsCallable(functions, "commandesARegler");

const PLACEHOLDER_IMG =
  "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='%23E7E1D5'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-size='9' fill='%23948C7A' text-anchor='middle' dominant-baseline='middle'%3EBokki%3C/text%3E%3C/svg%3E";

function fmt(n) {
  return Math.round(n || 0).toLocaleString("fr-FR").replace(/,/g, " ");
}

function fmtDateFr(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function fmtMoisAnnee(ts) {
  if (!ts) return null;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

// Mêmes accesseurs compatibles ancien/nouveau schéma que produits.js — pas
// de listener partagé entre les deux pages, donc dupliqués ici plutôt que
// de faire dépendre cette page du montage Vue de produits.js.
function nomAffiche(p) {
  return p.infosGenerales?.nom ?? p.nom ?? "";
}
function imageAffichee(p) {
  // Vignette 480 px si disponible : affichée en petit dans la liste.
  return (Array.isArray(p.imagesSmall) && p.imagesSmall[0]) || (Array.isArray(p.images) && p.images[0]) || PLACEHOLDER_IMG;
}

const params = new URLSearchParams(location.search);
const fournisseurId = params.get("id");

const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;

createApp({
  components: { FenetrePaiement, FenetreConfirmation },
  setup() {
    const message = ref("");
    const afficherErreur = (texte) => { message.value = texte; };
    const etat = etatFournisseur(afficherErreur, () => { location.href = "fournisseurs.html"; });
    const retrait = produitRetire(afficherErreur);
    const fournisseur = ref(null);
    const loading = ref(true);
    const notFound = ref(!fournisseurId);
    const produits = ref([]);
    const paiements = ref([]);

    // Pas de stock (dépôt-vente, quantité illimitée) : à la place, le nombre
    // d'unités vendues par produit, compté via une requête agrégée sur les
    // commandes livrées (même pattern que produits.js / livreurs.js). Pas de
    // fournisseurId sur les commandes, donc on agrège produit par produit.
    const ventes = ref({});

    // Deux requêtes disjointes par construction : les commandes créées avant
    // l'évolution panier multi-articles portent produitId à plat, celles
    // créées depuis portent produitIds[] (tableau, potentiellement plusieurs
    // produits) — jamais les deux à la fois sur un même document, donc les
    // deux comptes s'additionnent sans risque de double comptage.
    async function loadVenduFor(produitId) {
      ventes.value = { ...ventes.value, [produitId]: { loading: true } };
      try {
        const [ancien, nouveau] = await Promise.all([
          getCountFromServer(
            query(collection(db, "commandes"), where("produitId", "==", produitId), where("statut", "==", "livree"))
          ),
          getCountFromServer(
            query(collection(db, "commandes"), where("produitIds", "array-contains", produitId), where("statut", "==", "livree"))
          ),
        ]);
        const count = ancien.data().count + nouveau.data().count;
        ventes.value = { ...ventes.value, [produitId]: { loading: false, count } };
      } catch (err) {
        console.error(err);
        ventes.value = { ...ventes.value, [produitId]: { loading: false, error: true } };
      }
    }
    function venduFor(produitId) {
      return ventes.value[produitId] || { loading: true };
    }

    // Prix d'achat : jamais sur le document produit/variante lui-même
    // (lisible publiquement), lu à part depuis produits/{id}/interne/achat
    // (même pattern que produits.js).
    const achatInterne = ref({});
    async function loadAchatFor(produitId) {
      try {
        const snap = await getDoc(doc(db, "produits", produitId, "interne", "achat"));
        achatInterne.value = { ...achatInterne.value, [produitId]: snap.exists() ? snap.data() : {} };
      } catch (err) {
        console.error(err);
        achatInterne.value = { ...achatInterne.value, [produitId]: {} };
      }
    }
    function prixAchatAffiche(p) {
      const achat = achatInterne.value[p.id];
      if (!achat) return 0;
      if (achat.parVariante) {
        const valeurs = Object.values(achat.parVariante).map((v) => Number(v) || 0);
        return valeurs.length ? Math.min(...valeurs) : 0;
      }
      return Number(achat.prixAchat) || 0;
    }

    watch(
      produits,
      (list) => {
        list.forEach((p) => {
          if (!(p.id in ventes.value)) loadVenduFor(p.id);
          if (!(p.id in achatInterne.value)) loadAchatFor(p.id);
        });
      },
      { immediate: true }
    );

    const totalVendus = computed(() => {
      if (produits.value.length === 0) return 0;
      if (produits.value.some((p) => venduFor(p.id).loading)) return null;
      return produits.value.reduce((sum, p) => sum + (venduFor(p.id).count || 0), 0);
    });
    const depuisText = computed(() => {
      const label = fournisseur.value ? fmtMoisAnnee(fournisseur.value.dateCreation) : null;
      return label ? `Fournisseur depuis ${label}` : "";
    });

    const paiementOuvert = ref(params.get("payer") === "1");
    const dejaVerse = computed(() => paiements.value.reduce((t, p) => t + (Number(p.montant) || 0), 0));

    // Le numéro n'apparaît que si le reçu existe encore : le paiement, lui, reste.
    const numerosRecus = ref(new Map());
    const recuDe = (p) => numerosRecus.value.get(p.recuId) || "";

    const commandes = ref([]);
    const nonAffecte = ref(0);
    const commandesCharge = ref(false);
    let duCharge = null;
    function chargerCommandes(du) {
      if (du === duCharge) return;
      duCharge = du;
      commandesARegler({ fournisseurId }).then((r) => {
        commandes.value = r.data.commandes;
        nonAffecte.value = r.data.nonAffecte;
        commandesCharge.value = true;
      }).catch((err) => { console.error(err); commandesCharge.value = true; });
    }

    const tousFournisseurs = ref([]);
    const autresFournisseurs = computed(() => tousFournisseurs.value.filter((f) => f.id !== fournisseurId && f.actif !== false && !f.supprime).sort(parPrenom));

    if (fournisseurId) {
      onSnapshot(
        doc(db, "fournisseurs", fournisseurId),
        (snap) => {
          loading.value = false;
          if (!snap.exists()) {
            notFound.value = true;
            fournisseur.value = null;
            return;
          }
          notFound.value = false;
          fournisseur.value = { id: snap.id, ...snap.data() };
          document.title = `Bokki Admin — ${fournisseur.value.nom || snap.id}`;
          chargerCommandes(Number(fournisseur.value.montantDu) || 0);
        },
        (err) => {
          console.error(err);
          loading.value = false;
          notFound.value = true;
        }
      );

      onSnapshot(query(collection(db, "recus"), where("type", "==", "fournisseur"), where("beneficiaireId", "==", fournisseurId), orderBy("date", "desc"), limit(500)), (snap) => {
        numerosRecus.value = new Map(snap.docs.map((d) => [d.id, d.data().numero]));
      }, console.error);
      onSnapshot(collection(db, "fournisseurs"), (snap) => {
        tousFournisseurs.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      }, console.error);

      onSnapshot(query(collection(db, "produits"), where("fournisseurId", "==", fournisseurId)), (snap) => {
        produits.value = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => nomAffiche(a).localeCompare(nomAffiche(b)));
      });

      onSnapshot(
        query(collection(db, "paiementsFournisseurs"), where("fournisseurId", "==", fournisseurId), orderBy("dateCreation", "desc")),
        (snap) => {
          paiements.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        }
      );
    } else {
      loading.value = false;
    }

    return {
      fournisseur,
      loading,
      notFound,
      produits,
      paiements,
      totalVendus,
      venduFor,
      depuisText,
      PLACEHOLDER_IMG,
      fmt,
      fmtDateFr,
      nomAffiche,
      prixAchatAffiche,
      imageAffichee,
      message,
      etat,
      retrait,
      autresFournisseurs,
      paiementOuvert,
      dejaVerse,
      recuDe,
      commandes,
      nonAffecte,
      commandesCharge,
      dateCourte,
      pluriel,
    };
  },
}).mount("#fournisseurDetailApp");
