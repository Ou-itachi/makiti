// Journal d'activité des admins : écrit par le serveur seul.
import { createApp, ref } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { db } from "../firebase-config.js";
import { collection, limit, onSnapshot, orderBy, query } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { dateHeure, fmt } from "./livraison-commun.js";

const ACTIONS = {
  confirmer: "Confirmer", reassigner: "Assigner ou réassigner", annuler: "Annuler", preparer: "En préparation",
  corriger_statut: "Corriger le statut", valider_code_distance: "Valider le code à distance", consulter_video: "Consulter une vidéo",
  payer_livreur: "Payer un livreur", argent_recu: "Argent reçu", creer_livreur: "Créer un livreur", creer_acces_livreur: "Créer un accès livreur",
  desactiver_livreur: "Désactiver un livreur", reactiver_livreur: "Réactiver un livreur", nouveau_mot_de_passe: "Nouveau mot de passe",
  prendre_alerte: "Prendre en charge une alerte", cloturer_alerte: "Clôturer une alerte", garder_incident: "Garder (incident)",
};

createApp({
  setup() {
    const lignes = ref([]);
    const charge = ref(false);
    const erreurListe = ref(false);
    onSnapshot(query(collection(db, "journalActivite"), orderBy("date", "desc"), limit(200)), (s) => {
      lignes.value = s.docs.map((d) => {
        const j = d.data();
        const detail = [j.numero, j.cible, j.vers, j.raison, j.montant != null ? `${fmt(j.montant)} GNF` : ""].filter(Boolean).join(" · ");
        return { id: d.id, date: dateHeure(j.date), nom: j.nom, action: ACTIONS[j.action] || j.action, detail };
      });
      charge.value = true;
    }, (err) => { console.error(err); erreurListe.value = true; charge.value = true; });
    return { lignes, charge, erreurListe };
  },
}).mount("#journalApp");
