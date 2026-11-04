// Tableau de bord de celui qui livre : sa journée et son argent.
import { createApp, ref, computed, onMounted } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { db } from "../firebase-base.js";
import { auth } from "../auth-client.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { collection, doc, getAggregateFromServer, getDoc, onSnapshot, query, sum, Timestamp, where } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { dateHeure, enDate, fmt } from "./livraison-commun.js";

// Derniers totaux reçus, pour rester lisibles sans réseau (effacés à la déconnexion, auth-guard.js).
const CLE_TOTAUX = "bokki-livreur-totaux-v1";

createApp({
  setup() {
    const prenom = ref("");
    const coursesDuJour = ref([]);
    const totaux = ref({ gains: 0, encaisse: 0 });
    const paiements = ref([]);
    const livraisons = ref([]);
    const estAdmin = ref(false);
    const charge = ref(false);
    const erreurListe = ref(false);

    const aujourdhui = new Date().toISOString().slice(0, 10);
    const gainsJour = computed(() => coursesDuJour.value.reduce((t, c) => t + (Number(c.montantCourse) || 0), 0));
    const aRecevoir = computed(() => totaux.value.gains - paiements.value.reduce((t, p) => t + (Number(p.montant) || 0), 0));
    const aRemettre = computed(() => totaux.value.encaisse);
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
        // Toutes les courses depuis le début n'étaient lues que pour deux totaux :
        // le serveur les calcule, seules celles du jour sont téléchargées.
        const cleTotaux = `${CLE_TOTAUX}-${user.uid}`;
        try { totaux.value = JSON.parse(localStorage.getItem(cleTotaux)) || totaux.value; } catch { /* stockage indisponible */ }
        async function lireTotaux() {
          const mes = where("livreurId", "==", id);
          const [gains, encaisse] = await Promise.all([
            getAggregateFromServer(query(collection(db, "courses"), mes), { total: sum("montantCourse") }),
            getAggregateFromServer(query(collection(db, "courses"), mes, where("remiseId", "==", null)), { total: sum("encaisse") }),
          ]);
          totaux.value = { gains: gains.data().total || 0, encaisse: encaisse.data().total || 0 };
          try { localStorage.setItem(cleTotaux, JSON.stringify(totaux.value)); } catch { /* stockage indisponible */ }
        }
        const erreur = (err) => { console.error(err); erreurListe.value = true; charge.value = true; };
        const suivre = (requete, cible, apres) => onSnapshot(requete, (s) => {
          cible.value = s.docs.map((d) => ({ id: d.id, ...d.data() }));
          // Sans réseau le calcul serveur échoue : les derniers totaux restent affichés.
          apres?.().catch(console.error).finally(() => { charge.value = true; });
        }, erreur);
        const mes = (nom, ...filtres) => query(collection(db, nom), where("livreurId", "==", id), ...filtres);
        const minuit = Timestamp.fromDate(new Date(`${aujourdhui}T00:00:00.000Z`));
        suivre(mes("courses", where("jour", "==", aujourdhui)), coursesDuJour, lireTotaux);
        suivre(mes("paiementsLivreurs"), paiements);
        suivre(mes("livraisons", where("statutMajLe", ">=", minuit)), livraisons);
      });
    });

    return { prenom, charge, erreurListe, coursesDuJour, prevuesDuJour, gainsJour, aRecevoir, aRemettre, mesPaiements, estAdmin, fmt, dateHeure };
  },
}).mount("#tableauLivreurApp");
