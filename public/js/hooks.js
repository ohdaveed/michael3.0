/**
 * Monitors scroll position and notifies when it crosses a threshold.
 *
 * @param {Function} callback - Receives the passed state and current scroll position.
 * @param {number|Function} threshold - A threshold value or a function that returns one.
 * @return {Function} A cleanup function that removes the scroll listener.
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
 * Creates an IntersectionObserver wrapper for observing elements immediately or on demand.
 * Supports `(elementsOrSelector, callback, options)` and `(callback, options)` signatures.
 *
 * @param {string|Element|Element[]|NodeList|Function} first - Elements, a selector, or the observer callback.
 * @param {Function|Object} [second] - The observer callback or options.
 * @param {Object} [third] - Observer options when `first` specifies elements.
 * @return {Function} A function that observes targets and exposes observer control methods.
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
 * Initializes accordion items with accessibility attributes and exclusive toggle behavior.
 *
 * @param {string} accordionSelector - Selector for the accordion items.
 * @param {string} questionSelector - Selector for each item's trigger button.
 * @param {string} answerSelector - Selector for each item's answer panel.
 * @param {string} activeClass - Class applied to the expanded item.
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
