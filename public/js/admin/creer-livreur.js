// « Créer un livreur » : tout passe par la fonction creerLivreur.
import { createApp, ref } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { functions } from "../firebase-config.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { compresserPhotoIncident } from "./photo-incident.js";
import { genererMotDePasse } from "./livraison-commun.js";

const creerLivreur = httpsCallable(functions, "creerLivreur");

createApp({
  setup() {
    const form = ref({ prenom: "", nom: "", telephone: "", contactUrgence: "", zone: "", email: "", motDePasse: "", tarifCourse: "" });
    const piece = ref(null);
    const erreur = ref("");
    const envoi = ref(false);
    const cree = ref(null);

    const generer = () => { form.value.motDePasse = genererMotDePasse(); };
    async function choisirPiece(e) {
      const fichier = e.target.files?.[0];
      if (!fichier) return;
      try { piece.value = await compresserPhotoIncident(fichier); } catch (err) { erreur.value = err.message; }
    }
    async function creer() {
      erreur.value = "";
      envoi.value = true;
      try {
        const { tarifCourse, ...reste } = form.value;
        await creerLivreur({ ...reste, tarifCourse: tarifCourse === "" ? null : Number(tarifCourse), piece: piece.value });
        cree.value = { email: form.value.email.trim().toLowerCase(), motDePasse: form.value.motDePasse };
      } catch (err) {
        console.error(err);
        erreur.value = err.message || "Création impossible, réessayez.";
      } finally {
        envoi.value = false;
      }
    }
    return { form, piece, erreur, envoi, cree, generer, choisirPiece, creer };
  },
}).mount("#creerLivreurApp");
