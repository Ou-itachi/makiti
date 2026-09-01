// Barre de recherche du header, commune à toutes les pages sauf l'accueil :
// sur l'accueil, produits-list.js filtre déjà la grille en direct à la
// frappe (voir #searchInput) et gère aussi #searchGo ; ailleurs, Entrée ou
// le bouton rond renvoient vers l'accueil avec le terme en query string
// (repris par produits-list.js au chargement).
(function () {
  var input = document.getElementById("searchInput");
  if (!input) return;
  var surAccueil = /\/(index\.html)?$/.test(location.pathname);
  if (surAccueil) return;

  function lancerRecherche() {
    var q = input.value.trim();
    location.href = "index.html" + (q ? "?q=" + encodeURIComponent(q) : "") + "#produits";
  }

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") lancerRecherche();
  });
  var go = document.getElementById("searchGo");
  if (go) go.addEventListener("click", lancerRecherche);
})();
