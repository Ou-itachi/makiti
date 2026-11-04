// « Mes livraisons » : commandes attribuées à la personne connectée, sur
// ordinateur et sur téléphone. Lecture en temps réel de livraisons/{id} (copie
// réduite, sans code de livraison). Tout changement de statut passe par la
// fonction changerStatutCommande, qui contrôle les droits.
import { createApp, ref, computed, onMounted } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { auth, db, functions } from "../firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, where } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { compresserPhotoIncident, nouvelIdAction } from "./photo-incident.js";
import { obtenirToken, pushDisponible } from "./admin-push.js";

const changerStatutCommande = httpsCallable(functions, "changerStatutCommande", { timeout: 25000 });
const enregistrerTokenLivreur = httpsCallable(functions, "enregistrerTokenLivreur");

const CLE_ATTENTE = "bokki-actions-livraison";
const STATUTS = {
  confirmee: { label: "Confirmée", cls: "bleu" },
  en_preparation: { label: "En préparation", cls: "bleu" },
  en_livraison: { label: "En livraison", cls: "ambre" },
  livree: { label: "Livrée", cls: "vert" },
  en_negociation: { label: "En négociation", cls: "gris" },
  non_joignable: { label: "Non joignable", cls: "gris" },
  nouvelle: { label: "Nouvelle", cls: "gris" },
  retournee: { label: "Retournée", cls: "rouge" },
  endommagee: { label: "Endommagée", cls: "rouge" },
  annulee_client: { label: "Annulée par le client", cls: "rouge" },
};
const PROBLEMES = [
  { statut: "retournee", libelle: "Retournée" },
  { statut: "endommagee", libelle: "Endommagée · photo obligatoire" },
  { statut: "annulee_client", libelle: "Annulée par le client" },
];
const DEPART_POSSIBLE = ["confirmee", "en_preparation"];
const TERMINEES = ["livree", "retournee", "endommagee", "annulee_client"];

const fmt = (n) => Math.round(n || 0).toLocaleString("fr-FR").replace(/[\s,\u202f]/g, " ");
const memeJour = (ts) => {
  const d = ts?.toDate?.();
  return !!d && d.toDateString() === new Date().toDateString();
};
function lireAttente() {
  try { return JSON.parse(localStorage.getItem(CLE_ATTENTE) || "[]"); } catch { return []; }
}
function ecrireAttente(liste) {
  try { localStorage.setItem(CLE_ATTENTE, JSON.stringify(liste)); return true; } catch { return false; }
}
const coupureReseau = (err) => navigator.onLine === false
  || ["functions/unavailable", "functions/deadline-exceeded"].includes(err?.code)
  || (err?.code === "functions/internal" && /^internal$/i.test(err?.message || ""));

createApp({
  setup() {
    const livraisons = ref([]);
    const charge = ref(false);
    const nomLivreur = ref("");
    const sansCompte = ref(false);
    const estAdmin = ref(false);
    const horsLigne = ref(navigator.onLine === false);
    const attente = ref(lireAttente());
    const menuOuvert = ref(null);
    const idDetail = ref(new URLSearchParams(location.search).get("id"));
    const messageAction = ref("");
    const messageType = ref("info");
    const probleme = ref(null);
    const problemeErreur = ref("");
    const raison = ref("");
    const commentaire = ref("");
    const photo = ref(null);
    const pushProposable = ref(false);

    function afficher(texte, type = "info") {
      messageAction.value = texte;
      messageType.value = type;
    }

    const duJour = computed(() => livraisons.value.filter((l) => !TERMINEES.includes(l.statut) || memeJour(l.statutMajLe)));
    const compteurs = computed(() => ({
      aLivrer: duJour.value.filter((l) => DEPART_POSSIBLE.includes(l.statut)).length,
      enLivraison: duJour.value.filter((l) => l.statut === "en_livraison").length,
      livrees: duJour.value.filter((l) => l.statut === "livree").length,
    }));
    const vueDetail = computed(() => livraisons.value.find((l) => l.commandeId === idDetail.value) || null);
    const sousTitre = computed(() => {
      const date = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
      return nomLivreur.value ? `${nomLivreur.value} · ${date}` : date;
    });

    const infoStatut = (s) => STATUTS[s] || { label: s, cls: "gris" };
    const enAttente = (id) => attente.value.some((a) => a.commandeId === id);
    const peutPartir = (l) => DEPART_POSSIBLE.includes(l.statut) && !enAttente(l.commandeId);
    const peutSignaler = (l) => [...DEPART_POSSIBLE, "en_livraison"].includes(l.statut) && !enAttente(l.commandeId);

    function ouvrirDetail(l) {
      idDetail.value = l.commandeId;
      history.replaceState(null, "", `?id=${l.commandeId}`);
      scrollTo(0, 0);
    }
    function fermerDetail() {
      idDetail.value = null;
      history.replaceState(null, "", location.pathname);
    }

    // File d'envoi : l'action reste sur le téléphone tant que le serveur n'a
    // pas répondu. idAction évite tout doublon si un envoi perdu avait abouti.
    let envoiEnCours = null;
    async function viderFile() {
      while (attente.value.length) {
        if (navigator.onLine === false) return;
        const action = attente.value[0];
        try {
          await changerStatutCommande(action);
          afficher(`Commande ${action.numero || ""} : statut enregistré.`.replace("  ", " "), "ok");
        } catch (err) {
          if (coupureReseau(err)) {
            afficher("Pas de réseau : l'action est gardée et partira au retour du réseau.");
            return;
          }
          afficher(`Commande ${action.numero || ""} : ${err.message || "action refusée."}`, "erreur");
        }
        attente.value = attente.value.slice(1);
        ecrireAttente(attente.value);
      }
    }
    function envoyerFile() {
      envoiEnCours ||= (navigator.locks?.request
        ? navigator.locks.request(CLE_ATTENTE, () => { attente.value = lireAttente(); return viderFile(); })
        : viderFile()).finally(() => { envoiEnCours = null; });
      return envoiEnCours;
    }
    function agir(livraison, statut, details = {}) {
      const action = { commandeId: livraison.commandeId, numero: livraison.numero, statut, idAction: nouvelIdAction(), ...details };
      attente.value = [...attente.value, action];
      const garde = ecrireAttente(attente.value);
      if (!garde && details.photo) {
        // Photo trop lourde pour le téléphone : envoi direct uniquement.
        attente.value = attente.value.filter((a) => a.idAction !== action.idAction);
        afficher("Reconnectez-vous au réseau pour envoyer cette photo.", "erreur");
        return;
      }
      if (navigator.onLine === false) afficher("Pas de réseau : l'action est gardée et partira au retour du réseau.");
      else afficher("");
      envoyerFile();
    }
    function partir(l) {
      agir(l, "en_livraison");
    }

    function validerCode(l) {
      if (estAdmin.value) {
        location.href = `commande-detail.html?id=${l.commandeId}&action=code`;
        return;
      }
      afficher("La validation du code est réservée à l'admin. Demandez-lui de saisir le code donné par le client.");
      scrollTo(0, 0);
    }

    function ouvrirProbleme(l, statut) {
      menuOuvert.value = null;
      raison.value = "";
      commentaire.value = "";
      photo.value = null;
      problemeErreur.value = "";
      probleme.value = { livraison: l, statut, libelle: PROBLEMES.find((p) => p.statut === statut).libelle.split(" · ")[0] };
    }
    async function choisirPhoto(e) {
      const fichier = e.target.files?.[0];
      if (!fichier) return;
      try {
        photo.value = await compresserPhotoIncident(fichier);
      } catch (err) {
        problemeErreur.value = err.message;
      }
    }
    function validerProbleme() {
      const { statut, livraison } = probleme.value;
      const texte = commentaire.value.trim();
      problemeErreur.value = "";
      if (statut === "retournee" && !raison.value) problemeErreur.value = "Choisissez la raison.";
      else if (statut === "retournee" && raison.value === "autre" && !texte) problemeErreur.value = "Précisez la raison.";
      else if (statut === "annulee_client" && !raison.value.trim()) problemeErreur.value = "Indiquez la raison.";
      else if (statut === "endommagee" && !photo.value) problemeErreur.value = "Ajoutez une photo.";
      else if (statut === "endommagee" && !texte) problemeErreur.value = "Ajoutez un commentaire.";
      if (problemeErreur.value) return;
      const details = {};
      if (raison.value) details.raison = raison.value.trim();
      if (texte) details.commentaire = texte;
      if (photo.value) details.photo = photo.value;
      probleme.value = null;
      agir(livraison, statut, details);
    }

    async function activerNotifications() {
      try {
        if ((await Notification.requestPermission()) !== "granted") throw new Error("refus");
        await enregistrerTokenLivreur({ token: await obtenirToken() });
        localStorage.setItem("bokki-livreur-push", "1");
        pushProposable.value = false;
        afficher("Notifications activées sur cet appareil.", "ok");
      } catch (err) {
        console.error(err);
        afficher("Notifications impossibles sur cet appareil.", "erreur");
      }
    }

    function ecouter(livreurId) {
      const q = query(collection(db, "livraisons"), where("livreurId", "==", livreurId), orderBy("attribueeLe", "desc"), limit(100));
      onSnapshot(q, (snap) => {
        livraisons.value = snap.docs.map((d) => d.data());
        charge.value = true;
      }, (err) => {
        console.error(err);
        charge.value = true;
        afficher("Impossible de charger vos livraisons. Rechargez la page.", "erreur");
      });
    }

    onMounted(() => {
      addEventListener("online", () => { horsLigne.value = false; envoyerFile(); });
      addEventListener("offline", () => { horsLigne.value = true; });
      addEventListener("click", (e) => { if (!e.target.closest?.(".ml-menu")) menuOuvert.value = null; });
      setInterval(() => { if (attente.value.length) envoyerFile(); }, 20000);
      const stop = onAuthStateChanged(auth, async (user) => {
        if (!user) return;
        stop();
        const [compte, admin] = await Promise.all([
          getDoc(doc(db, "comptesLivreurs", user.uid)).catch(() => null),
          getDoc(doc(db, "parametres", "livraison")).then(() => true).catch(() => false),
        ]);
        estAdmin.value = admin;
        if (!compte?.exists()) {
          sansCompte.value = true;
          return;
        }
        nomLivreur.value = compte.data().nom || "";
        ecouter(compte.data().livreurId);
        pushProposable.value = pushDisponible() && !localStorage.getItem("bokki-livreur-push");
        envoyerFile();
      });
    });

    return {
      PROBLEMES, fmt, duJour, compteurs, charge, sansCompte, sousTitre, horsLigne, vueDetail, menuOuvert,
      messageAction, messageType, probleme, problemeErreur, raison, commentaire, pushProposable,
      infoStatut, enAttente, peutPartir, peutSignaler, ouvrirDetail, fermerDetail, partir, validerCode,
      ouvrirProbleme, choisirPhoto, validerProbleme, activerNotifications,
    };
  },
}).mount("#mesLivraisonsApp");
