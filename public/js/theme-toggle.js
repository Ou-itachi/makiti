(function () {
  var STORAGE_KEY = "makiti-theme";

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "nuit" ? "nuit" : "jour";
  }

  function updateButtons() {
    var theme = currentTheme();
    document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
      var sun = btn.querySelector(".icon-sun");
      var moon = btn.querySelector(".icon-moon");
      if (sun) sun.style.display = theme === "nuit" ? "" : "none";
      if (moon) moon.style.display = theme === "jour" ? "" : "none";
    });
  }

  function toggleTheme() {
    var next = currentTheme() === "nuit" ? "jour" : "nuit";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(STORAGE_KEY, next);
    updateButtons();
  }

  document.querySelectorAll("[data-theme-toggle]").forEach(function (btn) {
    btn.addEventListener("click", toggleTheme);
  });

  updateButtons();
})();
