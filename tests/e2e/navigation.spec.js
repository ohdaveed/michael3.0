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

test.describe("Mobile menu across the responsive breakpoint", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("closes and releases the page when resized to desktop while open", async ({
    page,
  }) => {
    await page.goto("/index.html");

    await page.getByRole("button", { name: /open menu/i }).click();
    await expect(page.locator(".nav-links")).toHaveClass(/open/);
    await expect(page.locator("main")).toHaveAttribute("inert", "");

    // Cross the 1024px breakpoint in css/responsive/general.css. The menu is
    // no longer reachable — the toggle is display:none above it — so if the
    // open state is not torn down, `inert` on main/footer and the locked body
    // scroll strand the desktop page with no way to recover.
    await page.setViewportSize({ width: 1280, height: 800 });

    await expect(page.locator("main")).not.toHaveAttribute("inert", "");
    await expect(page.locator("footer")).not.toHaveAttribute("inert", "");
    await expect(page.locator(".nav-links")).not.toHaveClass(/open/);
    // The inline style is what setMobileMenuState controls; the stylesheet
    // independently sets overflow-x: hidden on body, so the computed value
    // stays "hidden auto" either way and would not catch a regression.
    await expect
      .poll(() => page.locator("body").evaluate((el) => el.style.overflow))
      .toBe("");
    // Desktop links are visible, so they must not be hidden from assistive tech.
    await expect(page.locator(".nav-links")).not.toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});
