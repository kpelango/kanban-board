import { expect, test, type Page } from "@playwright/test";
import { initialData } from "../src/lib/kanban";

const loginAsUser = async (page: Page, resetBoard = true) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Sign in to Kanban Studio" })
  ).toBeVisible();
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("kanban-board-loaded")).toBeVisible();

  if (resetBoard) {
    const res = await page.request.put("/api/board", { data: initialData });
    expect(res.ok()).toBeTruthy();
    await page.reload();
    await expect(page.getByTestId("kanban-board-loaded")).toBeVisible();
  }
};

test("requires sign in, rejects invalid credentials, preserves session, and logs out", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Sign in to Kanban Studio" })
  ).toBeVisible();

  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid username or password")).toBeVisible();

  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in to Kanban Studio" })
  ).toBeVisible();
});

test("loads the kanban board", async ({ page }) => {
  await loginAsUser(page);
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
});

test("adds a card to a column and persists across reload", async ({ page }) => {
  await loginAsUser(page);
  const firstColumn = page.locator('[data-testid^="column-"]').first();
  await firstColumn.getByRole("button", { name: /add a card/i }).click();
  await firstColumn.getByPlaceholder("Card title").fill("Playwright card");
  await firstColumn.getByPlaceholder("Details").fill("Added via e2e.");
  await firstColumn.getByRole("button", { name: /add card/i }).click();
  await expect(firstColumn.getByText("Playwright card")).toBeVisible();

  await page.reload();
  await expect(
    page.locator('[data-testid^="column-"]').first().getByText("Playwright card")
  ).toBeVisible();
});

test("edits a card in a column and persists across reload", async ({ page }) => {
  await loginAsUser(page);
  const firstColumn = page.locator('[data-testid^="column-"]').first();
  await firstColumn
    .getByRole("button", { name: "Edit Align roadmap themes", exact: true })
    .click();
  await firstColumn.getByLabel("Edit card title").fill("Edited via Playwright");
  await firstColumn
    .getByLabel("Edit card details")
    .fill("Updated details via e2e.");
  await firstColumn.getByRole("button", { name: /^save$/i }).click();
  await expect(firstColumn.getByText("Edited via Playwright")).toBeVisible();
  await expect(firstColumn.getByText("Updated details via e2e.")).toBeVisible();

  await page.reload();
  const reloadedFirstColumn = page.locator('[data-testid^="column-"]').first();
  await expect(reloadedFirstColumn.getByText("Edited via Playwright")).toBeVisible();
  await expect(
    reloadedFirstColumn.getByText("Updated details via e2e.")
  ).toBeVisible();
});

test("moves a card between columns and persists across reload and logout/login", async ({
  page,
}) => {
  await loginAsUser(page);
  const card = page.getByTestId("card-card-1");
  const targetColumn = page.getByTestId("column-col-review");
  const cardBox = await card.boundingBox();
  const columnBox = await targetColumn.boundingBox();
  if (!cardBox || !columnBox) {
    throw new Error("Unable to resolve drag coordinates.");
  }

  await page.mouse.move(
    cardBox.x + cardBox.width / 2,
    cardBox.y + cardBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    columnBox.x + columnBox.width / 2,
    columnBox.y + 120,
    { steps: 12 }
  );
  const savePromise = page.waitForResponse(
    (res) => res.url().endsWith("/api/board") && res.request().method() === "PUT"
  );
  await page.mouse.up();
  await savePromise;
  await expect(targetColumn.getByTestId("card-card-1")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("kanban-board-loaded")).toBeVisible();
  await expect(
    page.getByTestId("column-col-review").getByTestId("card-card-1")
  ).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in to Kanban Studio" })
  ).toBeVisible();
  await loginAsUser(page, false);
  await expect(
    page.getByTestId("column-col-review").getByTestId("card-card-1")
  ).toBeVisible();
});

test("moves a card into an empty column and persists across reload", async ({
  page,
}) => {
  await loginAsUser(page);
  const discoveryColumn = page.getByTestId("column-col-discovery");
  await discoveryColumn
    .getByRole("button", { name: "Delete Prototype analytics view", exact: true })
    .click();
  await expect(discoveryColumn.getByText("Drop a card here")).toBeVisible();

  const card = page.getByTestId("card-card-1");
  const cardBox = await card.boundingBox();
  const columnBox = await discoveryColumn.boundingBox();
  if (!cardBox || !columnBox) {
    throw new Error("Unable to resolve drag coordinates.");
  }

  await page.mouse.move(
    cardBox.x + cardBox.width / 2,
    cardBox.y + cardBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    columnBox.x + columnBox.width / 2,
    columnBox.y + columnBox.height / 2,
    { steps: 12 }
  );
  await page.mouse.up();
  await expect(discoveryColumn.getByTestId("card-card-1")).toBeVisible();

  await page.reload();
  await expect(
    page.getByTestId("column-col-discovery").getByTestId("card-card-1")
  ).toBeVisible();
});

test("opens AI chat sidebar, chats with assistant, updates board, and persists/clears chat history", async ({
  page,
}) => {
  await loginAsUser(page);
  await page.request.delete("/api/chat/history");

  const updatedBoard = JSON.parse(JSON.stringify(initialData)) as typeof initialData;
  updatedBoard.cards["card-ai-1"] = {
    id: "card-ai-1",
    title: "AI Roadmap Milestone",
    details: "Added automatically via structured output",
  };
  updatedBoard.columns[0].cardIds.push("card-ai-1");

  let storedMessages: Array<{ role: string; content: string }> = [];

  await page.route("**/api/chat/history", async (route) => {
    if (route.request().method() === "DELETE") {
      storedMessages = [];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "cleared" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ messages: storedMessages }),
    });
  });

  await page.route("**/api/chat", async (route) => {
    const reqBody = JSON.parse(route.request().postData() || "{}") as {
      message: string;
    };
    const reply = "I have added AI Roadmap Milestone to your Backlog.";
    storedMessages.push(
      { role: "user", content: reqBody.message },
      { role: "assistant", content: reply }
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        reply,
        board: updatedBoard,
      }),
    });
  });

  await page.getByRole("button", { name: "AI Assistant" }).click();
  const sidebar = page.getByTestId("ai-chat-sidebar");
  await expect(sidebar).toBeVisible();

  await sidebar
    .getByLabel("AI chat input")
    .fill("Add AI Roadmap Milestone to Backlog");
  await sidebar.getByRole("button", { name: "Send" }).click();

  await expect(
    sidebar.getByText("I have added AI Roadmap Milestone to your Backlog.")
  ).toBeVisible();

  const firstColumn = page.locator('[data-testid^="column-"]').first();
  await expect(firstColumn.getByText("AI Roadmap Milestone")).toBeVisible();

  // Reload page and reopen sidebar to verify chat history is loaded from /api/chat/history
  await page.reload();
  await expect(page.getByTestId("kanban-board-loaded")).toBeVisible();
  await page.getByRole("button", { name: "AI Assistant" }).click();
  const reloadedSidebar = page.getByTestId("ai-chat-sidebar");
  await expect(
    reloadedSidebar.getByText("I have added AI Roadmap Milestone to your Backlog.")
  ).toBeVisible();

  // Clear chat history
  await reloadedSidebar.getByRole("button", { name: "Clear chat history" }).click();
  await expect(
    reloadedSidebar.getByText("Ask about your board or request changes.")
  ).toBeVisible();
});
