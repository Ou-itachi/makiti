// Journal d'activité des admins : écrit par le serveur seul.
import { createApp, ref } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { db } from "../firebase-config.js";
import { collection, limit, onSnapshot, orderBy, query } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { dateHeure, enDate, fmt } from "./livraison-commun.js";

const dateJour = (t) => enDate(t)?.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Conakry" }) || "";

const ACTIONS = {
  confirmer: "Confirmer", reassigner: "Assigner ou réassigner", annuler: "Annuler", preparer: "En préparation",
  corriger_statut: "Corriger le statut", valider_code_distance: "Valider le code à distance", consulter_video: "Consulter une vidéo",
  payer_livreur: "Payer un livreur", argent_recu: "Argent reçu", creer_livreur: "Créer un livreur", creer_acces_livreur: "Créer un accès livreur",
  desactiver_livreur: "Désactiver un livreur", reactiver_livreur: "Réactiver un livreur", reinitialiser_code_client: "Réinitialiser le code d'un client", nouveau_mot_de_passe: "Nouveau mot de passe",
  payer_fournisseur: "Payer un fournisseur", desactiver_fournisseur: "Désactiver un fournisseur", reactiver_fournisseur: "Réactiver un fournisseur",
  supprimer_fournisseur: "Supprimer un fournisseur", remettre_produit: "Remettre un produit en ligne", rattacher_produit: "Rattacher un produit",
  restaurer_commande: "Restaurer une commande", supprimer_commande: "Supprimer une commande", supprimer_incident: "Supprimer un incident", supprimer_video: "Supprimer une vidéo",
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
        // Reçu supprimé : une seule ligne courte, sans autre détail.
        if (j.action === "recu_supprime") {
          return { id: d.id, date: dateHeure(j.date), nom: j.nom, action: `reçu n°${j.numero} supprimé par ${j.nom} le ${dateJour(j.date)}`, detail: "" };
        }
        const detail = [j.numero, j.cible, j.vers, j.raison, j.montant != null ? `${fmt(j.montant)} GNF` : ""].filter(Boolean).join(" · ");
        return { id: d.id, date: dateHeure(j.date), nom: j.nom, action: ACTIONS[j.action] || j.action, detail };
      });
      charge.value = true;
    }, (err) => { console.error(err); erreurListe.value = true; charge.value = true; });
    return { lignes, charge, erreurListe };
  },
}).mount("#journalApp");
