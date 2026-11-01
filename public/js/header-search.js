// Barre de recherche du header (formulaire GET vers « /catalogue?q=… ») :
// • sans JavaScript, le formulaire suffit (le catalogue lit ?q= au chargement) ;
// • sur la page catalogue, catalogue.js filtre déjà en direct à la frappe :
//   l'envoi ne recharge pas la page, il prévient juste catalogue.js.
(function () {
  var form = document.querySelector(".hdr form.search");
  var input = document.getElementById("searchInput");
  if (!form || !input) return;
  var surCatalogue = !!document.getElementById("grille");
  form.addEventListener("submit", function (e) {
    if (!surCatalogue) return;
    e.preventDefault();
    input.blur();
    document.dispatchEvent(new CustomEvent("bokki:recherche"));
    window.scrollTo({ top: 0 });
  });
})();
