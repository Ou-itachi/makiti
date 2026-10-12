// Transitions entre pages (voir la fin de css/base.css) + préchargement.
// Script classique chargé dans <head> : "pagereveal" doit être écouté avant
// le premier affichage de la nouvelle page.

// Retour arrière (bouton retour, geste de balayage) : animation inversée,
// comme une app native. Navigation API absente (Safari) : animation par défaut.
addEventListener("pagereveal", function (e) {
  if (!e.viewTransition) return;
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
// site uniquement. En mode économie de données / 2G, le navigateur le
// désactive lui-même.
(function () {
  try {
    if (!HTMLScriptElement.supports || !HTMLScriptElement.supports("speculationrules")) return;
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
