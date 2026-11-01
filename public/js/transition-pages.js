// Transitions entre pages (voir la fin de css/base.css) + préchargement.
// Script classique chargé dans <head> : "pagereveal" doit être écouté avant
// le premier affichage de la nouvelle page.

// Retour arrière (bouton retour, geste de balayage) : animation inversée,
// comme une app native. Navigation API absente (Safari) : animation par défaut.
addEventListener("pagereveal", function (e) {
  if (!e.viewTransition) return;
  // Transition interrompue (navigation rapide, onglet en arrière-plan) : rien à signaler.
  e.viewTransition.ready.catch(function () {});
  e.viewTransition.finished.catch(function () {});
  if (e.viewTransition.updateCallbackDone) e.viewTransition.updateCallbackDone.catch(function () {});
  try {
    var act = window.navigation && navigation.activation;
    if (act && act.navigationType === "traverse" && act.from && act.entry && act.from.index > act.entry.index) {
      e.viewTransition.types.add("retour");
    }
  } catch (err) { /* animation par défaut */ }
});

// Préchargement (Chrome/Android) : la page visée est téléchargée dès que le
// doigt touche le lien (ou au survol prolongé à la souris), avant même le
// relâchement — la navigation paraît alors instantanée. Préchargement du
// HTML seulement (pas d'exécution de la page en arrière-plan), pages du
// site uniquement. Désactivé en économie de données et en réseau très lent
// (2G) : chaque page préchargée pour rien y coûterait trop cher. Les
// données de la fiche, elles, sont préchargées par carte-produit.js.
(function () {
  try {
    if (!HTMLScriptElement.supports || !HTMLScriptElement.supports("speculationrules")) return;
    var c = navigator.connection;
    if (c && (c.saveData || c.effectiveType === "slow-2g" || c.effectiveType === "2g")) return;
    var regles = document.createElement("script");
    regles.type = "speculationrules";
    regles.textContent = JSON.stringify({
      prefetch: [{
        where: { and: [{ href_matches: "/*" }, { not: { selector_matches: "[target=_blank], [download]" } }] },
        eagerness: "moderate",
      }],
    });
    document.head.appendChild(regles);
  } catch (err) { /* navigateur sans préchargement : navigation normale */ }
})();

// Côté page quittée : même chose si la transition est interrompue.
addEventListener("pageswap", function (e) {
  if (!e.viewTransition) return;
  e.viewTransition.ready.catch(function () {});
  e.viewTransition.finished.catch(function () {});
  if (e.viewTransition.updateCallbackDone) e.viewTransition.updateCallbackDone.catch(function () {});
});

// Une page qui redirige aussitôt (ex. /compte → /connexion) annule la
// transition en cours ; le navigateur rejette alors une promesse interne de
// la transition (InvalidStateError) que les .catch ci-dessus n'atteignent pas
// toujours. Sans effet visible : on l'ignore, et seulement elle.
addEventListener("unhandledrejection", function (e) {
  var r = e.reason;
  if (r && r.name === "InvalidStateError" && /transition/i.test(String(r.message))) e.preventDefault();
});
