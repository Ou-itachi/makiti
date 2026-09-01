import { createApp, ref } from "https://unpkg.com/vue@3.5.42/dist/vue.esm-browser.prod.js";
import { db, auth } from "../firebase-config.js";
import { doc, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import {
  onAuthStateChanged,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

// parametres/livraison.longueurCode : lu par creerCommande (Cloud Function)
// à chaque génération de code de livraison — jamais mis en cache côté
// serveur, donc un changement ici s'applique dès la prochaine commande.
createApp({
  setup() {
    const longueurCode = ref(4);
    const codeError = ref("");

    onSnapshot(
      doc(db, "parametres", "livraison"),
      (snap) => {
        const valeur = snap.data()?.longueurCode;
        longueurCode.value = valeur === 6 ? 6 : 4;
      },
      (err) => {
        console.error(err);
        codeError.value = "Impossible de charger le réglage : " + (err.message || err.code);
      }
    );

    async function setLongueurCode(valeur) {
      codeError.value = "";
      try {
        await setDoc(doc(db, "parametres", "livraison"), { longueurCode: valeur }, { merge: true });
      } catch (err) {
        console.error(err);
        codeError.value = "Erreur lors de l'enregistrement : " + (err.message || err.code || "réessaie.");
      }
    }

    return { longueurCode, codeError, setLongueurCode };
  },
}).mount("#codeApp");

const ACCOUNT_ERROR_MESSAGES = {
  "auth/wrong-password": "Mot de passe actuel incorrect.",
  "auth/invalid-credential": "Mot de passe actuel incorrect.",
  "auth/weak-password": "Le nouveau mot de passe est trop faible (6 caractères minimum).",
  "auth/requires-recent-login": "Session trop ancienne, reconnecte-toi puis réessaie.",
  "auth/too-many-requests": "Trop de tentatives, réessaie dans quelques minutes.",
  "auth/network-request-failed": "Problème de connexion réseau.",
};

// Changement de mot de passe de l'admin connecté (Firebase Auth). Une
// réauthentification (mot de passe actuel) est obligatoire juste avant :
// updatePassword() échoue avec auth/requires-recent-login si la session a
// plus de quelques minutes, ce qui est le cas courant pour un admin resté
// connecté — d'où le champ "Mot de passe actuel" en plus des deux du nouveau.
createApp({
  setup() {
    const email = ref("");
    const currentPassword = ref("");
    const newPassword = ref("");
    const confirmPassword = ref("");
    const accountError = ref("");
    const accountSuccess = ref("");
    const accountSaving = ref(false);

    onAuthStateChanged(auth, (user) => {
      email.value = user?.email || "";
    });

    async function changePassword() {
      accountError.value = "";
      accountSuccess.value = "";

      if (!currentPassword.value) {
        accountError.value = "Renseigne ton mot de passe actuel.";
        return;
      }
      if (newPassword.value.length < 6) {
        accountError.value = "Le nouveau mot de passe doit contenir au moins 6 caractères.";
        return;
      }
      if (newPassword.value !== confirmPassword.value) {
        accountError.value = "Les deux mots de passe ne correspondent pas.";
        return;
      }
      const user = auth.currentUser;
      if (!user) {
        accountError.value = "Session expirée, reconnecte-toi.";
        return;
      }

      accountSaving.value = true;
      try {
        const credential = EmailAuthProvider.credential(user.email, currentPassword.value);
        await reauthenticateWithCredential(user, credential);
        await updatePassword(user, newPassword.value);
        accountSuccess.value = "Mot de passe modifié avec succès.";
        currentPassword.value = "";
        newPassword.value = "";
        confirmPassword.value = "";
      } catch (err) {
        console.error(err);
        accountError.value = ACCOUNT_ERROR_MESSAGES[err.code] || "Erreur : " + (err.message || err.code || "réessaie.");
      } finally {
        accountSaving.value = false;
      }
    }

    return {
      email,
      currentPassword,
      newPassword,
      confirmPassword,
      accountError,
      accountSuccess,
      accountSaving,
      changePassword,
    };
  },
}).mount("#accountApp");
