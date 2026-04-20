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
