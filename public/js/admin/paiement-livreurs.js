// « Paiement des livreurs » : ce que Bokki doit à chacun, et l'argent des
// clients à remettre. Les opérations passent par le serveur et ne se modifient
// pas : on corrige par une nouvelle opération.
import { createApp, ref, computed } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { db, functions } from "../firebase-config.js";
import { collection, getDocs, limit, onSnapshot, orderBy, query, where } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { nouvelIdAction } from "./photo-incident.js";
import { argentARemettre, cleMois, dateHeure, enDate, fmt, libelleMois, soldeLivreur } from "./livraison-commun.js";
import { BarreLot, FenetreConfirmation, useSelection } from "./selection-lot.js";
import { dateCourte, libelleMode, parPrenom, suppressionRecus, totalRecus } from "./recus-commun.js";

const enregistrerPaiementLivreur = httpsCallable(functions, "enregistrerPaiementLivreur");
const enregistrerArgentRecu = httpsCallable(functions, "enregistrerArgentRecu");
const listerAdmins = httpsCallable(functions, "listerAdmins");

createApp({
  components: { BarreLot, FenetreConfirmation },
  setup() {
    const livreurs = ref([]);
    const recus = ref([]);
    const livreurFiltre = ref("");
    const recuCree = ref(null);
    const admins = ref([]);
    const courses = ref([]);
    const paiements = ref([]);
    const journees = ref([]);
    const paiement = ref(null);
    const argent = ref(null);
    const erreur = ref("");
    const charge = ref(false);
    const erreurListe = ref(false);
    const envoi = ref(false);
    const mois = cleMois();

    const lignes = computed(() => {
      const ligne = (id, nom, role, prenom = "") => {
        const cs = courses.value.filter((c) => c.livreurId === id);
        const ps = paiements.value.filter((p) => p.livreurId === id);
        const duMois = cs.filter((c) => c.mois === mois);
        const paye = ps.filter((p) => p.mois === mois).reduce((t, p) => t + (Number(p.montant) || 0), 0);
        return {
          id, nom, prenom, role, courses: duMois.length, gains: duMois.reduce((t, c) => t + (Number(c.montantCourse) || 0), 0),
          paye, reste: soldeLivreur(cs, ps).reste, aRemettre: argentARemettre(cs),
        };
      };
      return [
        ...livreurs.value.map((l) => ligne(l.id, l.nom, "livreur", l.prenom)),
        ...admins.value.map((a) => ligne(a.id, a.nom, "admin")).filter((l) => l.aRemettre > 0),
      ].sort(parPrenom);
    });
    const recusAffiches = computed(() => (livreurFiltre.value ? recus.value.filter((r) => r.beneficiaireId === livreurFiltre.value) : recus.value));
    const nomFiltre = computed(() => lignes.value.find((l) => l.id === livreurFiltre.value)?.nom || "");
    const sel = useSelection(recusAffiches);
    const suppression = suppressionRecus("le reste à payer", sel.vider);
    const resumeLot = computed(() => {
      const n = sel.selection.value.length;
      return `${n} reçu${n > 1 ? "s" : ""} sélectionné${n > 1 ? "s" : ""} · ${fmt(totalRecus(sel.selection.value))} GNF`;
    });
    const filtrer = (l) => { livreurFiltre.value = livreurFiltre.value === l.id ? "" : l.id; };
    const historique = computed(() => [
      ...paiements.value.map((p) => ({
        id: p.id, date: p.date, nom: p.nom, operation: "Paiement des courses",
        montant: `${fmt(p.montant)} GNF · ${p.mode === "orange_money" ? "Orange Money" : "Espèces"}`, detail: p.note || `Par ${p.par}`,
      })),
      ...journees.value.filter((j) => j.etat === "recue" && j.recuLe).map((j) => ({
        id: j.id, date: j.recuLe, nom: j.nom, operation: "Argent des clients reçu",
        montant: `${fmt(j.recu)} GNF`, detail: `Écart : ${fmt(j.ecart)} GNF`,
      })),
    ].sort((a, b) => (enDate(b.date)?.getTime() || 0) - (enDate(a.date)?.getTime() || 0)));

    async function recharger() {
      const lire = async (nom, cible) => { cible.value = (await getDocs(collection(db, nom))).docs.map((d) => ({ id: d.id, ...d.data() })); };
      await Promise.all([lire("courses", courses), lire("paiementsLivreurs", paiements), lire("journees", journees)])
        .catch((err) => { console.error(err); erreurListe.value = true; });
      charge.value = true;
    }
    const ouvrirPaiement = (l) => {
      erreur.value = "";
      paiement.value = { livreurId: l.id, nom: l.nom, montant: l.reste > 0 ? l.reste : "", mode: "especes", date: new Date().toISOString().slice(0, 10), note: "", idAction: nouvelIdAction() };
    };
    const ouvrirArgent = (l) => {
      erreur.value = "";
      argent.value = { livreurId: l.id, nom: l.nom, attendu: l.aRemettre, montant: l.aRemettre, note: "" };
    };
    async function faire(action, fermer) {
      erreur.value = "";
      envoi.value = true;
      try {
        await action();
        fermer();
        await recharger();
      } catch (err) {
        console.error(err);
        erreur.value = err.message || "Enregistrement impossible, réessayez.";
      } finally {
        envoi.value = false;
      }
    }
    const validerPaiement = () => {
      const { nom, ...p } = paiement.value;
      let reponse = null;
      faire(async () => { reponse = (await enregistrerPaiementLivreur({ ...p, montant: Number(p.montant) })).data; }, () => { paiement.value = null; recuCree.value = reponse; });
    };
    const validerArgent = () => {
      const { livreurId, montant, note } = argent.value;
      faire(() => enregistrerArgentRecu({ livreurId, montant: Number(montant), note }), () => { argent.value = null; });
    };

    onSnapshot(query(collection(db, "livreurs"), orderBy("nom")), (s) => { livreurs.value = s.docs.map((d) => ({ id: d.id, ...d.data() })); }, console.error);
    onSnapshot(query(collection(db, "recus"), where("type", "==", "livreur"), orderBy("date", "desc"), limit(500)), (s) => {
      recus.value = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    }, console.error);
    listerAdmins().then((r) => { admins.value = r.data.admins; }).catch(console.error);
    recharger();

    return { recusAffiches, livreurFiltre, nomFiltre, filtrer, sel, suppression, resumeLot, recuCree, dateCourte, libelleMode, charge, erreurListe, lignes, historique, paiement, argent, erreur, envoi, fmt, dateHeure, moisTexte: libelleMois(), ouvrirPaiement, ouvrirArgent, validerPaiement, validerArgent };
  },
}).mount("#paiementLivreursApp");
