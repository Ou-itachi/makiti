import { createApp, ref, watch } from "/vendor/vue-3.5.42.esm-browser.prod.js";
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

// parametres/parrainage : lu par creerCommande (réduction du filleul) et
// suiviParrainageCommande (récompense du parrain) à chaque usage. Mêmes
// valeurs par défaut et mêmes bornes que côté serveur (functions/src/index.ts,
// PARRAINAGE_DEFAUT) : pourcentage entre 0 et 50, plafond ≥ 0, filleuls
// récompensés par mois entre 0 (sans limite) et 1000.
const PARRAINAGE_DEFAUT = { actif: true, pourcentFilleul: 5, pourcentParrain: 5, plafondFilleul: 100000, plafondParrain: 100000, maxFilleulsParMois: 10 };
createApp({
  setup() {
    const form = ref({ ...PARRAINAGE_DEFAUT });
    const erreur = ref("");
    const message = ref("");
    const saving = ref(false);
    let modifie = false;

    onSnapshot(
      doc(db, "parametres", "parrainage"),
      (snap) => {
        if (modifie) return; // ne pas écraser une saisie en cours
        const d = snap.data() || {};
        form.value = {
          actif: d.actif === undefined ? PARRAINAGE_DEFAUT.actif : d.actif === true,
          pourcentFilleul: d.pourcentFilleul ?? PARRAINAGE_DEFAUT.pourcentFilleul,
          pourcentParrain: d.pourcentParrain ?? PARRAINAGE_DEFAUT.pourcentParrain,
          plafondFilleul: d.plafondFilleul ?? PARRAINAGE_DEFAUT.plafondFilleul,
          plafondParrain: d.plafondParrain ?? PARRAINAGE_DEFAUT.plafondParrain,
          maxFilleulsParMois: d.maxFilleulsParMois ?? PARRAINAGE_DEFAUT.maxFilleulsParMois,
        };
        modifie = false; // le watch (synchrone) vient de réagir à cette affectation
        if (!snap.exists()) message.value = "Valeurs par défaut (pas encore enregistrées).";
      },
      (err) => {
        console.error(err);
        erreur.value = "Impossible de charger le réglage : " + (err.message || err.code);
      }
    );

    function exemple(pc, plafond) {
      const brut = Math.floor((2000000 * (Number(pc) || 0)) / 100 / 100) * 100;
      return Math.max(0, Math.min(brut, Number(plafond) || 0)).toLocaleString("fr-FR").replace(/[\u202f\u00a0,]/g, " ");
    }

    async function enregistrer() {
      erreur.value = "";
      message.value = "";
      const f = form.value;
      const pcOk = (v) => Number.isFinite(v) && v >= 0 && v <= 50;
      const plOk = (v) => Number.isInteger(v) && v >= 0;
      if (!pcOk(f.pourcentFilleul) || !pcOk(f.pourcentParrain)) {
        erreur.value = "Les pourcentages doivent être compris entre 0 et 50.";
        return;
      }
      if (!plOk(f.plafondFilleul) || !plOk(f.plafondParrain)) {
        erreur.value = "Les plafonds doivent être des montants entiers positifs (ou 0).";
        return;
      }
      if (!Number.isInteger(f.maxFilleulsParMois) || f.maxFilleulsParMois < 0 || f.maxFilleulsParMois > 1000) {
        erreur.value = "Le nombre de filleuls récompensés par mois doit être un entier entre 0 et 1000.";
        return;
      }
      saving.value = true;
      try {
        await setDoc(doc(db, "parametres", "parrainage"), {
          actif: !!f.actif,
          pourcentFilleul: f.pourcentFilleul,
          pourcentParrain: f.pourcentParrain,
          plafondFilleul: f.plafondFilleul,
          plafondParrain: f.plafondParrain,
          maxFilleulsParMois: f.maxFilleulsParMois,
        });
        modifie = false;
        message.value = "Enregistré.";
      } catch (err) {
        console.error(err);
        erreur.value = "Erreur lors de l'enregistrement : " + (err.message || err.code || "réessaie.");
      } finally {
        saving.value = false;
      }
    }

    // Toute saisie suspend la mise à jour en direct jusqu'à l'enregistrement.
    watch(form, () => { modifie = true; }, { deep: true, flush: "sync" });

    return { form, erreur, message, saving, exemple, enregistrer };
  },
}).mount("#parrainageApp");

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
