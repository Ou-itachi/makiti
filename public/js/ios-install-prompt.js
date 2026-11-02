// Bouton « Mettre Bokki sur l'accueil », en haut de l'écran (dans l'en-tête).
// Un seul geste pour le client, selon ce que son téléphone permet :
//  • Android (Chrome, Samsung Internet, Edge…) : le navigateur fournit
//    l'événement `beforeinstallprompt`. Un toucher sur le bouton ouvre
//    directement la fenêtre « Installer » du téléphone : un clic de plus et
//    l'icône Bokki est sur l'écran d'accueil.
//  • iPhone / iPad : Apple ne laisse AUCUN site s'installer tout seul. Le
//    bouton ouvre alors un guide en grand, avec une flèche vers le bouton
//    Partager de Safari (ou de Chrome).
//  • Navigateur intégré d'une application (WhatsApp, Facebook, Instagram,
//    TikTok…) : on ne peut pas y installer de site. Android : le bouton
//    rouvre la page dans Chrome. iPhone : le guide explique comment ouvrir
//    dans Safari.
// Rien n'est affiché si Bokki est déjà ouvert depuis l'écran d'accueil.
// La croix masque le bouton pendant 7 jours.
(function () {
  var ua = navigator.userAgent;
  var installee = window.navigator.standalone === true
    || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  if (installee) return;

  var CLE = "bokki-installer-masque";
  var SEPT_JOURS = 7 * 24 * 3600 * 1000;
  try {
    var t = Number(localStorage.getItem(CLE) || 0);
    if (t && Date.now() - t < SEPT_JOURS) return;
  } catch (e) { /* stockage indisponible : on affiche */ }

  var ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var android = /Android/i.test(ua);
  var appIntegree = /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|TikTok|musical_ly|Snapchat|Twitter|; wv\)/i.test(ua);
  var iosAutreNavigateur = ios && /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);

  var invite = null; // événement beforeinstallprompt gardé pour le clic
  var barre = null;

  function masquer(memoriser) {
    if (barre) { barre.remove(); barre = null; }
    if (memoriser) { try { localStorage.setItem(CLE, String(Date.now())); } catch (e) { /* ignore */ } }
  }

  function afficherBarre() {
    if (barre || !document.body) return;
    barre = document.createElement("div");
    barre.className = "installer-barre";
    barre.innerHTML =
      '<img class="ib-icone" src="/assets/bokki-192.png" alt="" width="36" height="36"/>' +
      '<span class="ib-txt"><b>Bokki sur votre téléphone</b><small>Comme une appli, en un toucher</small></span>' +
      '<button type="button" class="ib-btn">Mettre sur l’accueil</button>' +
      '<button type="button" class="ib-fermer" aria-label="Masquer"><svg class="i" aria-hidden="true"><use href="/assets/icons.svg?v=2#i-x"/></svg></button>';
    var hdr = document.querySelector(".hdr");
    if (hdr) hdr.insertBefore(barre, hdr.firstChild);
    else document.body.insertBefore(barre, document.body.firstChild);
    barre.querySelector(".ib-btn").addEventListener("click", installer);
    barre.querySelector(".ib-fermer").addEventListener("click", function () { masquer(true); });
  }

  function installer() {
    if (invite) {
      var e = invite;
      invite = null;
      e.prompt();
      e.userChoice.then(function (choix) {
        if (choix && choix.outcome === "accepted") masquer(false);
      }).catch(function () {});
      return;
    }
    if (android && appIntegree) {
      // Rouvre la même page dans Chrome, où l'installation est possible.
      location.href = "intent://" + location.host + location.pathname + location.search +
        "#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=" +
        encodeURIComponent(location.href) + ";end";
      return;
    }
    ouvrirGuide();
  }

  function ouvrirGuide() {
    var etapes;
    if (ios && appIntegree) {
      etapes = [
        ["i-arrow-right", "Touchez <b>•••</b> ou la boussole, puis <b>Ouvrir dans Safari</b>"],
        ["i-upload", "Dans Safari, touchez <b>Partager</b> <span class=\"ig-carre\" aria-hidden=\"true\"><svg class=\"i\"><use href=\"/assets/icons.svg?v=2#i-upload\"/></svg></span>"],
        ["i-home", "Choisissez <b>Sur l’écran d’accueil</b>, puis <b>Ajouter</b>"]
      ];
    } else if (ios) {
      etapes = [
        ["i-upload", (iosAutreNavigateur ? "Touchez <b>Partager</b> en haut, à côté de l’adresse" : "Touchez <b>Partager</b> en bas de l’écran (ou <b>•••</b> puis <b>Partager</b>)") + " <span class=\"ig-carre\" aria-hidden=\"true\"><svg class=\"i\"><use href=\"/assets/icons.svg?v=2#i-upload\"/></svg></span>"],
        ["i-home", "Faites défiler et choisissez <b>Sur l’écran d’accueil</b>"],
        ["i-check", "Touchez <b>Ajouter</b> en haut à droite. C’est fini !"]
      ];
    } else {
      etapes = [
        ["i-grid", "Touchez le menu <b>⋮</b> en haut à droite du navigateur"],
        ["i-home", "Choisissez <b>Ajouter à l’écran d’accueil</b> ou <b>Installer l’application</b>"],
        ["i-check", "Confirmez avec <b>Ajouter</b> ou <b>Installer</b>"]
      ];
    }
    var fond = document.createElement("div");
    fond.className = "installer-guide";
    fond.setAttribute("role", "dialog");
    fond.setAttribute("aria-modal", "true");
    fond.setAttribute("aria-label", "Mettre Bokki sur l’écran d’accueil");
    var html = '<div class="ig-feuille"><button type="button" class="ig-fermer" aria-label="Fermer"><svg class="i" aria-hidden="true"><use href="/assets/icons.svg?v=2#i-x"/></svg></button>' +
      '<img class="ig-icone" src="/assets/bokki-192.png" alt="" width="56" height="56"/>' +
      '<h2>Mettre Bokki sur l’accueil</h2>' +
      '<p class="ig-intro">' + (ios ? "Sur iPhone, Apple demande de le faire soi-même. C’est rapide :" : "En 3 touchers :") + '</p><ol class="ig-etapes">';
    for (var i = 0; i < etapes.length; i++) {
      html += '<li><span class="ig-num">' + (i + 1) + '</span><span>' + etapes[i][1] + '</span></li>';
    }
    html += '</ol><button type="button" class="btn btn-primary btn-block ig-ok">J’ai compris</button></div>';
    if (ios && !appIntegree && !iosAutreNavigateur) html += '<div class="ig-fleche" aria-hidden="true"><svg viewBox="0 0 24 24" width="36" height="36"><path d="M12 3v16m0 0-6-6m6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>';
    fond.innerHTML = html;
    document.body.appendChild(fond);
    var fermer = function () { fond.remove(); document.removeEventListener("keydown", echap); };
    var echap = function (e) { if (e.key === "Escape") fermer(); };
    document.addEventListener("keydown", echap);
    fond.addEventListener("click", function (e) { if (e.target === fond) fermer(); });
    fond.querySelector(".ig-fermer").addEventListener("click", fermer);
    fond.querySelector(".ig-ok").addEventListener("click", fermer);
    fond.querySelector(".ig-ok").focus();
  }

  // Android : le navigateur annonce que l'installation directe est possible.
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    invite = e;
    afficherBarre();
  });
  window.addEventListener("appinstalled", function () { invite = null; masquer(false); });

  // iPhone/iPad et applis à navigateur intégré : pas d'événement, on affiche
  // le bouton d'office. Les autres navigateurs Android l'affichent seulement
  // si l'installation directe est possible (évite un faux bouton quand Bokki
  // est déjà installé).
  if (ios || appIntegree) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", afficherBarre);
    else afficherBarre();
  }
})();
