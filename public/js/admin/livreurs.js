import { createApp, ref, computed, watch } from "https://unpkg.com/vue@3/dist/vue.esm-browser.js";
import { db } from "../firebase-config.js";
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  orderBy,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  getCountFromServer,
  getDocs,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const ZONES = ["Ratoma", "Kaloum", "Matam", "Dixinn", "Autre ville"];

function initials(nom) {
  const parts = (nom || "").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
}

function fmt(n) {
  return Math.round(n || 0).toLocaleString("fr-FR").replace(/,/g, " ");
}

function emptyForm() {
  return { nom: "", telephone: "", zonePrincipale: ZONES[0], fraisParLivraison: 20000 };
}

createApp({
  setup() {
    const livreurs = ref([]);
    const searchTerm = ref("");

    const modalOpen = ref(false);
    const editingId = ref(null);
    const formError = ref("");
    const saving = ref(false);
    const form = ref(emptyForm());

    const filteredLivreurs = computed(() => {
      const term = searchTerm.value.trim().toLowerCase();
      if (!term) return livreurs.value;
      return livreurs.value.filter((l) =>
        (l.nom || "").toLowerCase().includes(term) ||
        (l.telephone || "").toLowerCase().includes(term) ||
        (l.zonePrincipale || "").toLowerCase().includes(term)
      );
    });

    const tbDateText = computed(() => {
      const n = livreurs.value.length;
      return `${n} livreur${n !== 1 ? "s" : ""}`;
    });

    function openModal(l) {
      formError.value = "";
      if (l) {
        editingId.value = l.id;
        form.value = {
          nom: l.nom || "",
          telephone: l.telephone || "",
          zonePrincipale: l.zonePrincipale || ZONES[0],
          fraisParLivraison: l.fraisParLivraison ?? 20000,
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
        formError.value = "Le nom du livreur est obligatoire.";
        return;
      }

      saving.value = true;
      try {
        const data = {
          nom,
          telephone: form.value.telephone.trim(),
          zonePrincipale: form.value.zonePrincipale,
          fraisParLivraison: Number(form.value.fraisParLivraison) || 0,
        };
        if (editingId.value) {
          await updateDoc(doc(db, "livreurs", editingId.value), data);
        } else {
          await setDoc(doc(collection(db, "livreurs")), { ...data, dateCreation: serverTimestamp() });
        }
        closeModal();
      } catch (err) {
        console.error(err);
        formError.value = "Erreur lors de l'enregistrement : " + (err.message || err.code || "réessaie.");
      } finally {
        saving.value = false;
      }
    }

    async function removeLivreur(l) {
      if (!confirm(`Supprimer « ${l.nom} » ? Cette action est irréversible.`)) return;
      try {
        await deleteDoc(doc(db, "livreurs", l.id));
      } catch (err) {
        console.error(err);
        alert("Erreur lors de la suppression : " + (err.message || err.code || "réessaie."));
      }
    }

    // Stats par livreur (livraisons, en cours, taux de réussite) : requêtes
    // agrégées count() plutôt que de charger toute la collection commandes
    // côté client — voir le ticket. Contrepartie : ce sont des lectures
    // ponctuelles (getCountFromServer n'a pas d'équivalent onSnapshot dans
    // le SDK web à ce jour), donc ces chiffres se rafraîchissent quand la
    // liste des livreurs charge/change, pas en temps réel si une commande
    // change de statut pendant que cette page est ouverte — rechargement
    // requis pour voir une mise à jour dans ce cas précis.
    const stats = ref({});

    async function loadStatsFor(livreurId) {
      stats.value = { ...stats.value, [livreurId]: { loading: true } };
      try {
        const commandesRef = collection(db, "commandes");
        const [livreeSnap, enCoursSnap, retourneeSnap] = await Promise.all([
          getCountFromServer(query(commandesRef, where("livreurId", "==", livreurId), where("statut", "==", "livree"))),
          getCountFromServer(query(commandesRef, where("livreurId", "==", livreurId), where("statut", "==", "en_livraison"))),
          getCountFromServer(query(commandesRef, where("livreurId", "==", livreurId), where("statut", "==", "retournee"))),
        ]);
        const livree = livreeSnap.data().count;
        const enCours = enCoursSnap.data().count;
        const retournee = retourneeSnap.data().count;
        const totalTermine = livree + retournee;
        const tauxReussite = totalTermine > 0 ? Math.round((livree / totalTermine) * 100) : null;
        stats.value = { ...stats.value, [livreurId]: { loading: false, livree, enCours, tauxReussite } };
      } catch (err) {
        console.error(err);
        stats.value = { ...stats.value, [livreurId]: { loading: false, error: true } };
      }
    }

    function statFor(livreurId) {
      return stats.value[livreurId] || { loading: true };
    }

    watch(
      livreurs,
      (list) => {
        list.forEach((l) => {
          if (!(l.id in stats.value)) loadStatsFor(l.id);
        });
      },
      { immediate: true }
    );

    onSnapshot(query(collection(db, "livreurs"), orderBy("nom")), (snap) => {
      livreurs.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    });

    // ===== Cartes résumé du haut de page =====
    // Une seule requête (commandes livrées depuis le début du mois) sert aux
    // trois cartes : "aujourd'hui" est un sous-ensemble filtré côté client
    // du même résultat, pas une deuxième requête. fraisLivreur n'est stocké
    // sur aucune commande (calculé à la volée côté serveur pour la
    // répartition financière du jour) : on le recalcule ici depuis
    // livreurs.fraisParLivraison, comme le fait déjà repartitionFinanciereDuJour.
    const livraisonsAujourdhui = ref(null);
    const totalPayeLivreursCeMois = ref(null);
    const livreurLePlusActif = ref(null);

    function debutAujourdhui() {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d;
    }
    function debutMoisCourant() {
      const d = new Date();
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      return d;
    }

    async function loadStatsResume() {
      try {
        const debutMois = debutMoisCourant();
        const snap = await getDocs(
          query(
            collection(db, "commandes"),
            where("statut", "==", "livree"),
            where("dateLivraison", ">=", debutMois)
          )
        );
        const debutJour = debutAujourdhui();
        const parLivreur = {};
        let aujourdhui = 0;
        let totalPaye = 0;
        snap.docs.forEach((d) => {
          const c = d.data();
          const date = c.dateLivraison?.toDate ? c.dateLivraison.toDate() : null;
          if (date && date >= debutJour) aujourdhui++;
          if (c.livreurId) {
            parLivreur[c.livreurId] = (parLivreur[c.livreurId] || 0) + 1;
            const l = livreurs.value.find((x) => x.id === c.livreurId);
            totalPaye += l ? Number(l.fraisParLivraison) || 0 : 0;
          }
        });
        livraisonsAujourdhui.value = aujourdhui;
        totalPayeLivreursCeMois.value = totalPaye;
        const topId = Object.keys(parLivreur).sort((a, b) => parLivreur[b] - parLivreur[a])[0];
        livreurLePlusActif.value = topId
          ? livreurs.value.find((x) => x.id === topId)?.nom || null
          : null;
      } catch (err) {
        console.error(err);
      }
    }
    watch(livreurs, () => loadStatsResume(), { immediate: true });

    return {
      livreurs,
      searchTerm,
      filteredLivreurs,
      tbDateText,
      ZONES,
      initials,
      fmt,
      statFor,
      modalOpen,
      editingId,
      formError,
      saving,
      form,
      openModal,
      closeModal,
      save,
      removeLivreur,
      livraisonsAujourdhui,
      totalPayeLivreursCeMois,
      livreurLePlusActif,
    };
  },
}).mount("#livreursApp");
