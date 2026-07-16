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
