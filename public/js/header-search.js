// Barre de recherche du header (formulaire GET vers « /catalogue?q=… ») :
// • sans JavaScript, le formulaire suffit (le catalogue lit ?q= au chargement) ;
// • sur la page catalogue, catalogue.js filtre déjà en direct à la frappe :
//   l'envoi ne recharge pas la page, il prévient juste catalogue.js.
(function () {
  var form = document.querySelector(".hdr form.search");
  var input = document.getElementById("searchInput");
  if (!form || !input) return;
  var surCatalogue = !!document.getElementById("grille");
  // Suggestions : chargées au premier toucher sur la barre.
  input.addEventListener("focus", function () {
    import("/js/recherche-suggestions.js").then(function (m) {
      var neuf = !form.__suggestions;
      m.brancher(form, input);
      if (neuf && document.activeElement === input) input.dispatchEvent(new Event("focus"));
    }).catch(function () { /* la recherche classique reste disponible */ });
  }, { once: true });
  form.addEventListener("submit", function (e) {
    if (!surCatalogue) return;
    e.preventDefault();
    input.blur();
    document.dispatchEvent(new CustomEvent("bokki:recherche"));
    window.scrollTo({ top: 0 });
  });
})();
