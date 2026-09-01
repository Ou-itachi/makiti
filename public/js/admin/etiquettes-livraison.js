import { createApp, ref, computed } from "https://unpkg.com/vue@3.5.42/dist/vue.esm-browser.prod.js";
import { db } from "../firebase-config.js";
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { articlesDe, montant } from "./commande-utils.js";

// Bons de livraison imprimables : commandes confirmées et prêtes à partir,
// ou déjà en cours de livraison — pas "nouvelle" (pas encore confirmée par
// téléphone) ni "livrée"/"retournée"/"en_négociation" (plus rien à livrer).
const STATUTS_IMPRIMABLES = ["confirmee", "en_livraison"];

function fmt(n) {
  return Math.round(n || 0).toLocaleString("fr-FR").replace(/,/g, " ");
}

createApp({
  setup() {
    const commandes = ref([]);
    const livreurs = ref([]);
    const selected = ref({});

    const printableCommandes = computed(() =>
      [...commandes.value].sort((a, b) => {
        const ad = a.dateCreation?.toMillis ? a.dateCreation.toMillis() : 0;
        const bd = b.dateCreation?.toMillis ? b.dateCreation.toMillis() : 0;
        return bd - ad;
      })
    );

    const selectedCount = computed(
      () => printableCommandes.value.filter((c) => selected.value[c.id]).length
    );
    const countLabel = computed(
      () => `${selectedCount.value} sur ${printableCommandes.value.length} étiquettes sélectionnées`
    );
    const allSelected = computed(
      () => printableCommandes.value.length > 0 && selectedCount.value === printableCommandes.value.length
    );

    function toggleAll() {
      const next = !allSelected.value;
      printableCommandes.value.forEach((c) => (selected.value[c.id] = next));
    }

    function livreurNomFor(c) {
      if (!c.livreurId) return "Non assigné";
      return livreurs.value.find((l) => l.id === c.livreurId)?.nom || "Livreur supprimé";
    }

    onSnapshot(
      query(collection(db, "commandes"), where("statut", "in", STATUTS_IMPRIMABLES)),
      (snap) => {
        commandes.value = snap.docs.map((d) => {
          const data = d.data();
          delete data.codeLivraison;
          const id = d.id;
          if (!(id in selected.value)) selected.value[id] = true;
          return { id, ...data };
        });
        // Retire du choix de sélection les commandes qui ne sont plus dans la
        // liste (changement de statut ailleurs), sans quoi selectedCount
        // resterait faussé par des id fantômes.
        const liveIds = new Set(commandes.value.map((c) => c.id));
        Object.keys(selected.value).forEach((id) => {
          if (!liveIds.has(id)) delete selected.value[id];
        });
      }
    );

    onSnapshot(query(collection(db, "livreurs"), orderBy("nom")), (snap) => {
      livreurs.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    });

    return {
      printableCommandes,
      selected,
      countLabel,
      toggleAll,
      livreurNomFor,
      fmt,
      montant,
      articlesDe,
    };
  },
}).mount("#etiquettesApp");
