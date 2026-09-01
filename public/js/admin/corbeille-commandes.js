import { createApp, ref } from "https://unpkg.com/vue@3.5.42/dist/vue.esm-browser.prod.js";
import { db } from "../firebase-config.js";
import {
  collection,
  doc,
  query,
  where,
  orderBy,
  onSnapshot,
  updateDoc,
  deleteDoc,
  deleteField,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { montant, resumeArticles } from "./commande-utils.js";

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
createApp({
  setup() {
    const commandes = ref([]);

    // Même index composite (corbeille, dateCorbeille) que celui utilisé par
    // la purge planifiée côté Cloud Function — un seul à déployer pour les
    // deux usages (voir firestore.indexes.json).
    onSnapshot(
      query(collection(db, "commandes"), where("corbeille", "==", true), orderBy("dateCorbeille", "asc")),
      (snap) => {
        commandes.value = snap.docs.map((d) => {
          const data = d.data();
          return { id: d.id, ...data, _resume: resumeArticles(data) };
        });
      },
      (err) => console.error(err)
    );

    function joursRestants(c) {
      if (!c.dateCorbeille?.toDate) return "—";
      const datePurge = c.dateCorbeille.toDate();
      datePurge.setDate(datePurge.getDate() + JOURS_RETENTION);
      const jours = Math.ceil((datePurge - new Date()) / (1000 * 60 * 60 * 24));
      return Math.max(0, jours);
    }

    async function restaurer(c) {
      try {
        await updateDoc(doc(db, "commandes", c.id), { corbeille: false, dateCorbeille: deleteField() });
      } catch (err) {
        console.error(err);
        alert("Impossible de restaurer la commande " + (c.numero || "") + " : " + (err.message || err.code || "réessaie."));
      }
    }

    async function supprimerDefinitivement(c) {
      if (!confirm(`Supprimer définitivement la commande ${c.numero} ? Cette action est irréversible.`)) return;
      try {
        await deleteDoc(doc(db, "commandes", c.id));
      } catch (err) {
        console.error(err);
        alert("Impossible de supprimer la commande " + (c.numero || "") + " : " + (err.message || err.code || "réessaie."));
      }
    }

    return { commandes, fmt, fmtDate, montant, joursRestants, restaurer, supprimerDefinitivement };
  },
}).mount("#corbeilleApp");
