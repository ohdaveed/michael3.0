import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import Fuse from "fuse.js";
import JustValidate from "just-validate";
import { useScroll, useIntersectionObserver, useAccordion } from "./hooks.js";

// Scroll-triggered animations
// threshold 0.15 + a -40px bottom margin means an element must be 15% visible
// and already 40px past the viewport edge before it fades in — avoids
// triggering the animation the instant a section's top pixel appears.
useIntersectionObserver(
  ".animate",
  (entries, observer) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
);

const nav = document.getElementById("nav");
const stickyCta = document.getElementById("stickyCta");
const main = document.querySelector("main");
const footer = document.querySelector("footer");
const mobileToggle = document.querySelector(".mobile-toggle");
const navLinks = document.querySelector(".nav-links");

if (nav) {
  nav.setAttribute("aria-label", "Primary");
}

function normalizePathname(pathname) {
  const last = pathname.split("/").filter(Boolean).pop();
  return last || "index.html";
}

function setCurrentNavLink() {
  if (!navLinks) return;
  const currentPath = normalizePathname(window.location.pathname);
  const currentHash = window.location.hash;
  const matchingLinks = [];

  navLinks
    .querySelectorAll("a[aria-current]")
    .forEach((link) => link.removeAttribute("aria-current"));

  navLinks.querySelectorAll("a[href]").forEach((link) => {
    const href = link.getAttribute("href");
    if (!href) return;

    const linkUrl = new URL(href, window.location.href);
    const linkPath = normalizePathname(linkUrl.pathname);
    const hashOnlyMatch = href.startsWith("#") && href === currentHash;
    const samePage = linkPath === currentPath;
    const hashMatches = !linkUrl.hash || linkUrl.hash === currentHash;

    if ((samePage && hashMatches) || hashOnlyMatch) {
      matchingLinks.push(link);
    }
  });

  const nonCtaMatch = matchingLinks.find(
    (link) => !link.classList.contains("nav-cta"),
  );
  const activeLink = nonCtaMatch || matchingLinks[0];
  if (activeLink) {
    activeLink.setAttribute("aria-current", "page");
  }
}

setCurrentNavLink();

function setMobileMenuState(isOpen) {
  if (!mobileToggle || !navLinks) return;
  navLinks.classList.toggle("open", isOpen);
  mobileToggle.setAttribute("aria-expanded", isOpen);
  mobileToggle.setAttribute("aria-label", isOpen ? "Close menu" : "Open menu");
  navLinks.setAttribute("aria-hidden", String(!isOpen));
  document.body.style.overflow = isOpen ? "hidden" : "";
  if (main) main.toggleAttribute("inert", isOpen);
  if (footer) footer.toggleAttribute("inert", isOpen);
}

if (nav) {
  useScroll((isPassed) => {
    nav.classList.toggle("scrolled", isPassed);
  }, 60);
}

if (stickyCta) {
  useScroll(
    (isPassed) => {
      stickyCta.classList.toggle("visible", isPassed);
    },
    () => window.innerHeight * 0.8,
  );
}

// Mobile nav toggle
if (mobileToggle && navLinks) {
  mobileToggle.setAttribute("aria-haspopup", "true");
  mobileToggle.setAttribute("aria-label", "Open menu");
  navLinks.setAttribute("aria-hidden", "true");
  mobileToggle.addEventListener("click", () => {
    const isOpen = !navLinks.classList.contains("open");
    setMobileMenuState(isOpen);
    if (isOpen) {
      const firstLink = navLinks.querySelector("a");
      if (firstLink) requestAnimationFrame(() => firstLink.focus());
    } else {
      mobileToggle.focus();
    }
  });
  navLinks.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      setMobileMenuState(false);
      mobileToggle.focus();
    });
  });
}

// Decorative SVGs should be ignored by assistive tech.
document
  .querySelectorAll(
    ".sticky-cta svg, .faq-icon, .practice-icon, .trust-item svg, .pricing-feature svg, .video-placeholder svg",
  )
  .forEach((icon) => {
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("focusable", "false");
  });

// Smooth scroll for same-page anchor links
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", function (e) {
    const hash = this.getAttribute("href");
    if (!hash || hash === "#" || hash.length < 2) return;
    const id = decodeURIComponent(hash.slice(1));
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    const navHeight = nav ? nav.offsetHeight : 0;
    const subnav = document.getElementById("sectionSubnav");
    const subnavHeight = subnav ? subnav.offsetHeight : 0;
    const targetPosition = target.offsetTop - navHeight - subnavHeight - 20;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    window.scrollTo({
      top: targetPosition,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  });
});

// FAQ Accordion
useAccordion(".faq-item", ".faq-question", ".faq-answer", "active");

// FAQ Search with Fuse.js
(function () {
  const searchInput = document.getElementById("faqSearchInput");
  const clearBtn = document.getElementById("faqSearchClear");
  const noResults = document.getElementById("faqNoResults");
  const searchStatus = document.getElementById("faqSearchStatus");
  const faqItems = Array.from(document.querySelectorAll(".faq-item"));

  if (!searchInput || faqItems.length === 0) return;

  // 1. Index the DOM elements
  const faqData = faqItems.map((item, index) => {
    const questionText =
      item.querySelector(".faq-question span")?.textContent || "";
    const answerText = item.querySelector(".faq-answer p")?.textContent || "";
    return {
      element: item,
      index: index,
      question: questionText,
      answer: answerText,
    };
  });

  // 2. Initialize Fuse.js
  const fuse = new Fuse(faqData, {
    keys: [
      { name: "question", weight: 0.7 },
      { name: "answer", weight: 0.3 },
    ],
    threshold: 0.35,
    ignoreLocation: true,
  });

  function performSearch() {
    const query = searchInput.value.trim();

    if (clearBtn) {
      clearBtn.hidden = query.length === 0;
    }

    if (query.length === 0) {
      // Show all if empty query
      faqItems.forEach((item) => {
        item.style.display = "";
      });
      if (noResults) noResults.style.display = "none";
      if (searchStatus) searchStatus.textContent = "";
      return;
    }

    const results = fuse.search(query);
    const matchedElements = new Set(results.map((r) => r.item.element));

    faqItems.forEach((item) => {
      if (matchedElements.has(item)) {
        item.style.display = "";
      } else {
        item.style.display = "none";
        // Reset state of hidden items
        item.classList.remove("active");
        const button = item.querySelector(".faq-question");
        const answer = item.querySelector(".faq-answer");
        if (button) button.setAttribute("aria-expanded", "false");
        if (answer) answer.hidden = true;
      }
    });

    if (noResults) {
      noResults.style.display = results.length === 0 ? "block" : "none";
    }

    if (searchStatus) {
      searchStatus.textContent = `${results.length} question${results.length === 1 ? "" : "s"} found matching "${query}".`;
    }
  }

  searchInput.addEventListener("input", performSearch);

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      searchInput.value = "";
      performSearch();
      searchInput.focus();
    });
  }
})();

// Contact Form Handler with Web3Forms & JustValidate
const contactForm = document.getElementById("contactForm");
const formMessage = document.getElementById("formMessage");

if (contactForm && formMessage) {
  const validator = new JustValidate(contactForm, {
    errorFieldCssClass: "is-invalid",
    errorLabelCssClass: "just-validate-error-label",
    errorLabelStyle: {
      color: "var(--gold-text)",
      fontSize: "0.85rem",
      marginTop: "0.25rem",
      display: "block",
    },
  });

  validator
    .addField("#fname", [
      {
        rule: "required",
        errorMessage: "First name is required.",
      },
    ])
    .addField("#lname", [
      {
        rule: "required",
        errorMessage: "Last name is required.",
      },
    ])
    .addField("#email", [
      {
        rule: "required",
        errorMessage: "Email is required.",
      },
      {
        rule: "email",
        errorMessage: "Please enter a valid email address.",
      },
    ])
    .addField("#message", [
      {
        rule: "required",
        errorMessage: "Message is required.",
      },
    ])
    .onSuccess(async () => {
      const submitButton = contactForm.querySelector('button[type="submit"]');
      if (!submitButton) return;

      const originalButtonText = submitButton.textContent;

      submitButton.disabled = true;
      submitButton.textContent = "Sending...";

      formMessage.textContent = "";
      formMessage.className = "form-message";
      formMessage.setAttribute("role", "status");

      let leavePage = false;
      try {
        const formData = new FormData(contactForm);
        const response = await fetch("https://api.web3forms.com/submit", {
          method: "POST",
          body: formData,
        });

        const data = await response.json();

        if (data.success) {
          leavePage = true;
          const thankYou = new URL("thank-you.html", window.location.href);
          window.location.assign(thankYou.href);
          return;
        } else {
          throw new Error(data.message || "Form submission failed");
        }
      } catch (error) {
        formMessage.textContent =
          "There was an error sending your message. Please try again in a moment, or email michael@lehr-law.com directly.";
        formMessage.className = "form-message error";
        formMessage.setAttribute("role", "alert");
        console.error("Form submission error:", error);
      } finally {
        if (!leavePage) {
          submitButton.disabled = false;
          submitButton.textContent = originalButtonText;
        }
      }
    });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && navLinks && navLinks.classList.contains("open")) {
    setMobileMenuState(false);
    if (mobileToggle) {
      mobileToggle.focus();
    }
  }
});

if (mobileToggle && navLinks) {
  const focusableElements = navLinks.querySelectorAll("a, button");
  if (focusableElements.length > 0) {
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    navLinks.addEventListener("keydown", (e) => {
      if (e.key === "Tab" && navLinks.classList.contains("open")) {
        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    });
  }
}

// === ESTATE READINESS QUIZ ===
(function () {
  const startView = document.getElementById("quizStartView");
  const questionsView = document.getElementById("quizQuestionsView");
  const resultView = document.getElementById("quizResultView");
  const startBtn = document.getElementById("quizStartBtn");
  const progressFill = document.getElementById("quizProgressFill");
  const progressLabel = document.getElementById("quizProgressLabel");
  const progressBar = document.getElementById("quizProgress");
  const questionArea = document.getElementById("quizQuestionArea");

  if (!startView || !questionsView || !resultView || !startBtn) return;

  const questions = [
    {
      text: "Do you have a living trust or will already in place?",
      gapAnchor: "services.html#living-trusts",
      gapLabel: "Explore Living Trusts",
    },
    {
      text: "Has your estate plan been reviewed in the last 3 years?",
      gapAnchor: "services.html#estate-planning",
      gapLabel: "Explore Estate Planning",
    },
    {
      text: "Do you have a healthcare directive and durable power of attorney?",
      gapAnchor: "services.html#wills-powers-of-attorney",
      gapLabel: "Explore Wills & Powers of Attorney",
    },
    {
      text: "Are beneficiaries clearly named on all your accounts and insurance policies?",
      gapAnchor: "services.html#funding-checklist",
      gapLabel: "See the Trust Funding Checklist",
    },
    {
      text: "Have you set up a guardianship plan or provisions for dependents?",
      gapAnchor: "services.html#estate-planning",
      gapLabel: "Explore Estate Planning",
    },
  ];

  let current = 0;
  let noCount = 0;
  let firstGap = null;

  function showQuestion(index) {
    const currentQuestion = index + 1;
    const pct = Math.round((currentQuestion / questions.length) * 100);
    progressFill.style.width = pct + "%";
    progressBar.setAttribute("aria-valuenow", currentQuestion);
    progressBar.setAttribute("aria-valuemax", questions.length);
    progressLabel.textContent =
      "Question " + currentQuestion + " of " + questions.length;

    var questionText = questions[index].text;
    questionArea.innerHTML =
      '<p class="quiz-question-text">' +
      questionText +
      "</p>" +
      '<div class="quiz-options">' +
      '<button type="button" class="quiz-option-btn" data-answer="yes" aria-label="Yes: ' +
      questionText +
      '">Yes</button>' +
      '<button type="button" class="quiz-option-btn" data-answer="no" aria-label="No or not sure: ' +
      questionText +
      '">No / Not sure</button>' +
      "</div>";

    questionArea.querySelectorAll(".quiz-option-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (this.dataset.answer === "no") {
          noCount++;
          if (!firstGap) firstGap = questions[index];
        }
        current++;
        if (current < questions.length) {
          showQuestion(current);
        } else {
          showResult();
        }
      });
    });

    var firstOptionButton = questionArea.querySelector(".quiz-option-btn");
    if (firstOptionButton) {
      firstOptionButton.focus();
    }
  }

  function showResult() {
    questionsView.hidden = true;
    resultView.hidden = false;

    var score = questions.length - noCount;
    var message, detail, urgencyClass;

    // Tiering: 0 gaps reads as "well-prepared", 1-2 as a few fixable gaps,
    // 3+ (out of 5 questions) as significant exposure worth an urgent call.
    if (noCount === 0) {
      message = "Your estate looks well-prepared.";
      detail =
        "You've checked all the key boxes. Schedule a free review with Michael to make sure nothing has changed and your documents are fully up to date.";
      urgencyClass = "quiz-result--good";
    } else if (noCount <= 2) {
      message =
        "You have " +
        noCount +
        " gap" +
        (noCount > 1 ? "s" : "") +
        " worth addressing.";
      detail =
        "A few missing pieces could leave your family exposed. A free consultation with Michael can identify exactly what's needed and how to fix it quickly.";
      urgencyClass = "quiz-result--medium";
    } else {
      message = "Your estate has " + noCount + " significant gaps.";
      detail =
        "Without these protections, probate can mean months in court, minimum statutory fees, and avoidable pressure on your family. A free consultation can identify the biggest gaps quickly.";
      urgencyClass = "quiz-result--urgent";
    }

    var actionsHtml;
    if (firstGap) {
      // Route to the most relevant service first (lower commitment than
      // booking outright), with consultation as the secondary action.
      actionsHtml =
        '<div class="quiz-result-actions">' +
        '<a href="' +
        firstGap.gapAnchor +
        '" class="btn-primary">' +
        firstGap.gapLabel +
        " →</a>" +
        '<a href="contact.html#contact" class="btn-secondary">Book a Free Consultation →</a>' +
        "</div>";
    } else {
      actionsHtml =
        '<div class="quiz-result-actions">' +
        '<a href="contact.html#contact" class="btn-primary">Book a Free Consultation →</a>' +
        "</div>";
    }

    resultView.className = "quiz-result-view " + urgencyClass;
    resultView.innerHTML =
      '<div class="quiz-result-score">' +
      score +
      "/" +
      questions.length +
      "</div>" +
      '<p class="quiz-result-score-label">Estate readiness score</p>' +
      '<p class="quiz-result-message">' +
      message +
      "</p>" +
      '<p class="quiz-result-detail">' +
      detail +
      "</p>" +
      actionsHtml +
      '<button type="button" class="quiz-retake-btn" id="quizRetakeBtn">Retake the check</button>';

    resultView
      .querySelector("#quizRetakeBtn")
      .addEventListener("click", resetQuiz);
  }

  function resetQuiz() {
    current = 0;
    noCount = 0;
    firstGap = null;
    resultView.hidden = true;
    resultView.innerHTML = "";
    startView.hidden = false;
  }

  startBtn.addEventListener("click", function () {
    startView.hidden = true;
    questionsView.hidden = false;
    showQuestion(0);
  });
})();

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

// Trust funding checklist (localStorage-persisted)
(function () {
  var list = document.getElementById("fundingChecklistList");
  if (!list) return;

  // Checkbox state is keyed by each item's data-funding-id (see below), so
  // renaming or removing an id just orphans its old localStorage entry
  // rather than corrupting others — no migration needed for item changes.
  var STORAGE_KEY = "lehr-law-funding-checklist";
  var track = document.getElementById("fundingProgress");
  var fill = document.getElementById("fundingProgressFill");
  var label = document.getElementById("fundingProgressLabel");
  var checkboxes = Array.prototype.slice.call(
    list.querySelectorAll('input[type="checkbox"]'),
  );
  var total = checkboxes.length;

  function loadState() {
    try {
      return JSON.parse(window.localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function saveState(state) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // localStorage unavailable (private browsing, quota) - degrade to session-only state
    }
  }

  function updateProgress() {
    var checked = checkboxes.filter(function (cb) {
      return cb.checked;
    }).length;
    var pct = total ? Math.round((checked / total) * 100) : 0;
    fill.style.width = pct + "%";
    if (track) track.setAttribute("aria-valuenow", String(pct));
    label.textContent = checked + " of " + total + " assets retitled";
  }

  var state = loadState();
  checkboxes.forEach(function (cb) {
    var id = cb.getAttribute("data-funding-id");
    if (state[id]) cb.checked = true;
    cb.addEventListener("change", function () {
      var current = loadState();
      current[id] = cb.checked;
      saveState(current);
      updateProgress();
    });
  });

  updateProgress();
})();

// Interactive Onboarding Tour using driver.js
// Walks a visitor through the six #step-* cards on process.html; gated on
// #start-tour-btn existing so this is a no-op on every other page.
(function () {
  const startBtn = document.getElementById("start-tour-btn");
  if (!startBtn) return;

  startBtn.addEventListener("click", () => {
    const driverObj = driver({
      showProgress: true,
      allowClose: true,
      animate: true,
      overlayColor: "rgba(10, 25, 47, 0.85)", // Deep navy matching site theme
      steps: [
        {
          element: "#start-tour-btn",
          popover: {
            title: "Welcome to the Guided Tour!",
            description:
              "Let's walk through the six simple steps we use to build your custom estate plan and secure your peace of mind.",
            side: "bottom",
            align: "center",
          },
        },
        {
          element: "#step-consultation",
          popover: {
            title: "Step 1: Free Consultation",
            description:
              "We meet for 45-60 minutes (in office, at your home, or remotely) to review your assets, goals, and quote an upfront flat fee.",
            side: "top",
            align: "start",
          },
        },
        {
          element: "#step-design",
          popover: {
            title: "Step 2: Designing Your Plan",
            description:
              "You complete a secure questionnaire. We then design the custom blueprint for your wills, trusts, and healthcare directives.",
            side: "top",
            align: "start",
          },
        },
        {
          element: "#step-drafting",
          popover: {
            title: "Step 3: Drafting & Revisions",
            description:
              "We draft your documents and provide unlimited reviews. We make revisions until you understand and approve every clause.",
            side: "top",
            align: "start",
          },
        },
        {
          element: "#step-signing",
          popover: {
            title: "Step 4: The Signing Ceremony",
            description:
              "We gather in person with witnesses and a notary to properly execute your documents, ensuring they are fully legally binding.",
            side: "top",
            align: "start",
          },
        },
        {
          element: "#step-implementation",
          popover: {
            title: "Step 5: Funding Your Trust",
            description:
              "Important: We prepare new real estate deeds and coach you step-by-step on retitling bank and brokerage accounts into your trust.",
            side: "top",
            align: "start",
          },
        },
        {
          element: "#step-ongoing",
          popover: {
            title: "Step 6: Ongoing Support",
            description:
              "As your life evolves (births, marriages, moves, or major purchases), we update your plan to ensure it always protects your legacy.",
            side: "top",
            align: "start",
          },
        },
        {
          element: ".process-cta",
          popover: {
            title: "Begin Your Plan Today",
            description:
              "Ready to take the first step? Send Michael a message to schedule your free consultation.",
            side: "top",
            align: "center",
          },
        },
      ],
    });
    driverObj.drive();
  });
})();

// === STICKY SECTION SUB-NAV (scroll-spy) ===
(function () {
  const subnav = document.getElementById("sectionSubnav");
  if (!subnav) return;

  const links = Array.from(subnav.querySelectorAll("a[href^='#']"));
  const targets = links
    .map((link) => {
      const id = decodeURIComponent(link.getAttribute("href").slice(1));
      const el = document.getElementById(id);
      return el ? { link, el } : null;
    })
    .filter(Boolean);

  if (!targets.length) return;

  function setActive(id) {
    links.forEach((link) => {
      const isActive =
        decodeURIComponent(link.getAttribute("href").slice(1)) === id;
      link.classList.toggle("active", isActive);
      if (isActive) {
        link.setAttribute("aria-current", "true");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  useIntersectionObserver(
    targets.map((t) => t.el),
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setActive(entry.target.id);
        }
      });
    },
    { rootMargin: "-45% 0px -50% 0px", threshold: 0 },
  );
})();
