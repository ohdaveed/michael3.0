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
