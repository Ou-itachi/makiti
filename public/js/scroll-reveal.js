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
  var revealSelectors = '.card, .pcard, .supp-card, .rider-card, .kpi, .stat-card, .zone-card, .c-card, .step4, .cat-card, .faq-item, .sum-card, .due-row, .status-card, .recap-card, .deliv-card, .chart-panel, .panel, .zero-item, .trust-item, .form-box, .info-card';
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

    // Ce filet ne couvre que le chargement initial. Sur une page Vue dont le
    // template source est capturé dans le DOM (in-DOM template compilation,
    // sans étape de build) AVANT que ce script ne s'exécute, un élément
    // stampé par un v-for hérite de la classe "reveal" ajoutée ci-dessus au
    // node-modèle non encore développé — donc tout élément ajouté ensuite à
    // une liste réactive (ex. "Ajouter un fournisseur"/"Ajouter un produit")
    // naît déjà avec "reveal" mais sans jamais croiser l'IntersectionObserver
    // (qui n'observe que les éléments présents au chargement) ni le filet de
    // 1200ms (déjà écoulé) : il reste bloqué en opacity:0 indéfiniment. Ce
    // MutationObserver couvre la durée de vie de la page, pas seulement le
    // chargement initial — les éléments ajoutés plus tard apparaissent
    // immédiatement (sans animation d'entrée, qui n'a de sens que pour du
    // contenu déjà présent qu'on découvre en scrollant).
    var mo = new MutationObserver(function(){
      document.querySelectorAll('.reveal:not(.in)').forEach(function(el){
        el.classList.add('in');
        io.unobserve(el);
      });
    });
    mo.observe(document.body, {childList:true, subtree:true});
  }
})();
