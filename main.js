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
  mobileToggle.addEventListener('click', () => {
    navLinks.classList.toggle('open');
    const isExpanded = navLinks.classList.contains('open');
    mobileToggle.setAttribute('aria-expanded', isExpanded);
    if (isExpanded) {
      const firstLink = navLinks.querySelector('a');
      if (firstLink) requestAnimationFrame(() => firstLink.focus());
    } else {
      mobileToggle.focus();
    }
  });
  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('open');
      mobileToggle.setAttribute('aria-expanded', 'false');
      mobileToggle.focus();
    });
  });
}

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
document.querySelectorAll('.faq-question').forEach(button => {
  button.addEventListener('click', () => {
    const faqItem = button.parentElement;
    const isActive = faqItem.classList.contains('active');

    document.querySelectorAll('.faq-item').forEach(item => {
      item.classList.remove('active');
      item.querySelector('.faq-question')?.setAttribute('aria-expanded', 'false');
    });

    if (!isActive) {
      faqItem.classList.add('active');
      button.setAttribute('aria-expanded', 'true');
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
    navLinks.classList.remove('open');
    if (mobileToggle) {
      mobileToggle.setAttribute('aria-expanded', 'false');
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
