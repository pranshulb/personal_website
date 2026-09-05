/* gladiator.cx — interactions. No framework, no build step. */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

  /* ---------- header shadow ---------- */
  var header = document.getElementById('header');
  if (header) {
    var onScroll = function () {
      header.classList.toggle('is-stuck', window.scrollY > 12);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------- mobile nav ---------- */
  var toggle = document.getElementById('menuToggle');
  var mobileNav = document.getElementById('mobileNav');
  if (toggle && mobileNav) {
    var setMenu = function (open) {
      mobileNav.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      toggle.querySelector('use').setAttribute('href', open ? '#i-close' : '#i-menu');
    };
    toggle.addEventListener('click', function () {
      setMenu(toggle.getAttribute('aria-expanded') !== 'true');
    });
    mobileNav.addEventListener('click', function (e) {
      if (e.target.closest('a')) setMenu(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setMenu(false);
    });
  }

  /* ---------- scroll reveal ---------- */
  var reveals = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window) || reduced) {
    Array.prototype.forEach.call(reveals, function (el) { el.classList.add('shown'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('shown');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    Array.prototype.forEach.call(reveals, function (el) { io.observe(el); });
  }

  /* ---------- stat count-up ---------- */
  var counters = document.querySelectorAll('[data-count]');
  if (counters.length && !reduced && 'IntersectionObserver' in window) {
    var countIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        countIO.unobserve(el);
        var target = parseFloat(el.getAttribute('data-count'));
        var suffix = el.getAttribute('data-suffix') || '';
        var start = performance.now();
        var dur = 1100;
        var step = function (now) {
          var t = Math.min(1, (now - start) / dur);
          var eased = 1 - Math.pow(1 - t, 3);
          el.textContent = Math.round(target * eased) + suffix;
          if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    }, { threshold: 0.6 });
    Array.prototype.forEach.call(counters, function (el) { countIO.observe(el); });
  }

  /* ---------- rank ladder ---------- */
  var ladder = document.getElementById('ladder');
  if (ladder) {
    var ranks = Array.prototype.slice.call(ladder.querySelectorAll('.rank'));
    var detail = {
      glyph: document.getElementById('detailGlyph'),
      tier: document.getElementById('detailTier'),
      name: document.getElementById('detailName'),
      desc: document.getElementById('detailDesc'),
      meter: document.getElementById('detailMeter'),
      panel: document.getElementById('rank-detail')
    };

    var select = function (index, focus) {
      ranks.forEach(function (btn, i) {
        var on = i === index;
        btn.setAttribute('aria-selected', String(on));
        btn.tabIndex = on ? 0 : -1;
      });
      var btn = ranks[index];
      detail.name.textContent = btn.querySelector('.name').textContent;
      detail.desc.innerHTML = btn.getAttribute('data-desc');
      detail.tier.textContent = 'Rank ' + ROMAN[index] + ' of ' + ROMAN[ranks.length - 1];
      detail.meter.style.width = ((index + 1) / ranks.length * 100).toFixed(1) + '%';
      detail.glyph.querySelector('use')
        .setAttribute('href', btn.querySelector('.glyph use').getAttribute('href'));
      detail.panel.setAttribute('aria-labelledby', btn.id);
      if (focus) btn.focus();
    };

    ranks.forEach(function (btn, i) {
      btn.addEventListener('click', function () { select(i); });
      btn.addEventListener('mouseenter', function () { select(i); });
      btn.addEventListener('keydown', function (e) {
        var next = null;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (i + 1) % ranks.length;
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (i - 1 + ranks.length) % ranks.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = ranks.length - 1;
        if (next === null) return;
        e.preventDefault();
        select(next, true);
      });
    });

    select(0);
  }

  /* ---------- pricing switch ---------- */
  var buySelf = document.getElementById('buySelf');
  var buyGift = document.getElementById('buyGift');
  var planClassic = document.getElementById('planClassic');
  var planGift = document.getElementById('planGift');
  if (buySelf && buyGift && planClassic && planGift) {
    var setMode = function (gift) {
      buySelf.setAttribute('aria-pressed', String(!gift));
      buyGift.setAttribute('aria-pressed', String(gift));
      planClassic.classList.toggle('dimmed', gift);
      planGift.classList.toggle('dimmed', !gift);
    };
    buySelf.addEventListener('click', function () { setMode(false); });
    buyGift.addEventListener('click', function () { setMode(true); });
    setMode(false);
  }

  /* ---------- faq accordion ---------- */
  var faqList = document.getElementById('faqList');
  if (faqList) {
    faqList.addEventListener('click', function (e) {
      var btn = e.target.closest('.qa > button');
      if (!btn) return;
      var qa = btn.parentElement;
      var open = !qa.classList.contains('open');
      Array.prototype.forEach.call(faqList.querySelectorAll('.qa'), function (item) {
        item.classList.remove('open');
        item.querySelector('button').setAttribute('aria-expanded', 'false');
      });
      if (open) {
        qa.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  }

  /* ---------- the buttons that go nowhere, going nowhere gracefully ---------- */
  var quips = [
    'The gates are still being oiled. Try again after the parade.',
    'Your challenger is warming up. This is a satire site, remember.',
    'Payment declined: the emperor only accepts denarii.',
    'Nothing was charged. Nothing was ever going to be charged.'
  ];
  var toast = null, toastTimer = null;
  var say = function (msg) {
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 3600);
  };
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-demo]');
    if (!b) return;
    say(quips[Math.floor(Math.random() * quips.length)]);
  });

  /* ---------- year ---------- */
  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
})();
