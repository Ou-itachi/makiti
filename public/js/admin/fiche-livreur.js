// Fiche d'un livreur (ou d'un admin qui livre) et ses onglets.
import { createApp, ref, computed } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { db, functions } from "../firebase-config.js";
import { collection, doc, onSnapshot, query, updateDoc, where } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { argentARemettre, cleMois, dateHeure, enDate, fmt, genererMotDePasse, infoStatut, initiales, libelleRaison, soldeLivreur } from "./livraison-commun.js";
import { directiveFenetre } from "./selection-lot.js";

const appel = (nom) => httpsCallable(functions, nom);
const listerAdmins = appel("listerAdmins");
const changerActivationLivreur = appel("changerActivationLivreur");
const nouveauMotDePasseLivreur = appel("nouveauMotDePasseLivreur");
const creerAccesLivreur = appel("creerAccesLivreur");

const recentEnPremier = (cle) => (a, b) => (enDate(b[cle])?.getTime() || 0) - (enDate(a[cle])?.getTime() || 0);

createApp({
  setup() {
    const id = new URLSearchParams(location.search).get("id") || "";
    const estAdmin = id.startsWith("admin_");
    const fiche = ref(null);
    const introuvable = ref(false);
    const onglet = ref("livraisons");
    const livraisons = ref([]);
    const alertes = ref([]);
    const enregistrements = ref([]);
    const paiements = ref([]);
    const courses = ref([]);
    const message = ref("");
    const erreur = ref("");
    const motDePasse = ref(null);
    const edition = ref(null);
    const acces = ref(null);
    const envoi = ref(false);

    const ONGLETS = [
      ["livraisons", "Livraisons"], ["incidents", "Incidents et SOS"], ["enregistrements", "Enregistrements"],
      ...(estAdmin ? [] : [["paiements", "Paiements"]]), ["informations", "Informations"],
    ];
    const coursesMois = computed(() => courses.value.filter((c) => c.mois === cleMois()).length);
    const solde = computed(() => soldeLivreur(courses.value, paiements.value));
    const aRemettre = computed(() => argentARemettre(courses.value));

    async function faire(action, reussite) {
      erreur.value = "";
      message.value = "";
      envoi.value = true;
      try {
        await action();
        if (reussite) message.value = reussite;
        return true;
      } catch (err) {
        console.error(err);
        erreur.value = err.message || "Action impossible, réessayez.";
        return false;
      } finally {
        envoi.value = false;
      }
    }
    function basculerActivation() {
      const actif = fiche.value.actif === false;
      if (!actif && !confirm(`Désactiver ${fiche.value.nom} ? Il sera déconnecté de tous ses appareils.`)) return;
      faire(() => changerActivationLivreur({ livreurId: id, actif }), actif ? "Livreur réactivé." : "Livreur désactivé et déconnecté.");
    }
    function nouveauMotDePasse() {
      const mdp = genererMotDePasse();
      faire(() => nouveauMotDePasseLivreur({ livreurId: id, motDePasse: mdp })).then((ok) => { if (ok) motDePasse.value = mdp; });
    }
    const ouvrirEdition = () => {
      const f = fiche.value;
      edition.value = { telephone: f.telephone || "", contactUrgence: f.contactUrgence || "", zone: f.zone || f.zonePrincipale || "", fraisParLivraison: f.fraisParLivraison ?? "" };
    };
    async function enregistrerEdition() {
      const { fraisParLivraison, ...reste } = edition.value;
      const donnees = { ...reste, fraisParLivraison: fraisParLivraison === "" ? null : Number(fraisParLivraison) };
      if (await faire(() => updateDoc(doc(db, "livreurs", id), donnees), "Informations enregistrées.")) edition.value = null;
    }
    const ouvrirAcces = () => { acces.value = { email: "", motDePasse: genererMotDePasse() }; };
    async function creerAcces() {
      const { email, motDePasse: mdp } = acces.value;
      if (await faire(() => creerAccesLivreur({ livreurId: id, email, motDePasse: mdp }), "Accès créé.")) {
        motDePasse.value = mdp;
        acces.value = null;
      }
    }

    const suivre = (nom, cible, cle) => onSnapshot(
      query(collection(db, nom), where("livreurId", "==", id)),
      (s) => { cible.value = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort(recentEnPremier(cle)); },
      console.error,
    );
    suivre("livraisons", livraisons, "attribueeLe");
    suivre("alertes", alertes, "date");
    suivre("enregistrements", enregistrements, "debut");
    suivre("paiementsLivreurs", paiements, "date");
    suivre("courses", courses, "date");

    if (estAdmin) {
      listerAdmins().then((r) => {
        const a = r.data.admins.find((x) => x.id === id);
        if (a) fiche.value = { ...a, role: "Admin", actif: true };
        else introuvable.value = true;
      }).catch(console.error);
    } else if (id) {
      onSnapshot(doc(db, "livreurs", id), (s) => {
        if (s.exists()) fiche.value = { id: s.id, role: "Livreur", ...s.data() };
        else introuvable.value = true;
      }, console.error);
    } else {
      introuvable.value = true;
    }

    return {
      id, estAdmin, fiche, introuvable, ONGLETS, onglet, livraisons, alertes, enregistrements, paiements, message, erreur,
      motDePasse, edition, acces, envoi, coursesMois, solde, aRemettre, fmt, dateHeure, infoStatut, initiales, libelleRaison,
      basculerActivation, nouveauMotDePasse, ouvrirEdition, enregistrerEdition, ouvrirAcces, creerAcces,
    };
  },
}).directive("fenetre", directiveFenetre).mount("#ficheLivreurApp");
