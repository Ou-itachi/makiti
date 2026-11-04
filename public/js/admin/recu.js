// Un reçu (?id=) ou la fiche du mois d'un fournisseur ou d'un livreur
// (?type=fournisseur|livreur&cible=…&mois=AAAA-MM) : à l'écran, à imprimer, en PDF.
import { createApp, computed, ref, watch } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { auth, db } from "../firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { collection, doc, getDoc, getDocs, orderBy, query, where } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { fmt } from "./livraison-commun.js";
import { dateCourte, dateLongue, libelleBeneficiaire, libelleMode, libelleMoisCle, moisCourant, montantEnLettres, telechargerFiche, telechargerRecu, totalRecus } from "./recus-commun.js";

const params = new URLSearchParams(location.search);
const recuId = params.get("id");
const typeFiche = params.get("type") === "livreur" ? "livreur" : "fournisseur";
const cible = params.get("cible");

// Douze derniers mois, et le mois demandé s'il est plus ancien.
function moisRecents(demande) {
  const liste = [];
  const d = new Date();
  d.setUTCDate(15);
  for (let i = 0; i < 12; i++) {
    liste.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return liste.includes(demande) ? liste : [demande, ...liste];
}

createApp({
  setup() {
    const recu = ref(null);
    const charge = ref(false);
    const erreur = ref("");
    const fiche = ref(false);
    const nomFiche = ref("");
    const recusFiche = ref([]);
    const moisDemande = /^\d{4}-\d{2}$/.test(params.get("mois") || "") ? params.get("mois") : moisCourant();
    const mois = ref(moisDemande);
    const moisProposes = moisRecents(moisDemande);

    const retour = computed(() => {
      const type = recu.value?.type || (cible ? typeFiche : null);
      const id = recu.value?.beneficiaireId || cible;
      if (type === "livreur") return "paiement-livreurs.html";
      return id ? `versements-fournisseurs.html?id=${encodeURIComponent(id)}` : "versements-fournisseurs.html";
    });

    const signaler = (err) => { console.error(err); erreur.value = "Impossible de charger ce document. Vérifiez la connexion, puis rechargez la page."; };
    async function chargerRecu() {
      const snap = await getDoc(doc(db, "recus", recuId));
      if (snap.exists()) recu.value = { id: snap.id, ...snap.data() };
    }
    async function chargerMois() {
      const snap = await getDocs(query(collection(db, "recus"), where("type", "==", typeFiche), where("beneficiaireId", "==", cible), where("mois", "==", mois.value), orderBy("date", "asc")));
      recusFiche.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
    async function chargerFiche() {
      fiche.value = true;
      const beneficiaire = await getDoc(doc(db, typeFiche === "livreur" ? "livreurs" : "fournisseurs", cible));
      await chargerMois();
      nomFiche.value = beneficiaire.data()?.nom || recusFiche.value[0]?.nom || "";
    }
    watch(mois, () => chargerMois().catch(signaler));

    // Attendre la session : sans elle, Firestore refuserait la lecture.
    const stop = onAuthStateChanged(auth, (user) => {
      if (!user) return;
      stop();
      (recuId ? chargerRecu() : cible ? chargerFiche() : Promise.resolve()).catch(signaler).finally(() => { charge.value = true; });
    });

    return { recu, charge, erreur, fiche, nomFiche, recusFiche, typeFiche, mois, moisProposes, retour, imprimer: () => window.print(), fmt, dateCourte, dateLongue, libelleBeneficiaire, libelleMode, libelleMoisCle, montantEnLettres, telechargerFiche, telechargerRecu, totalRecus };
  },
}).mount("#recuApp");
