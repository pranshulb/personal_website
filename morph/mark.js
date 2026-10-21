/* morphhouse — the hidden clue.
   The nav mark starts as a caterpillar and slowly becomes a butterfly
   as you accumulate time on the site (carried across pages in a visit
   via sessionStorage; a fresh tab starts over as a caterpillar). */
(function(){
  function clamp(x){ return Math.max(0, Math.min(1, x)); }
  var TARGET = 120000;            // ms of on-site time to fully emerge
  var KEY = 'mh_morph_ms';

  // adult shapes the nav mark cycles through once it has emerged
  var ORDER = ['butterfly','moth','dragonfly','frog'];
  var ADULT_SHAPES = {
    butterfly: '<g class="wings" fill="currentColor" style="transform-box:fill-box;transform-origin:center;transform:scaleX(1);transition:transform 1.1s linear;"><path d="M30 23 C18 9 6 15 8 27 C9 34 22 31 30 25 Z"/><path d="M30 23 C42 9 54 15 52 27 C51 34 38 31 30 25 Z"/><path d="M30 30 C21 36 11 40 14 48 C17 54 28 48 30 38 Z"/><path d="M30 30 C39 36 49 40 46 48 C43 54 32 48 30 38 Z"/></g><path d="M30 18 V44" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="30" cy="16" r="2.2" fill="currentColor"/><path d="M30 16 C28 10 24 8 21 8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M30 16 C32 10 36 8 39 8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    moth: '<g class="wings" fill="currentColor" style="transform-box:fill-box;transform-origin:center;transform:scaleX(1);transition:transform 1.1s linear;"><path d="M30 17 L9 45 C20 41 40 41 51 45 Z"/></g><path d="M30 18 V43" fill="none" stroke="#f5f2e6" stroke-width="1.3" stroke-linecap="round"/><ellipse cx="30" cy="31" rx="3.2" ry="13" fill="currentColor"/><circle cx="30" cy="16" r="3" fill="currentColor"/><path d="M30 15 C27 9 23 8 20 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M30 15 C33 9 37 8 40 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    dragonfly: '<g class="wings" fill="currentColor" style="transform-box:fill-box;transform-origin:center;transform:scaleX(1);transition:transform 1.1s linear;"><ellipse cx="17" cy="22" rx="14" ry="4.5" transform="rotate(-18 17 22)"/><ellipse cx="43" cy="22" rx="14" ry="4.5" transform="rotate(18 43 22)"/><ellipse cx="18" cy="33" rx="12" ry="4" transform="rotate(15 18 33)"/><ellipse cx="42" cy="33" rx="12" ry="4" transform="rotate(-15 42 33)"/></g><circle cx="30" cy="15" r="4" fill="currentColor"/><rect x="28.4" y="17" width="3.2" height="38" rx="1.6" fill="currentColor"/>',
    frog: '<ellipse cx="30" cy="41" rx="18" ry="13" fill="currentColor"/><circle cx="21" cy="27" r="7" fill="currentColor"/><circle cx="39" cy="27" r="7" fill="currentColor"/><circle cx="21" cy="26" r="2.4" fill="#f5f2e6"/><circle cx="39" cy="26" r="2.4" fill="#f5f2e6"/><path d="M22 45 C20 51 16 53 13 53" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M38 45 C40 51 44 53 47 53" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M24 43 C27 46 33 46 36 43" fill="none" stroke="#f5f2e6" stroke-width="2" stroke-linecap="round"/>'
  };

  function stage(p){
    return {
      cat:   1 - clamp((p - 0.30) / 0.12),                                  // fades out 30%–42%
      chry:  Math.min(clamp((p - 0.33) / 0.12), 1 - clamp((p - 0.57) / 0.12)), // in 33%, out 57%
      fly:   clamp((p - 0.60) / 0.14),                                      // fades in 60%–74%
      wings: clamp((p - 0.64) / 0.20)                                       // unfold 64%–84%
    };
  }

  function apply(){
    var ms = parseInt(sessionStorage.getItem(KEY) || '0', 10) || 0;
    var p = clamp(ms / TARGET);
    var s = stage(p);
    var marks = document.querySelectorAll('[data-morph-mark]');
    for (var i = 0; i < marks.length; i++){
      var m = marks[i];
      var cat = m.querySelector('.cat'),
          chry = m.querySelector('.chry'),
          fly = m.querySelector('.fly'),
          wings = m.querySelector('.wings');
      if (cat)  cat.style.opacity  = s.cat;
      if (chry) chry.style.opacity = s.chry;
      if (fly && !m.__swapping)  fly.style.opacity  = s.fly;
      if (wings) wings.style.transform = 'scaleX(' + s.wings.toFixed(3) + ')';
      var label = p < 0.33 ? 'still a caterpillar…'
                : p < 0.60 ? 'something is happening…'
                : p < 0.99 ? 'wings drying…'
                : 'there it is \u2726';
      m.setAttribute('title', label);
    }
    var creatures = document.querySelectorAll('[data-morph-creature]');
    for (var j = 0; j < creatures.length; j++){
      var c = creatures[j];
      var tt = parseFloat(c.getAttribute('data-tt') || '0.6');
      var isFly = p >= tt;
      var cc = c.querySelector('.ccat'), cf = c.querySelector('.cfly');
      if (cc) cc.style.opacity = isFly ? 0 : 1;
      if (cf) cf.style.opacity = isFly ? 1 : 0;
      if (isFly) c.classList.add('is-fly'); else c.classList.remove('is-fly');
    }
  }

  window.runMorphMark = function(){
    apply();
    if (window.__mhMorphInterval) return;
    var last = Date.now();
    window.__mhMorphInterval = setInterval(function(){
      var now = Date.now();
      if (document.visibilityState !== 'hidden'){
        var ms = (parseInt(sessionStorage.getItem(KEY) || '0', 10) || 0) + (now - last);
        sessionStorage.setItem(KEY, String(ms));
      }
      last = now;
      apply();
    }, 1000);

    if (!window.__mhCycle){
      window.__mhCycle = setInterval(function(){
        var pp = clamp((parseInt(sessionStorage.getItem(KEY) || '0', 10) || 0) / TARGET);
        if (pp < 0.74 || document.visibilityState === 'hidden') return;
        window.__mhCycleIdx = ((window.__mhCycleIdx == null ? 0 : window.__mhCycleIdx) + 1) % ORDER.length;
        var shape = ADULT_SHAPES[ORDER[window.__mhCycleIdx]];
        var marks = document.querySelectorAll('[data-morph-mark]');
        for (var k = 0; k < marks.length; k++){
          (function(mm){
            var fly = mm.querySelector('.fly');
            if (!fly) return;
            mm.__swapping = true;
            fly.style.opacity = 0;
            setTimeout(function(){ fly.innerHTML = shape; fly.style.opacity = 1; }, 560);
            setTimeout(function(){ mm.__swapping = false; }, 1700);
          })(marks[k]);
        }
      }, 5200);
    }
  };
})();
