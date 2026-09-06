// Interrupteur « Notifications push sur cet appareil » (Paramètres >
// Notifications). Enregistre / retire le jeton FCM immédiatement au clic
// (pas de bouton Enregistrer — c'est une action par appareil, pas un réglage
// partagé). Voir admin-push.js pour la mécanique.
import {
  pushDisponible,
  pushEtat,
  activerPush,
  desactiverPush,
  rafraichirPushSilencieux,
} from "./admin-push.js";

window.addEventListener("load", () => {
  const row = document.getElementById("pushAdminRow");
  const toggle = document.getElementById("pushAdminToggle");
  const hint = document.getElementById("pushAdminHint");
  if (!row || !toggle || !hint) return;

  const hintParDefaut = hint.textContent;

  if (!pushDisponible()) {
    row.hidden = false;
    toggle.disabled = true;
    hint.textContent =
      "Sur iPhone : installe d'abord Bokki Admin sur l'écran d'accueil (bouton Partager → « Sur l'écran d'accueil »), puis reviens ici.";
    return;
  }

  row.hidden = false;

  function majAffichage() {
    const etat = pushEtat();
    toggle.checked = etat === "actif";
    toggle.disabled = etat === "bloque";
    if (etat === "bloque") {
      hint.textContent =
        "Notifications bloquées dans les réglages du navigateur pour ce site. Autorise-les puis recharge la page.";
    } else {
      hint.textContent = hintParDefaut;
    }
  }

  majAffichage();
  rafraichirPushSilencieux();

  toggle.addEventListener("change", async () => {
    toggle.disabled = true;
    try {
      if (toggle.checked) {
        await activerPush();
        hint.textContent = "Notifications activées sur cet appareil ✓";
      } else {
        await desactiverPush();
        hint.textContent = hintParDefaut;
      }
    } catch (err) {
      console.error(err);
      if (err && err.message === "refuse") {
        alert(
          "Tu as refusé les notifications. Pour les activer, autorise-les dans les réglages du navigateur puis recharge la page."
        );
      } else {
        alert("Impossible d'activer les notifications sur cet appareil pour le moment.");
      }
    } finally {
      majAffichage();
      if (!toggle.disabled) toggle.disabled = false;
    }
  });
});
