// Listes de contrôle avant « Confirmer » et « En préparation », dans la liste des
// commandes et sur le détail. Mêmes clés que CHECKLISTS dans functions/src/index.ts :
// le serveur refuse le changement de statut si une case manque.
import { computed, ref } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { FenetreConfirmation } from "./selection-lot.js";

export const CHECKLISTS = {
  confirmee: {
    titre: "Avant de confirmer", bouton: "Confirmer", nom: "Confirmer",
    cases: [
      { cle: "client_appele", libelle: "Client appelé, il veut bien la commande" },
      { cle: "adresse_verifiee", libelle: "Adresse et quartier vérifiés" },
      { cle: "prix_annonce", libelle: "Prix et frais annoncés au client" },
    ],
  },
  en_preparation: {
    titre: "Avant de préparer", bouton: "En préparation", nom: "En préparation",
    cases: [
      { cle: "produit_recupere", libelle: "Produit récupéré chez le fournisseur" },
      { cle: "produit_verifie", libelle: "Produit vérifié (bon modèle, bon état, complet)" },
      { cle: "colis_prepare", libelle: "Colis préparé" },
    ],
  },
};

export const FenetreChecklist = {
  components: { FenetreConfirmation },
  props: { etape: String, numero: String, resume: String, envoi: Boolean, erreur: String },
  emits: ["annuler", "valider"],
  setup(props) {
    const liste = computed(() => CHECKLISTS[props.etape]);
    const cochees = ref([]);
    const complete = computed(() => liste.value.cases.every((c) => cochees.value.includes(c.cle)));
    return { liste, cochees, complete };
  },
  template: `<fenetre-confirmation :titre="liste.titre + ' ' + numero" :sous-titre="resume" :libelle="liste.bouton" :envoi="envoi" :erreur="erreur" :desactive="!complete"
      @annuler="$emit('annuler')" @confirmer="$emit('valider', cochees)">
    <fieldset class="fen-cases"><legend class="sr-only">{{ liste.titre }}</legend>
      <label v-for="c in liste.cases" :key="c.cle" class="fen-case"><input type="checkbox" :value="c.cle" v-model="cochees"/><span>{{ c.libelle }}</span></label>
    </fieldset>
    <p class="fen-note">Cochez chaque case pour valider l'étape.</p>
  </fenetre-confirmation>`,
};
