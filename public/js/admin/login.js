import { createApp, ref } from "https://unpkg.com/vue@3/dist/vue.esm-browser.js";
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
        await setPersistence(
          auth,
          remember.value ? browserLocalPersistence : browserSessionPersistence
        );
        await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
        window.location.href = "dashboard.html";
      } catch (err) {
        messageType.value = "error";
        message.value = AUTH_ERROR_MESSAGES[err.code] || "Connexion impossible, réessaie.";
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
        await sendPasswordResetEmail(auth, trimmed);
        messageType.value = "success";
        message.value = "Email de réinitialisation envoyé à " + trimmed + ".";
      } catch (err) {
        messageType.value = "error";
        message.value = AUTH_ERROR_MESSAGES[err.code] || "Impossible d'envoyer l'email de réinitialisation.";
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
