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
