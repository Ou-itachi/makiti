import { auth } from "../firebase-config.js";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

const form = document.getElementById("loginForm");
const emailInput = document.getElementById("fid");
const pwdInput = document.getElementById("fpwd");
const rememberInput = document.getElementById("fremember");
const errorBox = document.getElementById("loginError");
const submitBtn = form.querySelector(".login-btn");
const submitLabel = submitBtn.querySelector(".btn-label");
const toggleBtn = document.querySelector(".toggle-pass");
const forgotLink = document.getElementById("forgotLink");

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function hideError() {
  errorBox.hidden = true;
}

const AUTH_ERROR_MESSAGES = {
  "auth/invalid-email": "Adresse email invalide.",
  "auth/invalid-credential": "Identifiant ou mot de passe incorrect.",
  "auth/user-not-found": "Identifiant ou mot de passe incorrect.",
  "auth/wrong-password": "Identifiant ou mot de passe incorrect.",
  "auth/too-many-requests": "Trop de tentatives, réessaie dans quelques minutes.",
  "auth/network-request-failed": "Problème de connexion réseau.",
};

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError();

  const email = emailInput.value.trim();
  const password = pwdInput.value;

  submitBtn.disabled = true;
  submitLabel.textContent = "Connexion...";

  try {
    await setPersistence(
      auth,
      rememberInput.checked ? browserLocalPersistence : browserSessionPersistence
    );
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = "dashboard.html";
  } catch (err) {
    showError(AUTH_ERROR_MESSAGES[err.code] || "Connexion impossible, réessaie.");
    submitBtn.disabled = false;
    submitLabel.textContent = "Se connecter";
  }
});

toggleBtn.addEventListener("click", () => {
  const isPwd = pwdInput.type === "password";
  pwdInput.type = isPwd ? "text" : "password";
  toggleBtn.setAttribute("aria-label", isPwd ? "Masquer le mot de passe" : "Afficher le mot de passe");
});

forgotLink.addEventListener("click", async (e) => {
  e.preventDefault();
  hideError();
  const email = emailInput.value.trim();
  if (!email) {
    showError("Renseigne d'abord ton email ci-dessus pour recevoir le lien de réinitialisation.");
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    errorBox.style.color = "var(--palme)";
    showError("Email de réinitialisation envoyé à " + email + ".");
  } catch (err) {
    showError(AUTH_ERROR_MESSAGES[err.code] || "Impossible d'envoyer l'email de réinitialisation.");
  }
});
