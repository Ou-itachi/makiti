// Fenêtre « Payer » d'un fournisseur : le montant, le mode, et le reçu créé.
import { computed, ref, watch } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { functions } from "../firebase-config.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { nouvelIdAction } from "./photo-incident.js";
import { fmt } from "./livraison-commun.js";
import { FenetreConfirmation } from "./selection-lot.js";

const enregistrerPaiementFournisseur = httpsCallable(functions, "enregistrerPaiementFournisseur");
const changerActivationFournisseur = httpsCallable(functions, "changerActivationFournisseur");
const supprimerFournisseur = httpsCallable(functions, "supprimerFournisseur");
const gererProduitRetire = httpsCallable(functions, "gererProduitRetire");
export const MESSAGE_MONTANT_DU = "Réglez d'abord le montant dû";

export const FenetrePaiement = {
  components: { FenetreConfirmation },
  // fournisseur absent : la fenêtre propose la liste (registre des paiements).
  props: { fournisseur: Object, fournisseurs: Array },
  emits: ["fermer"],
  setup(props, { emit }) {
    const choisiId = ref(props.fournisseur?.id || "");
    const cible = computed(() => props.fournisseur || (props.fournisseurs || []).find((f) => f.id === choisiId.value) || null);
    const du = computed(() => Number(cible.value?.montantDu) || 0);
    const montant = ref(du.value || null);
    const mode = ref("especes");
    const date = ref(new Date().toISOString().slice(0, 10));
    const note = ref("");
    const envoi = ref(false);
    const erreur = ref("");
    const recu = ref(null);
    // Gardé d'un essai à l'autre : un clic répété après une coupure ne paie pas deux fois.
    const idAction = nouvelIdAction();
    watch(choisiId, () => { montant.value = du.value || null; });
    const valide = computed(() => !!cible.value && Number(montant.value) > 0);
    async function payer() {
      erreur.value = "";
      envoi.value = true;
      try {
        const r = await enregistrerPaiementFournisseur({ fournisseurId: cible.value.id, montant: Number(montant.value), mode: mode.value, date: date.value, note: note.value.trim(), idAction });
        recu.value = r.data;
      } catch (err) {
        console.error(err);
        erreur.value = err.message || "Paiement impossible, réessayez.";
      } finally {
        envoi.value = false;
      }
    }
    return { emit, choisiId, cible, du, montant, mode, date, note, envoi, erreur, recu, valide, payer, fmt };
  },
  template: `<fenetre-confirmation v-if="recu" titre="Paiement enregistré" sans-action @annuler="emit('fermer')">
      <p class="fen-texte">Le reçu <b>{{ recu.numero }}</b> est créé et rangé dans Versements fournisseurs.</p>
      <a class="fen-btn noir fen-lien" :href="'recu.html?id=' + recu.recuId">Voir le reçu</a>
    </fenetre-confirmation>
    <fenetre-confirmation v-else :titre="cible ? 'Payer ' + cible.nom : 'Payer un fournisseur'" :sous-titre="cible ? 'Montant dû : ' + fmt(du) + ' GNF' : ''"
        libelle="Payer et créer le reçu" :envoi="envoi" :erreur="erreur" :desactive="!valide" @annuler="emit('fermer')" @confirmer="payer">
      <div class="fen-champ" v-if="!fournisseur">
        <label for="fpFournisseur">Fournisseur</label>
        <select id="fpFournisseur" v-model="choisiId"><option value="" disabled>Choisir un fournisseur</option><option v-for="f in fournisseurs" :key="f.id" :value="f.id">{{ f.nom }} — {{ fmt(f.montantDu) }} GNF dû</option></select>
      </div>
      <div class="fen-champ"><label for="fpMontant">Montant versé (GNF)</label><input id="fpMontant" type="number" min="1" inputmode="numeric" v-model="montant"/></div>
      <fieldset class="fen-champ fen-modes"><legend>Mode de paiement</legend>
        <label class="fen-case"><input type="radio" name="fpMode" value="especes" v-model="mode"/><span>Espèces</span></label>
        <label class="fen-case"><input type="radio" name="fpMode" value="orange_money" v-model="mode"/><span>Orange Money</span></label>
      </fieldset>
      <div class="fen-champ"><label for="fpDate">Date</label><input id="fpDate" type="date" v-model="date"/></div>
      <div class="fen-champ"><label for="fpNote">Note (facultatif)</label><input id="fpNote" maxlength="300" v-model="note"/></div>
      <p class="fen-note">Un reçu est créé et rangé dans Versements fournisseurs.</p>
    </fenetre-confirmation>`,
};

// Actif / Non actif et suppression, avec leur confirmation. La règle du montant
// dû est contrôlée ici pour répondre tout de suite, et sur le serveur.
export function etatFournisseur(afficherErreur, apresSuppression = () => {}) {
  const demande = ref(null);
  const envoi = ref(false);
  const erreur = ref("");
  const actif = (f) => f.actif !== false;
  function bloque(f) {
    if ((Number(f.montantDu) || 0) <= 0) return false;
    afficherErreur(MESSAGE_MONTANT_DU);
    return true;
  }
  async function changer(f, voulu) {
    afficherErreur("");
    if (actif(f) === voulu) return;
    if (!voulu) {
      if (bloque(f)) return;
      erreur.value = "";
      demande.value = {
        f, action: "desactiver", titre: `Désactiver ${f.nom} ?`, libelle: "Désactiver",
        note: "Ses produits sont retirés de la boutique, sans être supprimés. Vous pourrez les remettre en ligne ou les rattacher à un autre fournisseur.",
      };
      return;
    }
    try {
      await changerActivationFournisseur({ fournisseurId: f.id, actif: true });
    } catch (err) {
      console.error(err);
      afficherErreur(err.message || "Action impossible, réessayez.");
    }
  }
  function supprimer(f) {
    afficherErreur("");
    if (bloque(f)) return;
    erreur.value = "";
    demande.value = {
      f, action: "supprimer", titre: `Supprimer ${f.nom} ?`, libelle: "Supprimer",
      note: "Il disparaît de la liste. Ses produits sont retirés de la boutique, sans être supprimés. Ses reçus et ses paiements restent.",
    };
  }
  async function confirmer() {
    const { f, action } = demande.value;
    envoi.value = true;
    erreur.value = "";
    try {
      if (action === "supprimer") await supprimerFournisseur({ fournisseurId: f.id });
      else await changerActivationFournisseur({ fournisseurId: f.id, actif: false });
      demande.value = null;
      if (action === "supprimer") apresSuppression();
    } catch (err) {
      console.error(err);
      erreur.value = err.message || "Action impossible, réessayez.";
    } finally {
      envoi.value = false;
    }
  }
  const annuler = () => { demande.value = null; };
  return { actif, demande, envoi, erreur, changer, supprimer, confirmer, annuler };
}

// Produit retiré : remise en ligne ou rattachement à un autre fournisseur actif.
export function produitRetire(afficherErreur) {
  const rattachement = ref(null);
  const cible = ref("");
  const envoi = ref(false);
  const erreur = ref("");
  async function remettre(p) {
    afficherErreur("");
    try {
      await gererProduitRetire({ produitId: p.id });
    } catch (err) {
      console.error(err);
      afficherErreur(err.message || "Action impossible, réessayez.");
    }
  }
  function ouvrirRattachement(p) {
    erreur.value = "";
    cible.value = "";
    rattachement.value = p;
  }
  async function rattacher() {
    envoi.value = true;
    erreur.value = "";
    try {
      await gererProduitRetire({ produitId: rattachement.value.id, rattacher: true, fournisseurId: cible.value });
      rattachement.value = null;
    } catch (err) {
      console.error(err);
      erreur.value = err.message || "Action impossible, réessayez.";
    } finally {
      envoi.value = false;
    }
  }
  return { rattachement, cible, envoi, erreur, remettre, ouvrirRattachement, rattacher };
}
