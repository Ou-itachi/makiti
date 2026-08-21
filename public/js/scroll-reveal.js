(function(){
  var bar = document.getElementById('scrollProgress');
  function updateProgress(){
    if(!bar) return;
    var h = document.documentElement;
    var denom = (h.scrollHeight - h.clientHeight);
    var scrolled = denom > 0 ? (h.scrollTop / denom * 100) : 0;
    bar.style.width = scrolled + '%';
  }
  window.addEventListener('scroll', updateProgress, {passive:true});
  updateProgress();

  // L'animation d'apparition au scroll (opacity:0 -> 1 via IntersectionObserver)
  // a été retirée : elle pouvait laisser du contenu invisible de façon
  // intermittente (ex: tableau des commandes, code de livraison) sur les
  // pages dont le contenu est généré après coup par Vue. Le contenu
  // s'affiche maintenant directement, sans transition.
})();
