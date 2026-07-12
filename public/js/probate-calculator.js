// === PROBATE COST CALCULATOR ===
(function () {
  var input = document.getElementById("estateValueInput");
  var calcBtn = document.getElementById("calcGoBtn");
  var output = document.getElementById("calcOutput");
  var probateCostEl = document.getElementById("calcProbateCost");
  var savingsEl = document.getElementById("calcSavings");
  var calcCta = document.getElementById("calcCta");
  var slider = document.getElementById("estateValueSlider");
  var sliderValueEl = document.getElementById("calcSliderValue");

  if (!input || !calcBtn || !output) return;

  function calcStatutoryFee(value) {
    // California Probate Code §10810 - attorney fee (executor fee is equal)
    var fee = 0;
    if (value <= 100000) {
      fee = value * 0.04;
    } else if (value <= 200000) {
      fee = 4000 + (value - 100000) * 0.03;
    } else if (value <= 1000000) {
      fee = 7000 + (value - 200000) * 0.02;
    } else if (value <= 10000000) {
      fee = 23000 + (value - 1000000) * 0.01;
    } else {
      fee = 113000 + (value - 10000000) * 0.005;
    }
    return fee * 2; // attorney + executor = doubled
  }

  function formatCurrency(n) {
    return "$" + Math.round(n).toLocaleString("en-US");
  }

  var errorMsg = document.createElement("p");
  errorMsg.className = "calc-error";
  errorMsg.setAttribute("role", "alert");
  errorMsg.hidden = true;
  input.parentNode.parentNode.appendChild(errorMsg);

  function calculate(opts) {
    opts = opts || {};
    var raw = input.valueAsNumber;
    if (!Number.isFinite(raw) || raw <= 0) {
      if (opts.silent) return;
      errorMsg.textContent =
        "Please enter an estate value greater than $0 (e.g. 800000).";
      errorMsg.hidden = false;
      input.focus();
      return;
    }
    errorMsg.hidden = true;
    var probateCost = calcStatutoryFee(raw);
    // Keep in sync with the "Starting at $2,495" figure quoted for the
    // Complete Living Trust Package in the pricing section on index.html.
    var trustPackage = 2495;
    var savings = probateCost - trustPackage;

    probateCostEl.textContent = formatCurrency(probateCost) + " minimum";
    savingsEl.textContent =
      savings > 0
        ? formatCurrency(savings) + " minimum"
        : "No savings (trust cost exceeds estimated probate fees)";

    if (calcCta) {
      if (savings > 500) {
        calcCta.textContent =
          "Your family could avoid at least " +
          formatCurrency(savings) +
          " in statutory fees → Book a Free Consultation";
      } else {
        calcCta.textContent =
          "Protect Your Estate Before Probate Costs Start →";
      }
    }

    output.hidden = false;
    if (!opts.silent) {
      var reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      output.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "nearest",
      });
    }
  }

  calcBtn.addEventListener("click", calculate);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") calculate();
  });

  if (slider && sliderValueEl) {
    var syncSliderLabel = function () {
      sliderValueEl.textContent = formatCurrency(Number(slider.value));
    };
    syncSliderLabel();

    slider.addEventListener("input", function () {
      syncSliderLabel();
      input.value = slider.value;
      calculate({ silent: true });
    });

    input.addEventListener("input", function () {
      var raw = input.valueAsNumber;
      if (Number.isFinite(raw)) {
        var clamped = Math.min(
          Math.max(raw, Number(slider.min)),
          Number(slider.max),
        );
        slider.value = String(clamped);
        syncSliderLabel();
        if (!output.hidden) calculate({ silent: true });
      }
    });
  }
})();
