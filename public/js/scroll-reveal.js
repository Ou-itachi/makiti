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
  var revealSelectors = '.card, .pcard, .supp-card, .kpi, .stat-card, .zone-card, .c-card, .step4, .cat-card, .faq-item, .sum-card, .due-row, .status-card, .recap-card, .deliv-card, .chart-panel, .panel, .zero-item, .trust-item, .form-box, .result-card, .info-card, .code-card';
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
  }
})();
