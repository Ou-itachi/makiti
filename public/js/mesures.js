// Mesures anonymes (suggestions 3, 4, 6 et 7) : envoie un seul petit paquet
// par page à /api/collecte (fonction « collecte »), au moment où la page est
// quittée ou masquée. Aucune donnée personnelle : ni numéro, ni nom, ni
// identifiant de visiteur — seulement des compteurs du jour.
//   - erreurs JavaScript de nos propres scripts (alerte e-mail côté serveur) ;
//   - vitesse réelle : FCP, LCP, INP, CLS, et le type de réseau ;
//   - entonnoir : vue_accueil, vue_produit, ajout_panier, debut_commande,
//     commande_validee (window.bokkiMesure("…") depuis les autres scripts) ;
//   - variante A/B du visiteur (« A » ou « B », tirée une fois, gardée en
//     localStorage) : window.bokkiVariante, et data-ab="A|B" sur <html>.
// Chargé tôt dans le <head>, sans dépendance, en script classique.
(function () {
  "use strict";
  var VERSION = "m1";
  var ENDPOINT = "/api/collecte";
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") ENDPOINT = null;

  // ---- Variante A/B ----
  var variante = "A";
  try {
    variante = localStorage.getItem("bokki-ab");
    if (variante !== "A" && variante !== "B") {
      variante = Math.random() < 0.5 ? "A" : "B";
      localStorage.setItem("bokki-ab", variante);
    }
  } catch (e) { variante = "A"; }
  window.bokkiVariante = variante;
  document.documentElement.setAttribute("data-ab", variante);

  var evenements = [];
  var metriques = {};
  var erreurs = [];
  var envoye = false;

  window.bokkiMesure = function (nom) {
    if (typeof nom === "string" && evenements.indexOf(nom) < 0 && evenements.length < 10) evenements.push(nom);
  };

  // Vues déduites de l'adresse.
  var chemin = location.pathname.replace(/\.html$/, "");
  if (chemin === "/" || chemin === "/index") window.bokkiMesure("vue_accueil");
  else if (chemin === "/produit" || chemin.indexOf("/produit/") === 0) window.bokkiMesure("vue_produit");
  else if (chemin === "/commande/identification" || chemin === "/commande-identification") window.bokkiMesure("debut_commande");

  // ---- Erreurs (seulement celles de nos scripts) ----
  function notreScript(src) {
    return !src || src.indexOf(location.origin) === 0;
  }
  function noterErreur(message, source, ligne, pile) {
    if (erreurs.length >= 3 || !message) return;
    message = String(message);
    if (/^Script error\.?$/i.test(message) || /ResizeObserver loop/i.test(message)) return;
    if (!notreScript(source)) return;
    erreurs.push({ m: message.slice(0, 300), s: String(source || "").replace(location.origin, "").slice(0, 200), l: ligne || 0, k: String(pile || "").slice(0, 1200) });
    // Une erreur part tout de suite (la page peut ne jamais être quittée proprement).
    setTimeout(function () { envoyer(true); }, 0);
  }
  addEventListener("error", function (e) {
    if (e && e.message) noterErreur(e.message, e.filename, e.lineno, e.error && e.error.stack);
  });
  addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    if (!r) return;
    if (r.name === "InvalidStateError" && /transition/i.test(String(r.message))) return;
    if (r.name === "AbortError") return;
    // Erreurs réseau attendues en 3G : déjà gérées par l'interface.
    if (/network|failed to fetch|load failed|unavailable|deadline/i.test(String(r.message || r.code || r))) return;
    var pile = String(r.stack || "");
    if (pile && pile.indexOf(location.origin) < 0 && pile.indexOf("/js/") < 0) return;
    noterErreur((r.name ? r.name + ": " : "") + (r.message || String(r)), "", 0, pile);
  });

  // ---- Vitesse réelle ----
  function observer(type, rappel, options) {
    try {
      var po = new PerformanceObserver(function (liste) { liste.getEntries().forEach(rappel); });
      var o = options || {};
      o.type = type; o.buffered = true;
      po.observe(o);
      return po;
    } catch (e) { return null; }
  }
  observer("paint", function (e) { if (e.name === "first-contentful-paint") metriques.fcp = Math.round(e.startTime); });
  observer("largest-contentful-paint", function (e) { metriques.lcp = Math.round(e.startTime); });
  var cls = 0;
  observer("layout-shift", function (e) { if (!e.hadRecentInput) { cls += e.value; metriques.cls = Math.round(cls * 1000) / 1000; } });
  observer("event", function (e) {
    if (e.interactionId && e.duration > (metriques.inp || 0)) metriques.inp = Math.round(e.duration);
  }, { durationThreshold: 40 });

  function reseau() {
    var c = navigator.connection;
    return c && c.effectiveType ? c.effectiveType : "";
  }

  // ---- Envoi ----
  function envoyer(seulementErreurs) {
    if (!ENDPOINT) return;
    var paquet = { v: variante, r: reseau(), p: chemin.slice(0, 80), c: VERSION };
    if (erreurs.length) { paquet.x = erreurs; erreurs = []; }
    if (!seulementErreurs) {
      if (envoye) return;
      envoye = true;
      if (evenements.length) paquet.e = evenements;
      // Mesures de vitesse : seulement au 1er affichage réel (pas une page
      // restaurée depuis le cache arrière, ni ouverte en arrière-plan).
      if (!pageCachee) paquet.m = metriques;
    }
    if (!paquet.x && !paquet.e && !paquet.m) return;
    var corps = JSON.stringify(paquet);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, new Blob([corps], { type: "text/plain" }))) return;
    } catch (e) { /* repli ci-dessous */ }
    try { fetch(ENDPOINT, { method: "POST", body: corps, keepalive: true, headers: { "Content-Type": "text/plain" } }); } catch (e) { /* tant pis */ }
  }
  var pageCachee = document.visibilityState === "hidden";
  addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") envoyer(false); });
  addEventListener("pagehide", function () { envoyer(false); });
  // Page restaurée depuis le cache arrière : nouvelle « vue », sans vitesse.
  addEventListener("pageshow", function (e) {
    if (e.persisted) { envoye = false; pageCachee = true; metriques = {}; }
  });
})();
