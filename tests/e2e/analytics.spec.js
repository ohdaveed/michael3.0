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
