// Localisation : position partagée par un livreur, ou envoyée par son SOS.
import { computed, createApp, nextTick, ref, watch } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { db } from "../firebase-config.js";
import { collection, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { afficherCarte } from "./carte-livraison.js";

const ANCIENNE_MS = 75 * 60000;
const dateDe = (p) => p.date?.toDate?.() || new Date(0);
const memeJour = (a, b) => a.toDateString() === b.toDateString();

createApp({
  setup() {
    const fiches = ref([]);
    const charge = ref(false);
    const erreurListe = ref(false);
    const horsLigne = ref(false);
    const copie = ref("");
    const maintenant = ref(Date.now());
    setInterval(() => { maintenant.value = Date.now(); }, 30000);

    onSnapshot(query(collection(db, "localisations"), where("visible", "==", true)), { includeMetadataChanges: true }, (snap) => {
      fiches.value = snap.docs.map((d) => d.data());
      horsLigne.value = snap.metadata.fromCache;
      erreurListe.value = false;
      charge.value = true;
    }, (err) => {
      console.error(err);
      erreurListe.value = true;
      charge.value = true;
    });

    // Une position partagée ne reste pas affichée le lendemain ; un SOS, si.
    const liste = computed(() => fiches.value
      .filter((p) => p.sos || memeJour(dateDe(p), new Date(maintenant.value)))
      .sort((a, b) => Number(b.sos) - Number(a.sos) || dateDe(b) - dateDe(a)));
    watch(liste, async (points) => {
      await nextTick();
      points.forEach((p) => afficherCarte(document.getElementById(`carte-${p.uid}`), [p]).catch(console.error));
    });

    const ancienne = (p) => maintenant.value - dateDe(p) > ANCIENNE_MS;
    function age(p) {
      const min = Math.floor((maintenant.value - dateDe(p)) / 60000);
      return min < 1 ? "Mise à jour à l'instant" : `Mise à jour il y a ${min} min`;
    }
    const coord = (p) => `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
    const heure = (p) => dateDe(p).toLocaleString("fr-FR", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short", year: "numeric" });
    const itineraire = (p) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
    async function copier(p) {
      try {
        await navigator.clipboard.writeText(coord(p));
        copie.value = "Coordonnées copiées.";
      } catch {
        copie.value = `Copie impossible : ${coord(p)}`;
      }
    }
    const SOURCES = { suivi: "Envoyée par le livreur", ok: "Tout va bien", auto: "Envoi automatique", sos: "SOS" };
    const pointsDe = (p) => (p.points || []).map((x, i) => ({
      ...x, nom: `Point ${i + 1}`, source: SOURCES[x.source] || "Position",
      quand: dateDe(x).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
    })).reverse();
    return { liste, charge, erreurListe, horsLigne, copie, ancienne, age, coord, heure, itineraire, copier, pointsDe };
  },
}).mount("#localisationApp");
