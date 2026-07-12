import { useIntersectionObserver } from "./hooks.js";

// === ANIMATED STAT COUNTERS ===
(function () {
  var counterEls = document.querySelectorAll(".stat-number, .result-stat");
  if (!counterEls.length) return;

  var reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  function parseTarget(text) {
    var match = text.trim().match(/^([^\d]*)([\d,]+(?:\.\d+)?)([^\d]*)$/);
    if (!match) return null;
    var prefix = match[1],
      numStr = match[2],
      suffix = match[3];
    var decimals = numStr.indexOf(".") > -1 ? numStr.split(".")[1].length : 0;
    return {
      prefix: prefix,
      suffix: suffix,
      value: parseFloat(numStr.replace(/,/g, "")),
      decimals: decimals,
      hasComma: numStr.indexOf(",") > -1,
    };
  }

  function formatValue(value, decimals, hasComma) {
    var fixed = value.toFixed(decimals);
    if (!hasComma) return fixed;
    var parts = fixed.split(".");
    var withCommas = Number(parts[0]).toLocaleString("en-US");
    return parts[1] ? withCommas + "." + parts[1] : withCommas;
  }

  function renderValue(el, target, value) {
    el.textContent =
      target.prefix +
      formatValue(value, target.decimals, target.hasComma) +
      target.suffix;
  }

  function animateCounter(el, target) {
    // 1400ms felt like a natural count-up pace in testing — long enough to
    // register as a count rather than a jump, short enough not to drag.
    // Cubic ease-out (1 - (1-p)^3) keeps the counter snappy at the start and
    // settles gently on the final number rather than stopping abruptly.
    var duration = 1400;
    var start = performance.now();
    function tick(now) {
      var progress = Math.min((now - start) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      renderValue(el, target, target.value * eased);
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  useIntersectionObserver(
    counterEls,
    function (entries, observer) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        var el = entry.target;
        var target = parseTarget(el.textContent);
        if (!target) return;
        if (reduceMotion) {
          renderValue(el, target, target.value);
          return;
        }
        renderValue(el, target, 0);
        animateCounter(el, target);
      });
    },
    { threshold: 0.4 },
  );
})();
