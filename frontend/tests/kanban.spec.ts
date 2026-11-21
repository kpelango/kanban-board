import { expect, test, type Page } from "@playwright/test";
import { initialData } from "../src/test/fixtures";

const E2E_USERNAME = "e2e-test-user";
const E2E_PASSWORD = "password";

type BoardSummary = { id: number; name: string };

const signIn = async (
  page: Page,
  username = E2E_USERNAME,
  password = E2E_PASSWORD,
) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Sign in to Kanban Studio" }),
  ).toBeVisible();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("kanban-board-loaded")).toBeVisible();
};

/** Signs in as the E2E user and resets them to a single sample board with no chats. */
const signInFresh = async (page: Page) => {
  await signIn(page);
  const boards = (await (
    await page.request.get("/api/boards")
  ).json()) as BoardSummary[];
  const [first, ...rest] = boards;
  for (const board of rest) {
    expect(
      (await page.request.delete(`/api/boards/${board.id}`)).ok(),
    ).toBeTruthy();
  }
  await page.request.put(`/api/boards/${first.id}`, { data: initialData });
  await page.request.patch(`/api/boards/${first.id}`, {
    data: { name: "My First Board" },
  });
  const chats = (await (
    await page.request.get(`/api/boards/${first.id}/conversations`)
  ).json()) as {
    id: number;
  }[];
  for (const chat of chats) {
    await page.request.delete(`/api/conversations/${chat.id}`);
  }
  await page.reload();
  await expect(page.getByTestId("kanban-board-loaded")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "My First Board" }),
  ).toBeVisible();
  return first.id;
};

const logOut = async (page: Page) => {
  await page.getByRole("button", { name: /Account menu for/ }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in to Kanban Studio" }),
  ).toBeVisible();
};

const waitForSave = (page: Page) =>
  page.waitForResponse(
    (res) =>
      /\/api\/boards\/\d+$/.test(res.url()) && res.request().method() === "PUT",
  );

const dragCard = async (
  page: Page,
  cardTestId: string,
  columnTestId: string,
  yOffset?: number,
) => {
  const cardBox = await page.getByTestId(cardTestId).boundingBox();
  const columnBox = await page.getByTestId(columnTestId).boundingBox();
  if (!cardBox || !columnBox) {
    throw new Error("Unable to resolve drag coordinates.");
  }
  await page.mouse.move(
    cardBox.x + cardBox.width / 2,
    cardBox.y + cardBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    columnBox.x + columnBox.width / 2,
    columnBox.y + (yOffset ?? columnBox.height / 2),
    { steps: 12 },
  );
  const saved = waitForSave(page);
  await page.mouse.up();
  await saved;
};

test("requires sign in, rejects invalid credentials, preserves session, and logs out", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Username").fill(E2E_USERNAME);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid username or password")).toBeVisible();

  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("kanban-board-loaded")).toBeVisible();
  await expect(page.locator('[data-testid^="column-col-"]')).toHaveCount(5);

  await page.reload();
  await expect(page.getByTestId("kanban-board-loaded")).toBeVisible();

  await logOut(page);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Sign in to Kanban Studio" }),
  ).toBeVisible();
});

test("returns to sign-in when the session ends", async ({ page, context }) => {
  await signInFresh(page);
  await context.clearCookies();
  const backlog = page.getByTestId("column-col-backlog");
  await backlog.getByRole("button", { name: "Add a card" }).click();
  await backlog.getByLabel("Card title").fill("After expiry");
  await backlog.getByRole("button", { name: "Add card" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to Kanban Studio" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Your session ended");
  await signIn(page);
  await expect(page.getByText("After expiry")).toHaveCount(0);
});

test("registers an account, changes the password, and deletes the account", async ({
  page,
}) => {
  const username = `e2e-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByText("Passwords need at least 8 characters."),
  ).toBeVisible();

  await page.getByLabel("Password").fill("first-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByTestId("kanban-board-loaded")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "My First Board" }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: `Account menu for ${username}` })
    .click();
  await page.getByRole("menuitem", { name: "Account settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Account settings" });
  await dialog.getByLabel("Current password").fill("first-password");
  await dialog.getByLabel("New password").fill("second-password");
  await dialog.getByRole("button", { name: "Change password" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Password changed.");
  await dialog.getByRole("button", { name: "Close" }).click();

  await logOut(page);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("first-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid username or password")).toBeVisible();
  await signIn(page, username, "second-password");

  await page
    .getByRole("button", { name: `Account menu for ${username}` })
    .click();
  await page.getByRole("menuitem", { name: "Account settings" }).click();
  await page.getByLabel("Confirm with your password").fill("second-password");
  await page.getByRole("button", { name: "Delete account" }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in to Kanban Studio" }),
  ).toBeVisible();

  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("second-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid username or password")).toBeVisible();
});

test("admins manage other users", async ({ page, browser }) => {
  // Registers a throwaway account, then the seeded admin ('user') manages only that account
  const username = `e2e-admin-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("first-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByTestId("kanban-board-loaded")).toBeVisible();
  await page
    .getByRole("button", { name: `Account menu for ${username}` })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Manage users" }),
  ).toHaveCount(0);

  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signIn(admin, "user", "password");
  try {
    await admin.getByRole("button", { name: "Account menu for user" }).click();
    await admin.getByRole("menuitem", { name: "Manage users" }).click();
    const dialog = admin.getByRole("dialog", { name: "Manage users" });
    const row = dialog.getByTestId(`user-${username}`);
    await expect(row).toContainText("1 board");

    await row
      .getByRole("button", { name: `Reset password for ${username}` })
      .click();
    await row.getByLabel(`New password for ${username}`).fill("reset-password");
    await row
      .getByRole("button", { name: "Set password", exact: true })
      .click();
    await expect(dialog.getByRole("status")).toHaveText(
      `Password reset for ${username}.`,
    );

    await row.getByRole("button", { name: `Make admin ${username}` }).click();
    await expect(row.getByText("Admin", { exact: true })).toBeVisible();

    // The reset signed the other account out; it signs back in with the new password
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Sign in to Kanban Studio" }),
    ).toBeVisible();
    await signIn(page, username, "reset-password");
    await page
      .getByRole("button", { name: `Account menu for ${username}` })
      .click();
    await expect(
      page.getByRole("menuitem", { name: "Manage users" }),
    ).toBeVisible();

    await row.getByRole("button", { name: `Delete ${username}` }).click();
    await row.getByRole("button", { name: "Delete user" }).click();
    await expect(dialog.getByRole("status")).toHaveText(`Deleted ${username}.`);
    await expect(dialog.getByTestId(`user-${username}`)).toHaveCount(0);

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Sign in to Kanban Studio" }),
    ).toBeVisible();
  } finally {
    // Remove the throwaway account even if an assertion failed midway
    const users = (await (
      await admin.request.get("/api/admin/users")
    ).json()) as {
      id: number;
      username: string;
    }[];
    const leftover = users.find((u) => u.username === username);
    if (leftover) {
      await admin.request.delete(`/api/admin/users/${leftover.id}`);
    }
    await adminContext.close();
  }
});

test("creates, switches, renames, and deletes boards with separate cards", async ({
  page,
}) => {
  await signInFresh(page);

  await page.getByRole("button", { name: /switch board/i }).click();
  await page.getByRole("button", { name: "New board" }).click();
  await page.getByLabel("New board name").fill("Hiring");
  await page.getByRole("button", { name: "Create board" }).click();
  await expect(page.getByRole("heading", { name: "Hiring" })).toBeVisible();
  await expect(page.getByTestId("stat-total")).toHaveText("0");

  const backlog = page.getByTestId("column-col-backlog");
  await backlog.getByRole("button", { name: "Add a card" }).click();
  await backlog.getByLabel("Card title").fill("Post the job ad");
  const saved = waitForSave(page);
  await backlog.getByRole("button", { name: "Add card" }).click();
  await saved;

  await page.getByRole("button", { name: /switch board/i }).click();
  await page.getByRole("dialog", { name: "Boards" }).getByRole("button", { name: /My First Board/ }).click();
  await expect(
    page.getByRole("heading", { name: "My First Board" }),
  ).toBeVisible();
  await expect(page.getByText("Post the job ad")).toHaveCount(0);
  await expect(page.getByTestId("stat-total")).toHaveText("8");

  // The last opened board is restored after a reload
  await page.getByRole("button", { name: /switch board/i }).click();
  await page.getByRole("dialog", { name: "Boards" }).getByRole("button", { name: /Hiring/ }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Hiring" })).toBeVisible();
  await expect(page.getByText("Post the job ad")).toBeVisible();

  await page.getByRole("button", { name: /switch board/i }).click();
  await page.getByRole("button", { name: "Rename this board" }).click();
  await page.getByLabel("Board name").fill("Hiring 2027");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(
    page.getByRole("heading", { name: "Hiring 2027" }),
  ).toBeVisible();

  await page.getByRole("button", { name: /switch board/i }).click();
  await page.getByRole("button", { name: "Delete this board" }).click();
  await page.getByRole("button", { name: "Delete board" }).click();
  await expect(
    page.getByRole("heading", { name: "My First Board" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /switch board/i }).click();
  await expect(page.getByRole("list", { name: "Your boards" }).getByRole("listitem")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Delete this board" }),
  ).toBeDisabled();
});

test("duplicates, exports, and imports boards", async ({ page }) => {
  await signInFresh(page);
  const menuButton = page.getByRole("button", { name: /switch board/i });
  const menu = page.getByRole("dialog", { name: "Boards" });

  await menuButton.click();
  await menu.getByRole("button", { name: "Duplicate this board" }).click();
  await expect(page.getByRole("heading", { name: "My First Board copy" })).toBeVisible();
  await expect(page.getByTestId("stat-total")).toHaveText("8");

  await menuButton.click();
  const downloadPromise = page.waitForEvent("download");
  await menu.getByRole("button", { name: "Export as JSON" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("my-first-board-copy.json");
  const exported = JSON.parse(
    (await (await download.createReadStream()).toArray()).join(""),
  ) as { name: string; board: typeof initialData };
  expect(exported.name).toBe("My First Board copy");
  expect(Object.keys(exported.board.cards)).toHaveLength(8);

  exported.name = "Imported via E2E";
  exported.board.columns[0].title = "Imported backlog";
  await menuButton.click();
  await menu.getByLabel("Import a board").setInputFiles({
    name: "import.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await expect(page.getByRole("heading", { name: "Imported via E2E" })).toBeVisible();
  await expect(
    page.getByTestId("column-col-backlog").getByLabel("Column title"),
  ).toHaveValue("Imported backlog");

  await menuButton.click();
  await menu.getByLabel("Import a board").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ columns: [], cards: {} })),
  });
  await expect(menu.getByRole("alert")).toBeVisible();
  await expect(menu.getByRole("list", { name: "Your boards" }).getByRole("listitem")).toHaveCount(3);
});

test("adds a card and edits its details, priority, due date, and labels", async ({
  page,
}) => {
  await signInFresh(page);
  const backlog = page.getByTestId("column-col-backlog");
  await backlog.getByRole("button", { name: "Add a card" }).click();
  await backlog.getByLabel("Card title").fill("Playwright card");
  await backlog.getByLabel("Details").fill("Added via e2e.");
  let saved = waitForSave(page);
  await backlog.getByRole("button", { name: "Add card" }).click();
  await saved;

  await page.getByRole("button", { name: "Edit Playwright card" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit card" });
  await dialog.getByLabel("Title").fill("Edited via Playwright");
  await dialog.getByText("High", { exact: true }).click();
  await dialog.getByLabel("Due date").fill("2001-02-03");
  await dialog.getByLabel("Labels").fill("e2e, Automation");
  saved = waitForSave(page);
  await dialog.getByRole("button", { name: "Save card" }).click();
  await saved;

  await page.reload();
  const card = page
    .getByTestId("column-col-backlog")
    .locator('[data-testid^="card-"]', {
      hasText: "Edited via Playwright",
    });
  await expect(card).toContainText("High");
  await expect(card).toContainText("Overdue");
  await expect(card).toContainText("automation");
  await expect(page.getByTestId("stat-overdue")).toHaveText("1");
});

test("tracks a checklist on a card", async ({ page }) => {
  await signInFresh(page);
  await page
    .getByRole("button", { name: "Edit Refine status language" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Edit card" });
  for (const item of [
    "Audit current labels",
    "Draft new wording",
    "Get sign-off",
  ]) {
    await dialog.getByLabel("New checklist item").fill(item);
    await dialog.getByLabel("New checklist item").press("Enter");
  }
  await dialog.getByLabel("Done: Audit current labels").check();
  await expect(dialog.getByText("1 of 3 done")).toBeVisible();
  const saved = waitForSave(page);
  await dialog.getByRole("button", { name: "Save card" }).click();
  await saved;

  await page.reload();
  const card = page.getByTestId("card-card-4");
  await expect(card.getByTestId("card-checklist")).toHaveText("1/3");
  await page
    .getByRole("button", { name: "Edit Refine status language" })
    .click();
  await expect(page.getByLabel("Done: Audit current labels")).toBeChecked();
  await expect(page.getByLabel("Done: Get sign-off")).not.toBeChecked();
});

test("renames a column and sets a WIP limit that persists", async ({
  page,
}) => {
  await signInFresh(page);
  const progress = page.getByTestId("column-col-progress");
  await progress.getByLabel("Column title").fill("Doing");
  let saved = waitForSave(page);
  await progress.getByLabel("Column title").press("Enter");
  await saved;

  await progress.getByRole("button", { name: "Doing settings" }).click();
  await page.getByLabel("Work-in-progress limit").fill("1");
  saved = waitForSave(page);
  await page.getByRole("button", { name: "Save limit" }).click();
  await saved;

  await page.reload();
  await expect(progress.getByLabel("Column title")).toHaveValue("Doing");
  await expect(progress.getByTestId("column-count")).toHaveText("2/1");
  await expect(progress.getByText("Over the limit of 1")).toBeVisible();
});

test("moves a card between columns by dragging and persists it", async ({
  page,
}) => {
  await signInFresh(page);
  await dragCard(page, "card-card-1", "column-col-review", 120);
  await expect(
    page.getByTestId("column-col-review").getByTestId("card-card-1"),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByTestId("column-col-review").getByTestId("card-card-1"),
  ).toBeVisible();
  await logOut(page);
  await signIn(page);
  await expect(
    page.getByTestId("column-col-review").getByTestId("card-card-1"),
  ).toBeVisible();
});

test("moves a card into an empty column", async ({ page }) => {
  await signInFresh(page);
  const discovery = page.getByTestId("column-col-discovery");
  await page
    .getByRole("button", { name: "Edit Prototype analytics view" })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const saved = waitForSave(page);
  await page.getByRole("button", { name: "Delete card" }).click();
  await saved;
  await expect(discovery.getByText("Drop a card here")).toBeVisible();

  await dragCard(page, "card-card-1", "column-col-discovery");
  await page.reload();
  await expect(
    page.getByTestId("column-col-discovery").getByTestId("card-card-1"),
  ).toBeVisible();
});

test("filters cards by search, priority, and label", async ({ page }) => {
  await signInFresh(page);
  await page.getByLabel("Search cards").fill("roadmap");
  await expect(page.locator('[data-testid^="card-"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator('[data-testid^="card-card-"]')).toHaveCount(8);

  await page.getByLabel("Filter by label").selectOption("design");
  await expect(page.locator('[data-testid^="card-card-"]')).toHaveCount(2);
  await page.getByLabel("Filter by priority").selectOption("high");
  await expect(page.locator('[data-testid^="card-card-"]')).toHaveCount(0);
});

test("filters by due date and undoes a card deletion", async ({ page }) => {
  const boardId = await signInFresh(page);
  const board = structuredClone(initialData);
  board.cards["card-2"].dueDate = "2001-01-01";
  await page.request.put(`/api/boards/${boardId}`, { data: board });
  await page.reload();

  await page.getByLabel("Filter by due date").selectOption("overdue");
  await expect(page.locator('[data-testid^="card-card-"]')).toHaveCount(1);
  await expect(page.getByTestId("card-card-2")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();

  await page
    .getByRole("button", { name: "Edit Gather customer signals" })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  let saved = waitForSave(page);
  await page.getByRole("button", { name: "Delete card" }).click();
  await saved;
  await expect(page.getByTestId("card-card-2")).toHaveCount(0);

  saved = waitForSave(page);
  await page.getByRole("button", { name: "Undo" }).click();
  await saved;
  await page.reload();
  await expect(
    page.getByTestId("column-col-backlog").getByTestId("card-card-2"),
  ).toBeVisible();
});

test("archives cards and restores them from the archive", async ({ page }) => {
  await signInFresh(page);
  const done = page.getByTestId("column-col-done");
  await done.getByRole("button", { name: "Done settings" }).click();
  let saved = waitForSave(page);
  await page.getByRole("button", { name: "Archive 2 cards" }).click();
  await saved;
  await expect(done.getByTestId("column-count")).toHaveText("0");
  await expect(page.getByTestId("stat-total")).toHaveText("6");

  await page.reload();
  await page.getByRole("button", { name: "Archived cards (2)" }).click();
  const dialog = page.getByRole("dialog", { name: "Archived cards" });
  saved = waitForSave(page);
  await dialog
    .getByRole("button", { name: "Restore Ship marketing page" })
    .click();
  await saved;
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(done.getByText("Ship marketing page")).toBeVisible();

  await page.getByRole("button", { name: /switch board/i }).click();
  await expect(
    page.getByRole("dialog", { name: "Boards" }).getByRole("button", { name: /My First Board/ }),
  ).toContainText("7 cards");
});

test("focuses search with the / key", async ({ page }) => {
  await signInFresh(page);
  await page.keyboard.press("/");
  await expect(page.getByLabel("Search cards")).toBeFocused();
});

test("chats with the assistant in separate conversations that update the board", async ({
  page,
}) => {
  const boardId = await signInFresh(page);
  const updatedBoard = structuredClone(initialData);
  updatedBoard.cards["card-ai-1"] = {
    id: "card-ai-1",
    title: "AI Roadmap Milestone",
    details: "Added automatically via structured output",
    priority: "high",
    dueDate: null,
    labels: ["ai"],
    checklist: [],
  };
  updatedBoard.columns[0].cardIds.push("card-ai-1");

  // Only the model call is faked: conversations are stored by the real backend
  await page.route("**/api/conversations/*/messages", async (route) => {
    const conversationId = Number(
      route
        .request()
        .url()
        .match(/conversations\/(\d+)/)![1],
    );
    const { message } = route.request().postDataJSON() as { message: string };
    await page.request.put(`/api/boards/${boardId}`, { data: updatedBoard });
    await route.fulfill({
      json: {
        reply: `Done: ${message}`,
        board: updatedBoard,
        conversation: {
          id: conversationId,
          boardId,
          title: message,
          updatedAt: "2026-11-14T10:00:00+00:00",
        },
      },
    });
  });

  await page.getByRole("button", { name: "AI assistant" }).click();
  const sidebar = page.getByTestId("ai-chat-sidebar");
  await expect(
    sidebar.getByText("Ask about this board or tell it what to change."),
  ).toBeVisible();
  await sidebar
    .getByLabel("AI chat input")
    .fill("Add AI Roadmap Milestone to Backlog");
  await sidebar.getByLabel("AI chat input").press("Enter");
  await expect(
    sidebar.getByText("Done: Add AI Roadmap Milestone to Backlog"),
  ).toBeVisible();
  await expect(
    page.getByTestId("column-col-backlog").getByText("AI Roadmap Milestone"),
  ).toBeVisible();

  await sidebar.getByRole("button", { name: "New chat" }).click();
  await sidebar.getByLabel("AI chat input").fill("Second topic");
  await sidebar.getByRole("button", { name: "Send" }).click();
  await expect(sidebar.getByText("Done: Second topic")).toBeVisible();

  // Both chats were created by the real backend
  const chats = (await (
    await page.request.get(`/api/boards/${boardId}/conversations`)
  ).json()) as unknown[];
  expect(chats).toHaveLength(2);

  await page.reload();
  await expect(
    page.getByTestId("column-col-backlog").getByText("AI Roadmap Milestone"),
  ).toBeVisible();
  await page.getByRole("button", { name: "AI assistant" }).click();
  await sidebar.getByRole("button", { name: "Chats (2)" }).click();
  await sidebar
    .getByRole("button", { name: /^Delete chat/ })
    .first()
    .click();
  await expect(
    sidebar.getByRole("button", { name: "Chats (1)" }),
  ).toBeVisible();
  await sidebar.getByRole("button", { name: "Close AI assistant" }).click();
  await expect(sidebar).toHaveCount(0);
});

test.describe("mobile layout", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("shows scrollable lanes, column tabs, and moves cards from the card dialog", async ({
    page,
  }) => {
    await signInFresh(page);
    const tabs = page.getByRole("navigation", { name: "Columns" });
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole("link")).toHaveCount(5);

    // No horizontal page scroll: only the lanes container scrolls
    const pageOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(pageOverflow).toBeLessThanOrEqual(0);

    const done = page.getByTestId("column-col-done");
    await expect(done).not.toBeInViewport();
    await tabs.getByRole("link", { name: /Done/ }).click();
    await expect(done).toBeInViewport();

    await tabs.getByRole("link", { name: /Backlog/ }).click();
    await page
      .getByRole("button", { name: "Edit Align roadmap themes" })
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("Column", { exact: true })
      .selectOption("col-done");
    const saved = waitForSave(page);
    await page.getByRole("button", { name: "Save card" }).click();
    await saved;
    await expect(done.getByTestId("card-card-1")).toBeAttached();
    await expect(page.getByTestId("stat-done")).toHaveText("3");

    await page.getByRole("button", { name: "AI assistant" }).click();
    const sidebar = page.getByTestId("ai-chat-sidebar");
    const box = await sidebar.boundingBox();
    expect(box?.width).toBe(390);
  });
});
