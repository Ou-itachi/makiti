// Versements fournisseurs : total versé par fournisseur et ses reçus. Ne compte
// que les reçus présents : un reçu supprimé sort de ces totaux, jamais du dû.
import { createApp, computed, ref } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { db } from "../firebase-config.js";
import { collection, limit, onSnapshot, orderBy, query, where } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { fmt } from "./livraison-commun.js";
import { useListeCache } from "./liste-cache.js";
import { BarreLot, FenetreConfirmation, useSelection } from "./selection-lot.js";
import { dateCourte, libelleMode, moisCourant, parPrenom, suppressionRecus, totalRecus } from "./recus-commun.js";

const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;

createApp({
  components: { BarreLot, FenetreConfirmation },
  setup() {
    const recus = ref([]);
    const charge = ref(false);
    const erreurListe = ref(false);
    const { incertain, enCache, noter } = useListeCache();
    const idChoisi = ref(new URLSearchParams(location.search).get("id"));
    const fiches = ref(new Map());

    const nomDe = (id, repli) => fiches.value.get(id)?.nom || repli || "";
    const recusChoisis = computed(() => recus.value.filter((r) => r.beneficiaireId === idChoisi.value));
    const nomChoisi = computed(() => nomDe(idChoisi.value, recusChoisis.value[0]?.nom));
    const sel = useSelection(recusChoisis);
    const suppression = suppressionRecus("le montant dû", sel.vider);

    const parFournisseur = computed(() => {
      const groupes = new Map();
      for (const r of recus.value) {
        const g = groupes.get(r.beneficiaireId) || { id: r.beneficiaireId, nom: nomDe(r.beneficiaireId, r.nom), nombre: 0, total: 0, dernier: r.date };
        g.nombre += 1;
        g.total += Number(r.montant) || 0;
        groupes.set(r.beneficiaireId, g);
      }
      return [...groupes.values()].sort(parPrenom);
    });
    const kpis = computed(() => {
      const liste = idChoisi.value ? recusChoisis.value : recus.value;
      return { total: totalRecus(liste), nombre: liste.length, mois: totalRecus(liste.filter((r) => r.mois === moisCourant())) };
    });
    const sousTitre = computed(() => (idChoisi.value
      ? `${pluriel(kpis.value.nombre, "reçu")} · ${fmt(kpis.value.total)} GNF versés`
      : `${pluriel(parFournisseur.value.length, "fournisseur")} · ${pluriel(kpis.value.nombre, "reçu")}`));
    const resumeLot = computed(() => {
      const n = sel.selection.value.length;
      return `${n} reçu${n > 1 ? "s" : ""} sélectionné${n > 1 ? "s" : ""} · ${fmt(totalRecus(sel.selection.value))} GNF`;
    });

    function ouvrir(id) {
      idChoisi.value = id;
      sel.vider();
      history.pushState(null, "", `?id=${encodeURIComponent(id)}`);
      scrollTo(0, 0);
    }
    function retour() {
      idChoisi.value = null;
      sel.vider();
      history.pushState(null, "", location.pathname);
    }
    addEventListener("popstate", () => { idChoisi.value = new URLSearchParams(location.search).get("id"); sel.vider(); });

    onSnapshot(query(collection(db, "recus"), where("type", "==", "fournisseur"), orderBy("date", "desc"), limit(2000)), { includeMetadataChanges: true }, (snap) => {
      noter("recus", snap.metadata.fromCache);
      recus.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      charge.value = true;
    }, (err) => { console.error(err); erreurListe.value = true; charge.value = true; });
    onSnapshot(collection(db, "fournisseurs"), { includeMetadataChanges: true }, (snap) => {
      noter("fournisseurs", snap.metadata.fromCache);
      fiches.value = new Map(snap.docs.map((d) => [d.id, d.data()]));
    }, console.error);

    return { recus, charge, erreurListe, incertain, enCache, idChoisi, nomChoisi, recusChoisis, parFournisseur, kpis, sousTitre, resumeLot, sel, suppression, ouvrir, retour, fmt, dateCourte, libelleMode };
  },
}).mount("#versementsApp");
