import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Workspace } from "@/components/Workspace";
import { initialData } from "@/test/fixtures";
import { mockFetch } from "@/test/fetchMock";

const blank = {
  columns: initialData.columns.map((c) => ({ ...c, cardIds: [] })),
  cards: {},
  archived: {},
};

const boardSummary = (id: number, name: string, cardCount = 8) => ({
  id,
  name,
  cardCount,
  updatedAt: "2026-11-14T10:00:00+00:00",
});

let boards: ReturnType<typeof boardSummary>[];

const setup = (extra: Record<string, (body: unknown) => unknown> = {}) =>
  mockFetch({
    "GET /api/boards": () => boards,
    "GET /api/boards/1": () => initialData,
    "GET /api/boards/2": () => blank,
    "PUT /api/boards/1": (body) => body,
    ...extra,
  });

beforeEach(() => {
  boards = [boardSummary(1, "Roadmap"), boardSummary(2, "Hiring", 0)];
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Workspace", () => {
  it("loads the first board with stats", async () => {
    setup();
    render(<Workspace username="user" onLogout={vi.fn()} />);
    expect(await screen.findByTestId("kanban-board-loaded")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Roadmap" })).toBeInTheDocument();
    expect(screen.getByTestId("stat-total")).toHaveTextContent("8");
    expect(screen.getByTestId("stat-done")).toHaveTextContent("2");
  });

  it("switches boards and remembers the choice", async () => {
    setup();
    const { unmount } = render(<Workspace username="user" onLogout={vi.fn()} />);
    await screen.findByTestId("kanban-board-loaded");
    await userEvent.click(screen.getByRole("button", { name: /switch board/i }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Boards" })).getByRole("button", { name: /Hiring/ }));
    await waitFor(() => expect(screen.getByTestId("stat-total")).toHaveTextContent("0"));
    expect(screen.getByRole("heading", { name: "Hiring" })).toBeInTheDocument();
    unmount();

    render(<Workspace username="user" onLogout={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Hiring" })).toBeInTheDocument();
  });

  it("ignores a slow board response after switching to another board", async () => {
    let releaseFirst: () => void = () => {};
    let firstRequests = 0;
    setup({
      "GET /api/boards/1": () => {
        firstRequests += 1;
        if (firstRequests === 1) {
          return initialData;
        }
        return new Promise((resolve) => {
          releaseFirst = () => resolve(initialData);
        });
      },
    });
    render(<Workspace username="user" onLogout={vi.fn()} />);
    await screen.findByTestId("kanban-board-loaded");

    // Start loading Roadmap again (slow), then switch to Hiring before it returns
    await userEvent.click(screen.getByRole("button", { name: /switch board/i }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Boards" })).getByRole("button", { name: /Hiring/ }));
    await userEvent.click(screen.getByRole("button", { name: /switch board/i }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Boards" })).getByRole("button", { name: /Roadmap/ }));
    await userEvent.click(screen.getByRole("button", { name: /switch board/i }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Boards" })).getByRole("button", { name: /Hiring/ }));
    await waitFor(() => expect(screen.getByTestId("stat-total")).toHaveTextContent("0"));

    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByRole("heading", { name: "Hiring" })).toBeInTheDocument();
    expect(screen.getByTestId("stat-total")).toHaveTextContent("0");
  });

  it("waits for pending saves before messaging the assistant", async () => {
    let releaseSave: () => void = () => {};
    const { calls } = setup({
      "PUT /api/boards/1": (body) =>
        new Promise((resolve) => {
          releaseSave = () => resolve(body);
        }),
      "GET /api/boards/1/conversations": () => [],
      "POST /api/boards/1/conversations": () => ({
        status: 201,
        body: { id: 9, boardId: 1, title: "New conversation", updatedAt: "2026-11-14T10:00:00+00:00" },
      }),
      "POST /api/conversations/9/messages": () => ({
        reply: "Seen it.",
        board: null,
        conversation: { id: 9, boardId: 1, title: "Hi", updatedAt: "2026-11-14T10:00:00+00:00" },
      }),
    });
    render(<Workspace username="user" onLogout={vi.fn()} />);
    await screen.findByTestId("kanban-board-loaded");

    const backlog = screen.getByTestId("column-col-backlog");
    await userEvent.click(within(backlog).getByRole("button", { name: "Add a card" }));
    await userEvent.type(within(backlog).getByLabelText("Card title"), "Unsaved card");
    await userEvent.click(within(backlog).getByRole("button", { name: "Add card" }));

    await userEvent.click(screen.getByRole("button", { name: "AI assistant" }));
    await screen.findByText("Ask about this board or tell it what to change.");
    await userEvent.type(screen.getByLabelText("AI chat input"), "Hi{Enter}");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.some((c) => c.key === "POST /api/conversations/9/messages")).toBe(false);

    releaseSave();
    expect(await screen.findByText("Seen it.")).toBeInTheDocument();
    const keys = calls.map((c) => c.key);
    expect(keys.indexOf("POST /api/conversations/9/messages")).toBeGreaterThan(keys.indexOf("PUT /api/boards/1"));
  });

  it("creates, renames, and deletes boards", async () => {
    const { calls } = setup({
      "POST /api/boards": (body) => {
        const created = boardSummary(3, (body as { name: string }).name, 0);
        boards = [...boards, created];
        return { status: 201, body: created };
      },
      "GET /api/boards/3": () => blank,
      "PATCH /api/boards/3": (body) => {
        boards = boards.map((b) => (b.id === 3 ? { ...b, name: (body as { name: string }).name } : b));
        return boards[2];
      },
      "DELETE /api/boards/3": () => {
        boards = boards.filter((b) => b.id !== 3);
        return { status: 204 };
      },
    });
    render(<Workspace username="user" onLogout={vi.fn()} />);
    await screen.findByTestId("kanban-board-loaded");

    await userEvent.click(screen.getByRole("button", { name: /switch board/i }));
    await userEvent.click(screen.getByRole("button", { name: "New board" }));
    await userEvent.type(screen.getByLabelText("New board name"), "Launch");
    await userEvent.click(screen.getByRole("button", { name: "Create board" }));
    expect(await screen.findByRole("heading", { name: "Launch" })).toBeInTheDocument();
    expect(calls.find((c) => c.key === "POST /api/boards")?.body).toEqual({
      name: "Launch",
      template: "blank",
    });

    await userEvent.click(screen.getByRole("button", { name: /switch board/i }));
    await userEvent.click(screen.getByRole("button", { name: "Rename this board" }));
    const nameInput = screen.getByLabelText("Board name");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Launch v2");
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByRole("heading", { name: "Launch v2" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /switch board/i }));
    await userEvent.click(screen.getByRole("button", { name: "Delete this board" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete board" }));
    expect(await screen.findByRole("heading", { name: "Roadmap" })).toBeInTheDocument();
  });

  it("duplicates the current board", async () => {
    const { calls } = setup({
      "POST /api/boards": (body) => {
        const created = boardSummary(3, (body as { name: string }).name);
        boards = [...boards, created];
        return { status: 201, body: created };
      },
      "GET /api/boards/3": () => initialData,
    });
    render(<Workspace username="user" onLogout={vi.fn()} />);
    await screen.findByTestId("kanban-board-loaded");
    await userEvent.click(screen.getByRole("button", { name: /switch board/i }));
    await userEvent.click(screen.getByRole("button", { name: "Duplicate this board" }));
    expect(await screen.findByRole("heading", { name: "Roadmap copy" })).toBeInTheDocument();
    const post = calls.find((c) => c.key === "POST /api/boards")!.body as { data: unknown };
    expect(post.data).toEqual(initialData);
  });

  it("imports a board file and reports invalid files", async () => {
    const { calls } = setup({
      "POST /api/boards": (body) => {
        const created = boardSummary(4, (body as { name: string }).name);
        boards = [...boards, created];
        return { status: 201, body: created };
      },
      "GET /api/boards/4": () => initialData,
    });
    render(<Workspace username="user" onLogout={vi.fn()} />);
    await screen.findByTestId("kanban-board-loaded");

    await userEvent.click(screen.getByRole("button", { name: /switch board/i }));
    await userEvent.upload(
      screen.getByLabelText("Import a board"),
      new File(["nope"], "broken.json", { type: "application/json" })
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("not valid JSON");

    await userEvent.upload(
      screen.getByLabelText("Import a board"),
      new File([JSON.stringify({ kanbanStudio: 1, name: "Imported plan", board: initialData })], "plan.json", {
        type: "application/json",
      })
    );
    expect(await screen.findByRole("heading", { name: "Imported plan" })).toBeInTheDocument();
    expect(calls.find((c) => c.key === "POST /api/boards")!.body).toMatchObject({
      name: "Imported plan",
      data: initialData,
    });
  });

  it("saves board changes and reports failures", async () => {
    let fail = false;
    const { calls } = setup({
      "PUT /api/boards/1": (body) => (fail ? { status: 500, body: {} } : body),
    });
    render(<Workspace username="user" onLogout={vi.fn()} />);
    await screen.findByTestId("kanban-board-loaded");

    const backlog = screen.getByTestId("column-col-backlog");
    await userEvent.click(within(backlog).getByRole("button", { name: "Add a card" }));
    await userEvent.type(within(backlog).getByLabelText("Card title"), "Saved card");
    await userEvent.click(within(backlog).getByRole("button", { name: "Add card" }));
    expect(await screen.findByText("All changes saved")).toBeInTheDocument();
    expect(calls.filter((c) => c.key === "PUT /api/boards/1")).toHaveLength(1);

    fail = true;
    await userEvent.click(within(backlog).getByRole("button", { name: "Add a card" }));
    await userEvent.type(within(backlog).getByLabelText("Card title"), "Lost card");
    await userEvent.click(within(backlog).getByRole("button", { name: "Add card" }));
    expect(await screen.findByText(/Your last change was not saved/)).toBeInTheDocument();
  });

  it("filters cards from the toolbar", async () => {
    setup();
    render(<Workspace username="user" onLogout={vi.fn()} />);
    await screen.findByTestId("kanban-board-loaded");
    await userEvent.type(screen.getByLabelText("Search cards"), "roadmap");
    expect(screen.getByText("Align roadmap themes")).toBeInTheDocument();
    expect(screen.queryByText("Gather customer signals")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Gather customer signals")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Filter by priority"), "medium");
    expect(screen.getByText("Prototype analytics view")).toBeInTheDocument();
    expect(screen.queryByText("Align roadmap themes")).not.toBeInTheDocument();
  });

  it("focuses search with the / shortcut unless typing", async () => {
    setup();
    render(<Workspace username="user" onLogout={vi.fn()} />);
    await screen.findByTestId("kanban-board-loaded");
    const search = screen.getByLabelText("Search cards");

    await userEvent.keyboard("/");
    expect(search).toHaveFocus();
    expect(search).toHaveValue("");

    const columnTitle = within(screen.getByTestId("column-col-backlog")).getByLabelText("Column title");
    await userEvent.click(columnTitle);
    await userEvent.keyboard("/");
    expect(columnTitle).toHaveFocus();
    expect(columnTitle).toHaveValue("Backlog/");
  });

  it("filters by due date from the toolbar", async () => {
    setup();
    render(<Workspace username="user" onLogout={vi.fn()} />);
    await screen.findByTestId("kanban-board-loaded");
    await userEvent.selectOptions(screen.getByLabelText("Filter by due date"), "none");
    expect(screen.getAllByTestId(/^card-card-/)).toHaveLength(8);
    await userEvent.selectOptions(screen.getByLabelText("Filter by due date"), "overdue");
    expect(screen.queryAllByTestId(/^card-card-/)).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByLabelText("Filter by due date")).toHaveValue("all");
  });

  it("restores and permanently deletes archived cards", async () => {
    const archivedBoard = {
      ...initialData,
      columns: initialData.columns.map((c) =>
        c.id === "col-done" ? { ...c, cardIds: [] } : c
      ),
      archived: { "card-7": "col-done", "card-8": "col-done" },
    };
    const { calls } = setup({
      "GET /api/boards/1": () => archivedBoard,
      "PUT /api/boards/1": (body) => body,
    });
    render(<Workspace username="user" onLogout={vi.fn()} />);
    await screen.findByTestId("kanban-board-loaded");
    expect(screen.getByTestId("stat-total")).toHaveTextContent("6");

    await userEvent.click(screen.getByRole("button", { name: "Archived cards (2)" }));
    const dialog = screen.getByRole("dialog", { name: "Archived cards" });
    expect(within(dialog).getAllByText("From Done")).toHaveLength(2);

    await userEvent.click(within(dialog).getByRole("button", { name: "Restore Ship marketing page" }));
    expect(within(screen.getByTestId("column-col-done")).getByText("Ship marketing page")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Delete Close onboarding sprint" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete forever" }));
    expect(within(dialog).getByText(/Nothing archived/)).toBeInTheDocument();

    await waitFor(() => expect(calls.filter((c) => c.key === "PUT /api/boards/1")).toHaveLength(2));
    const last = calls.filter((c) => c.key === "PUT /api/boards/1").at(-1)!.body as typeof archivedBoard;
    expect(last.archived).toEqual({});
    expect(last.cards).not.toHaveProperty("card-8");
    expect(last.columns[4].cardIds).toEqual(["card-7"]);
  });

  it("shows Manage users only to admins", async () => {
    setup({ "GET /api/admin/users": () => [] });
    const { unmount } = render(<Workspace username="user" onLogout={vi.fn()} />);
    await screen.findByTestId("kanban-board-loaded");
    await userEvent.click(screen.getByRole("button", { name: "Account menu for user" }));
    expect(screen.queryByRole("menuitem", { name: "Manage users" })).not.toBeInTheDocument();
    unmount();

    render(<Workspace username="user" isAdmin onLogout={vi.fn()} />);
    await screen.findByTestId("kanban-board-loaded");
    await userEvent.click(screen.getByRole("button", { name: "Account menu for user" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Manage users" }));
    expect(screen.getByRole("dialog", { name: "Manage users" })).toBeInTheDocument();
  });

  it("logs out from the account menu", async () => {
    setup();
    const onLogout = vi.fn();
    render(<Workspace username="user" onLogout={onLogout} />);
    await screen.findByTestId("kanban-board-loaded");
    await userEvent.click(screen.getByRole("button", { name: "Account menu for user" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Log out" }));
    expect(onLogout).toHaveBeenCalled();
  });

  it("changes the password from account settings", async () => {
    const { calls } = setup({
      "PUT /api/auth/password": (body) =>
        (body as { currentPassword: string }).currentPassword === "password"
          ? { status: "password_changed" }
          : { status: 400, body: { detail: "Current password is incorrect" } },
    });
    render(<Workspace username="user" onLogout={vi.fn()} />);
    await screen.findByTestId("kanban-board-loaded");
    await userEvent.click(screen.getByRole("button", { name: "Account menu for user" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Account settings" }));

    const dialog = screen.getByRole("dialog", { name: "Account settings" });
    await userEvent.type(within(dialog).getByLabelText("Current password"), "wrong");
    await userEvent.type(within(dialog).getByLabelText("New password"), "new-password");
    await userEvent.click(within(dialog).getByRole("button", { name: "Change password" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Current password is incorrect");

    await userEvent.clear(within(dialog).getByLabelText("Current password"));
    await userEvent.type(within(dialog).getByLabelText("Current password"), "password");
    await userEvent.click(within(dialog).getByRole("button", { name: "Change password" }));
    expect(await within(dialog).findByRole("status")).toHaveTextContent("Password changed.");
    expect(calls.at(-1)?.body).toEqual({ currentPassword: "password", newPassword: "new-password" });
  });

  it("deletes the account and signs out", async () => {
    setup({ "DELETE /api/auth/account": () => ({ status: "account_deleted" }) });
    const onLogout = vi.fn();
    render(<Workspace username="user" onLogout={onLogout} />);
    await screen.findByTestId("kanban-board-loaded");
    await userEvent.click(screen.getByRole("button", { name: "Account menu for user" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Account settings" }));
    await userEvent.type(screen.getByLabelText("Confirm with your password"), "password");
    await userEvent.click(screen.getByRole("button", { name: "Delete account" }));
    await waitFor(() => expect(onLogout).toHaveBeenCalled());
  });
});
