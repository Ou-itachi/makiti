// Bouton de thème jour / nuit ([data-theme-toggle]). L'état est exposé par
// aria-pressed (pressé = thème nuit actif) ; les icônes soleil / lune sont
// gérées en CSS (bokki.css). Le stockage peut être indisponible (navigation
// privée, stockage bloqué) : le thème change quand même pour la page.
(function () {
  var STORAGE_KEY = "bokki-theme";

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "nuit" ? "nuit" : "jour";
  }

  function updateButtons() {
    var nuit = currentTheme() === "nuit";
    document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", nuit ? "true" : "false");
    });
  }

  function toggleTheme() {
    var next = currentTheme() === "nuit" ? "jour" : "nuit";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch (e) {}
    updateButtons();
  }

  document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
    btn.addEventListener("click", toggleTheme);
  });

  updateButtons();
})();
