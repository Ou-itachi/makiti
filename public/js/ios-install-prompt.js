// Bandeau d'installation, Safari iOS uniquement : contrairement à
// Android/Chrome (bannière d'installation automatique via le manifest),
// iOS n'offre aucune installation automatique — l'utilisateur doit ouvrir
// le menu Partager puis choisir "Sur l'écran d'accueil" lui-même. Sans ce
// bandeau, ce chemin reste invisible pour la plupart des clients.
//
// Détection : iPhone/iPad/iPod, ou iPadOS 13+ qui se déclare "MacIntel"
// mais reste tactile (navigator.maxTouchPoints > 1, absent sur un vrai Mac
// de bureau) ; ET Safari précisément — Chrome/Firefox/Edge sur iOS
// utilisent tous le moteur WebKit de Safari et contiennent donc "Safari"
// dans leur user-agent, il faut explicitement exclure leurs propres
// user-agents (CriOS/FxiOS/EdgiOS/OPiOS) pour ne pas les cibler à tort ;
// ET pas déjà installée (navigator.standalone true une fois ajoutée à
// l'écran d'accueil sur iOS).
(function () {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari = isIOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  const isStandalone = window.navigator.standalone === true;
  if (!isSafari || isStandalone) return;

  const DISMISS_KEY = "makiti-ios-install-dismissed";
  if (localStorage.getItem(DISMISS_KEY)) return;

  const banner = document.createElement("div");
  banner.className = "ios-install-banner";
  banner.setAttribute("role", "note");
  banner.innerHTML = `
    <button type="button" class="iib-close" aria-label="Fermer">
      <i class="ph-bold ph-x" style="font-size:14px"></i>
    </button>
    <div class="iib-head">
      <div class="iib-app-icon"><span>M</span></div>
      <div class="iib-head-txt">
        <strong>Installer Makitti</strong>
        <span>Ajoutez la boutique sur votre écran d'accueil, comme une app.</span>
      </div>
    </div>
    <div class="iib-steps">
      <div class="iib-step">
        <span class="iib-num">1</span>
        <i class="ph ph-export iib-glyph" style="font-size:20px"></i>
        <span>Appuyez sur <strong>Partager</strong> en bas de Safari</span>
      </div>
      <div class="iib-step">
        <span class="iib-num">2</span>
        <i class="ph ph-plus-square iib-glyph" style="font-size:20px"></i>
        <span>Choisissez <strong>Sur l'écran d'accueil</strong></span>
      </div>
    </div>
  `;
  document.body.appendChild(banner);

  banner.querySelector(".iib-close").addEventListener("click", () => {
    banner.remove();
    localStorage.setItem(DISMISS_KEY, "1");
  });
})();
