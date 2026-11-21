import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const expectNoViolations = async (page: Page, label: string) => {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`
  );
  expect(summary, `${label} accessibility violations`).toEqual([]);
};

const signIn = async (page: Page) => {
  await page.goto("/");
  await page.getByLabel("Username").fill("e2e-test-user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("kanban-board-loaded")).toBeVisible();
};

for (const [name, viewport] of [
  ["desktop", { width: 1440, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
] as const) {
  test.describe(`accessibility on ${name}`, () => {
    test.use({ viewport });

    test("sign-in and registration screens", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Sign in to Kanban Studio" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Try the demo" })).toBeVisible();
      await expectNoViolations(page, "sign in");
      await page.getByRole("button", { name: "Create an account" }).click();
      await expectNoViolations(page, "register");
    });

    test("board, menus, and dialogs", async ({ page }) => {
      await signIn(page);
      await expectNoViolations(page, "board");

      await page.getByRole("button", { name: /switch board/i }).click();
      await expectNoViolations(page, "board menu");
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: /^Edit / }).first().click();
      await expect(page.getByRole("dialog", { name: "Edit card" })).toBeVisible();
      await expectNoViolations(page, "card dialog");
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: /Account menu for/ }).click();
      await page.getByRole("menuitem", { name: "Account settings" }).click();
      await expectNoViolations(page, "account dialog");
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: /^Archived cards/ }).click();
      await expectNoViolations(page, "archive dialog");
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "AI assistant" }).click();
      await expect(page.getByTestId("ai-chat-sidebar")).toBeVisible();
      await expectNoViolations(page, "chat");
    });

    test("demo guest board and account menu", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Try the demo" }).click();
      await expect(page.getByTestId("kanban-board-loaded")).toBeVisible();
      await expectNoViolations(page, "guest board");
      await page.getByRole("button", { name: /Account menu for guest-/ }).click();
      await expect(page.getByText("Guest account, expires after 24 hours")).toBeVisible();
      await expectNoViolations(page, "guest account menu");
    });
  });
}
