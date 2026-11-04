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
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { nouvelIdAction } from "./photo-incident.js";
import { libelleRaison } from "./livraison-commun.js";
import { montant, montantNet, resumeArticles, fraisAConfirmer, telephoneInternational, lienTel } from "./commande-utils.js";

const changerStatutCommande = httpsCallable(functions, "changerStatutCommande");

const STATUT_INFO = {
  nouvelle: { label: "Nouvelle", cls: "st-new" },
  confirmee: { label: "Confirmée", cls: "st-confirmed" },
  en_preparation: { label: "En préparation", cls: "st-preparing" },
  en_livraison: { label: "En livraison", cls: "st-transit" },
  livree: { label: "Livrée", cls: "st-done" },
  en_negociation: { label: "En négociation", cls: "st-negotiate" },
  non_joignable: { label: "Non joignable", cls: "st-unreachable" },
  retournee: { label: "Retournée", cls: "st-returned" },
  endommagee: { label: "Endommagée", cls: "st-unreachable" },
  annulee_client: { label: "Annulée par le client", cls: "st-returned" },
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
    // ?statut=… (raccourcis du tableau de bord) : filtre appliqué d'office.
    const STATUTS_FILTRABLES = ["toutes", "nouvelle", "confirmee", "en_preparation", "en_livraison", "livree", "en_negociation", "non_joignable", "retournee", "annulee"];
    const statutAdresse = new URLSearchParams(location.search).get("statut");
    const statusFilter = ref(STATUTS_FILTRABLES.includes(statutAdresse) ? statutAdresse : "toutes");

    // Chaque commande garde la longueur de code telle qu'elle a été générée
    // à l'époque (le réglage admin a pu changer depuis) : la source de
    // vérité pour la saisie est la commande elle-même, jamais le réglage
    // actuel.


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
    // Fusion avec « … » par défaut : un statut ajouté depuis (ex. en_preparation)
    // n'a pas encore de compteur mémorisé.
    const statusCounts = ref({ ...Object.fromEntries(["toutes", ...Object.keys(STATUT_INFO)].map((k) => [k, "…"])), ...(compteursMemorises || {}) });
    let comptageTimer = null;
    // 22 comptages à chaque ouverture : au retour d'une fiche commande, les
    // chiffres d'il y a moins d'une minute suffisent. Tout changement reçu
    // ensuite les recalcule comme avant.
    const CLE_COMPTEURS_DATE = "bokki-commandes-compteurs-date";
    let premierInstantane = true;
    const compteursRecents = () => {
      try { return Date.now() - Number(localStorage.getItem(CLE_COMPTEURS_DATE) || 0) < 60000; } catch { return false; }
    };
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
        try {
          localStorage.setItem(CLE_COMPTEURS, JSON.stringify(counts));
          localStorage.setItem(CLE_COMPTEURS_DATE, String(Date.now()));
        } catch { /* ignore */ }
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

    // Actions de la liste. Confirmer, Réassigner et Annuler s'ouvrent dans le
    // détail ; les statuts de livraison se changent dans « Ma livraison ».
    const aConfirmer = (c) => ["nouvelle", "non_joignable", "en_negociation"].includes(c.statut);
    const peutReassigner = (c) => ["confirmee", "en_preparation", "en_livraison"].includes(c.statut);
    const peutAnnuler = (c) => aConfirmer(c) || ["confirmee", "en_preparation"].includes(c.statut);
    const fmtHeure = (t) => t?.toDate?.().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) || "";
    async function preparer(c) {
      try {
        await changerStatutCommande({ commandeId: c.id, statut: "en_preparation", idAction: nouvelIdAction() });
      } catch (err) {
        console.error(err);
        alert("Impossible de mettre à jour la commande " + (c.numero || "") + " : " + (err.message || err.code || "réessaie."));
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
          if (!snap.metadata.fromCache) {
            if (!(premierInstantane && compteursMemorises && compteursRecents())) planifierCompteurs();
            premierInstantane = false;
          }
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
      montantNet,
      fraisAConfirmer,
      telephoneInternational,
      lienTel,
      statusInfo,
      aConfirmer,
      peutReassigner,
      peutAnnuler,
      preparer,
      fmtHeure,
      libelleRaison,
      envoyerCorbeille,
    };
  },
}).mount("#commandesApp");
