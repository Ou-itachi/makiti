// Incidents et SOS : tout ce qui demande une réaction, même quand c'est un admin
// qui a livré. Lecture en temps réel ; les actions passent par le serveur.
import { createApp, ref, computed, nextTick, onMounted, watch } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { auth, db, functions } from "../firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, where } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { afficherCarte } from "./carte-livraison.js";
import { dateHeure, enDate, heure } from "./livraison-commun.js";

const traiterAlerte = httpsCallable(functions, "traiterAlerte");
const ETATS = {
  active: { label: "Nouveau", cls: "rouge" },
  prise_en_charge: { label: "En cours", cls: "ambre" },
  cloturee: { label: "Résolu", cls: "vert" },
  annulee: { label: "Classé", cls: "gris" },
};

createApp({
  setup() {
    const alertes = ref([]);
    const charge = ref(false);
    const filtre = ref("");
    const idChoisi = ref(new URLSearchParams(location.search).get("id"));
    const positions = ref([]);
    const telephone = ref("");
    const note = ref("");
    const message = ref("");
    const envoi = ref(false);
    const messageType = ref("");
    const erreurListe = ref(false);
    let finPositions = null;

    const choisie = computed(() => alertes.value.find((a) => a.id === idChoisi.value) || null);
    const enAttente = computed(() => alertes.value.filter((a) => ["active", "prise_en_charge"].includes(a.etat)));
    const affichees = computed(() => alertes.value.filter((a) => !filtre.value || a.etat === filtre.value));
    const lienCarte = (a) => (a?.dernierePosition ? `https://www.openstreetmap.org/?mlat=${a.dernierePosition.lat}&mlon=${a.dernierePosition.lng}#map=17/${a.dernierePosition.lat}/${a.dernierePosition.lng}` : "");
    const reference = (a) => `INC-${a.id.slice(-6).toUpperCase()}`;

    async function dessiner() {
      await nextTick();
      const a = choisie.value;
      if (!a) return;
      const points = positions.value.length ? positions.value : a.dernierePosition ? [a.dernierePosition] : [];
      if (points.length) afficherCarte(document.getElementById("carteIncident"), points).catch(console.error);
    }
    async function ouvrir(a) {
      idChoisi.value = a.id;
      history.pushState(null, "", `?id=${a.id}`);
      note.value = "";
      message.value = "";
      charger();
      scrollTo(0, 0);
    }
    async function charger() {
      finPositions?.();
      positions.value = [];
      telephone.value = "";
      const a = choisie.value;
      if (!a) return;
      finPositions = onSnapshot(query(collection(db, "positions"), where("alerteId", "==", a.id)), (snap) => {
        positions.value = snap.docs.map((d) => d.data()).sort((x, y) => (enDate(x.date)?.getTime() || 0) - (enDate(y.date)?.getTime() || 0));
        dessiner();
      }, console.error);
      if (a.livreurId && !String(a.livreurId).startsWith("admin_")) {
        const fiche = await getDoc(doc(db, "livreurs", a.livreurId)).catch(() => null);
        telephone.value = fiche?.data()?.telephone || "";
      }
      dessiner();
    }
    function retour() {
      idChoisi.value = null;
      history.pushState(null, "", location.pathname);
    }
    async function traiter(action) {
      if (envoi.value) return;
      envoi.value = true;
      message.value = "";
      try {
        await traiterAlerte({ alerteId: idChoisi.value, action, note: note.value });
        message.value = action === "prendre" ? "Vous avez pris l'alerte en charge." : "Alerte clôturée.";
        messageType.value = "ok";
      } catch (err) {
        console.error(err);
        message.value = err.message || "Action impossible, réessayez.";
        messageType.value = "erreur";
      } finally {
        envoi.value = false;
      }
    }

    onMounted(() => {
      const stop = onAuthStateChanged(auth, (user) => {
        if (!user) return;
        stop();
        let premiere = true;
        onSnapshot(query(collection(db, "alertes"), orderBy("date", "desc"), limit(300)), (snap) => {
          alertes.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          charge.value = true;
          if (premiere && choisie.value) charger();
          premiere = false;
          dessiner();
        }, (err) => { console.error(err); erreurListe.value = true; charge.value = true; });
      });
    });
    addEventListener("popstate", () => {
      idChoisi.value = new URLSearchParams(location.search).get("id");
      charger();
    });
    watch(choisie, (a, avant) => { if (a && !avant) dessiner(); });

    return { ETATS, alertes, charge, erreurListe, messageType, filtre, choisie, enAttente, affichees, positions, telephone, note, message, envoi, lienCarte, reference, ouvrir, retour, traiter, dateHeure, heure };
  },
}).mount("#incidentsApp");
