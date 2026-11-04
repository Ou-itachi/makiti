import { createApp, ref, computed, watch } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { db, functions } from "../firebase-config.js";
import { storage } from "../firebase-stockage.js";
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
import { ref as storageRef, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";
import { categorieConfig } from "../produit-categories.js";
import { nouvelIdAction } from "./photo-incident.js";
import { libelleRaison } from "./livraison-commun.js";
import { articlesDe, montant, totalEncaisser, montantBrut, montantNet, libelleReductionParrainage, fraisAConfirmer, libelleFrais, telephoneInternational, lienTel, lienWhatsApp } from "./commande-utils.js";

// Annulation de la réduction de parrainage (serveur : retire la réduction,
// annule la récompense du parrain, garde parrainages/{téléphone}).
const annulerReductionParrainage = httpsCallable(functions, "annulerReductionParrainage");
// Statut et attribution : uniquement par le serveur (firestore.rules).
const changerStatutCommande = httpsCallable(functions, "changerStatutCommande");
const attribuerLivreur = httpsCallable(functions, "attribuerLivreur");
const corrigerStatutCommande = httpsCallable(functions, "corrigerStatutCommande");
const STATUTS_TERMINES = ["livree", "retournee", "endommagee", "annulee_client"];
const STATUTS_A_CONFIRMER = ["nouvelle", "non_joignable", "en_negociation"];
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
  en_preparation: { label: "En préparation", cls: "preparing" },
  en_livraison: { label: "En livraison", cls: "transit" },
  livree: { label: "Livrée", cls: "done" },
  en_negociation: { label: "En négociation", cls: "negotiate" },
  non_joignable: { label: "Non joignable", cls: "unreachable" },
  retournee: { label: "Retournée", cls: "returned" },
  endommagee: { label: "Endommagée", cls: "unreachable" },
  annulee_client: { label: "Annulée par le client", cls: "returned" },
};

// Étapes de la progression "normale" d'une commande. en_negociation et
// retournee sont des embranchements, pas des étapes de cette ligne — voir
// timelineSteps().
const STEPS = [
  { key: "nouvelle", label: "Commande reçue" },
  { key: "confirmee", label: "Confirmée par téléphone" },
  { key: "en_preparation", label: "En préparation" },
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

    const priceOverlayOpen = ref(false);
    const courierOverlayOpen = ref(false);
    // Chaque commande garde la longueur de code telle qu'elle a été générée
    // à l'époque (parametres/livraison.longueurCode a pu changer depuis) :
    // la source de vérité pour la saisie admin est donc la commande
    // elle-même, jamais le réglage actuel.
    const codeLength = computed(() => order.value?.codeLongueur || 4);
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
      if (order.value.livreurRole === "admin") return { name: `${order.value.livreurNom} (admin)`, phone: "" };
      const l = livreurs.value.find((x) => x.id === order.value.livreurId);
      if (!l) return { name: "Livreur supprimé", phone: "" };
      return { name: l.nom, phone: l.telephone || "" };
    });

    const timelineSteps = computed(() => {
      if (!order.value) return [];
      const statut = order.value.statut;
      const idx = STEPS.findIndex((s) => s.key === statut);

      if (idx === -1) {
        // en_negociation / retournee / endommagee / annulee_client : embranchement
        // hors de la ligne "normale" ; le détail est dans historiqueLignes.
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

    // Historique : qui, quand, pourquoi (écrit par le serveur).
    const historiqueLignes = computed(() => (order.value?.historique || []).slice().reverse().map((h) => {
      const nomLivreur = (id) => (String(id).startsWith("admin_") ? "un admin" : livreurs.value.find((l) => l.id === id)?.nom || "un livreur");
      const titre = h.type === "attribution"
        ? `Attribuée à ${nomLivreur(h.livreurId)}`
        : STATUT_INFO[h.vers]?.label || h.vers;
      const raison = [h.raison === "correction" ? "Correction" : libelleRaison(h.raison), h.commentaire].filter(Boolean).join(" · ");
      const qui = h.nom || (h.role === "admin" ? "Admin" : "Livreur");
      return { titre, detail: `${fmtDate(h.date)} · ${qui}`, raison };
    }));

    // Annuler et Corriger le statut : même fenêtre, raison obligatoire.
    const raisonOuverte = ref(false);
    const raisonStatut = ref("");
    const raisonChoix = ref("");
    const raisonCommentaire = ref("");
    const raisonErreur = ref("");
    function ouvrirRaison(statut) {
      raisonStatut.value = statut;
      raisonChoix.value = "";
      raisonCommentaire.value = "";
      raisonErreur.value = "";
      raisonOuverte.value = true;
    }
    function fermerRaison() {
      raisonOuverte.value = false;
    }
    async function envoyerStatut(statut, extra = {}) {
      statusChanging.value = true;
      try {
        await changerStatutCommande({ commandeId, statut, idAction: nouvelIdAction(), ...extra });
          return true;
      } catch (err) {
        console.error(err);
        if (raisonOuverte.value) raisonErreur.value = err.message || "Réessaie.";
        else alert("Impossible de mettre à jour le statut : " + (err.message || err.code || "réessaie."));
        return false;
      } finally {
        statusChanging.value = false;
      }
    }
    const correctionVers = ref("");
    function ouvrirCorrection() {
      correctionVers.value = "";
      ouvrirRaison("correction");
    }
    async function validerRaison() {
      raisonErreur.value = "";
      if (raisonStatut.value === "correction") {
        if (!correctionVers.value || !raisonCommentaire.value.trim()) {
          raisonErreur.value = "Choisissez le statut et indiquez la raison.";
          return;
        }
        statusChanging.value = true;
        try {
          await corrigerStatutCommande({ commandeId, statut: correctionVers.value, raison: raisonCommentaire.value });
          raisonOuverte.value = false;
        } catch (err) {
          console.error(err);
          raisonErreur.value = err.message || "Correction impossible, réessayez.";
        } finally {
          statusChanging.value = false;
        }
        return;
      }
      if (!raisonChoix.value) {
        raisonErreur.value = "Choisissez la raison.";
        return;
      }
      if (await envoyerStatut("annulee_client", { raison: raisonChoix.value })) raisonOuverte.value = false;
    }
    const passerStatut = (statut) => envoyerStatut(statut);


    // Anti-triche du parrainage : tant que la commande n'est pas livrée,
    // l'équipe peut retirer la réduction (ex. « Parrainage à vérifier »
    // confirmé au téléphone : le client est le parrain lui-même).
    const annulationParrainage = ref(false);
    const annulationErreur = ref("");
    const peutAnnulerParrainage = computed(() => {
      const o = order.value;
      return !!o && o.statut !== "livree" && !o.parrainageAnnule && !o.recompenseParrain?.versee
        && (!!o.parrainUid || Number(o.reductionParrainage) > 0);
    });
    async function annulerParrainage() {
      const o = order.value;
      const reduction = Number(o.reductionParrainage) || 0;
      const avertissementPrix = o.prixConvenu != null ? "\n\nUn prix convenu est saisi : pensez à le corriger si besoin." : "";
      if (!confirm(`Annuler la réduction de parrainage de la commande ${o.numero}${reduction > 0 ? ` (−${fmt(reduction)} GNF)` : ""} ? Le parrain ne sera pas récompensé et ce numéro ne pourra plus être parrainé.${avertissementPrix}`)) return;
      annulationErreur.value = "";
      annulationParrainage.value = true;
      try {
        await annulerReductionParrainage({ commandeId });
      } catch (err) {
        console.error(err);
        annulationErreur.value = err.message || "Annulation impossible, réessaie.";
      } finally {
        annulationParrainage.value = false;
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

    // Frais de livraison (ville non reconnue → « à confirmer », ou
    // correction) : enregistrés sur la commande, visibles par le client
    // dans son suivi (fraisLivraison numérique, fraisAConfirmer false).
    const fraisEdition = ref(false);
    const fraisSaisie = ref(null);
    const fraisErreur = ref("");
    const fraisEnregistrement = ref(false);
    function ouvrirFrais() {
      fraisErreur.value = "";
      fraisSaisie.value = fraisAConfirmer(order.value) ? null : Number(order.value.fraisLivraison) || 0;
      fraisEdition.value = true;
    }
    async function enregistrerFrais() {
      fraisErreur.value = "";
      const frais = Number(fraisSaisie.value);
      if (fraisSaisie.value === null || fraisSaisie.value === "" || !Number.isSafeInteger(frais) || frais < 0) {
        fraisErreur.value = "Indique un montant en GNF (0 si la livraison est gratuite).";
        return;
      }
      fraisEnregistrement.value = true;
      try {
        await updateDoc(doc(db, "commandes", commandeId), { fraisLivraison: frais, fraisAConfirmer: false });
        fraisEdition.value = false;
      } catch (err) {
        console.error(err);
        fraisErreur.value = "Erreur lors de l'enregistrement : " + (err.message || err.code || "réessaie.");
      } finally {
        fraisEnregistrement.value = false;
      }
    }

    // Même fenêtre pour « Confirmer et attribuer » et « Changer de livreur ».
    const modeConfirmation = ref(false);
    const noteLivreur = ref("");
    const prevenirLivreur = ref(true);
    function ouvrirAttribution(confirmation) {
      modeConfirmation.value = confirmation;
      pendingLivreurId.value = null;
      noteLivreur.value = order.value?.noteLivreur || "";
      prevenirLivreur.value = true;
      courierError.value = "";
      courierOverlayOpen.value = true;
    }
    function ouvrirConfirmation() {
      ouvrirAttribution(true);
    }
    function openCourierModal() {
      ouvrirAttribution(false);
    }
    function selectCourier(id) {
      pendingLivreurId.value = id;
      courierError.value = "";
    }
    async function assignCourier() {
      courierError.value = "";
      if (!pendingLivreurId.value) {
        courierError.value = "Choisissez qui livrera cette commande.";
        return;
      }
      courierSaving.value = true;
      try {
        const qui = pendingLivreurId.value === "moi" ? { moiMeme: true } : { livreurId: pendingLivreurId.value };
        await attribuerLivreur({ commandeId, ...qui, note: noteLivreur.value, prevenir: prevenirLivreur.value });
        courierOverlayOpen.value = false;
        } catch (err) {
        console.error(err);
        courierError.value = err.message || "Attribution impossible, réessaie.";
      } finally {
        courierSaving.value = false;
      }
    }
    const peutConfirmer = computed(() => !!order.value && STATUTS_A_CONFIRMER.includes(order.value.statut));
    const peutCorbeille = computed(() => !!order.value && STATUTS_TERMINES.includes(order.value.statut));
    const peutReassigner = computed(() => !!order.value && ["confirmee", "en_preparation", "en_livraison"].includes(order.value.statut));
    const peutAnnuler = computed(() => !!order.value && (STATUTS_A_CONFIRMER.includes(order.value.statut) || ["confirmee", "en_preparation"].includes(order.value.statut)));
    const livreursActifs = computed(() => livreurs.value.filter((l) => l.actif !== false && l.compteUid));
    const initialesLivreur = (nom) => (nom || "").trim().split(/\s+/).slice(0, 2).map((m) => m[0]?.toUpperCase()).join("");

    // Photo d'incident : lecture permise par storage.rules, adresse demandée à l'ouverture.
    const photoIncidentUrl = ref("");
    watch(() => order.value?.photoIncident, async (chemin) => {
      photoIncidentUrl.value = "";
      if (!chemin) return;
      try {
        photoIncidentUrl.value = await getDownloadURL(storageRef(storage, chemin));
      } catch (err) {
        console.error(err);
      }
    });

    // Arrivée depuis « Mes livraisons » ou la liste des commandes.
    let actionFaite = false;
    watch(order, (o) => {
      const action = params.get("action");
      if (!o || actionFaite || !action) return;
      actionFaite = true;
      if (action === "confirmer" && STATUTS_A_CONFIRMER.includes(o.statut)) ouvrirConfirmation();
      else if (action === "reassigner" && peutReassigner.value) openCourierModal();
      else if (action === "annulee_client" && peutAnnuler.value) ouvrirRaison(action);
    });

    function closeModal() {
      priceOverlayOpen.value = false;
      courierOverlayOpen.value = false;
      raisonOuverte.value = false;
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
      montantNet,
      libelleReductionParrainage,
      peutAnnulerParrainage,
      annulationParrainage,
      annulationErreur,
      annulerParrainage,
      fraisAConfirmer,
      totalEncaisser,
      libelleFrais,
      telephoneInternational,
      lienTel,
      lienWhatsApp,
      fraisEdition,
      fraisSaisie,
      fraisErreur,
      fraisEnregistrement,
      ouvrirFrais,
      enregistrerFrais,
      articles,
      statusInfo,
      caracteristiquesProduit,
      timelineSteps,
      statusChanging,
      passerStatut,
      historiqueLignes,
      raisonOuverte, raisonStatut, raisonChoix, raisonCommentaire, raisonErreur, correctionVers, libelleRaison,
      ouvrirRaison, ouvrirCorrection, fermerRaison, validerRaison, peutReassigner, peutAnnuler, livreursActifs,
      modeConfirmation, noteLivreur, prevenirLivreur, ouvrirConfirmation,
      peutConfirmer, peutCorbeille, initialesLivreur, photoIncidentUrl,
      STATUT_INFO,
      envoyerCorbeille,
      PLACEHOLDER_IMG,
      courierDisplay,
      livreurs,
      pendingLivreurId,
      courierSaving,
      courierError,
      priceOverlayOpen,
      courierOverlayOpen,
      codeLength,
      newPrice,
      priceError,
      priceSaving,
      openPriceModal,
      savePrice,
      openCourierModal,
      selectCourier,
      assignCourier,
      closeModal,
    };
  },
}).mount("#commandeDetailApp");
