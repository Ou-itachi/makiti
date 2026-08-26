import { createApp, ref } from "https://unpkg.com/vue@3/dist/vue.esm-browser.js";
import { db } from "../firebase-config.js";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

createApp({
  setup() {
    const zones = ref([]);
    const zonesError = ref("");

    onSnapshot(
      query(collection(db, "zones"), orderBy("ville")),
      (snap) => {
        zones.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      },
      (err) => {
        console.error(err);
        zonesError.value = "Impossible de charger les zones : " + (err.message || err.code);
      }
    );

    async function saveZoneField(zone, field, value) {
      zonesError.value = "";
      if (field === "ville" && !String(value).trim()) {
        zonesError.value = "Le nom de la ville ne peut pas être vide.";
        return;
      }
      try {
        await updateDoc(doc(db, "zones", zone.id), { [field]: value });
      } catch (err) {
        console.error(err);
        zonesError.value = "Erreur lors de l'enregistrement : " + (err.message || err.code || "réessaie.");
      }
    }

    async function addZone() {
      zonesError.value = "";
      try {
        await addDoc(collection(db, "zones"), { ville: "Nouvelle région", delai: "48-72h" });
      } catch (err) {
        console.error(err);
        zonesError.value = "Erreur lors de l'ajout : " + (err.message || err.code || "réessaie.");
      }
    }

    async function removeZone(zone) {
      if (!confirm(`Supprimer la zone "${zone.ville}" ?`)) return;
      zonesError.value = "";
      try {
        await deleteDoc(doc(db, "zones", zone.id));
      } catch (err) {
        console.error(err);
        zonesError.value = "Erreur lors de la suppression : " + (err.message || err.code || "réessaie.");
      }
    }

    return { zones, zonesError, saveZoneField, addZone, removeZone };
  },
}).mount("#zonesApp");
