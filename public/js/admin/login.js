import { createApp, ref } from "/vendor/vue-3.5.42.esm-browser.prod.js";
import { auth, db, functions } from "../firebase-config.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { collection, doc, getCountFromServer, getDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";

const terminerPremiereConnexion = httpsCallable(functions, "terminerPremiereConnexion");

// Seul "produits" est lisible sans authentification (règles Firestore) — les
// stats commandes/fournisseurs ne peuvent pas être affichées honnêtement sur
// cet écran public sans affaiblir les règles qui protègent ces données.
getCountFromServer(collection(db, "produits"))
  .then((snap) => {
    document.getElementById("bpStatProduits").textContent = snap.data().count;
  })
  .catch((err) => {
    console.error(err);
    document.getElementById("bpStatProduits").textContent = "—";
  });

const AUTH_ERROR_MESSAGES = {
  "auth/invalid-email": "Adresse email invalide.",
  "auth/invalid-credential": "Identifiant ou mot de passe incorrect.",
  "auth/user-not-found": "Identifiant ou mot de passe incorrect.",
  "auth/wrong-password": "Identifiant ou mot de passe incorrect.",
  "auth/too-many-requests": "Trop de tentatives, réessaie dans quelques minutes.",
  "auth/network-request-failed": "Problème de connexion réseau.",
};

// Certains navigateurs intégrés (WhatsApp, Messenger, Instagram…) limitent le
// stockage dont Firebase Auth a besoin pour se connecter : la promesse de
// connexion ne se termine alors jamais, ni en succès ni en erreur — le
// bouton reste bloqué sur "Connexion..." indéfiniment, sans aucun message.
// On borne donc l'attente pour toujours donner un retour à l'utilisateur.
const DELAI_MAX_CONNEXION_MS = 12000;
function avecDelaiMax(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject({ code: "timeout" }), ms)),
  ]);
}

createApp({
  setup() {
    const email = ref("");
    const password = ref("");
    // Rester connecté par défaut : l'admin est un outil privé, sur le
    // téléphone/ordi de l'équipe. Se faire déconnecter à chaque fermeture
    // de l'app coupe aussi les notifications « nouvelle commande » et oblige
    // à retaper le mot de passe sans arrêt. Décochable pour un poste partagé.
    const remember = ref(true);
    const showPassword = ref(false);
    const loading = ref(false);
    const message = ref("");
    const messageType = ref("error");
    const parametres = new URLSearchParams(location.search);
    const ecran = ref("choix");
    const espace = ref(parametres.get("espace") === "livreur" ? "livreur" : "admin");
    const besoinMotDePasse = ref(false);
    const nouveauMdp = ref("");
    const nouveauMdp2 = ref("");
    const accepte = ref(false);
    if (parametres.get("desactive")) message.value = "Ce compte est désactivé. Contactez Bokki.";

    function choisirEspace(choix) {
      espace.value = choix;
      message.value = "";
      ecran.value = "form";
    }

    // Où aller une fois connecté. Un compte livreur passe d'abord par sa
    // première connexion ; un admin garde son chemin habituel.
    async function apresConnexion() {
      const user = auth.currentUser;
      const [estAdmin, compte] = await Promise.all([
        getDoc(doc(db, "parametres", "livraison")).then(() => true).catch(() => false),
        getDoc(doc(db, "comptesLivreurs", user.uid)).catch(() => null),
      ]);
      if (estAdmin) {
        window.location.href = espace.value === "livreur" ? "ma-livraison.html" : "dashboard.html";
        return;
      }
      const fiche = compte?.exists() ? compte.data() : null;
      if (!fiche || fiche.actif === false) {
        await signOut(auth).catch(() => {});
        ecran.value = "choix";
        messageType.value = "error";
        message.value = fiche ? "Ce compte est désactivé. Contactez Bokki." : "Ce compte n'a pas accès à l'espace Bokki.";
        loading.value = false;
        return;
      }
      if (fiche.doitChangerMdp === true || fiche.infoAcceptee !== true) {
        besoinMotDePasse.value = fiche.doitChangerMdp === true;
        ecran.value = "premiere";
        loading.value = false;
        return;
      }
      window.location.href = "tableau-livreur.html";
    }

    async function terminerPremiere() {
      message.value = "";
      messageType.value = "error";
      if (besoinMotDePasse.value && nouveauMdp.value !== nouveauMdp2.value) {
        message.value = "Les deux mots de passe sont différents.";
        return;
      }
      loading.value = true;
      try {
        const adresse = auth.currentUser.email;
        await terminerPremiereConnexion({ motDePasse: nouveauMdp.value, accepte: accepte.value });
        // Le changement de mot de passe ferme la session : on la rouvre.
        if (besoinMotDePasse.value) await signInWithEmailAndPassword(auth, adresse, nouveauMdp.value);
        window.location.href = "tableau-livreur.html";
      } catch (err) {
        console.error(err);
        message.value = err.message || "Enregistrement impossible, réessayez.";
        loading.value = false;
      }
    }

    // Renvoyé ici par auth-guard : déjà connecté, première connexion à finir.
    if (parametres.get("premiere")) {
      const stop = onAuthStateChanged(auth, (user) => {
        stop();
        if (user) apresConnexion();
      });
    }

    async function handleSubmit() {
      message.value = "";
      loading.value = true;
      try {
        // Appli installée sur l'écran d'accueil (mode standalone) : on force
        // la persistance locale quel que soit le réglage — une appli qui
        // déconnecte à chaque fermeture n'a pas de sens, et les
        // notifications push en dépendent.
        const estAppInstallee =
          window.matchMedia("(display-mode: standalone)").matches ||
          window.navigator.standalone === true;
        const persistance =
          remember.value || estAppInstallee ? browserLocalPersistence : browserSessionPersistence;
        await avecDelaiMax(setPersistence(auth, persistance), DELAI_MAX_CONNEXION_MS);
        await avecDelaiMax(
          signInWithEmailAndPassword(auth, email.value.trim(), password.value),
          DELAI_MAX_CONNEXION_MS
        );
        await apresConnexion();
      } catch (err) {
        messageType.value = "error";
        message.value =
          err.code === "timeout"
            ? "La connexion prend trop de temps. Si tu as ouvert ce lien depuis WhatsApp ou Messenger, ouvre-le plutôt dans Safari ou Chrome (appuie sur ⋯ ou␠⤴ en haut, puis « Ouvrir dans le navigateur »), puis réessaie."
            : AUTH_ERROR_MESSAGES[err.code] || "Connexion impossible, réessaie.";
        loading.value = false;
      }
    }

    async function handleForgotPassword() {
      message.value = "";
      const trimmed = email.value.trim();
      if (!trimmed) {
        messageType.value = "error";
        message.value = "Renseigne d'abord ton email ci-dessus pour recevoir le lien de réinitialisation.";
        return;
      }
      try {
        await avecDelaiMax(sendPasswordResetEmail(auth, trimmed), DELAI_MAX_CONNEXION_MS);
        messageType.value = "success";
        message.value = "Email de réinitialisation envoyé à " + trimmed + ".";
      } catch (err) {
        messageType.value = "error";
        message.value =
          err.code === "timeout"
            ? "Ça prend trop de temps. Si tu es dans WhatsApp/Messenger, ouvre cette page dans Safari ou Chrome, puis réessaie."
            : AUTH_ERROR_MESSAGES[err.code] || "Impossible d'envoyer l'email de réinitialisation.";
      }
    }

    return {
      email,
      password,
      remember,
      showPassword,
      loading,
      message,
      messageType,
      ecran,
      espace,
      besoinMotDePasse,
      nouveauMdp,
      nouveauMdp2,
      accepte,
      choisirEspace,
      terminerPremiere,
      handleSubmit,
      handleForgotPassword,
    };
  },
}).mount("#loginApp");
