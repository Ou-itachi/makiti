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

  var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // .code-card et .result-card sont volontairement exclus : ce sont les
  // zones où s'affiche le code de livraison, qui doit rester lisible
  // immédiatement, sans délai d'apparition.
  var revealSelectors = '.card, .pcard, .supp-card, .kpi, .stat-card, .zone-card, .c-card, .step4, .cat-card, .faq-item, .sum-card, .due-row, .status-card, .recap-card, .deliv-card, .chart-panel, .panel, .zero-item, .trust-item, .form-box, .info-card';
  var els = document.querySelectorAll(revealSelectors);
  if(!prefersReduced){
    els.forEach(function(el, i){
      el.classList.add('reveal');
      el.style.transitionDelay = (i % 8) * 0.06 + 's';
    });
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(entry.isIntersecting){
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, {threshold:0.1, rootMargin:'0px 0px -30px 0px'});
    els.forEach(function(el){ io.observe(el); });

    // Filet de sécurité : sur les pages où le contenu est généré après coup
    // par un framework (ex. Vue qui remonte/patch le DOM après ce script),
    // l'observer peut manquer l'intersection et laisser des éléments bloqués
    // en opacity:0 indéfiniment. On force l'affichage après un court délai.
    setTimeout(function(){
      document.querySelectorAll('.reveal:not(.in)').forEach(function(el){
        el.classList.add('in');
        io.unobserve(el);
      });
    }, 1200);
  }
})();
