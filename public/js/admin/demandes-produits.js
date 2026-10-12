import { createApp, ref, computed, watch } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { db, storage } from "../firebase-config.js";
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  query,
  orderBy,
  where,
  limit,
  getCountFromServer,
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

    // Seules les demandes récentes sont écoutées (avant : toute la
    // collection à chaque ouverture). "Voir plus" agrandit la fenêtre.
    const PAS_DEMANDES = 50;
    const limiteDemandes = ref(PAS_DEMANDES);
    const plusDeDemandes = ref(false);
    let desabonner = null;
    function ecouterDemandes() {
      desabonner?.();
      loading.value = true;
      desabonner = onSnapshot(
        query(collection(db, "demandesProduits"), orderBy("dateCreation", "desc"), limit(limiteDemandes.value)),
        (snap) => {
          demandes.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          plusDeDemandes.value = snap.size >= limiteDemandes.value;
          loading.value = false;
          if (!snap.metadata.fromCache) planifierCompteurs();
        },
        (err) => {
          console.error(err);
          loading.value = false;
        }
      );
    }
    function voirPlusDemandes() {
      limiteDemandes.value += PAS_DEMANDES;
      ecouterDemandes();
    }

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

    // Compteurs calculés par le serveur : la liste ne contient plus que les
    // demandes récentes.
    // Derniers compteurs connus affichés tout de suite (effacés à la
    // déconnexion, auth-guard.js). "Trouvées ce mois" seulement si même mois.
    const CLE_COMPTEURS = "bokki-demandes-compteurs-v1";
    const moisActuel = `${new Date().getFullYear()}-${new Date().getMonth()}`;
    let memo = null;
    try { memo = JSON.parse(localStorage.getItem(CLE_COMPTEURS) || "null"); } catch { /* ignore */ }
    const counts = ref(memo?.counts || { toutes: "…", nouvelle: "…", en_recherche: "…", trouvee: "…", indisponible: "…" });
    const trouveesCeMois = ref(memo?.mois === moisActuel ? memo.ceMois : "…");
    let comptageTimer = null;
    async function actualiserCompteurs() {
      const col = collection(db, "demandesProduits");
      const compter = (...f) => getCountFromServer(query(col, ...f)).then((s) => s.data().count);
      const debutMois = new Date();
      debutMois.setDate(1);
      debutMois.setHours(0, 0, 0, 0);
      try {
        const statuts = ["nouvelle", "en_recherche", "trouvee", "indisponible"];
        const [toutes, ceMois, ...parStatut] = await Promise.all([
          compter(),
          compter(where("statut", "==", "trouvee"), where("dateCreation", ">=", debutMois)),
          ...statuts.map((s) => compter(where("statut", "==", s))),
        ]);
        const c = { toutes };
        statuts.forEach((s, i) => { c[s] = parStatut[i]; });
        counts.value = c;
        trouveesCeMois.value = ceMois;
        try { localStorage.setItem(CLE_COMPTEURS, JSON.stringify({ counts: c, ceMois, mois: moisActuel })); } catch { /* ignore */ }
      } catch (err) {
        console.error("Compteurs indisponibles :", err);
      }
    }
    function planifierCompteurs() {
      clearTimeout(comptageTimer);
      comptageTimer = setTimeout(actualiserCompteurs, 800);
    }
    ecouterDemandes();

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
        "bokki-prefill-produit",
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
      plusDeDemandes,
      voirPlusDemandes,
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
