// Réglages de la mise à jour n°6 : tarif par course, numéros, badge À vérifier.
// parametres/livraison reste réservé aux admins ; parametres/equipe est lu par
// ceux qui livrent (numéros à appeler).
import { createApp, ref } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { db } from "../firebase-config.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const enTexte = (o) => Object.entries(o || {}).map(([z, m]) => `${z} = ${m}`).join("\n");
function enObjet(texte) {
  const objet = {};
  for (const ligne of texte.split("\n")) {
    const [zone, montant] = ligne.split("=").map((m) => m.trim());
    if (zone && Number.isFinite(Number(montant)) && montant !== undefined && montant !== "") objet[zone] = Number(montant);
  }
  return objet;
}

createApp({
  setup() {
    const form = ref({ tarifCourse: "", tarifsZone: "", telBokki: "", telSecours: "", seuilVerification: "", zonesIsolees: "" });
    const message = ref("");
    const envoi = ref(false);

    Promise.all([getDoc(doc(db, "parametres", "livraison")), getDoc(doc(db, "parametres", "equipe"))]).then(([l, e]) => {
      const a = l.data() || {};
      const b = e.data() || {};
      form.value = {
        tarifCourse: a.tarifCourse ?? "", tarifsZone: enTexte(a.tarifsZone), telBokki: b.telBokki || "", telSecours: b.telSecours || "",
        seuilVerification: a.seuilVerification ?? "", zonesIsolees: (a.zonesIsolees || []).join(", "),
      };
    }).catch(console.error);

    async function enregistrer() {
      const f = form.value;
      envoi.value = true;
      message.value = "";
      try {
        await Promise.all([
          setDoc(doc(db, "parametres", "livraison"), {
            tarifCourse: Number(f.tarifCourse) || 0, tarifsZone: enObjet(f.tarifsZone), seuilVerification: Number(f.seuilVerification) || 0,
            zonesIsolees: f.zonesIsolees.split(",").map((z) => z.trim()).filter(Boolean),
          }, { merge: true }),
          setDoc(doc(db, "parametres", "equipe"), { telBokki: f.telBokki.trim(), telSecours: f.telSecours.trim() }, { merge: true }),
        ]);
        message.value = "Enregistré.";
      } catch (err) {
        console.error(err);
        message.value = "Enregistrement impossible, réessayez.";
      } finally {
        envoi.value = false;
      }
    }
    return { form, message, envoi, enregistrer };
  },
}).mount("#livraisonsApp");
