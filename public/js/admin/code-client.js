// Paramètres > Code de livraison > « Code personnel d'un client » :
// remplace le code à 4 chiffres d'un compte client par un code provisoire
// tiré au hasard (fonction reinitialiserCodeClient, réservée aux admins).
// L'agent le donne au client en l'appelant sur ce numéro.
import { functions } from "../firebase-config.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";

const reinitialiser = httpsCallable(functions, "reinitialiserCodeClient");
const form = document.getElementById("resetCodeForm");
const tel = document.getElementById("resetCodeTel");
const msg = document.getElementById("resetCodeMsg");
const btn = document.getElementById("resetCodeBtn");

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const numero = tel.value.trim();
  if (!numero) { msg.textContent = "Entrez le téléphone du client."; return; }
  if (!confirm(`Réinitialiser le code personnel du ${numero} ?`)) return;
  btn.disabled = true;
  msg.textContent = "Réinitialisation…";
  try {
    const { data } = await reinitialiser({ telephone: numero });
    msg.textContent = `Nouveau code provisoire pour ${data.telephone} : ${data.code}. Appelez le client sur ce numéro pour le lui donner (jamais par SMS ou WhatsApp à un autre numéro).`;
    tel.value = "";
  } catch (err) {
    msg.textContent = err?.message || "Réinitialisation impossible.";
  } finally {
    btn.disabled = false;
  }
});
