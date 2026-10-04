// What every café page shares that needs a script (cafe.css has the rest).
//
// "← back" is pinned to the top left so it stays in reach down a long page,
// but on a short window the page scrolls and the title slid under it
// ("musings is hidden behind back button", October 2026). Scrolling down now
// slides it away, so it never sits on what's being read; scrolling up, or
// being back near the top, brings it back. html.back-away in cafe.css.
(() => {
  const root = document.documentElement;
  let lastY = window.scrollY, queued = false;
  function update() {
    queued = false;
    const y = window.scrollY, dy = y - lastY;
    if (y < 8) root.classList.remove('back-away');
    else if (dy > 4) root.classList.add('back-away');
    else if (dy < -4) root.classList.remove('back-away');
    else return;          // a few pixels of jitter (a trackpad settling) changes nothing
    lastY = y;
  }
  window.addEventListener('scroll', () => {
    if (!queued) { queued = true; requestAnimationFrame(update); }
  }, { passive: true });
})();
