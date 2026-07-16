# E2E Test Coverage Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate the interactive surface of lehr-law.com (README's manual pre-launch checklist plus every JS-driven widget) as Playwright E2E specs, closing the gap where only the contact-form flow has coverage today.

**Architecture:** One new spec file per feature under `tests/e2e/`, all importing a shared `test`/`expect` pair from a new `tests/e2e/fixtures.js` that auto-blocks third-party network noise (GA's external script, Google Fonts) before every test. No application code changes — this plan only adds tests against existing, working `public/js/*.js` behavior.

**Tech Stack:** Playwright Test `@playwright/test@1.61.1` (already installed), running against the Vite dev server on `http://localhost:5173` per `playwright.config.js`.

## Global Constraints

- Never let a spec hit a real third-party endpoint that would create production side effects (real Tally leads, real GA4 hits, real Calendly page loads) — block or mock; this is the pattern `tests/e2e/send-a-message.spec.js` already established and this plan's design spec (`docs/superpowers/specs/2026-07-15-e2e-test-coverage-expansion-design.md`) requires.
- Prefer accessibility-first locators (`getByRole`, `getByLabel`) for interactive controls; CSS/id/data-attribute locators are fine for containers and elements with no ARIA role.
- Use Playwright's web-first, auto-retrying `expect(locator)...` assertions instead of manual `.evaluate()` snapshots, especially around scroll/reload/async timing.
- Every new spec file imports `test`/`expect` from `./fixtures.js`, not `@playwright/test` directly.
- Run `npx playwright test <file>` (or the full `npm run test:e2e`) after every task and get a real PASS before committing — no task is done on the strength of reading the code.

---

## Task 1: Shared third-party-blocking fixture

**Files:**

- Create: `tests/e2e/fixtures.js`
- Create: `tests/e2e/fixtures.spec.js`

**Interfaces:**

- Produces: `test` and `expect`, re-exported from `@playwright/test` with an auto-applying fixture that blocks `googletagmanager.com` and `fonts.(googleapis|gstatic).com` requests on every `page` before each test runs. Tasks 2–9 import both from this file: `import { test, expect } from "./fixtures.js";`

- [ ] **Step 1: Create the fixture file**

```js
// tests/e2e/fixtures.js
import { test as base, expect } from "@playwright/test";

// Auto-applied (no need to reference it in test args) to every test that
// imports `test` from this file. Blocks GA's external script and Google
// Fonts so specs never depend on, or send real traffic to, third-party
// services — the same blocking send-a-message.spec.js does inline, moved
// here once so the other 8 spec files don't repeat it.
export const test = base.extend({
  blockThirdParty: [
    async ({ page }, use) => {
      await page.route(
        /googletagmanager\.com|fonts\.(googleapis|gstatic)\.com/,
        (route) => route.abort(),
      );
      await use();
    },
    { auto: true },
  ],
});

export { expect };
```

- [ ] **Step 2: Create a smoke test for the fixture**

```js
// tests/e2e/fixtures.spec.js
import { test, expect } from "./fixtures.js";

test.describe("Shared third-party-blocking fixture", () => {
  test("aborts googletagmanager.com and Google Fonts requests automatically", async ({
    page,
  }) => {
    const failedHosts = [];
    page.on("requestfailed", (request) => {
      failedHosts.push(new URL(request.url()).hostname);
    });

    await page.goto("/index.html");
    await page.waitForLoadState("networkidle");

    expect(
      failedHosts.some((host) => host.includes("googletagmanager.com")),
    ).toBe(true);
    expect(
      failedHosts.some(
        (host) =>
          host.includes("fonts.googleapis.com") ||
          host.includes("fonts.gstatic.com"),
      ),
    ).toBe(true);
  });

  test("does not block same-origin requests", async ({ page }) => {
    const response = await page.goto("/index.html");
    expect(response.status()).toBe(200);
  });
});
```

- [ ] **Step 3: Run the test and verify it passes**

Run: `npx playwright test tests/e2e/fixtures.spec.js`
Expected: `2 passed`

- [ ] **Step 4: Mutation check — confirm the test actually detects a broken fixture**

Temporarily replace the `page.route(...)` call body in `tests/e2e/fixtures.js` with a no-op (comment out the `await page.route(...)` line entirely), then run:

Run: `npx playwright test tests/e2e/fixtures.spec.js`
Expected: the first test (`aborts googletagmanager.com...`) FAILS — `failedHosts` is empty because nothing was blocked.

Revert the comment-out so `tests/e2e/fixtures.js` matches Step 1 exactly again.

- [ ] **Step 5: Re-run to confirm both tests pass again**

Run: `npx playwright test tests/e2e/fixtures.spec.js`
Expected: `2 passed`

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/fixtures.js tests/e2e/fixtures.spec.js
git commit -m "test: add shared third-party-blocking fixture for E2E specs"
```

---

## Task 2: Navigation — mobile menu, focus management, active link

**Files:**

- Create: `tests/e2e/navigation.spec.js`

**Interfaces:**

- Consumes: `test`, `expect` from `tests/e2e/fixtures.js` (Task 1).

**Reference (already in the codebase, not modified by this task):**

- `public/js/nav.js` — mobile toggle logic, Escape handling, focus trap, `aria-current`.
- `public/partials/nav.html` — `<button class="mobile-toggle" aria-label="Menu" aria-expanded="false" aria-controls="nav-menu">`; `nav.js` overwrites `aria-label` to `"Open menu"` on init and toggles it to `"Close menu"` when open.
- `.mobile-toggle` only becomes visible below `max-width: 1150px` (`public/css/responsive/general.css`), so these tests need a narrow viewport.

- [ ] **Step 1: Write the spec file**

```js
// tests/e2e/navigation.spec.js
import { test, expect } from "./fixtures.js";

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const PAGES = ["/index.html", "/faq.html"];

test.describe("Mobile navigation menu", () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  for (const path of PAGES) {
    test(`opens and closes with Escape on ${path}`, async ({ page }) => {
      await page.goto(path);

      const navLinks = page.locator(".nav-links");

      await expect(navLinks).toHaveAttribute("aria-hidden", "true");
      await expect(
        page.getByRole("button", { name: /open menu/i }),
      ).toHaveAttribute("aria-expanded", "false");

      await page.getByRole("button", { name: /open menu/i }).click();

      await expect(navLinks).toHaveClass(/open/);
      await expect(navLinks).toHaveAttribute("aria-hidden", "false");
      await expect(
        page.getByRole("button", { name: /close menu/i }),
      ).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator("main")).toHaveAttribute("inert", "");
      await expect(navLinks.locator("a").first()).toBeFocused();

      await page.keyboard.press("Escape");

      await expect(navLinks).not.toHaveClass(/open/);
      await expect(navLinks).toHaveAttribute("aria-hidden", "true");
      await expect(
        page.getByRole("button", { name: /open menu/i }),
      ).toBeFocused();
      await expect(page.locator("main")).not.toHaveAttribute("inert", "");
    });
  }

  test("traps Tab focus while open", async ({ page }) => {
    await page.goto("/index.html");
    await page.getByRole("button", { name: /open menu/i }).click();

    const focusable = page.locator(".nav-links a, .nav-links button");
    const last = focusable.last();
    await last.focus();

    await page.keyboard.press("Tab");
    await expect(focusable.first()).toBeFocused();

    await page.keyboard.press("Shift+Tab");
    await expect(last).toBeFocused();
  });
});

test.describe("Active nav link", () => {
  test("marks the current page's nav link with aria-current", async ({
    page,
  }) => {
    await page.goto("/services.html");
    await expect(
      page.locator('.nav-links a[href="services.html"]'),
    ).toHaveAttribute("aria-current", "page");
  });
});
```

- [ ] **Step 2: Run the test and verify it passes**

Run: `npx playwright test tests/e2e/navigation.spec.js`
Expected: `4 passed` (2 pages × open/close test + Tab trap test + active-link test)

- [ ] **Step 3: Mutation check**

In `public/js/nav.js`, temporarily change the Escape handler condition so it never fires:

```js
document.addEventListener("keydown", (e) => {
  if (false && e.key === "Escape" && navLinks && navLinks.classList.contains("open")) {
```

Run: `npx playwright test tests/e2e/navigation.spec.js`
Expected: both `opens and closes with Escape on ...` tests FAIL (menu never closes, focus never returns to the toggle).

Revert `public/js/nav.js` to its original condition (`if (e.key === "Escape" && ...)`).

- [ ] **Step 4: Re-run to confirm all tests pass again**

Run: `npx playwright test tests/e2e/navigation.spec.js`
Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/navigation.spec.js
git commit -m "test: add E2E coverage for mobile nav, focus trap, and active link"
```

---

## Task 3: FAQ accordion and search

**Files:**

- Create: `tests/e2e/faq.spec.js`

**Interfaces:**

- Consumes: `test`, `expect` from `tests/e2e/fixtures.js` (Task 1).

**Reference:**

- `public/js/faq.js` (accordion via `useAccordion` in `public/js/hooks.js` — exclusive, one open at a time; search via Fuse.js, no debounce). Fuse.js searches both `question` (weight 0.7) and `answer` (weight 0.3) with `threshold: 0.35`, and only hides non-matches via inline `style.display = "none"` — they stay in the DOM, so `.locator(".faq-item")` always counts all 10 regardless of the search; use the `:visible` pseudo-class to count only the currently-shown items. A short query like `"probate take"` fuzzy-matches 4 of the 10 items (verified by running the installed `fuse.js` against the actual FAQ content: `probate` appears loosely across several answers) — the full literal question text is the only query confirmed (same verification) to match exactly 1 item.
- `public/faq.html` — 10 `.faq-item` elements; the second one's question is "How long does probate take in California?" (unique among the 10 questions).

- [ ] **Step 1: Write the spec file**

```js
// tests/e2e/faq.spec.js
import { test, expect } from "./fixtures.js";

test.describe("FAQ accordion", () => {
  test("expands one item and collapses others (exclusive toggle)", async ({
    page,
  }) => {
    await page.goto("/faq.html");

    const items = page.locator(".faq-item");
    const firstQuestion = items.nth(0).locator(".faq-question");
    const firstAnswer = items.nth(0).locator(".faq-answer");
    const secondQuestion = items.nth(1).locator(".faq-question");
    const secondAnswer = items.nth(1).locator(".faq-answer");

    await expect(firstQuestion).toHaveAttribute("aria-expanded", "false");
    await expect(firstAnswer).toBeHidden();

    await firstQuestion.click();
    await expect(firstQuestion).toHaveAttribute("aria-expanded", "true");
    await expect(firstAnswer).toBeVisible();

    await secondQuestion.click();
    await expect(secondQuestion).toHaveAttribute("aria-expanded", "true");
    await expect(secondAnswer).toBeVisible();
    await expect(firstQuestion).toHaveAttribute("aria-expanded", "false");
    await expect(firstAnswer).toBeHidden();

    await secondQuestion.click();
    await expect(secondQuestion).toHaveAttribute("aria-expanded", "false");
    await expect(secondAnswer).toBeHidden();
  });
});

test.describe("FAQ search", () => {
  test("filters to matching items and updates the live-region count", async ({
    page,
  }) => {
    await page.goto("/faq.html");

    await expect(page.locator(".faq-item")).toHaveCount(10);

    await page
      .locator("#faqSearchInput")
      .fill("How long does probate take in California");

    await expect(page.locator("#faqSearchStatus")).toHaveText(
      '1 question found matching "How long does probate take in California".',
    );
    await expect(
      page.locator(".faq-item", {
        hasText: "How long does probate take in California?",
      }),
    ).toBeVisible();
    await expect(
      page.locator(".faq-item", {
        hasText: "How much does a Living Trust cost?",
      }),
    ).toBeHidden();
  });

  test("shows the empty state for a query with no matches", async ({
    page,
  }) => {
    await page.goto("/faq.html");

    await page.locator("#faqSearchInput").fill("zzzznomatchzzzz");

    await expect(page.locator("#faqNoResults")).toBeVisible();
    await expect(page.locator("#faqSearchStatus")).toHaveText(
      '0 questions found matching "zzzznomatchzzzz".',
    );
  });

  test("clear button resets the search and re-shows all items", async ({
    page,
  }) => {
    await page.goto("/faq.html");

    await page
      .locator("#faqSearchInput")
      .fill("How long does probate take in California");
    await expect(page.locator(".faq-item:visible")).toHaveCount(1);

    await page.locator("#faqSearchClear").click();

    await expect(page.locator("#faqSearchInput")).toHaveValue("");
    await expect(page.locator(".faq-item:visible")).toHaveCount(10);
    await expect(page.locator("#faqSearchInput")).toBeFocused();
  });
});
```

- [ ] **Step 2: Run the test and verify it passes**

Run: `npx playwright test tests/e2e/faq.spec.js`
Expected: `4 passed`

- [ ] **Step 3: Mutation check**

In `public/js/faq.js`, temporarily comment out the search wiring:

```js
// searchInput.addEventListener("input", performSearch);
```

Run: `npx playwright test tests/e2e/faq.spec.js`
Expected: all 3 tests in the "FAQ search" describe block FAIL (typing never filters anything).

Revert the comment-out in `public/js/faq.js`.

- [ ] **Step 4: Re-run to confirm all tests pass again**

Run: `npx playwright test tests/e2e/faq.spec.js`
Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/faq.spec.js
git commit -m "test: add E2E coverage for FAQ accordion and search"
```

---

## Task 4: Estate readiness quiz

**Files:**

- Create: `tests/e2e/quiz.spec.js`

**Interfaces:**

- Consumes: `test`, `expect` from `tests/e2e/fixtures.js` (Task 1).

**Reference:**

- `public/js/quiz.js` — 5 questions; answering "No" on the first question sets `firstGap` to `{ gapAnchor: "services.html#living-trusts", gapLabel: "Explore Living Trusts" }`; answering "No" all 5 times yields `noCount=5`, `score="0/5"`, message `"Your estate has 5 significant gaps."`, class `quiz-result--urgent`.
- `public/index.html` — `#quizStartBtn`, `#quizProgress` (`role="progressbar"`, `aria-valuenow`/`aria-valuemax` set per-question by `quiz.js`), `#quizProgressLabel`.

- [ ] **Step 1: Write the spec file**

```js
// tests/e2e/quiz.spec.js
import { test, expect } from "./fixtures.js";

test.describe("Estate readiness quiz", () => {
  test("walks through all questions and shows a tailored result", async ({
    page,
  }) => {
    await page.goto("/index.html");

    await page.locator("#quizStartBtn").click();
    await expect(page.locator("#quizQuestionsView")).toBeVisible();

    for (let i = 1; i <= 5; i++) {
      await expect(page.locator("#quizProgressLabel")).toHaveText(
        `Question ${i} of 5`,
      );
      await expect(page.locator("#quizProgress")).toHaveAttribute(
        "aria-valuenow",
        String(i),
      );
      await expect(page.locator("#quizProgress")).toHaveAttribute(
        "aria-valuemax",
        "5",
      );
      await page.getByRole("button", { name: /^no/i }).click();
    }

    await expect(page.locator("#quizResultView")).toBeVisible();
    await expect(page.locator(".quiz-result-score")).toHaveText("0/5");
    await expect(page.locator(".quiz-result-message")).toHaveText(
      "Your estate has 5 significant gaps.",
    );
    await expect(page.locator(".quiz-result-view")).toHaveClass(
      /quiz-result--urgent/,
    );
    await expect(
      page.locator(".quiz-result-actions a", {
        hasText: "Explore Living Trusts",
      }),
    ).toHaveAttribute("href", "services.html#living-trusts");

    await page.locator("#quizRetakeBtn").click();
    await expect(page.locator("#quizStartView")).toBeVisible();
    await expect(page.locator("#quizResultView")).toBeHidden();
  });
});
```

- [ ] **Step 2: Run the test and verify it passes**

Run: `npx playwright test tests/e2e/quiz.spec.js`
Expected: `1 passed`

- [ ] **Step 3: Mutation check**

In `public/js/quiz.js`, temporarily break the gap counter:

```js
if (this.dataset.answer === "no") {
  // noCount++;
  if (!firstGap) firstGap = questions[index];
}
```

Run: `npx playwright test tests/e2e/quiz.spec.js`
Expected: FAILS — `.quiz-result-score` reads `"5/5"` instead of `"0/5"` and the message no longer matches `"Your estate has 5 significant gaps."`.

Revert the comment-out (`noCount++;`) in `public/js/quiz.js`.

- [ ] **Step 4: Re-run to confirm the test passes again**

Run: `npx playwright test tests/e2e/quiz.spec.js`
Expected: `1 passed`

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/quiz.spec.js
git commit -m "test: add E2E coverage for the estate readiness quiz"
```

---

## Task 5: Probate cost calculator

**Files:**

- Create: `tests/e2e/probate-calculator.spec.js`

**Interfaces:**

- Consumes: `test`, `expect` from `tests/e2e/fixtures.js` (Task 1).

**Reference:**

- `public/js/probate-calculator.js` — `calcStatutoryFee(800000)` = `7000 + 600000*0.02 = 19000`, doubled (attorney + executor) = `38000` → `"$38,000 minimum"`. Savings = `38000 - 2495 = 35505` → `"$35,505 minimum"`. Slider `input` event always recalculates (`{ silent: true }`) and syncs `#estateValueInput` + `#calcSliderValue`.
- `public/index.html` — `#estateValueInput` (`type="number"`), `#calcGoBtn`, `#estateValueSlider` (`type="range"`, `min="50000"`, `max="5000000"`), `#calcSliderValue`, `#calcOutput` (`hidden` by default), `#calcProbateCost`, `#calcSavings`, `#calcCta`. The error message element (`.calc-error`) is created and appended by the script itself, not present in the static HTML.

- [ ] **Step 1: Write the spec file**

```js
// tests/e2e/probate-calculator.spec.js
import { test, expect } from "./fixtures.js";

test.describe("Probate cost calculator", () => {
  test("calculates probate cost and savings for an entered estate value", async ({
    page,
  }) => {
    await page.goto("/index.html");

    await page.locator("#estateValueInput").fill("800000");
    await page.locator("#calcGoBtn").click();

    await expect(page.locator("#calcOutput")).toBeVisible();
    await expect(page.locator("#calcProbateCost")).toHaveText(
      "$38,000 minimum",
    );
    await expect(page.locator("#calcSavings")).toHaveText("$35,505 minimum");
    await expect(page.locator("#calcCta")).toHaveText(
      "Your family could avoid at least $35,505 in statutory fees → Book a Free Consultation",
    );
  });

  test("shows an error for a non-positive estate value", async ({ page }) => {
    await page.goto("/index.html");

    await page.locator("#estateValueInput").fill("-100");
    await page.locator("#calcGoBtn").click();

    await expect(page.locator(".calc-error")).toBeVisible();
    await expect(page.locator(".calc-error")).toHaveText(
      "Please enter an estate value greater than $0 (e.g. 800000).",
    );
    await expect(page.locator("#calcOutput")).toBeHidden();
  });

  test("keeps the slider and number input in sync", async ({ page }) => {
    await page.goto("/index.html");

    const slider = page.locator("#estateValueSlider");
    await slider.evaluate((el) => {
      el.value = "1000000";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await expect(page.locator("#estateValueInput")).toHaveValue("1000000");
    await expect(page.locator("#calcSliderValue")).toHaveText("$1,000,000");
  });
});
```

- [ ] **Step 2: Run the test and verify it passes**

Run: `npx playwright test tests/e2e/probate-calculator.spec.js`
Expected: `3 passed`

- [ ] **Step 3: Mutation check**

In `public/js/probate-calculator.js`, temporarily drop the attorney+executor doubling:

```js
return fee; // * 2 // attorney + executor = doubled
```

Run: `npx playwright test tests/e2e/probate-calculator.spec.js`
Expected: FAILS — `#calcProbateCost` reads `"$19,000 minimum"` instead of `"$38,000 minimum"`.

Revert to `return fee * 2;` in `public/js/probate-calculator.js`.

- [ ] **Step 4: Re-run to confirm all tests pass again**

Run: `npx playwright test tests/e2e/probate-calculator.spec.js`
Expected: `3 passed`

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/probate-calculator.spec.js
git commit -m "test: add E2E coverage for the probate cost calculator"
```

---

## Task 6: Trust funding checklist

**Files:**

- Create: `tests/e2e/funding-checklist.spec.js`

**Interfaces:**

- Consumes: `test`, `expect` from `tests/e2e/fixtures.js` (Task 1).

**Reference:**

- `public/js/funding-checklist.js` — persists checkbox state to `localStorage` keyed by `data-funding-id`; `updateProgress()` sets `#fundingProgressLabel` text to `"{checked} of {total} assets retitled"` and `#fundingProgress`'s `aria-valuenow` to `Math.round((checked/total)*100)`.
- `public/services.html` — 6 checkboxes with `data-funding-id`: `home`, `bank`, `brokerage`, `realestate`, `business`, `beneficiary`. `#fundingProgress` starts at `aria-valuenow="0"`, label starts `"0 of 6 assets retitled"`.

- [ ] **Step 1: Write the spec file**

```js
// tests/e2e/funding-checklist.spec.js
import { test, expect } from "./fixtures.js";

test.describe("Trust funding checklist", () => {
  test("updates progress as items are checked", async ({ page }) => {
    await page.goto("/services.html");

    await expect(page.locator("#fundingProgressLabel")).toHaveText(
      "0 of 6 assets retitled",
    );
    await expect(page.locator("#fundingProgress")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );

    await page.locator('[data-funding-id="home"]').check();

    await expect(page.locator("#fundingProgressLabel")).toHaveText(
      "1 of 6 assets retitled",
    );
    await expect(page.locator("#fundingProgress")).toHaveAttribute(
      "aria-valuenow",
      "17",
    );
  });

  test("persists checked state across a reload", async ({ page }) => {
    await page.goto("/services.html");

    await page.locator('[data-funding-id="home"]').check();
    await page.locator('[data-funding-id="bank"]').check();
    await expect(page.locator("#fundingProgressLabel")).toHaveText(
      "2 of 6 assets retitled",
    );

    await page.reload();

    await expect(page.locator('[data-funding-id="home"]')).toBeChecked();
    await expect(page.locator('[data-funding-id="bank"]')).toBeChecked();
    await expect(
      page.locator('[data-funding-id="brokerage"]'),
    ).not.toBeChecked();
    await expect(page.locator("#fundingProgressLabel")).toHaveText(
      "2 of 6 assets retitled",
    );
  });
});
```

- [ ] **Step 2: Run the test and verify it passes**

Run: `npx playwright test tests/e2e/funding-checklist.spec.js`
Expected: `2 passed`

- [ ] **Step 3: Mutation check**

In `public/js/funding-checklist.js`, temporarily comment out the persistence call:

```js
cb.addEventListener("change", function () {
  var current = loadState();
  current[id] = cb.checked;
  // saveState(current);
  updateProgress();
});
```

Run: `npx playwright test tests/e2e/funding-checklist.spec.js`
Expected: `"updates progress as items are checked"` still PASSES; `"persists checked state across a reload"` FAILS (checkboxes are unchecked after reload).

Revert the comment-out (`saveState(current);`) in `public/js/funding-checklist.js`.

- [ ] **Step 4: Re-run to confirm all tests pass again**

Run: `npx playwright test tests/e2e/funding-checklist.spec.js`
Expected: `2 passed`

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/funding-checklist.spec.js
git commit -m "test: add E2E coverage for the trust funding checklist"
```

---

## Task 7: Onboarding tour (process.html)

**Files:**

- Create: `tests/e2e/onboarding-tour.spec.js`

**Interfaces:**

- Consumes: `test`, `expect` from `tests/e2e/fixtures.js` (Task 1).

**Reference:**

- `public/js/onboarding-tour.js` — clicking `#start-tour-btn` dynamically imports `driver.js` and launches a tour whose first step's popover title is `"Welcome to the Guided Tour!"` and second step's title is `"Step 1: Free Consultation"`.
- `driver.js@1.6.0` (installed) renders `.driver-popover`, `.driver-popover-title`, `.driver-popover-next-btn`, `.driver-popover-close-btn` (verified against `node_modules/driver.js/dist/driver.js.mjs`).
- `public/process.html` — `#start-tour-btn`.

- [ ] **Step 1: Write the spec file**

```js
// tests/e2e/onboarding-tour.spec.js
import { test, expect } from "./fixtures.js";

test.describe("Guided process tour", () => {
  test("launches, advances, and can be closed", async ({ page }) => {
    await page.goto("/process.html");

    await page.locator("#start-tour-btn").click();

    const popoverTitle = page.locator(".driver-popover-title");
    await expect(popoverTitle).toHaveText("Welcome to the Guided Tour!");

    await page.locator(".driver-popover-next-btn").click();
    await expect(popoverTitle).toHaveText("Step 1: Free Consultation");

    await page.locator(".driver-popover-close-btn").click();
    await expect(page.locator(".driver-popover")).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run the test and verify it passes**

Run: `npx playwright test tests/e2e/onboarding-tour.spec.js`
Expected: `1 passed`

- [ ] **Step 3: Mutation check**

In `public/js/onboarding-tour.js`, temporarily disable the click handler:

```js
startBtn.addEventListener("click", async () => {
  return; // disabled for mutation check
  let driver;
  ...
```

Run: `npx playwright test tests/e2e/onboarding-tour.spec.js`
Expected: FAILS — `.driver-popover-title` never appears, test times out waiting for it.

Revert the `return;` line removal in `public/js/onboarding-tour.js`.

- [ ] **Step 4: Re-run to confirm the test passes again**

Run: `npx playwright test tests/e2e/onboarding-tour.spec.js`
Expected: `1 passed`

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/onboarding-tour.spec.js
git commit -m "test: add E2E coverage for the process page onboarding tour"
```

---

## Task 8: Sticky consultation CTA

**Files:**

- Create: `tests/e2e/sticky-cta.spec.js`

**Interfaces:**

- Consumes: `test`, `expect` from `tests/e2e/fixtures.js` (Task 1).

**Reference:**

- `public/js/sticky-cta.js` — toggles the `visible` class on `#stickyCta` based on `useScroll` (from `public/js/hooks.js`) crossing `window.innerHeight * 0.8`.

- [ ] **Step 1: Write the spec file**

```js
// tests/e2e/sticky-cta.spec.js
import { test, expect } from "./fixtures.js";

test.describe("Sticky consultation CTA", () => {
  test("stays hidden on load and appears after scrolling past 80% of the viewport", async ({
    page,
  }) => {
    await page.goto("/index.html");

    const stickyCta = page.locator("#stickyCta");
    await expect(stickyCta).not.toHaveClass(/visible/);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(stickyCta).toHaveClass(/visible/);

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(stickyCta).not.toHaveClass(/visible/);
  });
});
```

- [ ] **Step 2: Run the test and verify it passes**

Run: `npx playwright test tests/e2e/sticky-cta.spec.js`
Expected: `1 passed`

- [ ] **Step 3: Mutation check**

In `public/js/sticky-cta.js`, temporarily raise the threshold so it's unreachable:

```js
() => window.innerHeight * 1000,
```

Run: `npx playwright test tests/e2e/sticky-cta.spec.js`
Expected: FAILS — the CTA never gets the `visible` class even after scrolling to the bottom.

Revert to `() => window.innerHeight * 0.8,` in `public/js/sticky-cta.js`.

- [ ] **Step 4: Re-run to confirm the test passes again**

Run: `npx playwright test tests/e2e/sticky-cta.spec.js`
Expected: `1 passed`

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/sticky-cta.spec.js
git commit -m "test: add E2E coverage for the sticky consultation CTA"
```

---

## Task 9: `book_consult_click` GA4 analytics event

**Files:**

- Create: `tests/e2e/analytics.spec.js`

**Interfaces:**

- Consumes: `test`, `expect` from `tests/e2e/fixtures.js` (Task 1).

**Reference:**

- `public/js/analytics.js` — on click of any `a[data-cta="book-consult"]`, fires `gtag("event", "book_consult_click", { link_location, page_path })`. `link_location` comes from `link.closest("section[class], nav, footer")`: the nav CTA is inside `<nav id="nav">` → `"nav"`; the hero CTA is inside `<section class="hero">` (no id) → `"hero"`; the sticky CTA (`public/partials/sticky-cta.html`) is **not** wrapped in any matching ancestor → falls through to the `"page"` default.
- `public/partials/head-analytics.html` defines `gtag()` locally (pushes straight to `window.dataLayer`) independent of whether the (blocked) external `googletagmanager.com` script loads — this is the same mechanism `send-a-message.spec.js`'s `generate_lead` assertion already relies on.
- The CTA links use `target="_blank"` to Calendly — block `calendly.com` navigation via context-level routing so the popup never actually loads the real external site.

- [ ] **Step 1: Write the spec file**

```js
// tests/e2e/analytics.spec.js
import { test, expect } from "./fixtures.js";

const CTA_LOCATIONS = [
  {
    name: "nav",
    selector: '#nav [data-cta="book-consult"]',
    expectedLocation: "nav",
  },
  {
    name: "sticky CTA",
    selector: "#stickyCta",
    expectedLocation: "page",
  },
  {
    name: "hero",
    selector: '.hero [data-cta="book-consult"]',
    expectedLocation: "hero",
  },
];

test.describe("book_consult_click GA4 event", () => {
  test.beforeEach(async ({ page }) => {
    // The CTA opens Calendly in a new tab — block it so the popup never
    // actually reaches the real external site during the test.
    await page.context().route(/calendly\.com/, (route) => route.abort());
  });

  for (const { name, selector, expectedLocation } of CTA_LOCATIONS) {
    test(`fires with link_location "${expectedLocation}" from the ${name} CTA`, async ({
      page,
    }) => {
      await page.goto("/index.html");

      const [popup] = await Promise.all([
        page.waitForEvent("popup"),
        page.locator(selector).click(),
      ]);
      await popup.close();

      await expect
        .poll(() =>
          page.evaluate(() =>
            (window.dataLayer || []).some((entry) => {
              const args = Array.from(entry);
              return args[0] === "event" && args[1] === "book_consult_click";
            }),
          ),
        )
        .toBe(true);

      const eventArgs = await page.evaluate(() =>
        (window.dataLayer || [])
          .map((entry) => Array.from(entry))
          .find(
            (args) => args[0] === "event" && args[1] === "book_consult_click",
          ),
      );
      expect(eventArgs[2].link_location).toBe(expectedLocation);
      expect(eventArgs[2].page_path).toBe("/index.html");
    });
  }
});
```

- [ ] **Step 2: Run the test and verify it passes**

Run: `npx playwright test tests/e2e/analytics.spec.js`
Expected: `3 passed`

- [ ] **Step 3: Mutation check**

In `public/js/analytics.js`, temporarily rename the fired event:

```js
window.gtag("event", "book_consult_click_renamed", {
```

Run: `npx playwright test tests/e2e/analytics.spec.js`
Expected: all 3 tests FAIL (`expect.poll` never observes `"book_consult_click"` in `dataLayer` and times out).

Revert to `window.gtag("event", "book_consult_click", {` in `public/js/analytics.js`.

- [ ] **Step 4: Re-run to confirm all tests pass again**

Run: `npx playwright test tests/e2e/analytics.spec.js`
Expected: `3 passed`

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/analytics.spec.js
git commit -m "test: add E2E coverage for the book_consult_click GA4 event"
```

---

## Task 10: CI worker pool + full-suite verification

**Files:**

- Modify: `playwright.config.js:8`

**Interfaces:**

- Consumes: all spec files from Tasks 1–9 (this task runs the complete suite).

- [ ] **Step 1: Bump the CI worker count**

In `playwright.config.js`, change:

```js
  workers: process.env.CI ? 1 : undefined,
```

to:

```js
  workers: process.env.CI ? 2 : undefined,
```

- [ ] **Step 2: Run the complete E2E suite locally**

Run: `npm run test:e2e`
Expected: all specs pass — `tests/e2e/fixtures.spec.js`, `navigation.spec.js`, `faq.spec.js`, `quiz.spec.js`, `probate-calculator.spec.js`, `funding-checklist.spec.js`, `onboarding-tour.spec.js`, `sticky-cta.spec.js`, `analytics.spec.js`, and the pre-existing `send-a-message.spec.js`. Total: `19 passed`.

- [ ] **Step 3: Run the full CI-equivalent check**

Run: `npm run check`
Expected: `format:check` and `html:check` both pass with no changes needed (all new files already match Prettier/htmlhint rules from the pre-commit hook run in earlier tasks).

- [ ] **Step 4: Commit**

```bash
git add playwright.config.js
git commit -m "ci: bump Playwright worker pool to 2 for the larger E2E suite"
```

- [ ] **Step 5: Push and confirm CI passes**

```bash
git push
gh run watch
```

Expected: the `check` job (format/lint + `test:e2e` + build) in `.github/workflows/ci.yml` completes with conclusion `success`.

---

## Post-plan note

This plan intentionally does not touch `tests/e2e/send-a-message.spec.js` — migrating its inline third-party blocking to the new `fixtures.js` is optional cleanup called out in the design spec, not required here. If desired, it's a trivial follow-up: replace its `import { test, expect } from "@playwright/test";` with `import { test, expect } from "./fixtures.js";` and delete its inline `page.route(...)` block, then re-run to confirm no behavior change.
