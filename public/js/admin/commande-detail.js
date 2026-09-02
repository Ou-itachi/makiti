import { createApp, ref, computed, watch } from "https://unpkg.com/vue@3.5.42/dist/vue.esm-browser.prod.js";
import { db, functions } from "../firebase-config.js";
import {
  doc,
  getDoc,
  onSnapshot,
  updateDoc,
  collection,
  query,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { categorieConfig } from "../produit-categories.js";
import { articlesDe, montant, montantBrut } from "./commande-utils.js";

const validerCodeLivraison = httpsCallable(functions, "validerCodeLivraison");

// Mêmes règles que specRows() dans produit-detail.js (fiche produit
// publique) — dupliqué ici plutôt qu'importé : ce fichier a des effets de
// bord au chargement (lit un ?id= de page produit) incompatibles avec cette
// page admin. Affiche les caractéristiques GÉNÉRALES du produit (marque,
// état, garantie, fiche technique...), en plus de order.varianteLibelle qui
// donne déjà la combinaison précise choisie (couleur/stockage/taille…) —
// pour que l'admin voie exactement ce que le client a commandé, pas
// seulement son nom et sa ville.
function caracteristiquesGenerales(produit, config) {
  if (!produit) return [];
  const infos = produit.infosGenerales || {};
  const car = produit.caracteristiques || {};
  const dimKeys = new Set((config?.variantes?.dimensions || []).map((d) => d.key));
  const rows = [];
  if (infos.marque) rows.push(["Marque", infos.marque]);
  if (infos.modele) rows.push(["Modèle", infos.modele]);
  if (infos.etat) rows.push(["État", infos.etat]);
  (config?.essentiel || []).forEach((f) => {
    if (dimKeys.has(f.key)) return;
    if (car[f.key]) rows.push([f.label, car[f.key]]);
  });
  (config?.secondaire || []).forEach((f) => {
    if (car[f.key]) rows.push([f.label, car[f.key]]);
  });
  if (infos.garantie) rows.push(["Garantie", infos.garantie]);
  return rows;
}

const STATUT_INFO = {
  nouvelle: { label: "Nouvelle", cls: "new" },
  confirmee: { label: "Confirmée", cls: "confirmed" },
  en_livraison: { label: "En livraison", cls: "transit" },
  livree: { label: "Livrée", cls: "done" },
  en_negociation: { label: "En négociation", cls: "negotiate" },
  retournee: { label: "Retournée", cls: "returned" },
};

// Étapes de la progression "normale" d'une commande. en_negociation et
// retournee sont des embranchements, pas des étapes de cette ligne — voir
// timelineSteps().
const STEPS = [
  { key: "nouvelle", label: "Commande reçue" },
  { key: "confirmee", label: "Confirmée par téléphone" },
  { key: "en_livraison", label: "En livraison" },
  { key: "livree", label: "Livrée" },
];

const PLACEHOLDER_IMG =
  "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='150' height='150'%3E%3Crect width='150' height='150' fill='%23E7E1D5'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-size='13' fill='%23948C7A' text-anchor='middle' dominant-baseline='middle'%3EBokki%3C/text%3E%3C/svg%3E";

function fmt(n) {
  return Math.round(n || 0).toLocaleString("fr-FR").replace(/,/g, " ");
}

function fmtDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return (
    d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) +
    ", " +
    d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
  );
}

const params = new URLSearchParams(location.search);
const commandeId = params.get("id");

createApp({
  setup() {
    const order = ref(null);
    const loading = ref(true);
    const notFound = ref(!commandeId);

    const codeOverlayOpen = ref(false);
    const priceOverlayOpen = ref(false);
    const courierOverlayOpen = ref(false);
    const codeDigits = ref(["", "", "", ""]);
    // Chaque commande garde la longueur de code telle qu'elle a été générée
    // à l'époque (parametres/livraison.longueurCode a pu changer depuis) :
    // la source de vérité pour la saisie admin est donc la commande
    // elle-même, jamais le réglage actuel.
    const codeLength = computed(() => order.value?.codeLongueur || 4);
    const codeError = ref(false);
    const codeErrorMessage = ref("");
    const codeValidating = ref(false);
    const newPrice = ref(0);
    const priceError = ref("");
    const priceSaving = ref(false);

    // livreurs : collection réelle (voir livreurs.js/livreurs.html). La
    // commande ne stocke que livreurId — le nom/téléphone affichés viennent
    // d'une recherche en direct dans cette liste, jamais dénormalisés, pour
    // ne jamais afficher un livreur renommé de façon obsolète (même choix
    // que fournisseurNomFor dans produits.js).
    const livreurs = ref([]);
    const pendingLivreurId = ref(null);
    const courierSaving = ref(false);
    const courierError = ref("");
    const statusChanging = ref(false);
    const pendingStatus = ref(null);

    // Une commande peut contenir plusieurs articles (panier, KAN-75+) ou un
    // seul produit à plat (schéma historique) — articlesDe() unifie les deux.
    const articles = computed(() => articlesDe(order.value || {}));

    // Caractéristiques générales du produit commandé (marque, état, fiche
    // technique...) — chargées une seule fois par commande via produitId, pas
    // à chaque mise à jour de statut/etc. de la commande. N'a de sens que
    // pour une commande à un seul article (affichage secondaire, pas
    // essentiel) : pour un panier à plusieurs produits, l'admin peut ouvrir
    // chaque fiche produit individuellement si besoin.
    const caracteristiquesProduit = ref([]);
    let produitIdCharge = null;
    watch(
      () => (articles.value.length === 1 ? articles.value[0].produitId : null),
      async (produitId) => {
        if (!produitId || produitId === produitIdCharge) return;
        produitIdCharge = produitId;
        try {
          const snap = await getDoc(doc(db, "produits", produitId));
          if (!snap.exists()) {
            caracteristiquesProduit.value = [];
            return;
          }
          const produit = snap.data();
          const config = categorieConfig(produit.infosGenerales?.categorie ?? produit.categorie);
          caracteristiquesProduit.value = caracteristiquesGenerales(produit, config);
        } catch (err) {
          console.error(err);
          caracteristiquesProduit.value = [];
        }
      }
    );

    const statusInfo = computed(() =>
      order.value ? STATUT_INFO[order.value.statut] || { label: order.value.statut, cls: "" } : { label: "", cls: "" }
    );

    const courierDisplay = computed(() => {
      if (!order.value?.livreurId) return { name: "Non assigné", phone: "" };
      const l = livreurs.value.find((x) => x.id === order.value.livreurId);
      if (!l) return { name: "Livreur supprimé", phone: "" };
      return { name: l.nom, phone: l.telephone || "" };
    });

    const timelineSteps = computed(() => {
      if (!order.value) return [];
      const statut = order.value.statut;
      const idx = STEPS.findIndex((s) => s.key === statut);

      if (idx === -1) {
        // en_negociation / retournee : embranchement hors de la ligne
        // "normale", on ne peut pas savoir depuis quelle étape on y est
        // arrivé sans historique stocké.
        return [
          { label: "Commande reçue", time: fmtDate(order.value.dateCreation), state: "done" },
          { label: statusInfo.value.label, time: "—", state: "current" },
        ];
      }

      return STEPS.map((s, i) => {
        let state = "pending";
        if (i < idx) state = "done";
        else if (i === idx) state = "current";

        let time = "—";
        if (s.key === "nouvelle") time = fmtDate(order.value.dateCreation);
        else if (s.key === "livree") {
          time = order.value.dateLivraison ? fmtDate(order.value.dateLivraison) : "En attente";
        } else if (state === "pending") {
          time = "En attente";
        }

        return { label: s.label, time, state };
      });
    });

    function onStatusSelect(e) {
      pendingStatus.value = e.target.value;
    }
    async function commitStatusChange() {
      if (!pendingStatus.value || pendingStatus.value === order.value?.statut) return;
      statusChanging.value = true;
      try {
        await updateDoc(doc(db, "commandes", commandeId), { statut: pendingStatus.value });
        pendingStatus.value = null;
      } catch (err) {
        console.error(err);
        alert("Impossible de mettre à jour le statut : " + (err.message || err.code || "réessaie."));
      } finally {
        statusChanging.value = false;
      }
    }

    function openCodeModal() {
      codeDigits.value = Array(codeLength.value).fill("");
      codeError.value = false;
      codeErrorMessage.value = "";
      codeOverlayOpen.value = true;
    }
    async function validateCode() {
      const code = codeDigits.value.join("");
      codeError.value = false;
      codeErrorMessage.value = "";

      if (code.length !== codeLength.value) {
        codeErrorMessage.value = `Saisis les ${codeLength.value} chiffres du code.`;
        codeError.value = true;
        return;
      }

      codeValidating.value = true;
      try {
        await validerCodeLivraison({ commandeId, code });
        codeOverlayOpen.value = false;
      } catch (err) {
        codeErrorMessage.value = err.message || "Erreur, réessaie.";
        codeError.value = true;
      } finally {
        codeValidating.value = false;
      }
    }
    function onCodeInput(idx, e) {
      codeDigits.value[idx] = e.target.value;
      if (e.target.value && idx < codeDigits.value.length - 1) {
        const next = e.target.closest(".code-input-row").querySelectorAll("input")[idx + 1];
        next?.focus();
      }
    }

    async function envoyerCorbeille() {
      if (!confirm(`Envoyer la commande ${order.value.numero} à la corbeille ? Elle y restera 30 jours avant suppression définitive automatique — tu pourras la restaurer entre-temps.`)) return;
      try {
        await updateDoc(doc(db, "commandes", commandeId), { corbeille: true, dateCorbeille: serverTimestamp() });
        window.location.href = "commandes.html";
      } catch (err) {
        console.error(err);
        alert("Impossible d'envoyer cette commande à la corbeille : " + (err.message || err.code || "réessaie."));
      }
    }

    function openPriceModal() {
      priceError.value = "";
      newPrice.value = montant(order.value);
      priceOverlayOpen.value = true;
    }
    async function savePrice() {
      priceError.value = "";
      const price = Number(newPrice.value);
      if (!Number.isFinite(price) || price <= 0) {
        priceError.value = "Le nouveau prix doit être supérieur à 0.";
        return;
      }

      priceSaving.value = true;
      try {
        await updateDoc(doc(db, "commandes", commandeId), { prixConvenu: price });
        priceOverlayOpen.value = false;
      } catch (err) {
        console.error(err);
        priceError.value = "Erreur lors de l'enregistrement : " + (err.message || err.code || "réessaie.");
      } finally {
        priceSaving.value = false;
      }
    }

    function openCourierModal() {
      pendingLivreurId.value = order.value?.livreurId || null;
      courierError.value = "";
      courierOverlayOpen.value = true;
    }
    function selectCourier(id) {
      pendingLivreurId.value = id;
    }
    async function assignCourier() {
      courierError.value = "";
      if (!pendingLivreurId.value) {
        courierError.value = "Choisis un livreur.";
        return;
      }
      courierSaving.value = true;
      try {
        await updateDoc(doc(db, "commandes", commandeId), { livreurId: pendingLivreurId.value });
        courierOverlayOpen.value = false;
      } catch (err) {
        console.error(err);
        courierError.value = "Erreur lors de l'assignation : " + (err.message || err.code || "réessaie.");
      } finally {
        courierSaving.value = false;
      }
    }

    function closeModal() {
      codeOverlayOpen.value = false;
      priceOverlayOpen.value = false;
      courierOverlayOpen.value = false;
    }

    if (commandeId) {
      onSnapshot(
        doc(db, "commandes", commandeId),
        (snap) => {
          loading.value = false;
          if (!snap.exists()) {
            notFound.value = true;
            order.value = null;
            return;
          }
          notFound.value = false;
          const data = snap.data();
          // Même règle que commandes.js : le code de livraison ne doit
          // jamais être exposé côté admin avant validation manuelle. On
          // garde sa longueur à part (codeLongueur) avant suppression —
          // sinon codeLength retombe toujours sur 4 par défaut, même pour
          // une commande créée avec le réglage 6 chiffres.
          const codeLongueur = data.codeLivraison?.length || 4;
          delete data.codeLivraison;
          order.value = { id: snap.id, ...data, codeLongueur };
          document.title = `Bokki Admin — Détail commande ${data.numero || snap.id}`;
        },
        (err) => {
          console.error(err);
          loading.value = false;
          notFound.value = true;
        }
      );
    } else {
      loading.value = false;
    }

    onSnapshot(query(collection(db, "livreurs"), orderBy("nom")), (snap) => {
      livreurs.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    });

    return {
      order,
      loading,
      notFound,
      fmt,
      fmtDate,
      montant,
      montantBrut,
      articles,
      statusInfo,
      caracteristiquesProduit,
      timelineSteps,
      statusChanging,
      pendingStatus,
      onStatusSelect,
      commitStatusChange,
      envoyerCorbeille,
      PLACEHOLDER_IMG,
      courierDisplay,
      livreurs,
      pendingLivreurId,
      courierSaving,
      courierError,
      codeOverlayOpen,
      priceOverlayOpen,
      courierOverlayOpen,
      codeDigits,
      codeLength,
      codeError,
      codeErrorMessage,
      codeValidating,
      newPrice,
      priceError,
      priceSaving,
      openCodeModal,
      validateCode,
      onCodeInput,
      openPriceModal,
      savePrice,
      openCourierModal,
      selectCourier,
      assignCourier,
      closeModal,
    };
  },
}).mount("#commandeDetailApp");
