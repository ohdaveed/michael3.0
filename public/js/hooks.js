/**
 * A throttled scroll handler that uses requestAnimationFrame to monitor scroll position
 * and execute a callback when scroll y passes a threshold.
 *
 * @param {Function} callback - Executed with (isPassed, scrollY) when the threshold is crossed.
 * @param {number|Function} threshold - The threshold value or a function returning a threshold value.
 * @returns {Function} A cleanup function to remove the scroll listener.
 */
export function useScroll(callback, threshold) {
  let ticked = false;
  let previouslyPassed = null;

  const getThreshold = () => {
    return typeof threshold === "function" ? threshold() : threshold;
  };

  const checkScroll = () => {
    const currentScroll = window.scrollY;
    const thresh = getThreshold();
    const isPassed = currentScroll > thresh;

    if (isPassed !== previouslyPassed) {
      previouslyPassed = isPassed;
      callback(isPassed, currentScroll);
    }
  };

  const handler = () => {
    if (!ticked) {
      window.requestAnimationFrame(() => {
        checkScroll();
        ticked = false;
      });
      ticked = true;
    }
  };

  // Run initial check
  checkScroll();

  window.addEventListener("scroll", handler, { passive: true });

  return () => {
    window.removeEventListener("scroll", handler);
  };
}

/**
 * A reusable helper around IntersectionObserver that takes a list of elements/selectors
 * and runs the callback when they intersect. Supports dual signature:
 * - useIntersectionObserver(elementsOrSelector, callback, options)
 * - useIntersectionObserver(callback, options) (returns an observe function/wrapper)
 *
 * @param {string|Element|Element[]|NodeList|Function} first - Selector, element(s), or the callback function.
 * @param {Function|Object} [second] - Callback function or options object.
 * @param {Object} [third] - Options object if first is selector/elements.
 * @returns {Object & Function} An observe function that also exposes observer control methods.
 */
export function useIntersectionObserver(first, second, third) {
  let elementsOrSelector = null;
  let callback = null;
  let options = null;

  if (typeof first === "function") {
    callback = first;
    options = second;
  } else {
    elementsOrSelector = first;
    callback = second;
    options = third;
  }

  const observer = new IntersectionObserver(callback, options);

  const observe = (targets) => {
    if (!targets) return;
    const elements =
      typeof targets === "string"
        ? document.querySelectorAll(targets)
        : targets;

    if (NodeList.prototype.isPrototypeOf(elements) || Array.isArray(elements)) {
      elements.forEach((el) => observer.observe(el));
    } else if (elements instanceof Element) {
      observer.observe(elements);
    }
  };

  if (elementsOrSelector) {
    observe(elementsOrSelector);
  }

  const fn = (targets) => {
    observe(targets);
    return observer;
  };
  fn.observe = observe;
  fn.unobserve = (el) => observer.unobserve(el);
  fn.disconnect = () => observer.disconnect();
  fn.observer = observer;

  return fn;
}

/**
 * A reusable helper that sets up accessibility attributes and toggle behaviors for faq/accordion components.
 *
 * @param {string} accordionSelector - Selector for the individual accordion items (e.g. '.faq-item').
 * @param {string} questionSelector - Selector for the question trigger button (e.g. '.faq-question').
 * @param {string} answerSelector - Selector for the answer panel (e.g. '.faq-answer').
 * @param {string} activeClass - Class name to toggle when active (e.g. 'active').
 */
export function useAccordion(
  accordionSelector,
  questionSelector,
  answerSelector,
  activeClass,
) {
  const accordionItems = document.querySelectorAll(accordionSelector);

  accordionItems.forEach((faqItem, idx) => {
    const button = faqItem.querySelector(questionSelector);
    const answer = faqItem.querySelector(answerSelector);
    if (!button || !answer) return;

    // Set up accessibility attributes
    const answerId = answer.id || `faq-answer-${idx + 1}`;
    answer.id = answerId;
    button.setAttribute("aria-controls", answerId);
    answer.setAttribute("role", "region");

    if (!answer.hasAttribute("aria-labelledby")) {
      const buttonId = button.id || `faq-question-${idx + 1}`;
      button.id = buttonId;
      answer.setAttribute("aria-labelledby", buttonId);
    }

    const isActive = faqItem.classList.contains(activeClass);
    button.setAttribute("aria-expanded", String(isActive));
    answer.hidden = !isActive;

    button.addEventListener("click", () => {
      const itemIsActive = faqItem.classList.contains(activeClass);

      // Close other items
      accordionItems.forEach((item) => {
        item.classList.remove(activeClass);
        const itemButton = item.querySelector(questionSelector);
        const itemAnswer = item.querySelector(answerSelector);
        itemButton?.setAttribute("aria-expanded", "false");
        if (itemAnswer) itemAnswer.hidden = true;
      });

      // If it wasn't active, open it
      if (!itemIsActive) {
        faqItem.classList.add(activeClass);
        button.setAttribute("aria-expanded", "true");
        answer.hidden = false;
      }
    });
  });
}
