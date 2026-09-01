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

  // Classes d'animation d'entrée posées à la main dans le HTML.
  var HARD = '.reveal, .reveal-scale, .reveal-x';
  // Composants auxquels on ajoute .reveal automatiquement s'ils sont hors écran.
  // .code-card / .result-card exclus : le code de livraison doit rester lisible
  // sans délai.
  var AUTO = '.card, .pcard, .supp-card, .rider-card, .kpi, .stat-card, .zone-card, .c-card, .step4, .cat-card, .faq-item, .sum-card, .due-row, .status-card, .recap-card, .deliv-card, .chart-panel, .panel, .zero-item, .trust-item, .form-box, .info-card';

  var vh = window.innerHeight || document.documentElement.clientHeight;
  function aboveFold(el){ return el.getBoundingClientRect().top < vh - 40; }
  function show(el){ el.classList.add('in'); }

  // prefers-reduced-motion : on rend tout visible tout de suite, une bonne fois.
  if (prefersReduced) {
    var reveal = function(){ document.querySelectorAll(HARD).forEach(show); };
    reveal();
    new MutationObserver(reveal).observe(document.body, {childList:true, subtree:true});
    return;
  }

  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if(entry.isIntersecting){ show(entry.target); io.unobserve(entry.target); }
    });
  }, {threshold:0.1, rootMargin:'0px 0px -30px 0px'});

  var idx = 0;
  // Ce script s'exécute après le parsing du HTML : le contenu est déjà peint.
  // On n'anime QUE ce qui est hors écran — sinon on ferait clignoter
  // (visible -> opacity:0 -> ré-apparition) tout le contenu au-dessus de la
  // ligne de flottaison à chaque chargement.
  function process(root){
    // éléments déjà marqués à la main : hors écran -> on observe ;
    // déjà visible -> on retire les classes d'animation pour un affichage
    // immédiat avec la page (pas de fondu au chargement).
    (root || document).querySelectorAll(HARD).forEach(function(el){
      if (el.classList.contains('in')) return;
      if (aboveFold(el)) { el.classList.remove('reveal','reveal-scale','reveal-x'); return; }
      io.observe(el);
    });
    // composants : on leur ajoute .reveal seulement s'ils sont hors écran
    (root || document).querySelectorAll(AUTO).forEach(function(el){
      if (el.classList.contains('reveal') || el.classList.contains('in')) return;
      if (aboveFold(el)) return;
      el.classList.add('reveal');
      el.style.transitionDelay = (idx++ % 6) * 0.05 + 's';
      io.observe(el);
    });
  }
  process();

  // Contenu ajouté après coup (listes Firestore, montage Vue).
  new MutationObserver(function(){ process(); }).observe(document.body, {childList:true, subtree:true});

  // Filet de sécurité : rien ne doit rester invisible.
  setTimeout(function(){
    document.querySelectorAll('.reveal:not(.in), .reveal-scale:not(.in), .reveal-x:not(.in)').forEach(show);
  }, 1500);
})();
