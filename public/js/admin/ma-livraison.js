// « Ma livraison » : même interface pour un livreur et pour un admin qui livre
// lui-même, sur ordinateur et sur téléphone. Lecture en temps réel de
// livraisons/{id} (copie sans code de livraison). Toute action passe par le
// serveur, qui contrôle les droits. Sans réseau, l'action attend sur le
// téléphone et part une seule fois au retour du réseau (idAction).
import { createApp, ref, computed, nextTick, onMounted, watch } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { auth, db, functions } from "../firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { collection, doc, getDoc, onSnapshot, query, Timestamp, where } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";
import { compresserPhotoIncident, nouvelIdAction } from "./photo-incident.js";
import { obtenirToken, pushDisponible } from "./admin-push.js";
import { fmt, heure, infoStatut, libelleRaison } from "./livraison-commun.js";
import { Enregistreur, dansLesHeures, noterPosition, reprendreEnvois } from "./securite-livraison.js";

const changerStatutCommande = httpsCallable(functions, "changerStatutCommande", { timeout: 25000 });
const validerCodeLivraison = httpsCallable(functions, "validerCodeLivraison", { timeout: 25000 });
const enregistrerTokenLivreur = httpsCallable(functions, "enregistrerTokenLivreur");
const terminerJournee = httpsCallable(functions, "terminerJournee");
const declencherSos = httpsCallable(functions, "declencherSos");
const CLE_SOS = "bokki-sos-actif";
const APPUI_LONG_MS = 2000;
const SOS_POSITION_MS = 30000;
const SILENCE_MS = 60 * 60000;

const CLE_ATTENTE = "bokki-actions-livraison";
const PROBLEMES = [
  { cle: "endommagee", libelle: "Endommagée", statut: "endommagee" },
  { cle: "client_refuse", libelle: "Client a refusé", statut: "retournee" },
  { cle: "client_non_paye", libelle: "Client n'a pas payé", statut: "retournee" },
  { cle: "client_absent", libelle: "Client absent", statut: "retournee" },
  { cle: "autre", libelle: "Autre problème", statut: "retournee" },
];
const DEPART_POSSIBLE = ["confirmee", "en_preparation"];
const TERMINEES = ["livree", "retournee", "endommagee", "annulee_client"];
const EN_COURS = ["nouvelle", "confirmee", "en_preparation", "en_livraison", "en_negociation", "non_joignable"];

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
const vibrer = (ms) => { try { navigator.vibrate?.(ms); } catch { /* non pris en charge */ } };

createApp({
  setup() {
    const livraisons = ref([]);
    const charge = ref(false);
    const prenom = ref("");
    const estAdmin = ref(false);
    const horsLigne = ref(navigator.onLine === false);
    const attente = ref(lireAttente());
    const idChoisi = ref(new URLSearchParams(location.search).get("id"));
    const messageAction = ref("");
    const messageType = ref("info");
    const probleme = ref(null);
    const problemeErreur = ref("");
    const commentaire = ref("");
    const photo = ref(null);
    const saisieCode = ref(null);
    const pushProposable = ref(false);
    const telBokki = ref("");
    const telSecours = ref("");
    const envoi = ref("");
    const positionTexte = ref("");
    const positionErreur = ref("");
    const envoiPosition = ref(false);
    const pointsEnvoyes = ref([]);
    const questionPosee = ref(false);
    const restant = ref(0);
    const camera = ref({ actif: false, debut: 0, envoyes: 0, duree: "00:00", message: "" });
    const sos = ref(null);
    const jaugeSos = ref(0);

    function afficher(texte, type = "info") {
      messageAction.value = texte;
      messageType.value = type;
    }

    // Ordre de travail : ce qui roule d'abord, ce qui est terminé en dernier.
    const rang = (l) => (l.statut === "en_livraison" ? 0 : TERMINEES.includes(l.statut) ? 2 : 1);
    const duJour = computed(() => livraisons.value.filter((l) => !l.corbeille && (!TERMINEES.includes(l.statut) || memeJour(l.statutMajLe))).sort((a, b) => rang(a) - rang(b)));
    const enCours = computed(() => duJour.value.filter((l) => !TERMINEES.includes(l.statut)));
    const choisie = computed(() => duJour.value.find((l) => l.commandeId === idChoisi.value) || enCours.value[0] || null);
    const sousTitre = computed(() => {
      const date = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
      return `${prenom.value ? prenom.value + " · " : ""}${date} · livraisons de 9 h à 12 h et de 17 h à 19 h 30`;
    });

    const enAttente = (id) => attente.value.some((a) => a.commandeId === id);
    const peutPartir = (l) => DEPART_POSSIBLE.includes(l.statut) && !enAttente(l.commandeId);
    const peutLivrer = (l) => l.statut === "en_livraison" && !enAttente(l.commandeId);
    const lienBokki = computed(() => (telBokki.value ? `tel:${telBokki.value.replace(/\s+/g, "")}` : ""));

    function choisir(l) {
      idChoisi.value = l.commandeId;
      saisieCode.value = null;
      history.replaceState(null, "", `?id=${l.commandeId}`);
      // Téléphone : le détail est sous la liste, on l'amène sous le pouce (sans animation).
      if (matchMedia("(max-width:900px)").matches) nextTick(() => document.querySelector(".lm-detail")?.scrollIntoView({ block: "start" }));
    }

    const appels = { statut: changerStatutCommande, code: validerCodeLivraison };
    let envoiEnCours = null;
    async function viderFile() {
      while (attente.value.length) {
        if (navigator.onLine === false) return;
        const { genre = "statut", numero, ...action } = attente.value[0];
        try {
          await appels[genre](action);
          vibrer(15);
          afficher(`Commande ${numero || ""} : enregistrée.`.replace("  ", " "), "ok");
        } catch (err) {
          if (coupureReseau(err)) {
            afficher("Pas de réseau : l'action est gardée et partira au retour du réseau.");
            return;
          }
          afficher(`Commande ${numero || ""} : ${err.message || "action refusée."}`, "erreur");
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
    async function agir(livraison, genre, details) {
      const action = { genre, commandeId: livraison.commandeId, numero: livraison.numero, idAction: nouvelIdAction(), ...details };
      noterPosition(livraison.commandeId, "statut");
      attente.value = [...attente.value, action];
      const garde = ecrireAttente(attente.value);
      if (!garde && details.photo) {
        attente.value = attente.value.filter((a) => a.idAction !== action.idAction);
        afficher("Reconnectez-vous au réseau pour envoyer cette photo.", "erreur");
        return;
      }
      if (navigator.onLine === false) afficher("Pas de réseau : l'action est gardée et partira au retour du réseau.");
      else afficher("");
      envoi.value = livraison.commandeId;
      await envoyerFile();
      envoi.value = "";
    }
    const lancer = (l) => agir(l, "statut", { statut: "en_livraison" });

    // Position : un appui = un point daté. Les boutons de statut en posent un aussi.
    let dernierLieu = null;
    let gesteLocal = 0;
    let dernierAuto = 0;
    let ecran = null;
    const cleJour = () => new Date().toISOString().slice(0, 10);
    const CLE_POINTS = "bokki-points-envoyes";
    function lirePoints() {
      try {
        const memo = JSON.parse(localStorage.getItem(CLE_POINTS) || "null");
        return memo?.jour === cleJour() ? memo.dates : [];
      } catch {
        return [];
      }
    }
    pointsEnvoyes.value = lirePoints();
    function ajouterPoint(p) {
      pointsEnvoyes.value = [...pointsEnvoyes.value, p.date];
      try { localStorage.setItem(CLE_POINTS, JSON.stringify({ jour: cleJour(), dates: pointsEnvoyes.value })); } catch { /* stockage indisponible */ }
    }
    const enRoute = computed(() => enCours.value.filter((l) => l.statut === "en_livraison"));
    const commandeEnRoute = () => (choisie.value?.statut === "en_livraison" ? choisie.value : enRoute.value[0])?.commandeId || null;
    const ms = (t) => t?.toMillis?.() || 0;
    const dernierGeste = () => Math.max(gesteLocal, ...enRoute.value.flatMap((l) => [ms(l.lanceeLe), ms(l.dernierGeste)]));
    async function envoyerPosition() {
      positionErreur.value = "";
      const commande = commandeEnRoute();
      if (!dansLesHeures() && !commande) {
        positionErreur.value = "Avant 8 h et après 19 h 30, la position s'envoie seulement pendant une livraison en cours.";
        return;
      }
      envoiPosition.value = true;
      const point = await noterPosition(commande, "suivi");
      envoiPosition.value = false;
      if (!point) {
        positionErreur.value = "Position indisponible. Autorisez la localisation, puis réessayez.";
        return;
      }
      dernierLieu = point;
      gesteLocal = point.date;
      questionPosee.value = false;
      ajouterPoint(point);
      positionTexte.value = `Position envoyée à ${heure(new Date(point.date))}`;
      vibrer(15);
      controleSecurite();
    }
    async function toutVaBien() {
      gesteLocal = Date.now();
      questionPosee.value = false;
      positionErreur.value = "";
      positionTexte.value = `Merci, c'est noté à ${heure(new Date())}`;
      vibrer(15);
      controleSecurite();
      const point = await noterPosition(commandeEnRoute(), "ok");
      if (point?.lat != null) dernierLieu = point;
    }
    function signalerQuestion() {
      vibrer([200, 100, 200]);
      try {
        const son = new AudioContext();
        const note = son.createOscillator();
        note.connect(son.destination);
        note.start();
        note.stop(son.currentTime + 0.4);
      } catch { /* son indisponible */ }
    }
    async function garderEcran() {
      if (!ecran || ecran.released) ecran = await navigator.wakeLock?.request("screen").catch(() => null);
    }
    // Sans geste depuis une heure, la page envoie la position et pose la question.
    // Le serveur prévient les admins si rien n'arrive. Page ouverte seulement.
    function controleSecurite() {
      if (!enRoute.value.length) {
        questionPosee.value = false;
        restant.value = 0;
        ecran?.release?.().catch(() => undefined);
        ecran = null;
        return;
      }
      garderEcran();
      const now = Date.now();
      const geste = dernierGeste();
      const prochain = Math.max(geste, dernierAuto) + SILENCE_MS;
      restant.value = Math.max(1, Math.ceil((prochain - now) / 60000));
      const auto = () => {
        noterPosition(commandeEnRoute(), "auto").then((p) => { if (p) dernierLieu = p; });
      };
      if (now >= prochain) {
        dernierAuto = now;
        auto();
        if (!questionPosee.value) signalerQuestion();
        questionPosee.value = true;
      } else if (!document.hidden) {
        // 12 h et 19 h 30 : un point en plus, une seule fois par créneau.
        const minutes = new Date(now).getUTCHours() * 60 + new Date(now).getUTCMinutes();
        const creneau = [720, 1170].find((m) => minutes >= m && minutes < m + 15);
        if (creneau) {
          const cle = `bokki-creneau-${cleJour()}-${creneau}`;
          let fait = true;
          try { fait = !!localStorage.getItem(cle); if (!fait) localStorage.setItem(cle, "1"); } catch { /* stockage indisponible */ }
          if (!fait) auto();
        }
      }
    }

    // Caméra.
    let minuteur = null;
    const enregistreur = new Enregistreur({
      surChangement: (raison) => {
        camera.value = { ...camera.value, actif: enregistreur.actif, envoyes: enregistreur.envoyes, message: raison || camera.value.message };
        if (!enregistreur.actif) clearInterval(minuteur);
      },
    });
    if (["localhost", "127.0.0.1"].includes(location.hostname)) window.__enregistreur = enregistreur;
    async function basculerCamera(l) {
      if (enregistreur.actif) {
        await enregistreur.arreter();
        return;
      }
      camera.value = { actif: false, debut: 0, envoyes: 0, duree: "00:00", message: "" };
      try {
        await enregistreur.demarrer(l.commandeId);
        const debut = Date.now();
        minuteur = setInterval(() => {
          const s = Math.floor((Date.now() - debut) / 1000);
          camera.value = { ...camera.value, duree: `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` };
        }, 1000);
        vibrer(15);
      } catch (err) {
        console.error(err);
        camera.value = { ...camera.value, message: "Caméra indisponible. Autorisez la caméra, puis réessayez." };
      }
    }

    // SOS : appui long, envoi répété tant que le serveur n'a pas répondu, puis
    // une position toutes les 30 s tant que l'alerte est active.
    let chronoSos = null;
    let departSos = 0;
    let boucleSos = null;
    let essaiSos = null;
    let finSuiviSos = null;
    function appuiSos(action) {
      if (chronoSos) return;
      departSos = Date.now();
      chronoSos = setInterval(() => {
        jaugeSos.value = Math.min(1, (Date.now() - departSos) / APPUI_LONG_MS);
        if (jaugeSos.value >= 1) {
          relacheSos();
          action();
        }
      }, 40);
    }
    function relacheSos() {
      clearInterval(chronoSos);
      chronoSos = null;
      jaugeSos.value = 0;
    }
    function memoriserSos() {
      try { localStorage.setItem(CLE_SOS, JSON.stringify(sos.value)); } catch { /* stockage indisponible */ }
    }
    async function envoyerSos() {
      const alerte = sos.value;
      if (!alerte) return;
      try {
        if (!alerte.envoyee) {
          const { data } = await declencherSos({ id: alerte.id, commandeId: alerte.commandeId });
          sos.value = { ...sos.value, envoyee: true, alerteId: data.alerteId, echec: false };
          memoriserSos();
          vibrer([200, 100, 200]);
        }
        // Clôturée par un admin : fin de l'envoi des positions.
        finSuiviSos?.();
        finSuiviSos = onSnapshot(doc(db, "alertes", sos.value.alerteId), (snap) => {
          if (["cloturee", "annulee"].includes(snap.data()?.etat)) terminerSos();
        }, () => undefined);
        noterPosition(sos.value.commandeId, "sos", sos.value.alerteId);
        clearTimeout(essaiSos);
        clearInterval(boucleSos);
        boucleSos = setInterval(() => noterPosition(sos.value?.commandeId, "sos", sos.value?.alerteId), SOS_POSITION_MS);
      } catch (err) {
        console.error(err);
        sos.value = { ...sos.value, echec: true };
        essaiSos = setTimeout(envoyerSos, 5000);
      }
    }
    function lancerSos() {
      vibrer(100);
      if (sos.value) {
        sos.value = { ...sos.value, masque: false };
        memoriserSos();
        return;
      }
      sos.value = { id: nouvelIdAction(), commandeId: choisie.value?.commandeId || null, envoyee: false, echec: false };
      memoriserSos();
      envoyerSos();
    }
    function terminerSos() {
      finSuiviSos?.();
      finSuiviSos = null;
      clearInterval(boucleSos);
      clearTimeout(essaiSos);
      sos.value = null;
      try { localStorage.removeItem(CLE_SOS); } catch { /* stockage indisponible */ }
    }
    // Le signal est déjà parti : « Annuler » ramène seulement dans l'application.
    // L'alerte reste active et la position continue jusqu'à la clôture par un admin.
    function quitterSos() {
      sos.value = { ...sos.value, masque: true };
      memoriserSos();
    }

    function ouvrirCode(l) {
      saisieCode.value = { valeur: "", erreur: "", envoi: false, longueur: l.codeLongueur || 4 };
    }
    async function validerCode(l) {
      const saisie = saisieCode.value;
      const code = saisie.valeur.trim();
      saisie.erreur = "";
      if (code.length !== saisie.longueur) {
        saisie.erreur = `Saisissez les ${saisie.longueur} chiffres du code.`;
        return;
      }
      if (navigator.onLine === false) {
        saisieCode.value = null;
        await agir(l, "code", { code });
        return;
      }
      saisie.envoi = true;
      try {
        await validerCodeLivraison({ commandeId: l.commandeId, code, idAction: nouvelIdAction(), position: dernierLieu });
        noterPosition(l.commandeId, "statut");
        vibrer(30);
        saisieCode.value = null;
        afficher(`Commande ${l.numero} livrée.`, "ok");
      } catch (err) {
        if (coupureReseau(err)) {
          saisieCode.value = null;
          await agir(l, "code", { code });
          return;
        }
        vibrer([40, 40, 40]);
        saisie.valeur = "";
        const reste = err.details?.essaisRestants;
        saisie.erreur = err.details?.bloque ? "" : `${err.message}${reste != null ? ` Il reste ${reste} essai${reste > 1 ? "s" : ""}.` : ""}`;
      } finally {
        saisie.envoi = false;
      }
    }

    function ouvrirProbleme(l, p) {
      commentaire.value = "";
      photo.value = null;
      problemeErreur.value = "";
      probleme.value = { livraison: l, ...p };
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
      const { statut, cle, livraison } = probleme.value;
      const texte = commentaire.value.trim();
      problemeErreur.value = "";
      if (cle === "autre" && !texte) problemeErreur.value = "Décrivez le problème.";
      else if (cle === "endommagee" && !photo.value) problemeErreur.value = "Ajoutez une photo.";
      else if (cle === "endommagee" && !texte) problemeErreur.value = "Ajoutez un commentaire.";
      if (problemeErreur.value) return;
      const details = { statut };
      if (statut === "retournee") details.raison = cle;
      if (texte) details.commentaire = texte;
      if (photo.value) details.photo = photo.value;
      probleme.value = null;
      agir(livraison, "statut", details);
    }

    const journee = ref(null);
    async function terminerMaJournee() {
      if (!confirm("Terminer votre journée ?")) return;
      try {
        journee.value = (await terminerJournee()).data;
      } catch (err) {
        console.error(err);
        afficher(err.message || "Impossible pour le moment, réessayez.", "erreur");
      }
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

    function ecouter(ids) {
      // L'écran ne montre que ce qui reste à faire et ce qui a changé aujourd'hui
      // (duJour) : deux requêtes précises au lieu des 100 dernières livraisons.
      const miennes = where("livreurId", ids.length > 1 ? "in" : "==", ids.length > 1 ? ids : ids[0]);
      const debutJour = new Date();
      debutJour.setHours(0, 0, 0, 0);
      const parts = { enCours: null, duJour: null };
      const suivre = (cle, q) => onSnapshot(q, (snap) => {
        parts[cle] = snap.docs.map((d) => d.data());
        if (!parts.enCours || !parts.duJour) return;
        livraisons.value = [...new Map([...parts.duJour, ...parts.enCours].map((l) => [l.commandeId, l])).values()]
          .sort((a, b) => (b.attribueeLe?.toMillis?.() || 0) - (a.attribueeLe?.toMillis?.() || 0));
        charge.value = true;
      }, (err) => {
        console.error(err);
        charge.value = true;
        afficher("Impossible de charger vos livraisons. Rechargez la page.", "erreur");
      });
      suivre("enCours", query(collection(db, "livraisons"), miennes, where("statut", "in", EN_COURS)));
      suivre("duJour", query(collection(db, "livraisons"), miennes, where("statutMajLe", ">=", Timestamp.fromDate(debutJour))));
    }

    onMounted(() => {
      addEventListener("online", () => { horsLigne.value = false; envoyerFile(); reprendreEnvois(); });
      addEventListener("offline", () => { horsLigne.value = true; });
      setInterval(() => { if (attente.value.length) envoyerFile(); }, 20000);
      setInterval(controleSecurite, 20000);
      document.addEventListener("visibilitychange", controleSecurite);
      const stop = onAuthStateChanged(auth, async (user) => {
        if (!user) return;
        stop();
        const [compte, admin, equipe, boutique] = await Promise.all([
          getDoc(doc(db, "comptesLivreurs", user.uid)).catch(() => null),
          getDoc(doc(db, "parametres", "livraison")).then(() => true).catch(() => false),
          getDoc(doc(db, "parametres", "equipe")).catch(() => null),
          getDoc(doc(db, "parametres", "boutique")).catch(() => null),
        ]);
        estAdmin.value = admin;
        telBokki.value = equipe?.data()?.telBokki || boutique?.data()?.telephone || "";
        telSecours.value = equipe?.data()?.telSecours || "";
        reprendreEnvois();
        try {
          const enCoursSos = JSON.parse(localStorage.getItem(CLE_SOS) || "null");
          if (enCoursSos) { sos.value = enCoursSos; envoyerSos(); }
        } catch { /* stockage indisponible */ }
        const lieId = compte?.exists() ? compte.data().livreurId : null;
        const ids = [...(admin ? [`admin_${user.uid}`] : []), ...(lieId ? [lieId] : [])];
        prenom.value = compte?.data()?.prenom || "";
        if (!ids.length) { charge.value = true; return; }
        ecouter(ids);
        pushProposable.value = !admin && pushDisponible() && !localStorage.getItem("bokki-livreur-push");
        envoyerFile();
      });
    });

    const lienSecours = computed(() => (telSecours.value ? `tel:${telSecours.value.replace(/\s+/g, "")}` : ""));
    const sosVisible = computed(() => enCours.value.some((l) => l.statut === "en_livraison"));
    const CIRCONFERENCE = 2 * Math.PI * 34;

    watch(enRoute, controleSecurite);
    watch(choisie, (l) => { if (saisieCode.value && l?.statut !== "en_livraison") saisieCode.value = null; });

    return {
      PROBLEMES, fmt, heure, duJour, enCours, charge, choisie, sousTitre, horsLigne, estAdmin, attente, envoi,
      messageAction, messageType, probleme, problemeErreur, commentaire, photo, saisieCode, pushProposable, lienBokki,
      infoStatut, libelleRaison, enAttente, peutPartir, peutLivrer, choisir, lancer, ouvrirCode, validerCode,
      ouvrirProbleme, choisirPhoto, validerProbleme, activerNotifications, journee, terminerMaJournee,
      positionTexte, positionErreur, envoiPosition, pointsEnvoyes, questionPosee, restant, enRoute, envoyerPosition, toutVaBien, camera, basculerCamera,
      sos, jaugeSos, sosVisible, lienSecours, CIRCONFERENCE, appuiSos, relacheSos, lancerSos, quitterSos,
    };
  },
}).mount("#mesLivraisonsApp");
