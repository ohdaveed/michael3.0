// Scroll-triggered animations
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

document.querySelectorAll('.animate').forEach(el => observer.observe(el));

const nav = document.getElementById('nav');
const stickyCta = document.getElementById('stickyCta');
const main = document.querySelector('main');
const footer = document.querySelector('footer');

function setMobileMenuState(isOpen) {
  if (!mobileToggle || !navLinks) return;
  navLinks.classList.toggle('open', isOpen);
  mobileToggle.setAttribute('aria-expanded', isOpen);
  document.body.style.overflow = isOpen ? 'hidden' : '';
  if (main) main.toggleAttribute('inert', isOpen);
  if (footer) footer.toggleAttribute('inert', isOpen);
}

function updateScrollUi() {
  const y = window.scrollY;
  if (nav) nav.classList.toggle('scrolled', y > 60);
  if (stickyCta) {
    stickyCta.classList.toggle('visible', y > window.innerHeight * 0.8);
  }
}

if (nav || stickyCta) {
  window.addEventListener('scroll', updateScrollUi, { passive: true });
  updateScrollUi();
}

// Mobile nav toggle
const mobileToggle = document.querySelector('.mobile-toggle');
const navLinks = document.querySelector('.nav-links');
if (mobileToggle && navLinks) {
  mobileToggle.setAttribute('aria-haspopup', 'true');
  mobileToggle.addEventListener('click', () => {
    const isOpen = !navLinks.classList.contains('open');
    setMobileMenuState(isOpen);
    if (isOpen) {
      const firstLink = navLinks.querySelector('a');
      if (firstLink) requestAnimationFrame(() => firstLink.focus());
    } else {
      mobileToggle.focus();
    }
  });
  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      setMobileMenuState(false);
      mobileToggle.focus();
    });
  });
}

// Decorative SVGs should be ignored by assistive tech.
document.querySelectorAll('.sticky-cta svg, .faq-icon, .practice-icon, .trust-item svg, .pricing-feature svg, .video-placeholder svg').forEach((icon) => {
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
});

// Smooth scroll for same-page anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const hash = this.getAttribute('href');
    if (!hash || hash === '#' || hash.length < 2) return;
    const id = decodeURIComponent(hash.slice(1));
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    const navHeight = nav ? nav.offsetHeight : 0;
    const targetPosition = target.offsetTop - navHeight - 20;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({
      top: targetPosition,
      behavior: reduceMotion ? 'auto' : 'smooth'
    });
  });
});

// FAQ Accordion
document.querySelectorAll('.faq-item').forEach((faqItem, idx) => {
  const button = faqItem.querySelector('.faq-question');
  const answer = faqItem.querySelector('.faq-answer');
  if (!button || !answer) return;

  const answerId = answer.id || `faq-answer-${idx + 1}`;
  answer.id = answerId;
  button.setAttribute('aria-controls', answerId);
  answer.setAttribute('role', 'region');
  if (!answer.hasAttribute('aria-labelledby')) {
    const buttonId = button.id || `faq-question-${idx + 1}`;
    button.id = buttonId;
    answer.setAttribute('aria-labelledby', buttonId);
  }
  answer.hidden = !faqItem.classList.contains('active');

  button.addEventListener('click', () => {
    const isActive = faqItem.classList.contains('active');

    document.querySelectorAll('.faq-item').forEach(item => {
      item.classList.remove('active');
      const itemButton = item.querySelector('.faq-question');
      const itemAnswer = item.querySelector('.faq-answer');
      itemButton?.setAttribute('aria-expanded', 'false');
      if (itemAnswer) itemAnswer.hidden = true;
    });

    if (!isActive) {
      faqItem.classList.add('active');
      button.setAttribute('aria-expanded', 'true');
      answer.hidden = false;
    }
  });
});

// Contact Form Handler with Web3Forms
const contactForm = document.getElementById('contactForm');
const formMessage = document.getElementById('formMessage');

if (contactForm && formMessage) {
  contactForm.addEventListener('submit', async function (e) {
    e.preventDefault();

    const submitButton = this.querySelector('button[type="submit"]');
    if (!submitButton) return;

    const originalButtonText = submitButton.textContent;

    submitButton.disabled = true;
    submitButton.textContent = 'Sending...';

    formMessage.textContent = '';
    formMessage.className = 'form-message';

    let leavePage = false;
    try {
      const formData = new FormData(this);
      const response = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (data.success) {
        leavePage = true;
        const thankYou = new URL('thank-you.html', window.location.href);
        window.location.assign(thankYou.href);
        return;
      } else {
        throw new Error(data.message || 'Form submission failed');
      }
    } catch (error) {
      formMessage.textContent = 'There was an error sending your message. Please try again in a moment, or email michael@lehr-law.com directly.';
      formMessage.className = 'form-message error';
      console.error('Form submission error:', error);
    } finally {
      if (!leavePage) {
        submitButton.disabled = false;
        submitButton.textContent = originalButtonText;
      }
    }
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && navLinks && navLinks.classList.contains('open')) {
    setMobileMenuState(false);
    if (mobileToggle) {
      mobileToggle.focus();
    }
  }
});

if (mobileToggle && navLinks) {
  const focusableElements = navLinks.querySelectorAll('a, button');
  if (focusableElements.length > 0) {
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    navLinks.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && navLinks.classList.contains('open')) {
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
  const startView = document.getElementById('quizStartView');
  const questionsView = document.getElementById('quizQuestionsView');
  const resultView = document.getElementById('quizResultView');
  const startBtn = document.getElementById('quizStartBtn');
  const progressFill = document.getElementById('quizProgressFill');
  const progressLabel = document.getElementById('quizProgressLabel');
  const progressBar = document.getElementById('quizProgress');
  const questionArea = document.getElementById('quizQuestionArea');

  if (!startView || !questionsView || !resultView || !startBtn) return;

  const questions = [
    'Do you have a living trust or will already in place?',
    'Has your estate plan been reviewed in the last 3 years?',
    'Do you have a healthcare directive and durable power of attorney?',
    'Are beneficiaries clearly named on all your accounts and insurance policies?',
    'Have you set up a guardianship plan or provisions for dependents?'
  ];

  let current = 0;
  let noCount = 0;

  function showQuestion(index) {
    const currentQuestion = index + 1;
    const pct = Math.round((currentQuestion / questions.length) * 100);
    progressFill.style.width = pct + '%';
    progressBar.setAttribute('aria-valuenow', currentQuestion);
    progressBar.setAttribute('aria-valuemax', questions.length);
    progressLabel.textContent = 'Question ' + currentQuestion + ' of ' + questions.length;

    questionArea.innerHTML =
      '<p class="quiz-question-text">' + questions[index] + '</p>' +
      '<div class="quiz-options">' +
        '<button type="button" class="quiz-option-btn" data-answer="yes" aria-label="Yes: ' + questions[index] + '">Yes</button>' +
        '<button type="button" class="quiz-option-btn" data-answer="no" aria-label="No or not sure: ' + questions[index] + '">No / Not sure</button>' +
      '</div>';

    questionArea.querySelectorAll('.quiz-option-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (this.dataset.answer === 'no') noCount++;
        current++;
        if (current < questions.length) {
          showQuestion(current);
        } else {
          showResult();
        }
      });
    });
  }

  function showResult() {
    questionsView.hidden = true;
    resultView.hidden = false;

    var score = questions.length - noCount;
    var message, detail, urgencyClass;

    if (noCount === 0) {
      message = 'Your estate looks well-prepared.';
      detail = 'You\'ve checked all the key boxes. Schedule a free review with Michael to make sure nothing has changed and your documents are fully up to date.';
      urgencyClass = 'quiz-result--good';
    } else if (noCount <= 2) {
      message = 'You have ' + noCount + ' gap' + (noCount > 1 ? 's' : '') + ' worth addressing.';
      detail = 'A few missing pieces could leave your family exposed. A free consultation with Michael can identify exactly what\'s needed and how to fix it quickly.';
      urgencyClass = 'quiz-result--medium';
    } else {
      message = 'Your estate has ' + noCount + ' significant gaps.';
      detail = 'Without these protections in place, your family could face probate delays, avoidable costs, and legal uncertainty. Don\'t wait—a free consultation takes less than an hour.';
      urgencyClass = 'quiz-result--urgent';
    }

    resultView.className = 'quiz-result-view ' + urgencyClass;
    resultView.innerHTML =
      '<div class="quiz-result-score">' + score + '/' + questions.length + '</div>' +
      '<p class="quiz-result-score-label">Estate readiness score</p>' +
      '<p class="quiz-result-message">' + message + '</p>' +
      '<p class="quiz-result-detail">' + detail + '</p>' +
      '<div class="quiz-result-actions">' +
        '<a href="contact.html#contact" class="btn-primary">Book a Free Consultation →</a>' +
      '</div>' +
      '<button type="button" class="quiz-retake-btn" id="quizRetakeBtn">Retake the check</button>';

    resultView.querySelector('#quizRetakeBtn').addEventListener('click', resetQuiz);
  }

  function resetQuiz() {
    current = 0;
    noCount = 0;
    resultView.hidden = true;
    resultView.innerHTML = '';
    startView.hidden = false;
  }

  startBtn.addEventListener('click', function () {
    startView.hidden = true;
    questionsView.hidden = false;
    showQuestion(0);
  });
})();

// === PROBATE COST CALCULATOR ===
(function () {
  var input = document.getElementById('estateValueInput');
  var calcBtn = document.getElementById('calcGoBtn');
  var output = document.getElementById('calcOutput');
  var probateCostEl = document.getElementById('calcProbateCost');
  var savingsEl = document.getElementById('calcSavings');
  var calcCta = document.getElementById('calcCta');

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
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  var errorMsg = document.createElement('p');
  errorMsg.className = 'calc-error';
  errorMsg.setAttribute('role', 'alert');
  errorMsg.hidden = true;
  input.parentNode.parentNode.appendChild(errorMsg);

  function calculate() {
    var raw = parseFloat(input.value);
    if (!raw || raw <= 0) {
      errorMsg.textContent = 'Please enter an estate value greater than $0 (e.g. 800000).';
      errorMsg.hidden = false;
      input.focus();
      return;
    }
    errorMsg.hidden = true;
    var probateCost = calcStatutoryFee(raw);
    var trustPackage = 2495;
    var savings = probateCost - trustPackage;

    probateCostEl.textContent = formatCurrency(probateCost) + ' minimum';
    savingsEl.textContent = savings > 0 ? formatCurrency(savings) + ' minimum' : 'No savings (trust cost exceeds estimated probate fees)';

    if (calcCta) {
      if (savings > 500) {
        var savingsFormatted = formatCurrency(Math.min(savings, 9999999));
        calcCta.textContent = 'Save Your Family ' + savingsFormatted + ' → Book a Free Consultation';
      } else {
        calcCta.textContent = 'Start Protecting Your Estate →';
      }
    }

    output.hidden = false;
    output.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  calcBtn.addEventListener('click', calculate);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') calculate();
  });
})();
