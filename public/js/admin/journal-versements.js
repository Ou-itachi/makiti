// Journal de versement : un reçu reste tant que tous les administrateurs actifs
// ne l'ont pas supprimé. L'argent, lui, reste déduit.
import { computed, createApp, ref } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { auth, db, functions } from "../firebase-config.js";
import { collection, onSnapshot, orderBy, query } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { fmt } from "./livraison-commun.js";
import { nouvelIdAction } from "./photo-incident.js";
import { FenetreConfirmation } from "./selection-lot.js";

const etatVersements = httpsCallable(functions, "etatVersements");
const demander = httpsCallable(functions, "demanderSuppressionVersement");
const annuler = httpsCallable(functions, "annulerSuppressionVersement");
const corriger = httpsCallable(functions, "corrigerVersement");
const dateCourte = (t) => (t?.toDate ? t.toDate().toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "");
const listeNoms = (noms) => (noms.length > 1 ? `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}` : noms[0] || "");

createApp({
  components: { FenetreConfirmation },
  setup() {
    const lignes = ref([]);
    const admins = ref([]);
    const charge = ref(false);
    const erreurListe = ref(false);
    const horsLigne = ref(false);
    const envoi = ref(false);
    const erreurAction = ref("");
    const erreurFenetre = ref("");
    const aSupprimer = ref(null);
    const correction = ref(null);

    onSnapshot(query(collection(db, "versements"), orderBy("date", "desc")), { includeMetadataChanges: true }, (snap) => {
      lignes.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      horsLigne.value = snap.metadata.fromCache;
      erreurListe.value = false;
      charge.value = true;
    }, (err) => {
      console.error(err);
      erreurListe.value = true;
      charge.value = true;
    });
    etatVersements().then(({ data }) => { admins.value = data.admins; }).catch(console.error);

    const sousTitre = computed(() => `${lignes.value.length} ${lignes.value.length > 1 ? "reçus" : "reçu"}`);
    const aDemande = (v) => !!v.suppressions?.[auth.currentUser?.uid];
    function etatDe(v) {
      if (!Object.keys(v.suppressions || {}).length) return { label: "Validé", cls: "vert" };
      const manquants = admins.value.filter((a) => !v.suppressions[a.uid]).map((a) => a.nom.split(/\s+/)[0]);
      return { label: manquants.length ? `Suppression en attente de ${listeNoms(manquants)}` : "Suppression en attente", cls: "ambre" };
    }
    async function confirmerSuppression() {
      envoi.value = true;
      erreurFenetre.value = "";
      try {
        await demander({ id: aSupprimer.value.id });
        aSupprimer.value = null;
      } catch (err) {
        console.error(err);
        erreurFenetre.value = err.message || "Suppression impossible, réessayez.";
      } finally {
        envoi.value = false;
      }
    }
    async function annulerDemande(v) {
      envoi.value = true;
      erreurAction.value = "";
      try {
        await annuler({ id: v.id });
      } catch (err) {
        console.error(err);
        erreurAction.value = err.message || "Action impossible, réessayez.";
      } finally {
        envoi.value = false;
      }
    }
    function ouvrirCorrection(v) {
      erreurFenetre.value = "";
      correction.value = { ...v, idAction: nouvelIdAction(), bonMontant: null, motif: "", email: "" };
    }
    async function validerCorrection() {
      const c = correction.value;
      erreurFenetre.value = "";
      if (!Number.isSafeInteger(c.bonMontant) || c.bonMontant < 0) return void (erreurFenetre.value = "Indiquez le bon montant.");
      if (!c.motif.trim()) return void (erreurFenetre.value = "Indiquez le motif.");
      envoi.value = true;
      try {
        await corriger({ idAction: c.idAction, versementId: c.id, bonMontant: c.bonMontant, motif: c.motif.trim(), email: c.email.trim() });
        correction.value = null;
      } catch (err) {
        console.error(err);
        erreurFenetre.value = err.message || "Correction impossible, réessayez.";
      } finally {
        envoi.value = false;
      }
    }
    return {
      lignes, admins, charge, erreurListe, horsLigne, envoi, erreurAction, erreurFenetre, aSupprimer, correction, sousTitre,
      fmt, dateCourte, aDemande, etatDe, confirmerSuppression, annulerDemande, ouvrirCorrection, validerCorrection,
    };
  },
}).mount("#journalVersementsApp");
