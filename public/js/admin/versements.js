// Versements : l'argent gagné, moins ce qui est parti à la banque ou sur Orange Money.
import { createApp, ref } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { functions } from "../firebase-config.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { fmt } from "./livraison-commun.js";
import { nouvelIdAction } from "./photo-incident.js";
import { FenetreConfirmation } from "./selection-lot.js";

const etatVersements = httpsCallable(functions, "etatVersements");
const effectuerVersement = httpsCallable(functions, "effectuerVersement");
const aujourdhui = new Date().toLocaleDateString("en-CA");
const dateLisible = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

createApp({
  components: { FenetreConfirmation },
  setup() {
    const etat = ref(null);
    const erreur = ref("");
    const etape = ref(0);
    const envoi = ref(false);
    const erreurFenetre = ref("");
    const confirme = ref("");
    const form = ref({});

    async function charger() {
      try {
        etat.value = (await etatVersements()).data;
        erreur.value = "";
      } catch (err) {
        console.error(err);
        erreur.value = "Impossible de charger l'argent disponible. Vérifiez la connexion, puis rechargez la page.";
      }
    }
    function ouvrir() {
      form.value = { idAction: nouvelIdAction(), montant: null, date: aujourdhui, note: "", email: "" };
      erreurFenetre.value = "";
      confirme.value = "";
      etape.value = 1;
    }
    const fermer = () => { etape.value = 0; };
    function continuer() {
      const { montant, date } = form.value;
      erreurFenetre.value = "";
      if (!Number.isSafeInteger(montant) || montant <= 0) erreurFenetre.value = "Indiquez le montant.";
      else if (montant > etat.value.disponible) erreurFenetre.value = "Ce montant dépasse l'argent disponible.";
      else if (!date) erreurFenetre.value = "Indiquez la date.";
      else etape.value = 2;
    }
    async function valider() {
      envoi.value = true;
      erreurFenetre.value = "";
      try {
        await effectuerVersement({ ...form.value, email: form.value.email.trim() });
        await charger();
        etape.value = 0;
        confirme.value = `Versement de ${fmt(form.value.montant)} GNF enregistré.`;
      } catch (err) {
        console.error(err);
        erreurFenetre.value = err.message || "Enregistrement impossible, réessayez.";
      } finally {
        envoi.value = false;
      }
    }
    charger();
    return { etat, erreur, etape, envoi, erreurFenetre, confirme, form, aujourdhui, fmt, dateLisible, ouvrir, fermer, continuer, valider };
  },
}).mount("#versementsArgentApp");
