import { createApp, ref, computed } from "https://unpkg.com/vue@3.5.42/dist/vue.esm-browser.prod.js";
import { db } from "../firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { CATEGORIE_NOMS } from "../produit-categories.js";

function fmt(n) {
  return Math.round(n || 0).toLocaleString("fr-FR").replace(/,/g, " ");
}

// Mêmes règles d'affichage que la page Produits (produits.js) : compat ancien
// schéma plat (prixVente / prixAchat) et nouveau schéma (caracteristiques
// .prix ou .prixMin quand la catégorie a des variantes). Le prix d'achat
// vit dans la sous-collection admin produits/{id}/interne/achat, jamais sur
// le document produit lui-même (lisible publiquement).
function prixVenteAffiche(p) {
  return p.caracteristiques?.prixMin ?? p.caracteristiques?.prix ?? p.prixVente ?? 0;
}
function nomAffiche(p) {
  return p.infosGenerales?.nom ?? p.nom ?? "";
}
function categorieAffichee(p) {
  return p.infosGenerales?.categorie ?? p.categorie ?? "";
}
function prixAchatDepuis(achat) {
  if (!achat) return 0;
  if (achat.parVariante) {
    const valeurs = Object.values(achat.parVariante).map((v) => Number(v) || 0);
    return valeurs.length ? Math.min(...valeurs) : 0;
  }
  return Number(achat.prixAchat) || 0;
}

createApp({
  setup() {
    const produits = ref([]);
    // { [produitId]: { prixAchat } | { parVariante } }
    const achats = ref({});
    const chargementAchats = ref(true);
    const searchTerm = ref("");
    const categoryFilter = ref("");
    const sortBy = ref("marge-desc");

    onSnapshot(
      query(collection(db, "produits"), orderBy("dateCreation", "desc")),
      async (snap) => {
        produits.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        // Prix d'achat : une lecture par produit (sous-collection interne).
        // Pas de listener temps réel dessus — un prix d'achat ne bouge que
        // quand l'admin modifie la fiche, un rechargement suffit.
        const manquants = produits.value.filter((p) => !(p.id in achats.value));
        await Promise.all(
          manquants.map(async (p) => {
            try {
              const aSnap = await getDoc(doc(db, "produits", p.id, "interne", "achat"));
              achats.value = { ...achats.value, [p.id]: aSnap.exists() ? aSnap.data() : {} };
            } catch (err) {
              console.error(err);
              achats.value = { ...achats.value, [p.id]: {} };
            }
          })
        );
        chargementAchats.value = false;
      },
      (err) => console.error(err)
    );

    const lignes = computed(() => {
      const term = searchTerm.value.trim().toLowerCase();
      let list = produits.value
        .filter((p) => {
          if (term && !nomAffiche(p).toLowerCase().includes(term)) return false;
          if (categoryFilter.value && categorieAffichee(p) !== categoryFilter.value) return false;
          return true;
        })
        .map((p) => {
          const achat = prixAchatDepuis(achats.value[p.id]);
          const vente = prixVenteAffiche(p);
          return {
            id: p.id,
            nom: nomAffiche(p),
            categorie: categorieAffichee(p),
            achat,
            vente,
            marge: vente - achat,
            pct: achat > 0 ? Math.round(((vente - achat) / achat) * 100) : 0,
            variable: p.caracteristiques?.prixMin != null,
            sansAchat: achat <= 0,
          };
        });

      if (sortBy.value === "marge-desc") list.sort((a, b) => b.marge - a.marge);
      else if (sortBy.value === "marge-asc") list.sort((a, b) => a.marge - b.marge);
      else if (sortBy.value === "pct-desc") list.sort((a, b) => b.pct - a.pct);
      else if (sortBy.value === "nom") list.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
      return list;
    });

    const totaux = computed(() => {
      const r = lignes.value;
      const achat = r.reduce((s, x) => s + x.achat, 0);
      const vente = r.reduce((s, x) => s + x.vente, 0);
      const sansAchat = r.filter((x) => x.sansAchat).length;
      return {
        count: r.length,
        achat,
        vente,
        marge: vente - achat,
        pct: achat > 0 ? Math.round(((vente - achat) / achat) * 100) : 0,
        sansAchat,
      };
    });

    return {
      CATEGORIE_NOMS,
      produits,
      chargementAchats,
      searchTerm,
      categoryFilter,
      sortBy,
      lignes,
      totaux,
      fmt,
    };
  },
}).mount("#margesApp");
