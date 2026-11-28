/* Automatic desktop / mobile layout selection.
   Sets data-device and data-viewport on <html> so CSS can serve the right layout
   immediately and switch again when a window is resized or a device rotates. */
(function () {
  function apply() {
    var width = window.innerWidth || document.documentElement.clientWidth;
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    var mobileQuery = window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
    var mobile = mobileQuery || (coarse && width <= 1024);
    var viewport = width <= 600 ? 'phone' : mobile ? 'tablet' : 'desktop';
    var root = document.documentElement;
    if (root.getAttribute('data-device') !== (mobile ? 'mobile' : 'desktop')) {
      root.setAttribute('data-device', mobile ? 'mobile' : 'desktop');
    }
    if (root.getAttribute('data-viewport') !== viewport) {
      root.setAttribute('data-viewport', viewport);
    }
  }

  apply();
  window.addEventListener('resize', apply, { passive: true });
  window.addEventListener('orientationchange', apply, { passive: true });
  if (window.matchMedia) {
    var query = window.matchMedia('(max-width: 900px)');
    if (query.addEventListener) query.addEventListener('change', apply);
    else if (query.addListener) query.addListener(apply);
  }
})();
