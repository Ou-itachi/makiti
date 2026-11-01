// Barre de recherche du header (formulaire GET vers « /?q=… ») :
// • sans JavaScript, le formulaire suffit (l'accueil lit ?q= au chargement) ;
// • sur l'accueil et les pages /categorie/…, produits-list.js filtre déjà la
//   grille en direct à la frappe : on évite le rechargement et on amène
//   simplement la grille à l'écran ;
// • ailleurs, on ajoute l'ancre #produits pour arriver directement aux résultats.
(function () {
  var form = document.querySelector(".hdr form.search");
  var input = document.getElementById("searchInput");
  if (!form || !input) return;
  var avecGrille = !!document.getElementById("produits");

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (avecGrille) {
      input.blur();
      document.getElementById("produits").scrollIntoView({ block: "start" });
      return;
    }
    var q = input.value.trim();
    location.href = "/" + (q ? "?q=" + encodeURIComponent(q) : "") + "#produits";
  });
})();
