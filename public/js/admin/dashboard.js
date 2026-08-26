import { createApp, ref } from "https://unpkg.com/vue@3/dist/vue.esm-browser.js";
import { db, functions } from "../firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  getCountFromServer,
  getAggregateFromServer,
  sum,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const STATUT_PILL = {
  nouvelle: { label: "NOUVELLE", cls: "new" },
  confirmee: { label: "CONFIRMÉE", cls: "confirmed" },
  en_livraison: { label: "EN LIVRAISON", cls: "transit" },
  livree: { label: "LIVRÉE", cls: "done" },
  en_negociation: { label: "EN NÉGOCIATION", cls: "negotiate" },
  retournee: { label: "RETOURNÉE", cls: "returned" },
};
function pillInfo(statut) {
  return STATUT_PILL[statut] || { label: statut, cls: "" };
}
function montant(c) {
  return c.prixConvenu != null ? c.prixConvenu : c.prixInitial || 0;
}
function initials(nom) {
  const parts = (nom || "").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
}
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";

const repartitionFinanciereDuJour = httpsCallable(functions, "repartitionFinanciereDuJour");

function debutAujourdhui() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function debutDuMois() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}
function dateAujourdhuiTexte() {
  const texte = new Date().toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}
function fmt(n) {
  return Math.round(n || 0).toLocaleString("fr-FR").replace(/,/g, " ");
}

// Bip synthétisé (Web Audio API) plutôt qu'un fichier audio : pas d'asset à
// livrer/héberger, aucun souci de licence. Deux notes courtes façon "ding".
//
// Politique anti-autoplay des navigateurs : un AudioContext créé sans geste
// utilisateur réel préalable démarre "suspended", et resume() ne le débloque
// pas tant qu'aucune interaction n'a eu lieu sur la page (vérifié : un appel
// resume() sans interaction reste indéfiniment en attente). Si une commande
// arrivait avant le tout premier clic/touche de l'admin sur le dashboard, le
// son resterait donc silencieux malgré le badge — on profite ici du tout
// premier clic ou touche sur la page pour créer/débloquer l'AudioContext par
// avance, pour couvrir ce cas au plus tôt dans une session réelle.
let audioCtx = null;
function ensureAudioCtx() {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}
["pointerdown", "keydown"].forEach((evt) => window.addEventListener(evt, ensureAudioCtx, { once: true }));

function playNotificationSound() {
  try {
    const ctx = ensureAudioCtx();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = now + i * 0.12;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.2, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    });
  } catch (err) {
    console.error(err);
  }
}

createApp({
  setup() {
    const commandesDuJour = ref(null);
    const enLivraison = ref(null);
    const duFournisseurs = ref(null);
    const margeDuMois = ref(null);
    const kpiErrors = ref({});

    async function loadCommandesDuJour() {
      try {
        const snap = await getCountFromServer(
          query(collection(db, "commandes"), where("dateCreation", ">=", debutAujourdhui()))
        );
        commandesDuJour.value = snap.data().count;
      } catch (err) {
        console.error(err);
        kpiErrors.value = { ...kpiErrors.value, commandesDuJour: true };
      }
    }

    // Les 6 cartes de répartition par statut : mêmes comptages agrégés que
    // les KPI du haut, un par statut. Comme "Dû aux fournisseurs"/"Marge du
    // mois", on ne filtre pas les commandes envoyées à la corbeille — un
    // choix déjà fait et assumé pour le reste du dashboard (voir le ticket
    // corbeille), gardé identique ici pour rester cohérent.
    const STATUTS_GRID = ["nouvelle", "confirmee", "en_livraison", "livree", "en_negociation", "retournee"];
    const statutCounts = ref({});
    const statutCountsError = ref(false);
    async function loadStatutCounts() {
      try {
        const snaps = await Promise.all(
          STATUTS_GRID.map((s) => getCountFromServer(query(collection(db, "commandes"), where("statut", "==", s))))
        );
        const counts = {};
        STATUTS_GRID.forEach((s, i) => {
          counts[s] = snaps[i].data().count;
        });
        statutCounts.value = counts;
      } catch (err) {
        console.error(err);
        statutCountsError.value = true;
      }
    }

    async function loadEnLivraison() {
      try {
        const snap = await getCountFromServer(
          query(collection(db, "commandes"), where("statut", "==", "en_livraison"))
        );
        enLivraison.value = snap.data().count;
      } catch (err) {
        console.error(err);
        kpiErrors.value = { ...kpiErrors.value, enLivraison: true };
      }
    }

    async function loadDuFournisseurs() {
      try {
        const snap = await getAggregateFromServer(query(collection(db, "fournisseurs")), {
          total: sum("montantDu"),
        });
        duFournisseurs.value = snap.data().total || 0;
      } catch (err) {
        console.error(err);
        kpiErrors.value = { ...kpiErrors.value, duFournisseurs: true };
      }
    }

    // Pas de champ "marge" stocké par commande (et prixConvenu peut différer
    // de prixInitial après négociation) : impossible d'obtenir un total exact
    // via un seul sum() serveur sur un champ unique. On borne donc la requête
    // au mois en cours (statut livrée + dateLivraison de ce mois — jamais
    // toute la collection) puis on calcule le montant exact par commande :
    // vente réelle (prixConvenu si négocié, sinon prixInitial, hors frais de
    // livraison) moins le coût fournisseur. Ce coût vit dans la sous-collection
    // commandes/{id}/interne/fournisseur (admin uniquement) plutôt que sur la
    // commande elle-même, qui est lisible publiquement pour le suivi client —
    // sinon n'importe qui connaissant un numéro de commande pourrait lire la
    // marge exacte de Makitti dessus. Une lecture de plus par commande du mois,
    // coût négligeable vu le volume borné de cette requête.
    async function loadMargeDuMois() {
      try {
        const snap = await getDocs(
          query(
            collection(db, "commandes"),
            where("statut", "==", "livree"),
            where("dateLivraison", ">=", debutDuMois())
          )
        );
        const couts = await Promise.all(
          snap.docs.map((docSnap) =>
            getDoc(doc(db, "commandes", docSnap.id, "interne", "fournisseur"))
              .then((s) => s.data()?.montant || 0)
              .catch(() => 0)
          )
        );
        let total = 0;
        snap.docs.forEach((docSnap, i) => {
          const c = docSnap.data();
          const vente = (c.prixConvenu != null ? c.prixConvenu : c.prixInitial || 0) - (c.fraisLivraison || 0);
          total += vente - couts[i];
        });
        margeDuMois.value = total;
      } catch (err) {
        console.error(err);
        kpiErrors.value = { ...kpiErrors.value, margeDuMois: true };
      }
    }

    // Panneau "Commandes récentes" : les 6 dernières commandes actives (hors
    // corbeille), triées comme la liste principale (commandes.html). On lit
    // 8 documents pour compenser un éventuel filtrage de corbeille et
    // garder 6 lignes pleines à afficher.
    const commandesRecentes = ref([]);
    const commandesRecentesError = ref(false);
    async function loadCommandesRecentes() {
      try {
        const snap = await getDocs(query(collection(db, "commandes"), orderBy("dateCreation", "desc"), limit(8)));
        commandesRecentes.value = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((c) => !c.corbeille)
          .slice(0, 6);
      } catch (err) {
        console.error(err);
        commandesRecentesError.value = true;
      }
    }

    // Panneau "Dû aux fournisseurs" : les 4 fournisseurs avec le plus gros
    // solde couru, plus le nombre total de fournisseurs concernés (peut
    // dépasser les 4 affichés) pour le texte du bandeau en bas du panneau.
    const fournisseursDus = ref([]);
    const fournisseursDusCount = ref(0);
    const fournisseursDusError = ref(false);
    async function loadFournisseursDus() {
      try {
        const [snap, countSnap] = await Promise.all([
          getDocs(query(collection(db, "fournisseurs"), orderBy("montantDu", "desc"), limit(4))),
          getCountFromServer(query(collection(db, "fournisseurs"), where("montantDu", ">", 0))),
        ]);
        fournisseursDus.value = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((f) => (f.montantDu || 0) > 0);
        fournisseursDusCount.value = countSnap.data().count;
      } catch (err) {
        console.error(err);
        fournisseursDusError.value = true;
      }
    }

    // Répartition financière du jour (part Makitti / fournisseur / livreur
    // par commande) : calculée côté Cloud Function, jamais côté client, pour
    // ne pas exposer prixAchat/fraisParLivraison bruts au front admin.
    const repartition = ref(null);
    const repartitionError = ref(false);
    async function loadRepartition() {
      try {
        const result = await repartitionFinanciereDuJour();
        repartition.value = result.data;
      } catch (err) {
        console.error(err);
        repartitionError.value = true;
      }
    }

    // Badge + son quand une commande est écrite dans Firestore, en direct
    // pendant que le dashboard reste ouvert (onSnapshot). Le seuil de départ
    // est la date de création de la commande la plus récente déjà existante
    // — pas l'horloge du navigateur, pour ne jamais dépendre d'un éventuel
    // décalage entre l'heure du poste admin et celle du serveur Firestore.
    // Sans commande existante, seuil = epoch : la toute première commande
    // déclenche déjà le badge.
    const pendingNotifs = ref(0);
    function dismissNotifs() {
      pendingNotifs.value = 0;
    }
    async function initNotifications() {
      let seuil = new Date(0);
      try {
        const snap = await getDocs(query(collection(db, "commandes"), orderBy("dateCreation", "desc"), limit(1)));
        if (!snap.empty) {
          const ts = snap.docs[0].data().dateCreation;
          if (ts?.toDate) seuil = ts.toDate();
        }
      } catch (err) {
        console.error(err);
      }

      onSnapshot(
        query(collection(db, "commandes"), where("dateCreation", ">", seuil)),
        (snap) => {
          snap.docChanges().forEach((change) => {
            if (change.type === "added") {
              pendingNotifs.value++;
              playNotificationSound();
            }
          });
        },
        (err) => console.error(err)
      );
    }

    loadCommandesDuJour();
    loadEnLivraison();
    loadDuFournisseurs();
    loadMargeDuMois();
    loadRepartition();
    loadStatutCounts();
    loadCommandesRecentes();
    loadFournisseursDus();
    initNotifications();

    return {
      commandesDuJour,
      enLivraison,
      duFournisseurs,
      margeDuMois,
      kpiErrors,
      repartition,
      repartitionError,
      statutCounts,
      statutCountsError,
      commandesRecentes,
      commandesRecentesError,
      fournisseursDus,
      fournisseursDusCount,
      fournisseursDusError,
      pillInfo,
      montant,
      initials,
      pendingNotifs,
      dismissNotifs,
      fmt,
      dateAujourdhui: dateAujourdhuiTexte(),
    };
  },
}).mount("#dashboardApp");
