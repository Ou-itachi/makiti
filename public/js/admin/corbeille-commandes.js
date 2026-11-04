import { computed, createApp, ref } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { db, functions } from "../firebase-config.js";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { montant, resumeArticles } from "./commande-utils.js";
import { useListeCache } from "./liste-cache.js";
import { BarreLot, FenetreConfirmation, parLots, useSelection } from "./selection-lot.js";

const JOURS_RETENTION = 30;

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
const traiterCorbeille = httpsCallable(functions, "traiterCorbeille");
const pluriel = (n) => `${n} commande${n > 1 ? "s" : ""}`;

createApp({
  components: { BarreLot, FenetreConfirmation },
  setup() {
    const commandes = ref([]);
    const charge = ref(false);
    const { incertain, enCache, noter } = useListeCache();
    const sel = useSelection(commandes);
    const demande = ref(null);
    const envoi = ref(false);
    const erreur = ref("");
    const resumeLot = computed(() => {
      const n = sel.selection.value.length;
      return `${pluriel(n)} sélectionnée${n > 1 ? "s" : ""}`;
    });

    // Même index composite (corbeille, dateCorbeille) que celui utilisé par
    // la purge planifiée côté Cloud Function — un seul à déployer pour les
    // deux usages (voir firestore.indexes.json).
    onSnapshot(
      query(collection(db, "commandes"), where("corbeille", "==", true), orderBy("dateCorbeille", "asc")),
      { includeMetadataChanges: true },
      (snap) => {
        noter("commandes", snap.metadata.fromCache);
        commandes.value = snap.docs.map((d) => {
          const data = d.data();
          return { id: d.id, ...data, _resume: resumeArticles(data) };
        });
        charge.value = true;
      },
      (err) => { console.error(err); noter("commandes", true); charge.value = true; }
    );

    function joursRestants(c) {
      if (!c.dateCorbeille?.toDate) return "—";
      const datePurge = c.dateCorbeille.toDate();
      datePurge.setDate(datePurge.getDate() + JOURS_RETENTION);
      const jours = Math.ceil((datePurge - new Date()) / (1000 * 60 * 60 * 24));
      return Math.max(0, jours);
    }

    function demander(action, liste) {
      const n = liste.length;
      erreur.value = "";
      demande.value = action === "restaurer"
        ? { action, liste, titre: `Restaurer ${pluriel(n)} ?`, libelle: "Restaurer", note: `${n > 1 ? "Elles reviennent" : "Elle revient"} dans la liste des commandes.` }
        : { action, liste, titre: `Supprimer définitivement ${pluriel(n)} ?`, libelle: "Supprimer définitivement", note: "Cette action est irréversible." };
    }
    async function confirmer() {
      const { action, liste } = demande.value;
      envoi.value = true;
      erreur.value = "";
      try {
        await parLots(liste.map((c) => c.id), (ids) => traiterCorbeille({ ids, action }));
        demande.value = null;
        sel.vider();
      } catch (err) {
        console.error(err);
        erreur.value = err.message || "Action impossible, réessayez.";
      } finally {
        envoi.value = false;
      }
    }

    return { commandes, incertain, enCache, charge, fmt, fmtDate, montant, joursRestants, sel, resumeLot, demande, envoi, erreur, demander, confirmer };
  },
}).mount("#corbeilleApp");
