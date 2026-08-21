import { createApp, ref, computed } from "https://unpkg.com/vue@3/dist/vue.esm-browser.js";
import { db } from "../firebase-config.js";
import {
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const STATUT_INFO = {
  nouvelle: { label: "Nouvelle", cls: "st-new" },
  confirmee: { label: "Confirmée", cls: "st-confirmed" },
  en_livraison: { label: "En livraison", cls: "st-transit" },
  livree: { label: "Livrée", cls: "st-done" },
  en_negociation: { label: "En négociation", cls: "st-negotiate" },
  retournee: { label: "Retournée", cls: "st-returned" },
};

function fmt(n) {
  return Math.round(n || 0).toLocaleString("fr-FR").replace(/,/g, " ");
}

function fmtDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return (
    d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) +
    ", " +
    d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
  );
}

function montant(c) {
  return c.prixConvenu != null ? c.prixConvenu : c.prixInitial || 0;
}

createApp({
  setup() {
    const commandes = ref([]);
    const searchTerm = ref("");
    const statusFilter = ref("toutes");

    const codeOverlayOpen = ref(false);
    const priceOverlayOpen = ref(false);
    const courierOverlayOpen = ref(false);
    const activeOrder = ref(null);
    const codeDigits = ref(["", "", "", ""]);
    const codeError = ref(false);
    const newPrice = ref(0);

    const selectedCourier = ref({ name: "Sékou Fofana", phone: "+224 622 11 22 33" });
    const newCourierOpen = ref(false);
    const ncName = ref("");
    const ncPhone = ref("");

    const statusCounts = computed(() => {
      const counts = { toutes: commandes.value.length };
      Object.keys(STATUT_INFO).forEach((key) => {
        counts[key] = commandes.value.filter((c) => c.statut === key).length;
      });
      return counts;
    });

    const filteredCommandes = computed(() => {
      const term = searchTerm.value.trim().toLowerCase();
      return commandes.value.filter((c) => {
        if (statusFilter.value !== "toutes" && c.statut !== statusFilter.value) return false;
        if (!term) return true;
        return (
          (c.clientNom || "").toLowerCase().includes(term) ||
          (c.numero || "").toLowerCase().includes(term) ||
          (c.clientTel || "").toLowerCase().includes(term)
        );
      });
    });

    const tbDateText = computed(() => {
      const n = commandes.value.length;
      return `${n} commande${n !== 1 ? "s" : ""}`;
    });

    function statusInfo(statut) {
      return STATUT_INFO[statut] || { label: statut, cls: "" };
    }

    async function handleStatusChange(c, newStatut) {
      try {
        await updateDoc(doc(db, "commandes", c.id), { statut: newStatut });
      } catch (err) {
        console.error(err);
        alert(
          "Impossible de mettre à jour le statut de la commande " +
            (c.numero || "") +
            " : " +
            (err.message || err.code || "réessaie.")
        );
      }
    }

    function openCodeModal(c) {
      activeOrder.value = c;
      codeDigits.value = ["", "", "", ""];
      codeError.value = false;
      codeOverlayOpen.value = true;
    }
    function validateCode() {
      const code = codeDigits.value.join("");
      if (code.length === 4) {
        codeOverlayOpen.value = false;
      } else {
        codeError.value = true;
      }
    }
    function onCodeInput(idx, e) {
      codeDigits.value[idx] = e.target.value;
      if (e.target.value && idx < 3) {
        const next = e.target
          .closest(".code-input-row")
          .querySelectorAll("input")[idx + 1];
        next?.focus();
      }
    }

    function openPriceModal(c) {
      activeOrder.value = c;
      newPrice.value = montant(c);
      priceOverlayOpen.value = true;
    }
    function savePrice() {
      // Non persistant pour l'instant : la négociation de prix réelle
      // (écriture Firestore) est un ticket séparé.
      priceOverlayOpen.value = false;
    }

    function openCourierModal(c) {
      activeOrder.value = c;
      courierOverlayOpen.value = true;
      newCourierOpen.value = false;
    }
    function selectCourier(name, phone) {
      selectedCourier.value = { name, phone };
      newCourierOpen.value = false;
    }
    function toggleNewCourier() {
      newCourierOpen.value = !newCourierOpen.value;
    }
    function saveCourier() {
      if (ncName.value.trim()) {
        selectedCourier.value = { name: ncName.value.trim(), phone: ncPhone.value.trim() };
      }
      courierOverlayOpen.value = false;
    }

    function closeModal() {
      codeOverlayOpen.value = false;
      priceOverlayOpen.value = false;
      courierOverlayOpen.value = false;
    }

    onSnapshot(query(collection(db, "commandes"), orderBy("dateCreation", "desc")), (snap) => {
      commandes.value = snap.docs.map((d) => {
        const data = d.data();
        // Le code de livraison n'est jamais exposé côté admin avant
        // validation manuelle : on l'exclut explicitement de l'état affiché.
        delete data.codeLivraison;
        return { id: d.id, ...data };
      });
    });

    return {
      commandes,
      searchTerm,
      statusFilter,
      statusCounts,
      filteredCommandes,
      tbDateText,
      fmt,
      fmtDate,
      montant,
      statusInfo,
      handleStatusChange,
      codeOverlayOpen,
      priceOverlayOpen,
      courierOverlayOpen,
      activeOrder,
      codeDigits,
      codeError,
      newPrice,
      selectedCourier,
      newCourierOpen,
      ncName,
      ncPhone,
      openCodeModal,
      validateCode,
      onCodeInput,
      openPriceModal,
      savePrice,
      openCourierModal,
      selectCourier,
      toggleNewCourier,
      saveCourier,
      closeModal,
    };
  },
}).mount("#commandesApp");
