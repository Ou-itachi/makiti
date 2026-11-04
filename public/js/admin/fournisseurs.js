import { createApp, ref, computed } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { db, functions } from "../firebase-config.js";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  orderBy,
  setDoc,
  updateDoc,
  serverTimestamp,
  where,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { CATEGORIE_NOMS } from "../produit-categories.js";
import { useListeCache } from "./liste-cache.js";
import { FenetreConfirmation } from "./selection-lot.js";
import { FenetrePaiement, etatFournisseur } from "./paiement-fournisseur.js";
import { moisCourant, parPrenom, totalRecus } from "./recus-commun.js";

const commandesARegler = httpsCallable(functions, "commandesARegler");

function initials(nom) {
  const parts = (nom || "").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
}

function fmt(n) {
  return Math.round(n || 0).toLocaleString("fr-FR").replace(/,/g, " ");
}

function fmtDateFr(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function emptyForm() {
  return { nom: "", telephone: "", categoriePrincipale: CATEGORIE_NOMS[0] || "", adresse: "", note: "" };
}

createApp({
  components: { FenetrePaiement, FenetreConfirmation },
  setup() {
    const fournisseurs = ref([]);
    const message = ref("");
    const aPayer = ref(null);
    const registreOuvert = ref(false);
    const etat = etatFournisseur((texte) => { message.value = texte; });
    const searchTerm = ref("");

    const modalOpen = ref(false);
    const editingId = ref(null);
    const formError = ref("");
    const saving = ref(false);
    const form = ref(emptyForm());

    // Un fournisseur supprimé qui a encore un dû (commande livrée depuis) revient
    // dans la liste : cette dette ne doit jamais se perdre.
    const fournisseursListes = computed(() => fournisseurs.value
      .filter((f) => !f.supprime || (Number(f.montantDu) || 0) > 0)
      .sort(parPrenom));
    const fournisseursDus = computed(() => fournisseursListes.value.filter((f) => (Number(f.montantDu) || 0) > 0));

    const filteredFournisseurs = computed(() => {
      const term = searchTerm.value.trim().toLowerCase();
      if (!term) return fournisseursListes.value;
      return fournisseursListes.value.filter((f) =>
        (f.nom || "").toLowerCase().includes(term) ||
        (f.telephone || "").toLowerCase().includes(term) ||
        (f.categoriePrincipale || "").toLowerCase().includes(term)
      );
    });

    const tbDateText = computed(() => {
      const n = fournisseursListes.value.length;
      const actifs = fournisseursListes.value.filter((f) => f.actif !== false).length;
      return `${n} fournisseur${n > 1 ? "s" : ""} · ${actifs} actif${actifs > 1 ? "s" : ""}`;
    });

    function openModal(f) {
      formError.value = "";
      if (f) {
        editingId.value = f.id;
        form.value = {
          nom: f.nom || "",
          telephone: f.telephone || "",
          categoriePrincipale: f.categoriePrincipale || CATEGORIE_NOMS[0] || "",
          adresse: f.adresse || "",
          note: f.note || "",
        };
      } else {
        editingId.value = null;
        form.value = emptyForm();
      }
      modalOpen.value = true;
    }
    function closeModal() {
      modalOpen.value = false;
    }

    async function save() {
      formError.value = "";
      const nom = form.value.nom.trim();
      if (!nom) {
        formError.value = "Le nom du fournisseur est obligatoire.";
        return;
      }

      saving.value = true;
      try {
        const data = {
          nom,
          telephone: form.value.telephone.trim(),
          categoriePrincipale: form.value.categoriePrincipale,
          adresse: form.value.adresse.trim(),
          note: form.value.note.trim(),
        };
        if (editingId.value) {
          await updateDoc(doc(db, "fournisseurs", editingId.value), data);
        } else {
          await setDoc(doc(collection(db, "fournisseurs")), {
            ...data,
            montantDu: 0,
            dateCreation: serverTimestamp(),
          });
        }
        closeModal();
      } catch (err) {
        console.error(err);
        formError.value = "Erreur lors de l'enregistrement : " + (err.message || err.code || "réessaie.");
      } finally {
        saving.value = false;
      }
    }

    const fournisseursCharges = ref(false);
    const { incertain, enCache, noter } = useListeCache();
    onSnapshot(query(collection(db, "fournisseurs"), orderBy("nom")), { includeMetadataChanges: true }, (snap) => {
      noter("fournisseurs", snap.metadata.fromCache);
      fournisseurs.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      fournisseursCharges.value = true;
      actualiserCommandes();
    }, (err) => { console.error(err); noter("fournisseurs", true); fournisseursCharges.value = true; });

    // ===== Registre des paiements =====
    // "Montant dû" (fournisseurs.montantDu) est un solde couru calculé et
    // maintenu exclusivement côté serveur — crédité par le trigger
    // onCommandeStatutChange à chaque commande livrée, débité ici via la
    // Cloud Function enregistrerPaiementFournisseur (jamais par une écriture
    // client directe, voir firestore.rules). Le registre lui-même vient de
    // la vraie collection paiementsFournisseurs.
    const ledgerEntries = ref([]);

    // Un reçu supprimé ne laisse pas de numéro ici : le paiement reste listé.
    const recus = ref([]);
    onSnapshot(query(collection(db, "recus"), where("type", "==", "fournisseur"), orderBy("date", "desc"), limit(2000)), { includeMetadataChanges: true }, (snap) => {
      noter("recus", snap.metadata.fromCache);
      recus.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }, console.error);
    const numerosRecus = computed(() => new Map(recus.value.map((r) => [r.id, r.numero])));
    const recuDe = (entry) => numerosRecus.value.get(entry.recuId) || "";
    const verseCeMois = computed(() => totalRecus(recus.value.filter((r) => r.mois === moisCourant())));

    // Nombre de commandes à régler : calculé par le serveur, relu quand un dû change.
    const nombres = ref({});
    const commandesCharge = ref(false);
    const totalCommandes = computed(() => Object.values(nombres.value).reduce((t, n) => t + n, 0));
    let empreinteDus = null;
    function actualiserCommandes() {
      const empreinte = fournisseurs.value.map((f) => `${f.id}:${f.montantDu || 0}`).join("|");
      if (empreinte === empreinteDus) return;
      empreinteDus = empreinte;
      commandesARegler({}).then((r) => { nombres.value = r.data.nombres; commandesCharge.value = true; }).catch(console.error);
    }

    function closeAllModals() {
      modalOpen.value = false;
    }

    onSnapshot(query(collection(db, "paiementsFournisseurs"), orderBy("dateCreation", "desc")), { includeMetadataChanges: true }, (snap) => {
      noter("paiements", snap.metadata.fromCache);
      ledgerEntries.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    });

    // ===== Cartes résumé du haut de page =====
    // Total dû : solde couru (fournisseurs.montantDu), pas une somme "de ce
    // mois" — ce champ n'est jamais remis à zéro, voir la note plus haut.
    const totalDu = computed(() =>
      fournisseurs.value.reduce((s, f) => s + (Number(f.montantDu) || 0), 0)
    );
    return {
      fournisseurs,
      fournisseursListes,
      fournisseursDus,
      fournisseursCharges,
      incertain,
      enCache,
      message,
      aPayer,
      registreOuvert,
      etat,
      nombres,
      commandesCharge,
      totalCommandes,
      verseCeMois,
      recuDe,
      searchTerm,
      filteredFournisseurs,
      tbDateText,
      CATEGORIE_NOMS,
      initials,
      modalOpen,
      editingId,
      formError,
      saving,
      form,
      openModal,
      closeModal,
      save,
      ledgerEntries,
      fmt,
      fmtDateFr,
      closeAllModals,
      totalDu,
    };
  },
}).mount("#fournisseursApp");
