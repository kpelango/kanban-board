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
});
