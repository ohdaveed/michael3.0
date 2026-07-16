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
