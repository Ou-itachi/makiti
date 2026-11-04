// Tableau de bord de celui qui livre : sa journée et son argent.
import { createApp, ref, computed, onMounted } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { auth, db } from "../firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { collection, doc, getDoc, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { argentARemettre, dateHeure, enDate, fmt, soldeLivreur } from "./livraison-commun.js";

createApp({
  setup() {
    const prenom = ref("");
    const courses = ref([]);
    const paiements = ref([]);
    const livraisons = ref([]);
    const estAdmin = ref(false);

    const aujourdhui = new Date().toISOString().slice(0, 10);
    const coursesDuJour = computed(() => courses.value.filter((c) => c.jour === aujourdhui));
    const gainsJour = computed(() => coursesDuJour.value.reduce((t, c) => t + (Number(c.montantCourse) || 0), 0));
    const aRecevoir = computed(() => soldeLivreur(courses.value, paiements.value).reste);
    const aRemettre = computed(() => argentARemettre(courses.value));
    const prevuesDuJour = computed(() => livraisons.value.filter((l) => !l.corbeille && !["annulee_client"].includes(l.statut) && enDate(l.statutMajLe)?.toISOString().slice(0, 10) === aujourdhui).length);
    const mesPaiements = computed(() => [...paiements.value].sort((a, b) => (enDate(b.date)?.getTime() || 0) - (enDate(a.date)?.getTime() || 0)).slice(0, 5));

    onMounted(() => {
      const stop = onAuthStateChanged(auth, async (user) => {
        if (!user) return;
        stop();
        const [compte, admin] = await Promise.all([
          getDoc(doc(db, "comptesLivreurs", user.uid)).catch(() => null),
          getDoc(doc(db, "parametres", "livraison")).then(() => true).catch(() => false),
        ]);
        estAdmin.value = admin;
        prenom.value = compte?.data()?.prenom || "";
        const id = compte?.exists() ? compte.data().livreurId : `admin_${user.uid}`;
        const suivre = (nom, cible) => onSnapshot(query(collection(db, nom), where("livreurId", "==", id)), (s) => { cible.value = s.docs.map((d) => ({ id: d.id, ...d.data() })); }, console.error);
        suivre("courses", courses);
        suivre("paiementsLivreurs", paiements);
        suivre("livraisons", livraisons);
      });
    });

    return { prenom, coursesDuJour, prevuesDuJour, gainsJour, aRecevoir, aRemettre, mesPaiements, estAdmin, fmt, dateHeure };
  },
}).mount("#tableauLivreurApp");
