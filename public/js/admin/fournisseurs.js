import { createApp, ref, computed } from "https://unpkg.com/vue@3.5.42/dist/vue.esm-browser.prod.js";
import { db, functions } from "../firebase-config.js";
import {
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  getCountFromServer,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { CATEGORIE_NOMS } from "../produit-categories.js";

const enregistrerPaiementFournisseur = httpsCallable(functions, "enregistrerPaiementFournisseur");

function initials(nom) {
  const parts = (nom || "").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
}

function fmt(n) {
  return Math.round(n || 0).toLocaleString("fr-FR").replace(/,/g, " ");
}

function fmtDateFr(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function emptyForm() {
  return { nom: "", telephone: "", categoriePrincipale: CATEGORIE_NOMS[0] || "", adresse: "", note: "" };
}

createApp({
  setup() {
    const fournisseurs = ref([]);
    const searchTerm = ref("");

    const modalOpen = ref(false);
    const editingId = ref(null);
    const formError = ref("");
    const saving = ref(false);
    const form = ref(emptyForm());

    const filteredFournisseurs = computed(() => {
      const term = searchTerm.value.trim().toLowerCase();
      if (!term) return fournisseurs.value;
      return fournisseurs.value.filter((f) =>
        (f.nom || "").toLowerCase().includes(term) ||
        (f.telephone || "").toLowerCase().includes(term) ||
        (f.categoriePrincipale || "").toLowerCase().includes(term)
      );
    });

    const tbDateText = computed(() => {
      const n = fournisseurs.value.length;
      return `${n} fournisseur${n !== 1 ? "s" : ""} · dépôt-vente`;
    });

    function openModal(f) {
      formError.value = "";
      if (f) {
        editingId.value = f.id;
        form.value = {
          nom: f.nom || "",
          telephone: f.telephone || "",
          categoriePrincipale: f.categoriePrincipale || CATEGORIE_NOMS[0] || "",
          adresse: f.adresse || "",
          note: f.note || "",
        };
      } else {
        editingId.value = null;
        form.value = emptyForm();
      }
      modalOpen.value = true;
    }
    function closeModal() {
      modalOpen.value = false;
    }

    async function save() {
      formError.value = "";
      const nom = form.value.nom.trim();
      if (!nom) {
        formError.value = "Le nom du fournisseur est obligatoire.";
        return;
      }

      saving.value = true;
      try {
        const data = {
          nom,
          telephone: form.value.telephone.trim(),
          categoriePrincipale: form.value.categoriePrincipale,
          adresse: form.value.adresse.trim(),
          note: form.value.note.trim(),
        };
        if (editingId.value) {
          await updateDoc(doc(db, "fournisseurs", editingId.value), data);
        } else {
          await setDoc(doc(collection(db, "fournisseurs")), {
            ...data,
            montantDu: 0,
            dateCreation: serverTimestamp(),
          });
        }
        closeModal();
      } catch (err) {
        console.error(err);
        formError.value = "Erreur lors de l'enregistrement : " + (err.message || err.code || "réessaie.");
      } finally {
        saving.value = false;
      }
    }

    async function removeFournisseur(f) {
      if (!confirm(`Supprimer « ${f.nom} » ? Cette action est irréversible.`)) return;
      try {
        await deleteDoc(doc(db, "fournisseurs", f.id));
      } catch (err) {
        console.error(err);
        alert("Erreur lors de la suppression : " + (err.message || err.code || "réessaie."));
      }
    }

    onSnapshot(query(collection(db, "fournisseurs"), orderBy("nom")), (snap) => {
      fournisseurs.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    });

    // ===== Registre des paiements =====
    // "Montant dû" (fournisseurs.montantDu) est un solde couru calculé et
    // maintenu exclusivement côté serveur — crédité par le trigger
    // onCommandeStatutChange à chaque commande livrée, débité ici via la
    // Cloud Function enregistrerPaiementFournisseur (jamais par une écriture
    // client directe, voir firestore.rules). Le registre lui-même vient de
    // la vraie collection paiementsFournisseurs.
    const ledgerOverlayOpen = ref(false);
    const ledgerEntries = ref([]);
    const lgSupplierId = ref("");
    const lgAmount = ref(null);
    const lgDate = ref("");
    const lgNote = ref("");
    const ledgerError = ref("");
    const ledgerSaving = ref(false);

    function dernierReversement(fournisseurId) {
      const entry = ledgerEntries.value.find((e) => e.fournisseurId === fournisseurId);
      return entry ? fmtDateFr(entry.date) : null;
    }

    function openLedgerModal(f) {
      lgSupplierId.value = f?.id || "";
      lgAmount.value = null;
      lgDate.value = new Date().toISOString().slice(0, 10);
      lgNote.value = "";
      ledgerError.value = "";
      ledgerOverlayOpen.value = true;
    }
    async function submitPaiement(fournisseurId, montant, note) {
      ledgerError.value = "";
      if (!fournisseurId || !(montant > 0)) return;
      ledgerSaving.value = true;
      try {
        await enregistrerPaiementFournisseur({ fournisseurId, montant, date: lgDate.value, note });
        ledgerOverlayOpen.value = false;
      } catch (err) {
        console.error(err);
        ledgerError.value = err.message || "Erreur lors de l'enregistrement du paiement.";
      } finally {
        ledgerSaving.value = false;
      }
    }
    function saveLedgerEntry() {
      return submitPaiement(lgSupplierId.value, Number(lgAmount.value) || 0, lgNote.value.trim());
    }
    function marquerReverse(f) {
      const montantDu = Number(f.montantDu) || 0;
      if (montantDu <= 0) return;
      lgDate.value = new Date().toISOString().slice(0, 10);
      return submitPaiement(f.id, montantDu, "Reversement complet");
    }

    function closeAllModals() {
      modalOpen.value = false;
      ledgerOverlayOpen.value = false;
    }

    onSnapshot(query(collection(db, "paiementsFournisseurs"), orderBy("dateCreation", "desc")), (snap) => {
      ledgerEntries.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    });

    // ===== Cartes résumé du haut de page =====
    // Total dû : solde couru (fournisseurs.montantDu), pas une somme "de ce
    // mois" — ce champ n'est jamais remis à zéro, voir la note plus haut.
    const totalDu = computed(() =>
      fournisseurs.value.reduce((s, f) => s + (Number(f.montantDu) || 0), 0)
    );
    function debutMoisCourant() {
      const d = new Date();
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    const reversementsCeMois = computed(() => {
      const debut = debutMoisCourant();
      return ledgerEntries.value.filter((e) => {
        const d = e.dateCreation?.toDate ? e.dateCreation.toDate() : null;
        return d && d >= debut;
      }).length;
    });
    // Pas de suivi de stock/unités en dépôt dans ce système (dépôt-vente
    // sans entrepôt, quantité illimitée par produit — voir creerCommande) :
    // aucune donnée réelle ne correspond à "unités en dépôt". On affiche à la
    // place le nombre de produits au catalogue, seule mesure de volume réelle
    // disponible côté fournisseurs.
    const produitsCount = ref(null);
    getCountFromServer(collection(db, "produits"))
      .then((snap) => { produitsCount.value = snap.data().count; })
      .catch((err) => console.error(err));

    return {
      fournisseurs,
      searchTerm,
      filteredFournisseurs,
      tbDateText,
      CATEGORIE_NOMS,
      initials,
      modalOpen,
      editingId,
      formError,
      saving,
      form,
      openModal,
      closeModal,
      save,
      removeFournisseur,
      ledgerOverlayOpen,
      ledgerEntries,
      lgSupplierId,
      lgAmount,
      lgDate,
      lgNote,
      ledgerError,
      ledgerSaving,
      fmt,
      fmtDateFr,
      dernierReversement,
      openLedgerModal,
      saveLedgerEntry,
      marquerReverse,
      closeAllModals,
      totalDu,
      reversementsCeMois,
      produitsCount,
    };
  },
}).mount("#fournisseursApp");
