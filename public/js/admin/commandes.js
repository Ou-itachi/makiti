import { createApp, ref, computed } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { db, functions } from "../firebase-config.js";
import {
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
  where,
  limit,
  getDocs,
  getCountFromServer,
  updateDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { montant, resumeArticles } from "./commande-utils.js";

const validerCodeLivraison = httpsCallable(functions, "validerCodeLivraison");

const STATUT_INFO = {
  nouvelle: { label: "Nouvelle", cls: "st-new" },
  confirmee: { label: "Confirmée", cls: "st-confirmed" },
  en_livraison: { label: "En livraison", cls: "st-transit" },
  livree: { label: "Livrée", cls: "st-done" },
  en_negociation: { label: "En négociation", cls: "st-negotiate" },
  non_joignable: { label: "Non joignable", cls: "st-unreachable" },
  retournee: { label: "Retournée", cls: "st-returned" },
};

function fmt(n) {
  return Math.round(n || 0).toLocaleString("fr-FR").replace(/,/g, " ");
}

function fmtDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return (
    d.toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) +
    ", " +
    d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
  );
}

createApp({
  setup() {
    const commandes = ref([]);
    // Résultats de la recherche serveur (commandes plus anciennes que la
    // page chargée), fusionnés à la liste locale.
    const resultatsServeur = ref([]);
    const rechercheServeurEnCours = ref(false);
    const searchTerm = ref("");
    const statusFilter = ref("toutes");

    const codeOverlayOpen = ref(false);
    const priceOverlayOpen = ref(false);
    const courierOverlayOpen = ref(false);
    const activeOrder = ref(null);
    const codeDigits = ref(["", "", "", ""]);
    // Chaque commande garde la longueur de code telle qu'elle a été générée
    // à l'époque (le réglage admin a pu changer depuis) : la source de
    // vérité pour la saisie est la commande elle-même, jamais le réglage
    // actuel.
    const codeLength = computed(() => activeOrder.value?.codeLongueur || 4);
    const codeError = ref(false);
    const codeErrorMessage = ref("");
    const codeValidating = ref(false);
    const newPrice = ref(0);
    const priceError = ref("");
    const priceSaving = ref(false);

    // livreurs : collection réelle (voir livreurs.js/livreurs.html). Nom/
    // téléphone jamais dénormalisés sur la commande — recherchés en direct
    // dans cette liste à l'affichage (même choix que fournisseurNomFor dans
    // produits.js), pour ne jamais montrer un livreur renommé/supprimé de
    // façon obsolète.
    const livreurs = ref([]);
    const pendingLivreurId = ref(null);
    const courierSaving = ref(false);
    const courierError = ref("");
    const newCourierOpen = ref(false);
    const ncName = ref("");
    const ncPhone = ref("");

    // Une commande envoyée à la corbeille ne doit plus apparaître dans la
    // liste principale (ni compter dans ses chiffres) — voir
    // corbeille-commandes.html pour la retrouver, la restaurer ou la
    // supprimer définitivement.
    const commandesActives = computed(() => {
      const vus = new Set(commandes.value.map((c) => c.id));
      const anciennes = resultatsServeur.value.filter((c) => !vus.has(c.id));
      return [...commandes.value, ...anciennes].filter((c) => !c.corbeille);
    });

    // Compteurs calculés par le serveur (getCountFromServer : quelques octets
    // par statut) : la liste ne contient plus que les commandes récentes, ses
    // longueurs ne refléteraient pas le total réel.
    // Derniers compteurs connus sur cet appareil affichés tout de suite, puis
    // remplacés par la réponse serveur (effacés à la déconnexion, auth-guard.js).
    const CLE_COMPTEURS = "bokki-commandes-compteurs-v1";
    let compteursMemorises = null;
    try { compteursMemorises = JSON.parse(localStorage.getItem(CLE_COMPTEURS) || "null"); } catch { /* ignore */ }
    const statusCounts = ref(compteursMemorises || Object.fromEntries(["toutes", ...Object.keys(STATUT_INFO)].map((k) => [k, "…"])));
    let comptageTimer = null;
    async function actualiserCompteurs() {
      const ref_ = collection(db, "commandes");
      const compter = (...filtres) => getCountFromServer(query(ref_, ...filtres)).then((s) => s.data().count);
      try {
        const statuts = Object.keys(STATUT_INFO);
        const [total, totalCorbeille, ...parStatut] = await Promise.all([
          compter(),
          compter(where("corbeille", "==", true)),
          ...statuts.flatMap((s) => [
            compter(where("statut", "==", s)),
            compter(where("statut", "==", s), where("corbeille", "==", true)),
          ]),
        ]);
        const counts = { toutes: total - totalCorbeille };
        statuts.forEach((s, i) => { counts[s] = parStatut[2 * i] - parStatut[2 * i + 1]; });
        statusCounts.value = counts;
        try { localStorage.setItem(CLE_COMPTEURS, JSON.stringify(counts)); } catch { /* ignore */ }
      } catch (err) {
        console.error("Compteurs indisponibles :", err);
      }
    }
    function planifierCompteurs() {
      clearTimeout(comptageTimer);
      comptageTimer = setTimeout(actualiserCompteurs, 800);
    }

    // Recherche serveur : numéro de commande (BK-AAAA-XXXXXX) ou téléphone
    // exact, pour retrouver une commande qui n'est pas dans la page chargée.
    let rechercheTimer = null;
    let rechercheId = 0;
    function rechercherServeur() {
      clearTimeout(rechercheTimer);
      const brut = searchTerm.value.trim();
      if (brut.length < 4) {
        resultatsServeur.value = [];
        return;
      }
      rechercheTimer = setTimeout(async () => {
        const id = ++rechercheId;
        rechercheServeurEnCours.value = true;
        try {
          const ref_ = collection(db, "commandes");
          const requetes = [getDocs(query(ref_, where("numero", "==", brut.toUpperCase()), limit(5)))];
          if (/^[\d+\s().-]{6,}$/.test(brut)) requetes.push(getDocs(query(ref_, where("clientTel", "==", brut), limit(20))));
          const snaps = await Promise.all(requetes);
          if (id !== rechercheId) return;
          resultatsServeur.value = snaps.flatMap((s) => s.docs.map(versCommande));
        } catch (err) {
          console.error("Recherche serveur impossible :", err);
        } finally {
          if (id === rechercheId) rechercheServeurEnCours.value = false;
        }
      }, 450);
    }

    const filteredCommandes = computed(() => {
      const term = searchTerm.value.trim().toLowerCase();
      return commandesActives.value.filter((c) => {
        if (statusFilter.value !== "toutes" && c.statut !== statusFilter.value) return false;
        if (!term) return true;
        return (
          (c.clientNom || "").toLowerCase().includes(term) ||
          (c.numero || "").toLowerCase().includes(term) ||
          (c.clientTel || "").toLowerCase().includes(term)
        );
      });
    });

    // Total réel (serveur), pas la longueur de la page chargée.
    const tbDateText = computed(() => {
      const n = statusCounts.value.toutes;
      return `${n} commande${n !== 1 ? "s" : ""}`;
    });
    const aujourdhuiTexte = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

    function statusInfo(statut) {
      return STATUT_INFO[statut] || { label: statut, cls: "" };
    }

    // Bouton "client non joignable" : l'agent a essayé d'appeler sans
    // réponse. On passe la commande au statut "non joignable" (elle garde
    // son code de livraison réservé — voir STATUTS_CODE_ACTIF côté
    // fonctions) et on incrémente un compteur de tentatives, pour repérer
    // vite celles qui traînent et décider d'abandonner après plusieurs
    // essais. Le client n'est pas notifié (rien dans NOTIF_STATUT).
    async function marquerNonJoignable(c) {
      if (!confirm(`Marquer la commande ${c.numero || ""} comme « client non joignable » ? (tentative d'appel sans réponse)`)) return;
      try {
        await updateDoc(doc(db, "commandes", c.id), {
          statut: "non_joignable",
          tentativesAppel: (Number(c.tentativesAppel) || 0) + 1,
          dernierAppelNonJoignable: serverTimestamp(),
        });
      } catch (err) {
        console.error(err);
        alert(
          "Impossible de marquer la commande " + (c.numero || "") + " : " +
            (err.message || err.code || "réessaie.")
        );
      }
    }

    async function handleStatusChange(c, newStatut) {
      try {
        await updateDoc(doc(db, "commandes", c.id), { statut: newStatut });
      } catch (err) {
        console.error(err);
        alert(
          "Impossible de mettre à jour le statut de la commande " +
            (c.numero || "") +
            " : " +
            (err.message || err.code || "réessaie.")
        );
      }
    }

    async function envoyerCorbeille(c) {
      if (!confirm(`Envoyer la commande ${c.numero} à la corbeille ? Elle y restera 30 jours avant suppression définitive automatique — tu pourras la restaurer entre-temps.`)) return;
      try {
        await updateDoc(doc(db, "commandes", c.id), { corbeille: true, dateCorbeille: serverTimestamp() });
      } catch (err) {
        console.error(err);
        alert(
          "Impossible d'envoyer la commande " + (c.numero || "") + " à la corbeille : " +
            (err.message || err.code || "réessaie.")
        );
      }
    }

    function openCodeModal(c) {
      activeOrder.value = c;
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
        await validerCodeLivraison({ commandeId: activeOrder.value.id, code });
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
        const next = e.target
          .closest(".code-input-row")
          .querySelectorAll("input")[idx + 1];
        next?.focus();
      }
    }

    function openPriceModal(c) {
      activeOrder.value = c;
      priceError.value = "";
      newPrice.value = montant(c);
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
        await updateDoc(doc(db, "commandes", activeOrder.value.id), { prixConvenu: price });
        priceOverlayOpen.value = false;
      } catch (err) {
        console.error(err);
        priceError.value = "Erreur lors de l'enregistrement : " + (err.message || err.code || "réessaie.");
      } finally {
        priceSaving.value = false;
      }
    }

    function openCourierModal(c) {
      activeOrder.value = c;
      pendingLivreurId.value = c.livreurId || null;
      courierError.value = "";
      newCourierOpen.value = false;
      ncName.value = "";
      ncPhone.value = "";
      courierOverlayOpen.value = true;
    }
    function selectCourier(id) {
      pendingLivreurId.value = id;
      newCourierOpen.value = false;
    }
    function toggleNewCourier() {
      newCourierOpen.value = !newCourierOpen.value;
      if (newCourierOpen.value) pendingLivreurId.value = null;
    }
    async function saveCourier() {
      courierError.value = "";
      courierSaving.value = true;
      try {
        let livreurId = pendingLivreurId.value;
        if (newCourierOpen.value && ncName.value.trim()) {
          const livreurRef = doc(collection(db, "livreurs"));
          await setDoc(livreurRef, {
            nom: ncName.value.trim(),
            telephone: ncPhone.value.trim(),
            zonePrincipale: "",
            fraisParLivraison: 0,
            dateCreation: serverTimestamp(),
          });
          livreurId = livreurRef.id;
        }
        if (!livreurId) {
          courierError.value = "Choisis un livreur existant ou ajoutes-en un nouveau.";
          return;
        }
        await updateDoc(doc(db, "commandes", activeOrder.value.id), { livreurId });
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

    function versCommande(d) {
      const data = d.data();
      // Le code de livraison n'est jamais exposé côté admin avant
      // validation manuelle : on l'exclut explicitement de l'état affiché.
      // On garde sa LONGUEUR à part (codeLongueur) avant de le supprimer —
      // sinon codeLength (plus bas) retombe toujours sur 4 par défaut,
      // même pour une commande créée avec le réglage 6 chiffres.
      const codeLongueur = data.codeLivraison?.length || 4;
      delete data.codeLivraison;
      return { id: d.id, ...data, codeLongueur, _resume: resumeArticles(data) };
    }

    // Seules les commandes récentes sont écoutées en temps réel : écouter
    // toute la collection téléchargeait l'historique complet à chaque
    // ouverture (de plus en plus lent à mesure que la boutique vend).
    // "Voir plus" agrandit la fenêtre ; les commandes déjà reçues restent
    // dans le cache Firestore local, donc seules les nouvelles sont chargées.
    const PAS_COMMANDES = 50;
    const limiteCommandes = ref(PAS_COMMANDES);
    const plusDeCommandes = ref(false);
    const chargementCommandes = ref(true);
    let desabonnerCommandes = null;
    function ecouterCommandes() {
      desabonnerCommandes?.();
      chargementCommandes.value = true;
      desabonnerCommandes = onSnapshot(
        query(collection(db, "commandes"), orderBy("dateCreation", "desc"), limit(limiteCommandes.value)),
        (snap) => {
          commandes.value = snap.docs.map(versCommande);
          plusDeCommandes.value = snap.size >= limiteCommandes.value;
          chargementCommandes.value = false;
          if (!snap.metadata.fromCache) planifierCompteurs();
        },
        (err) => {
          console.error(err);
          chargementCommandes.value = false;
        }
      );
    }
    function voirPlusCommandes() {
      limiteCommandes.value += PAS_COMMANDES;
      ecouterCommandes();
    }
    ecouterCommandes();

    onSnapshot(query(collection(db, "livreurs"), orderBy("nom")), (snap) => {
      livreurs.value = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    });

    return {
      commandes,
      searchTerm,
      rechercherServeur,
      rechercheServeurEnCours,
      plusDeCommandes,
      chargementCommandes,
      voirPlusCommandes,
      statusFilter,
      statusCounts,
      filteredCommandes,
      tbDateText,
      aujourdhuiTexte,
      fmt,
      fmtDate,
      montant,
      statusInfo,
      handleStatusChange,
      marquerNonJoignable,
      envoyerCorbeille,
      codeOverlayOpen,
      priceOverlayOpen,
      courierOverlayOpen,
      activeOrder,
      codeDigits,
      codeLength,
      codeError,
      codeErrorMessage,
      codeValidating,
      newPrice,
      priceError,
      priceSaving,
      livreurs,
      pendingLivreurId,
      courierSaving,
      courierError,
      newCourierOpen,
      ncName,
      ncPhone,
      openCodeModal,
      validateCode,
      onCodeInput,
      openPriceModal,
      savePrice,
      openCourierModal,
      selectCourier,
      toggleNewCourier,
      saveCourier,
      closeModal,
    };
  },
}).mount("#commandesApp");
