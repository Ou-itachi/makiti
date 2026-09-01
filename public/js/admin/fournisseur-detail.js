import { createApp, ref, computed, watch } from "https://unpkg.com/vue@3.5.42/dist/vue.esm-browser.prod.js";
import { db, functions } from "../firebase-config.js";
import {
  doc,
  getDoc,
  onSnapshot,
  collection,
  query,
  where,
  orderBy,
  getCountFromServer,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";

const enregistrerPaiementFournisseur = httpsCallable(functions, "enregistrerPaiementFournisseur");

const PLACEHOLDER_IMG =
  "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='%23E7E1D5'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-size='9' fill='%23948C7A' text-anchor='middle' dominant-baseline='middle'%3EMakitti%3C/text%3E%3C/svg%3E";

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
  return (Array.isArray(p.images) && p.images[0]) || PLACEHOLDER_IMG;
}

const params = new URLSearchParams(location.search);
const fournisseurId = params.get("id");

createApp({
  setup() {
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

    const modalOpen = ref(false);
    const pAmount = ref(null);
    const pDate = ref("");
    const pNote = ref("");
    const pError = ref("");
    const pSaving = ref(false);

    function openModal() {
      pAmount.value = null;
      pDate.value = new Date().toISOString().slice(0, 10);
      pNote.value = "";
      pError.value = "";
      modalOpen.value = true;
    }
    function closeModal() {
      modalOpen.value = false;
    }

    async function submitPaiement(montant, note) {
      pError.value = "";
      if (!fournisseurId || !(montant > 0)) return;
      pSaving.value = true;
      try {
        await enregistrerPaiementFournisseur({ fournisseurId, montant, date: pDate.value, note });
        modalOpen.value = false;
      } catch (err) {
        console.error(err);
        pError.value = err.message || "Erreur lors de l'enregistrement du paiement.";
      } finally {
        pSaving.value = false;
      }
    }
    function savePaiement() {
      return submitPaiement(Number(pAmount.value) || 0, pNote.value.trim());
    }
    function marquerToutReverse() {
      const montantDu = Number(fournisseur.value?.montantDu) || 0;
      if (montantDu <= 0) return;
      pDate.value = new Date().toISOString().slice(0, 10);
      return submitPaiement(montantDu, "Reversement complet");
    }

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
          document.title = `Makitti Admin — ${fournisseur.value.nom || snap.id}`;
        },
        (err) => {
          console.error(err);
          loading.value = false;
          notFound.value = true;
        }
      );

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
      modalOpen,
      pAmount,
      pDate,
      pNote,
      pError,
      pSaving,
      openModal,
      closeModal,
      savePaiement,
      marquerToutReverse,
    };
  },
}).mount("#fournisseurDetailApp");
