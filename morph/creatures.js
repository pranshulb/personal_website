/* morphhouse — scattered creatures.
   Little critters placed at random spots throughout the whole document (they
   scroll with the page, NOT the viewport), so you keep meeting new ones as you
   go down each page. Each wanders only within its own small patch. As your
   time on the site grows (shared 'mh_morph_ms' clock) each juvenile
   metamorphoses into its adult and starts to fly / hop. */
(function(){
  if (window.__mhCrit) return;
  window.__mhCrit = true;

  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var KEY = 'mh_morph_ms', TARGET = 120000;
  function progress(){ var ms = parseInt(sessionStorage.getItem(KEY) || '0', 10) || 0; return Math.max(0, Math.min(1, ms / TARGET)); }

  var JUV = {
    cat: '<circle cx="48" cy="40" r="5" fill="currentColor" opacity="0.85"/><circle cx="39" cy="40" r="6" fill="currentColor"/><circle cx="30" cy="40" r="6.2" fill="currentColor" opacity="0.85"/><circle cx="21" cy="40" r="6.2" fill="currentColor"/><circle cx="12" cy="39" r="6.4" fill="currentColor"/><circle cx="9" cy="35" r="1.1" fill="#f5f2e6"/>',
    nymph: '<ellipse cx="30" cy="41" rx="8" ry="13" fill="currentColor"/><circle cx="30" cy="27" r="6" fill="currentColor"/><path d="M24 35 L16 31 M24 41 L15 41 M24 47 L16 51" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M36 35 L44 31 M36 41 L45 41 M36 47 L44 51" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="27" cy="26" r="1.3" fill="#f5f2e6"/><circle cx="33" cy="26" r="1.3" fill="#f5f2e6"/>',
    tadpole: '<ellipse cx="24" cy="40" rx="11" ry="8" fill="currentColor"/><path d="M33 40 C43 36 50 33 56 29" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="19" cy="37" r="1.6" fill="#f5f2e6"/>'
  };
  var ADULT = {
    butterfly: '<g class="w2" fill="currentColor"><path d="M30 23 C18 9 6 15 8 27 C9 34 22 31 30 25 Z"/><path d="M30 23 C42 9 54 15 52 27 C51 34 38 31 30 25 Z"/><path d="M30 30 C21 36 11 40 14 48 C17 54 28 48 30 38 Z"/><path d="M30 30 C39 36 49 40 46 48 C43 54 32 48 30 38 Z"/></g><path d="M30 18 V44" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="30" cy="16" r="2.2" fill="currentColor"/><path d="M30 16 C28 10 24 8 21 8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M30 16 C32 10 36 8 39 8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    moth: '<g class="w2" fill="currentColor"><path d="M30 17 L9 45 C20 41 40 41 51 45 Z"/></g><path d="M30 18 V43" fill="none" stroke="#f5f2e6" stroke-width="1.3" stroke-linecap="round"/><ellipse cx="30" cy="31" rx="3.2" ry="13" fill="currentColor"/><circle cx="30" cy="16" r="3" fill="currentColor"/><path d="M30 15 C27 9 23 8 20 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M30 15 C33 9 37 8 40 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    dragonfly: '<g class="w2" fill="currentColor"><ellipse cx="17" cy="22" rx="14" ry="4.5" transform="rotate(-18 17 22)"/><ellipse cx="43" cy="22" rx="14" ry="4.5" transform="rotate(18 43 22)"/><ellipse cx="18" cy="33" rx="12" ry="4" transform="rotate(15 18 33)"/><ellipse cx="42" cy="33" rx="12" ry="4" transform="rotate(-15 42 33)"/></g><circle cx="30" cy="15" r="4" fill="currentColor"/><rect x="28.4" y="17" width="3.2" height="38" rx="1.6" fill="currentColor"/>',
    frog: '<ellipse cx="30" cy="41" rx="18" ry="13" fill="currentColor"/><circle cx="21" cy="27" r="7" fill="currentColor"/><circle cx="39" cy="27" r="7" fill="currentColor"/><circle cx="21" cy="26" r="2.4" fill="#f5f2e6"/><circle cx="39" cy="26" r="2.4" fill="#f5f2e6"/><path d="M22 45 C20 51 16 53 13 53" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M38 45 C40 51 44 53 47 53" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M24 43 C27 46 33 46 36 43" fill="none" stroke="#f5f2e6" stroke-width="2" stroke-linecap="round"/>'
  };

  var DEFS = [
    { juv:'cat',     adult:'butterfly', tt:0.50, color:'#e0574c', size:32, mode:'fly' },
    { juv:'cat',     adult:'moth',      tt:0.62, color:'#6c8a78', size:30, mode:'fly' },
    { juv:'nymph',   adult:'dragonfly', tt:0.80, color:'#7a5bd0', size:32, mode:'fly', fast:true },
    { juv:'tadpole', adult:'frog',      tt:0.72, color:'#1f8a4c', size:32, mode:'hop' },
    { juv:'cat',     adult:'butterfly', tt:0.90, color:'#e8772e', size:28, mode:'fly' }
  ];

  var st = document.createElement('style');
  st.textContent = '@keyframes mhflap{0%,100%{transform:scaleX(1)}50%{transform:scaleX(0.55)}}'
    + '.mh-crit .w2{transform-box:fill-box;transform-origin:center;animation:mhflap .6s ease-in-out infinite}'
    + '.mh-crit.fast .w2{animation-duration:.26s;animation-timing-function:linear}';
  document.head.appendChild(st);

  // layer flows WITH the document (absolute, not fixed), spanning the full page height
  var layer = document.createElement('div');
  layer.setAttribute('aria-hidden','true');
  layer.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;pointer-events:none;z-index:70;';

  function docW(){ return document.documentElement.clientWidth || innerWidth; }
  function docH(){ return Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight, innerHeight); }
  function rand(a,b){ return a + Math.random()*(b-a); }

  var W = docW(), H = docH();
  var crits = [];

  function addCrit(def, hx, hy, R){
    var el = document.createElement('div');
    el.className = 'mh-crit' + (def.fast ? ' fast' : '');
    el.style.cssText = 'position:absolute;left:0;top:0;width:'+def.size+'px;height:'+def.size+'px;color:'+def.color+';will-change:transform;';
    el.innerHTML = '<svg viewBox="0 0 60 60" style="width:100%;height:100%;overflow:visible;">'
      + '<g class="cj" style="transition:opacity .9s linear">'+JUV[def.juv]+'</g>'
      + '<g class="ca" style="opacity:0;transition:opacity .9s linear">'+ADULT[def.adult]+'</g></svg>';
    layer.appendChild(el);
    crits.push({ def:def, el:el, cj:el.querySelector('.cj'), ca:el.querySelector('.ca'),
      hx:hx, hy:hy, R:R, x:hx, y:hy, vx:0, vy:0, dir: Math.random()<0.5?1:-1,
      crawlSpeed: rand(9,15), t: rand(0,10), tx:hx, ty:hy, retarget:0, hopT: rand(0,2), adult:null });
  }

  function spawn(){
    W = docW(); H = docH();
    layer.style.height = H + 'px';
    var bA = { juv:'cat', adult:'butterfly', tt:0.50, color:'#e0574c', size:32, mode:'fly' };
    var bB = { juv:'cat', adult:'butterfly', tt:0.80, color:'#e8772e', size:30, mode:'fly' };
    var others = [
      { juv:'cat',     adult:'moth',      tt:0.62, color:'#6c8a78', size:30, mode:'fly' },
      { juv:'nymph',   adult:'dragonfly', tt:0.82, color:'#7a5bd0', size:32, mode:'fly', fast:true },
      { juv:'tadpole', adult:'frog',      tt:0.72, color:'#1f8a4c', size:32, mode:'hop' }
    ];
    // exactly two butterflies, kept up near the title
    addCrit(bA, rand(W*0.12, W*0.45), rand(58, 200), 130);
    addCrit(bB, rand(W*0.55, W*0.86), rand(70, 220), 130);
    // the rest (moth / dragonfly / frog) scattered down the whole page
    var n = Math.max(3, Math.min(11, Math.round(H / 560) + 2));
    for (var i = 0; i < n; i++){
      var def = others[i % others.length];
      addCrit(def, rand(30, Math.max(60, W - 50)), rand(270, Math.max(330, H - 60)), rand(70, 150));
    }
  }

  function mount(){ (document.body || document.documentElement).appendChild(layer); spawn(); start(); }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  // keep layer tall enough as content/fonts settle
  var grows = 0;
  var grow = setInterval(function(){
    var h = docH();
    if (Math.abs(h - H) > 40){ H = h; layer.style.height = H + 'px'; }
    if (++grows > 12) clearInterval(grow);
  }, 1500);
  addEventListener('resize', function(){ W = docW(); H = docH(); layer.style.height = H + 'px'; });

  function draw(c, sx){ c.el.style.transform = 'translate(' + c.x.toFixed(1) + 'px,' + c.y.toFixed(1) + 'px) scaleX(' + sx + ')'; }

  function start(){
    if (REDUCE){
      var pr = progress();
      crits.forEach(function(c){ draw(c, 1); var a = pr >= c.def.tt; c.cj.style.opacity = a?0:1; c.ca.style.opacity = a?1:0; });
      setInterval(function(){ var p = progress(); crits.forEach(function(c){ var a = p >= c.def.tt; c.cj.style.opacity = a?0:1; c.ca.style.opacity = a?1:0; }); }, 1500);
      return;
    }
    var last = performance.now();
    function frame(now){
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      var p = progress();
      for (var i = 0; i < crits.length; i++){
        var c = crits[i]; c.t += dt;
        var isAdult = p >= c.def.tt;
        if (c.adult !== isAdult){ c.adult = isAdult; c.cj.style.opacity = isAdult ? 0 : 1; c.ca.style.opacity = isAdult ? 1 : 0; }
        var sx;
        var loX = Math.max(0, c.hx - c.R), hiX = Math.min(W - c.def.size, c.hx + c.R);
        var loY = Math.max(0, c.hy - c.R), hiY = Math.min(H - c.def.size, c.hy + c.R);

        if (!isAdult){
          c.x += c.dir * c.crawlSpeed * dt;
          c.y = c.hy + Math.sin(c.t * 5) * 1.8;
          if (c.x < loX){ c.x = loX; c.dir = 1; } else if (c.x > hiX){ c.x = hiX; c.dir = -1; }
          sx = c.dir > 0 ? -1 : 1;
        } else if (c.def.mode === 'hop'){
          c.x += c.dir * 22 * dt;
          if (c.x < loX){ c.x = loX; c.dir = 1; } else if (c.x > hiX){ c.x = hiX; c.dir = -1; }
          c.hopT += dt; var per = 2.2; var ph = (c.hopT % per) / per;
          var lift = ph < 0.42 ? Math.sin(ph / 0.42 * Math.PI) * 22 : 0;
          c.y = c.hy - lift;
          sx = c.dir > 0 ? -1 : 1;
        } else {
          var dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy) || 1;
          if (d < 30 || now > c.retarget){ c.tx = rand(loX, hiX); c.ty = rand(loY, hiY); c.retarget = now + rand(1500, 3400); }
          var sp = c.def.fast ? 60 : 42;
          var ease = Math.min(1, dt * 1.8);
          c.vx += ((dx / d) * sp - c.vx) * ease;
          c.vy += ((dy / d) * sp - c.vy) * ease + Math.sin(c.t * 7) * 8 * dt;
          c.x += c.vx * dt; c.y += c.vy * dt;
          if (c.x < loX){ c.x = loX; c.vx = Math.abs(c.vx); } else if (c.x > hiX){ c.x = hiX; c.vx = -Math.abs(c.vx); }
          if (c.y < loY){ c.y = loY; c.vy = Math.abs(c.vy); } else if (c.y > hiY){ c.y = hiY; c.vy = -Math.abs(c.vy); }
          sx = c.vx > 0 ? -1 : 1;
        }
        draw(c, sx);
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
})();
