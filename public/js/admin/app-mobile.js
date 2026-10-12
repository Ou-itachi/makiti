// Admin sur téléphone : aucun zoom possible, comme une app native.
// Complète css/admin-app.css (touch-action) et la balise viewport : Safari
// iPhone ignore "user-scalable=no" dans le navigateur, mais ses événements
// "gesture*" (pincement) peuvent être annulés.
(function () {
  function bloquer(e) { e.preventDefault(); }
  document.addEventListener("gesturestart", bloquer, { passive: false });
  document.addEventListener("gesturechange", bloquer, { passive: false });
  document.addEventListener("gestureend", bloquer, { passive: false });
  // Pincement à deux doigts sur les navigateurs sans événements gesture*.
  document.addEventListener("touchmove", function (e) {
    if (e.touches && e.touches.length > 1) e.preventDefault();
  }, { passive: false });
})();
