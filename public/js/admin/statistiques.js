// Page admin « Statistiques » : lit les compteurs anonymes du jour
// (statistiques/{AAAA-MM-JJ}, écrits par la fonction collecte) et les
// commandes livrées de la période.
import { createApp, ref, computed, watch } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { db } from "../firebase-config.js";
import {
  collection, getDocs, query, where, documentId, getCountFromServer,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const TEST_AB = "bouton de la fiche produit — A « Commander », B « Commander, payer à la livraison »";
const ETAPES = [
  ["vue_accueil", "Accueil vu"],
  ["vue_produit", "Fiche produit vue"],
  ["ajout_panier", "Ajout au panier"],
  ["debut_commande", "Début de commande"],
  ["commande_validee", "Commande validée"],
];
const RESEAUX = [["4g", "4G / Wi-Fi"], ["3g", "3G"], ["2g", "2G"], ["inconnu", "Inconnu (iPhone…)"]];
// Bornes hautes des tranches : doivent rester alignées avec METRIQUES_VITESSE
// (functions/src/index.ts).
const BORNES = {
  lcp: [1000, 2500, 4000, 6000, 10000, 20000],
  fcp: [1000, 1800, 3000, 5000, 8000, 15000],
  inp: [100, 200, 500, 1000, 2000],
};

function fmt(n) { return Math.round(n || 0).toLocaleString("fr-FR").replace(/[ ,]/g, " "); }
function pct(a, b) { return b ? Math.round((a / b) * 1000) / 10 + " %" : "—"; }
function jourIso(d) { return d.toISOString().slice(0, 10); }
function duree(ms) { return ms >= 1000 ? (ms / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " s" : ms + " ms"; }

// 75e centile approché : borne haute de la tranche qui contient le 75e %.
function p75(histo, metrique) {
  const bornes = BORNES[metrique];
  const cles = bornes.map((b) => "le" + b).concat("plus");
  const n = cles.reduce((s, c) => s + (histo[c] || 0), 0);
  if (!n) return { n: 0, texte: "—" };
  let cumul = 0;
  for (let i = 0; i < cles.length; i++) {
    cumul += histo[cles[i]] || 0;
    if (cumul >= n * 0.75) return { n, texte: i < bornes.length ? "≤ " + duree(bornes[i]) : "> " + duree(bornes[bornes.length - 1]) };
  }
  return { n, texte: "—" };
}

createApp({
  setup() {
    const jours = ref(7);
    const docs = ref([]);
    const livrees = ref(0);
    const chargement = ref(true);

    async function charger() {
      chargement.value = true;
      const fin = new Date();
      const debut = new Date(Date.now() - (jours.value - 1) * 86400000);
      try {
        const snap = await getDocs(query(collection(db, "statistiques"),
          where(documentId(), ">=", jourIso(debut)), where(documentId(), "<=", jourIso(fin))));
        docs.value = snap.docs.map((d) => d.data());
      } catch (e) { console.warn("statistiques", e); docs.value = []; }
      try {
        const debutJour = new Date(jourIso(debut) + "T00:00:00Z");
        const c = await getCountFromServer(query(collection(db, "commandes"),
          where("statut", "==", "livree"), where("dateLivraison", ">=", debutJour)));
        livrees.value = c.data().count;
      } catch (e) { console.warn("livrées", e); livrees.value = 0; }
      chargement.value = false;
    }
    watch(jours, charger, { immediate: true });

    function ab(cle, v) {
      return docs.value.reduce((s, d) => s + (d.entonnoir?.[cle]?.[v] || 0), 0);
    }
    function total(cle) { return ab(cle, "A") + ab(cle, "B"); }
    const erreurs = computed(() => docs.value.reduce((s, d) => s + (d.erreursClient || 0), 0));

    const etapes = computed(() => ETAPES.map(([cle, nom]) => ({ cle, nom, total: total(cle), A: ab(cle, "A"), B: ab(cle, "B") }))
      .concat([{ cle: "livree", nom: "Commande livrée", total: livrees.value, A: null, B: null }]));

    const vitesse = computed(() => RESEAUX.map(([reseau, libelle]) => {
      const fusion = (m) => {
        const h = {};
        for (const d of docs.value) for (const [k, v] of Object.entries(d.vitesse?.[reseau]?.[m] || {})) h[k] = (h[k] || 0) + v;
        return h;
      };
      const hl = fusion("lcp");
      const lcp = p75(hl, "lcp");
      const bons = (hl.le1000 || 0) + (hl.le2500 || 0);
      return { reseau, libelle, n: lcp.n, lcp: lcp.texte, fcp: p75(fusion("fcp"), "fcp").texte, inp: p75(fusion("inp"), "inp").texte, bon: lcp.n ? Math.round((bons / lcp.n) * 100) : 0 };
    }).filter((r) => r.n > 0));

    const libellePeriode = computed(() => (jours.value === 1 ? "Aujourd'hui (heure de Conakry)" : `${jours.value} derniers jours`));

    return { jours, chargement, livrees, erreurs, etapes, vitesse, total, ab, fmt, pct, libellePeriode, TEST_AB };
  },
}).mount("#statsApp");
