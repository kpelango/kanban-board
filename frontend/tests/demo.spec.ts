import { expect, test } from "@playwright/test";

// Safe to run against hosted previews: it needs no seeded accounts and only touches its own
// guest, which the daily cleanup deletes.

test("a visitor tries the demo, edits the sample board, and signs out", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in to Kanban Studio" })).toBeVisible();
  await page.getByRole("button", { name: "Try the demo" }).click();

  await expect(page.getByTestId("kanban-board-loaded")).toBeVisible();
  await expect(page.getByRole("heading", { name: "My First Board" })).toBeVisible();
  await expect(page.locator('[data-testid^="card-card-"]')).toHaveCount(8);

  const backlog = page.getByTestId("column-col-backlog");
  await backlog.getByRole("button", { name: "Add a card" }).click();
  await backlog.getByLabel("Card title").fill("Demo card");
  const saved = page.waitForResponse(
    (res) => /\/api\/boards\/\d+$/.test(res.url()) && res.request().method() === "PUT"
  );
  await backlog.getByRole("button", { name: "Add card" }).click();
  expect((await saved).ok()).toBeTruthy();

  await page.reload();
  await expect(page.getByTestId("kanban-board-loaded")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit Demo card" })).toBeVisible();

  await page.getByRole("button", { name: /Account menu for guest-/ }).click();
  await expect(page.getByText("Guest account, deleted after 24 hours")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Account settings" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to Kanban Studio" })).toBeVisible();

  // The guest's session is gone and a new demo starts a fresh, separate account
  expect((await page.request.get("/api/auth/me")).status()).toBe(401);
});
