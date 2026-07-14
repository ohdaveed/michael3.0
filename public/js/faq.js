import { useAccordion } from "./hooks.js";

// FAQ Accordion
useAccordion(".faq-item", ".faq-question", ".faq-answer", "active");

// FAQ Search with Fuse.js — imported dynamically so the library is only
// fetched on the page that actually has the search box (faq.html), instead
// of riding along in the shared bundle on every page.
(async function () {
  const searchInput = document.getElementById("faqSearchInput");
  const clearBtn = document.getElementById("faqSearchClear");
  const noResults = document.getElementById("faqNoResults");
  const searchStatus = document.getElementById("faqSearchStatus");
  const faqItems = Array.from(document.querySelectorAll(".faq-item"));

  if (!searchInput || faqItems.length === 0) return;

  const { default: Fuse } = await import("fuse.js");

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
