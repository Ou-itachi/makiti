import { createApp, ref, computed, watch } from "https://unpkg.com/vue@3.5.42/dist/vue.esm-browser.prod.js";
import { db, storage } from "../firebase-config.js";
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import {
  ref as storageRef,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";

const STATUT_LABELS = {
  nouvelle: "Nouvelle",
  en_recherche: "En recherche",
  trouvee: "Trouvée",
  indisponible: "Indisponible",
};
const STATUT_CLASSES = {
  nouvelle: "st-new",
  en_recherche: "st-search",
  trouvee: "st-found",
  indisponible: "st-unavailable",
};
const STATUTS_ORDRE = ["nouvelle", "en_recherche", "trouvee", "indisponible"];

function fmtDateHeure(ts) {
  if (!ts?.toDate) return "—";
  const d = ts.toDate();
  return (
    d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) +
    ", " +
    d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
  );
}
function initiales(nom) {
  const parts = (nom || "").trim().split(/\s+/).filter(Boolean);
  return parts.map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?";
}

createApp({
  setup() {
    const demandes = ref([]);
    const loading = ref(true);
    const searchTerm = ref("");
    const statusFilter = ref("toutes");

    onSnapshot(
      query(collection(db, "demandesProduits"), orderBy("dateCreation", "desc")),
      (snap) => {
        demandes.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        loading.value = false;
      },
      (err) => {
        console.error(err);
        loading.value = false;
      }
    );

    // Les photos ne sont jamais stockées en URL (storage.rules interdit la
    // lecture publique de demandes-produits/**) — seul un chemin Storage est
    // écrit par le client. Ici, authentifié admin, on résout l'URL réelle de
    // chaque photo à la volée, par demande.
    const photoUrls = ref({});
    async function loadPhotosFor(demande) {
      if (!demande.photos || demande.photos.length === 0) {
        photoUrls.value = { ...photoUrls.value, [demande.id]: [] };
        return;
      }
      photoUrls.value = { ...photoUrls.value, [demande.id]: null };
      try {
        const urls = await Promise.all(
          demande.photos.map((path) => getDownloadURL(storageRef(storage, path)))
        );
        photoUrls.value = { ...photoUrls.value, [demande.id]: urls };
      } catch (err) {
        console.error(err);
        photoUrls.value = { ...photoUrls.value, [demande.id]: "error" };
      }
    }
    watch(
      demandes,
      (list) => {
        list.forEach((d) => {
          if (!(d.id in photoUrls.value)) loadPhotosFor(d);
        });
      },
      { immediate: true }
    );
    function photosFor(id) {
      return photoUrls.value[id];
    }

    const counts = computed(() => {
      const c = { toutes: demandes.value.length, nouvelle: 0, en_recherche: 0, trouvee: 0, indisponible: 0 };
      demandes.value.forEach((d) => {
        if (d.statut in c) c[d.statut]++;
      });
      return c;
    });

    const trouveesCeMois = computed(() => {
      const now = new Date();
      return demandes.value.filter((d) => {
        if (d.statut !== "trouvee") return false;
        const dt = d.dateCreation?.toDate ? d.dateCreation.toDate() : null;
        return dt && dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
      }).length;
    });

    const filteredDemandes = computed(() => {
      const term = searchTerm.value.trim().toLowerCase();
      return demandes.value.filter((d) => {
        if (statusFilter.value !== "toutes" && d.statut !== statusFilter.value) return false;
        if (term) {
          const hay = `${d.nom || ""} ${d.clientNom || ""}`.toLowerCase();
          if (!hay.includes(term)) return false;
        }
        return true;
      });
    });

    // Passe le relais à admin-04-produits.html : nom/catégorie/photos de la
    // demande via sessionStorage (données structurées, pas de limite de
    // longueur d'URL), consommé une seule fois par produits.js puis effacé.
    function creerFicheProduit(demande) {
      const urls = photosFor(demande.id);
      const photoUrls = Array.isArray(urls) ? urls : [];
      sessionStorage.setItem(
        "makiti-prefill-produit",
        JSON.stringify({ nom: demande.nom || "", categorie: demande.categorie || "", photoUrls })
      );
      window.location.href = "produits.html?prefill=1";
    }

    async function updateStatut(demande, statut) {
      try {
        await updateDoc(doc(db, "demandesProduits", demande.id), { statut });
      } catch (err) {
        console.error(err);
        alert("Impossible de mettre à jour le statut : " + (err.message || err.code || "réessaie."));
      }
    }

    return {
      demandes,
      loading,
      searchTerm,
      statusFilter,
      counts,
      trouveesCeMois,
      filteredDemandes,
      photosFor,
      updateStatut,
      creerFicheProduit,
      STATUT_LABELS,
      STATUT_CLASSES,
      STATUTS_ORDRE,
      fmtDateHeure,
      initiales,
    };
  },
}).mount("#demandesApp");
