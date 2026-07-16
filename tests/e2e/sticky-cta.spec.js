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
