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
  // Appli installée : iPhone (navigator.standalone), Android et ordinateur
  // (display-mode), ou lancée depuis une icône Android (référent android-app).
  var mm = function (q) { return !!(window.matchMedia && window.matchMedia(q).matches); };
  var installee = window.navigator.standalone === true
    || mm("(display-mode: standalone)") || mm("(display-mode: fullscreen)")
    || mm("(display-mode: minimal-ui)") || mm("(display-mode: window-controls-overlay)")
    || /^android-app:\/\//.test(document.referrer || "");
  if (installee) {
    // Repère pour css/bokki.css (bande bleu nuit sous la barre d'état, jamais
    // de bannière « Installer »), aussi sur les pages suivantes de la visite.
    document.documentElement.classList.add("app-installee");
    try { sessionStorage.setItem("bokki-app-installee", "1"); } catch (e) { /* ignore */ }
    return;
  }
  try {
    if (sessionStorage.getItem("bokki-app-installee") === "1") { document.documentElement.classList.add("app-installee"); return; }
  } catch (e) { /* ignore */ }

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
  // Sur Android, seule l'installation faite par Chrome est sûre : Chrome
  // fait fabriquer l'appli par Google (format à jour). Beaucoup de
  // navigateurs livrés avec le téléphone (Phoenix sur Tecno/Infinix/itel,
  // Mi Browser, UC, Opera, Samsung Internet ancien…) fabriquent eux-mêmes
  // un fichier d'appli dans un vieux format : Android 14 et plus le bloque
  // (« Application non sécurisée bloquée… conçue pour une version plus
  // ancienne d'Android »). Hors de Chrome, on rouvre donc la page dans Chrome.
  var vraiChrome = android && /Chrome\/\d+/.test(ua) && !navigator.brave &&
    !/SamsungBrowser|OPR\/|OPT\/|Opera|OPiOS|UCBrowser|UCWEB|MiuiBrowser|XiaoMi|Mint Browser|HeyTapBrowser|PhxBrowser|Phoenix|PHX|HiBrowser|Transsion|EdgA|YaBrowser|VivoBrowser|HuaweiBrowser|HONORBrowser|DuckDuckGo|Firefox|Silk|Puffin|Kiwi|Vivaldi|; wv\)/i.test(ua);
  var androidAutreNavigateur = android && !vraiChrome && !appIntegree;
  var retourInstall = /[?&]installer=1\b/.test(location.search);

  var invite = null; // événement beforeinstallprompt gardé pour le clic
  var barre = null;
  // Chrome Android : l'événement d'installation arrive APRÈS l'affichage de
  // chaque page. On retient (le temps de la visite) que la barre est utile
  // pour la poser d'office sur les pages suivantes, sans décaler la page.
  var CLE_VUE = "bokki-installer-vue";
  function barreDejaVue() { try { return sessionStorage.getItem(CLE_VUE) === "1"; } catch (e) { return false; } }
  function retenirBarre(oui) { try { if (oui) sessionStorage.setItem(CLE_VUE, "1"); else sessionStorage.removeItem(CLE_VUE); } catch (e) { /* ignore */ } }

  function masquer(memoriser) {
    if (barre) { barre.remove(); barre = null; }
    retenirBarre(false);
    if (memoriser) { try { localStorage.setItem(CLE, String(Date.now())); } catch (e) { /* ignore */ } }
  }

  var deja = false; // appli déjà installée (getInstalledRelatedApps)
  function afficherBarre() {
    if (barre || deja || !document.body) return;
    barre = document.createElement("div");
    barre.className = "installer-barre";
    barre.innerHTML =
      '<img class="ib-icone" src="/assets/bokki-192.png" alt="" width="36" height="36"/>' +
      '<span class="ib-txt"><b>Bokki sur votre téléphone</b><small>Comme une appli, en un toucher</small></span>' +
      '<button type="button" class="ib-btn">Installer</button>' +
      '<button type="button" class="ib-fermer" aria-label="Masquer"><svg class="i" aria-hidden="true"><use href="/assets/icons.svg?v=2#i-x"/></svg></button>';
    var hdr = document.querySelector(".hdr");
    if (hdr) hdr.insertBefore(barre, hdr.firstChild);
    else document.body.insertBefore(barre, document.body.firstChild);
    barre.querySelector(".ib-btn").addEventListener("click", installer);
    barre.querySelector(".ib-fermer").addEventListener("click", function () { masquer(true); });
  }

  function ouvrirDansChrome() {
    // Si Chrome est absent, le téléphone revient sur cette page avec
    // ?installer=1 : on affiche alors le guide « installer Chrome ».
    var sep = location.search ? "&" : "?";
    var retour = location.href.split("#")[0] + (retourInstall ? "" : sep + "installer=1");
    location.href = "intent://" + location.host + location.pathname + location.search +
      "#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=" +
      encodeURIComponent(retour) + ";end";
  }

  function installer() {
    if (androidAutreNavigateur) {
      // Ne jamais utiliser l'installation de ce navigateur (appli bloquée
      // par Android) : on passe par Chrome, ou on guide vers Chrome.
      if (retourInstall) ouvrirGuideChrome();
      else ouvrirDansChrome();
      return;
    }
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
      ouvrirDansChrome();
      return;
    }
    ouvrirGuide();
  }

  function ouvrirGuideChrome() { ouvrirGuide(true); }

  function ouvrirGuide(chromeAbsent) {
    var etapes;
    if (chromeAbsent) {
      etapes = [
        ["i-download", "Installez <b>Google Chrome</b> (gratuit) depuis le <b>Play Store</b> — bouton ci-dessous"],
        ["i-arrow-right", "Ouvrez <b>" + location.host + "</b> dans Chrome"],
        ["i-home", "Touchez <b>Installer</b> en haut de la page"]
      ];
    } else if (ios && appIntegree) {
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
    fond.setAttribute("aria-label", "Installer Bokki");
    var html = '<div class="ig-feuille"><button type="button" class="ig-fermer" aria-label="Fermer"><svg class="i" aria-hidden="true"><use href="/assets/icons.svg?v=2#i-x"/></svg></button>' +
      '<img class="ig-icone" src="/assets/bokki-192.png" alt="" width="56" height="56"/>' +
      '<h2>Installer Bokki</h2>' +
      '<p class="ig-intro">' + (chromeAbsent ? "Le navigateur de ce téléphone fabrique une appli que les Android récents bloquent. Passez par Chrome, c’est sûr :" : ios ? "Sur iPhone, Apple demande de le faire soi-même. C’est rapide :" : "En 3 touchers :") + '</p><ol class="ig-etapes">';
    for (var i = 0; i < etapes.length; i++) {
      html += '<li><span class="ig-num">' + (i + 1) + '</span><span>' + etapes[i][1] + '</span></li>';
    }
    html += '</ol>';
    if (chromeAbsent) html += '<a class="btn btn-primary btn-block" href="https://play.google.com/store/apps/details?id=com.android.chrome">Installer Chrome</a>';
    html += '<button type="button" class="btn ' + (chromeAbsent ? "btn-block" : "btn-primary btn-block") + ' ig-ok">J’ai compris</button></div>';
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
  // Hors de Chrome, preventDefault() bloque aussi la bannière d'installation
  // du navigateur lui-même (celle qui produit l'appli bloquée).
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    if (androidAutreNavigateur) return;
    // Ordinateur : pas de barre « Bokki sur votre téléphone » (texte inadapté).
    if (!android) return;
    invite = e;
    retenirBarre(true);
    afficherBarre();
  });
  window.addEventListener("appinstalled", function () { invite = null; masquer(false); });
  // Chrome Android : Bokki déjà installé sur ce téléphone (site ouvert dans
  // le navigateur) → pas de bannière (manifest.json : related_applications).
  if (navigator.getInstalledRelatedApps) {
    navigator.getInstalledRelatedApps().then(function (apps) {
      if (apps && apps.length) { invite = null; masquer(false); deja = true; }
    }).catch(function () {});
  }
  // Script placé en fin de page : l'en-tête existe déjà, on pose la barre
  // avant le premier affichage.
  if (vraiChrome && barreDejaVue()) afficherBarre();

  // iPhone/iPad, applis à navigateur intégré et navigateurs Android autres
  // que Chrome : on affiche le bouton d'office (il mène vers Chrome). Dans
  // Chrome, il apparaît seulement si l'installation directe est possible
  // (évite un faux bouton quand Bokki est déjà installé).
  if (ios || appIntegree || androidAutreNavigateur) {
    var montrer = function () {
      afficherBarre();
      if (androidAutreNavigateur && retourInstall) ouvrirGuideChrome();
    };
    if (document.querySelector(".hdr") || document.readyState !== "loading") montrer();
    else document.addEventListener("DOMContentLoaded", montrer);
  }
})();
