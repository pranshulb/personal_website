/* gladiator.cx — everything the page does. Vanilla, no build step.
   Each block bails out if its markup isn't on the page, so both pages
   can load this file. */
(function () {
  'use strict';

  var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  var $ = function (id) { return document.getElementById(id); };
  var each = function (list, fn) { Array.prototype.forEach.call(list, fn); };

  /* --- header ties itself to the page once you leave the top --- */
  var header = $('header');
  if (header) {
    var stick = function () { header.classList.toggle('stuck', window.scrollY > 10); };
    stick();
    window.addEventListener('scroll', stick, { passive: true });
  }

  /* --- mobile menu --- */
  var toggle = $('menuToggle');
  var menu = $('mobileNav');
  if (toggle && menu) {
    var setMenu = function (open) {
      menu.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      toggle.querySelector('use').setAttribute('href', open ? '#i-close' : '#i-menu');
    };
    toggle.addEventListener('click', function () {
      setMenu(toggle.getAttribute('aria-expanded') !== 'true');
    });
    menu.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
  }

  /* --- things arrive as you reach them --- */
  var hidden = document.querySelectorAll('.reveal');
  if (still || !('IntersectionObserver' in window)) {
    each(hidden, function (el) { el.classList.add('shown'); });
  } else {
    var watcher = new IntersectionObserver(function (rows) {
      rows.forEach(function (row) {
        if (!row.isIntersecting) return;
        row.target.classList.add('shown');
        watcher.unobserve(row.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    each(hidden, function (el) { watcher.observe(el); });
  }

  /* --- the ladder ---
     A tablist: click or hover to pick a rank, arrows to walk it. The
     dossier reads everything it needs off the button that was chosen, so
     adding a rank to the HTML needs no change here. */
  var ladder = $('ladder');
  if (ladder) {
    var ranks = Array.prototype.slice.call(ladder.querySelectorAll('.rank'));
    var glyph = $('detailGlyph'), tier = $('detailTier'), name = $('detailName'),
        desc = $('detailDesc'), meter = $('detailMeter'), dossier = $('dossier');

    var pick = function (i, andFocus) {
      ranks.forEach(function (btn, n) {
        btn.setAttribute('aria-selected', String(n === i));
        btn.tabIndex = n === i ? 0 : -1;
      });
      var btn = ranks[i];
      name.textContent = btn.querySelector('.name').textContent;
      desc.innerHTML = btn.getAttribute('data-desc');
      tier.textContent = 'Rank ' + ROMAN[i] + ' of ' + ROMAN[ranks.length - 1];
      meter.style.width = ((i + 1) / ranks.length * 100).toFixed(1) + '%';
      glyph.querySelector('use')
        .setAttribute('href', btn.querySelector('.glyph use').getAttribute('href'));
      dossier.setAttribute('aria-labelledby', btn.id);
      if (andFocus) btn.focus();
    };

    ranks.forEach(function (btn, i) {
      btn.addEventListener('click', function () { pick(i); });
      btn.addEventListener('mouseenter', function () { pick(i); });
      btn.addEventListener('keydown', function (e) {
        var to = null;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') to = (i + 1) % ranks.length;
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') to = (i - 1 + ranks.length) % ranks.length;
        else if (e.key === 'Home') to = 0;
        else if (e.key === 'End') to = ranks.length - 1;
        if (to === null) return;
        e.preventDefault();
        pick(to, true);
      });
    });

    pick(0);
  }

  /* --- who the ticket is for --- */
  var mine = $('buySelf'), theirs = $('buyGift'),
      classic = $('planClassic'), gift = $('planGift');
  if (mine && theirs && classic && gift) {
    var mode = function (asGift) {
      mine.setAttribute('aria-pressed', String(!asGift));
      theirs.setAttribute('aria-pressed', String(asGift));
      classic.classList.toggle('dimmed', asGift);
      gift.classList.toggle('dimmed', !asGift);
    };
    mine.addEventListener('click', function () { mode(false); });
    theirs.addEventListener('click', function () { mode(true); });
    mode(false);
  }

  /* --- one question open at a time --- */
  var faq = $('faqList');
  if (faq) {
    faq.addEventListener('click', function (e) {
      var btn = e.target.closest('.qa > button');
      if (!btn) return;
      var opening = !btn.parentElement.classList.contains('open');
      each(faq.querySelectorAll('.qa'), function (qa) {
        qa.classList.remove('open');
        qa.querySelector('button').setAttribute('aria-expanded', 'false');
      });
      if (opening) {
        btn.parentElement.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  }

  /* --- the buttons lead nowhere; at least they can say so --- */
  var lines = [
    'The gates are still being oiled. Come back after the parade.',
    'Your challenger is warming up. This is a satire site, remember.',
    'Declined. The emperor only accepts denarii.',
    'Nothing was charged. Nothing was ever going to be charged.',
    'The lions were never booked. There is no arena.'
  ];
  var toast, timer;
  document.addEventListener('click', function (e) {
    if (!e.target.closest('[data-demo]')) return;
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      toast.setAttribute('role', 'status');
      document.body.appendChild(toast);
    }
    toast.textContent = lines[Math.floor(Math.random() * lines.length)];
    toast.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(function () { toast.classList.remove('show'); }, 3600);
  });

  var year = $('year');
  if (year) year.textContent = new Date().getFullYear();
})();
