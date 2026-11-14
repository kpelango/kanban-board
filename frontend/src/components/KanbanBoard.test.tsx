import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { KanbanBoard } from "@/components/KanbanBoard";
import { initialData } from "@/lib/kanban";

const getFirstColumn = () => screen.getAllByTestId(/column-/i)[0];

describe("KanbanBoard", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      if (init?.method === "PUT") {
        return new Response(init.body as BodyInit, { status: 200 });
      }
      return new Response(JSON.stringify(initialData), { status: 200 });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders five columns and loads initial board from /api/board", async () => {
    render(<KanbanBoard />);
    expect(screen.getAllByTestId(/column-/i)).toHaveLength(5);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/board");
    });
  });

  it("renames a column and persists to /api/board", async () => {
    render(<KanbanBoard />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/board");
    });
    const column = getFirstColumn();
    const input = within(column).getByLabelText("Column title");
    await userEvent.clear(input);
    await userEvent.type(input, "New Name");
    expect(input).toHaveValue("New Name");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/board",
      expect.objectContaining({ method: "PUT" })
    );
  });

  it("adds and removes a card and persists changes", async () => {
    render(<KanbanBoard />);
    const column = getFirstColumn();
    const addButton = within(column).getByRole("button", {
      name: /add a card/i,
    });
    await userEvent.click(addButton);

    const titleInput = within(column).getByPlaceholderText(/card title/i);
    await userEvent.type(titleInput, "New card");
    const detailsInput = within(column).getByPlaceholderText(/details/i);
    await userEvent.type(detailsInput, "Notes");

    await userEvent.click(within(column).getByRole("button", { name: /add card/i }));

    expect(within(column).getByText("New card")).toBeInTheDocument();

    const deleteButton = within(column).getByRole("button", {
      name: /delete new card/i,
    });
    await userEvent.click(deleteButton);

    expect(within(column).queryByText("New card")).not.toBeInTheDocument();
  });

  it("edits an existing card title and details and persists to /api/board", async () => {
    render(<KanbanBoard />);
    const column = getFirstColumn();
    const editButton = within(column).getByRole("button", {
      name: /edit align roadmap themes/i,
    });
    await userEvent.click(editButton);

    const titleInput = within(column).getByLabelText("Edit card title");
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "Updated roadmap themes");

    const detailsInput = within(column).getByLabelText("Edit card details");
    await userEvent.clear(detailsInput);
    await userEvent.type(detailsInput, "Updated quarterly metrics.");

    await userEvent.click(within(column).getByRole("button", { name: /^save$/i }));

    expect(within(column).getByText("Updated roadmap themes")).toBeInTheDocument();
    expect(within(column).getByText("Updated quarterly metrics.")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/board",
      expect.objectContaining({ method: "PUT" })
    );
  });

  it("opens AI chat sidebar, sends conversation history, and refreshes board on AI update", async () => {
    const updatedBoard = JSON.parse(JSON.stringify(initialData)) as typeof initialData;
    updatedBoard.cards["card-99"] = {
      id: "card-99",
      title: "AI Generated Task",
      details: "Created from sidebar chat",
    };
    updatedBoard.columns[0].cardIds.push("card-99");

    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockImplementation(async (input, init) => {
        if (input === "/api/chat" && init?.method === "POST") {
          const parsedBody = JSON.parse(init.body as string) as {
            message: string;
            history: Array<{ role: string; content: string }>;
          };
          if (parsedBody.history.length === 0) {
            return new Response(
              JSON.stringify({
                reply: "You have 2 cards in Backlog.",
                board: null,
              }),
              { status: 200 }
            );
          }
          return new Response(
            JSON.stringify({
              reply: "Added AI Generated Task to Backlog.",
              board: updatedBoard,
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify(initialData), { status: 200 });
      });

    render(<KanbanBoard />);
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith("/api/board");
    });

    await userEvent.click(screen.getByRole("button", { name: /ai assistant/i }));
    const sidebar = screen.getByTestId("ai-chat-sidebar");
    expect(sidebar).toBeInTheDocument();

    const chatInput = within(sidebar).getByLabelText("AI chat input");
    await userEvent.type(chatInput, "How many cards in Backlog?");
    await userEvent.click(within(sidebar).getByRole("button", { name: /^send$/i }));

    expect(
      await within(sidebar).findByText("You have 2 cards in Backlog.")
    ).toBeInTheDocument();

    await userEvent.type(chatInput, "Add AI Generated Task to Backlog");
    await userEvent.click(within(sidebar).getByRole("button", { name: /^send$/i }));

    expect(
      await within(sidebar).findByText("Added AI Generated Task to Backlog.")
    ).toBeInTheDocument();

    const firstColumn = getFirstColumn();
    expect(within(firstColumn).getByText("AI Generated Task")).toBeInTheDocument();
  });
});
