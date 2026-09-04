import { createApp, ref } from "https://unpkg.com/vue@3.5.42/dist/vue.esm-browser.prod.js";
import { auth, db } from "../firebase-config.js";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { collection, getCountFromServer } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

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
    const remember = ref(false);
    const showPassword = ref(false);
    const loading = ref(false);
    const message = ref("");
    const messageType = ref("error");

    async function handleSubmit() {
      message.value = "";
      loading.value = true;
      try {
        await avecDelaiMax(
          setPersistence(auth, remember.value ? browserLocalPersistence : browserSessionPersistence),
          DELAI_MAX_CONNEXION_MS
        );
        await avecDelaiMax(
          signInWithEmailAndPassword(auth, email.value.trim(), password.value),
          DELAI_MAX_CONNEXION_MS
        );
        window.location.href = "dashboard.html";
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
      handleSubmit,
      handleForgotPassword,
    };
  },
}).mount("#loginApp");
