// Sélection multiple et fenêtre de confirmation, communes aux écrans admin.
// Les fenêtres remplacent window.confirm : vrais boutons, focus gardé dedans,
// Échap pour annuler, retour du focus sur le bouton d'origine.
import { computed, onBeforeUnmount, onMounted, ref, watch } from "/vendor/vue-3.5.42.esm-browser.prod.js";

export function useSelection(elements, permis = () => true) {
  const ids = ref(new Set());
  const selectionnables = computed(() => elements.value.filter(permis));
  const selection = computed(() => selectionnables.value.filter((e) => ids.value.has(e.id)));
  const toutCoche = computed(() => selectionnables.value.length > 0 && selection.value.length === selectionnables.value.length);
  const estCoche = (e) => ids.value.has(e.id);
  function basculer(e) {
    const suite = new Set(ids.value);
    if (!suite.delete(e.id)) suite.add(e.id);
    ids.value = suite;
  }
  const toutBasculer = () => { ids.value = toutCoche.value ? new Set() : new Set(selectionnables.value.map((e) => e.id)); };
  const vider = () => { ids.value = new Set(); };
  // Un élément disparu ou devenu protégé quitte la sélection.
  watch(selectionnables, (liste) => {
    const presents = new Set(liste.map((e) => e.id));
    if ([...ids.value].some((id) => !presents.has(id))) ids.value = new Set([...ids.value].filter((id) => presents.has(id)));
  });
  return { selection, selectionnables, toutCoche, estCoche, basculer, toutBasculer, vider };
}

// Le serveur accepte des lots bornés : une grande sélection part en plusieurs fois.
export async function parLots(ids, appel, taille = 50) {
  for (let i = 0; i < ids.length; i += taille) await appel(ids.slice(i, i + taille));
}

let numeroFenetre = 0;
export const FenetreConfirmation = {
  props: {
    titre: String, sousTitre: String, texte: String, note: String, libelle: { type: String, default: "Confirmer" },
    danger: Boolean, envoi: Boolean, erreur: String, desactive: Boolean, sansAction: Boolean,
  },
  emits: ["annuler", "confirmer"],
  setup(props, { emit }) {
    const boite = ref(null);
    const idTitre = `fenetre-titre-${++numeroFenetre}`;
    const origine = document.activeElement;
    const annuler = () => { if (!props.envoi) emit("annuler"); };
    function clavier(e) {
      if (e.key === "Escape") return annuler();
      if (e.key !== "Tab" || !boite.value) return;
      const cibles = [...boite.value.querySelectorAll("a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)")];
      if (!cibles.length) return;
      const premier = cibles[0];
      const dernier = cibles[cibles.length - 1];
      if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); }
      else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
    }
    onMounted(() => {
      document.addEventListener("keydown", clavier);
      (boite.value?.querySelector("input:not([type=radio]),input:checked,select,.fen-annuler") || boite.value)?.focus();
    });
    onBeforeUnmount(() => {
      document.removeEventListener("keydown", clavier);
      if (origine?.isConnected) origine.focus();
    });
    return { boite, idTitre, annuler };
  },
  template: `<div class="overlay open fen-voile" @click.self="annuler">
    <div class="modal fen" ref="boite" role="dialog" aria-modal="true" :aria-labelledby="idTitre" tabindex="-1">
      <div class="fen-tete"><h2 :id="idTitre">{{ titre }}</h2><p v-if="sousTitre" class="fen-sous">{{ sousTitre }}</p></div>
      <div class="fen-corps">
        <p v-if="texte" class="fen-texte">{{ texte }}</p>
        <slot></slot>
        <p v-if="note" class="fen-note">{{ note }}</p>
        <p v-if="erreur" class="fen-erreur" role="alert">{{ erreur }}</p>
      </div>
      <div class="fen-pied">
        <button type="button" class="fen-btn fen-annuler" :disabled="envoi" @click="annuler">{{ sansAction ? 'Fermer' : 'Annuler' }}</button>
        <button v-if="!sansAction" type="button" class="fen-btn" :class="danger ? 'rouge' : 'noir'" :disabled="envoi || desactive" @click="$emit('confirmer')">{{ envoi ? 'Patientez…' : libelle }}</button>
      </div>
    </div>
  </div>`,
};

// Barre affichée dès qu'une ligne est cochée.
export const BarreLot = {
  props: { resume: String },
  emits: ["vider"],
  template: `<div class="lot-barre" role="status">
    <b class="lot-resume">{{ resume }}</b>
    <button type="button" class="lot-btn" @click="$emit('vider')">Tout désélectionner</button>
    <span class="lot-actions"><slot></slot></span>
  </div>`,
};
