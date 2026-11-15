import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KanbanBoard } from "@/components/KanbanBoard";
import { emptyFilters, type BoardData, type CardFilters } from "@/lib/kanban";
import { initialData } from "@/test/fixtures";

const changes: BoardData[] = [];

const Harness = ({ filters = emptyFilters, start = initialData }: { filters?: CardFilters; start?: BoardData }) => {
  const [board, setBoard] = useState(start);
  return (
    <KanbanBoard
      board={board}
      filters={filters}
      onChange={(updater) =>
        setBoard((prev) => {
          const next = updater(prev);
          changes.push(next);
          return next;
        })
      }
    />
  );
};

const column = (id: string) => screen.getByTestId(`column-${id}`);

beforeEach(() => {
  changes.length = 0;
});

describe("KanbanBoard", () => {
  it("renders five columns with their cards and counts", () => {
    render(<Harness />);
    expect(screen.getAllByTestId(/^column-col-/)).toHaveLength(5);
    expect(within(column("col-backlog")).getByText("Align roadmap themes")).toBeInTheDocument();
    expect(within(column("col-backlog")).getByTestId("column-count")).toHaveTextContent("2");
    expect(within(column("col-backlog")).getByText("High")).toBeInTheDocument();
    expect(within(column("col-backlog")).getByText("strategy")).toBeInTheDocument();
  });

  it("renames a column when the title input loses focus", async () => {
    render(<Harness />);
    const input = within(column("col-backlog")).getByLabelText("Column title");
    await userEvent.clear(input);
    await userEvent.type(input, "Ideas");
    expect(changes).toHaveLength(0); // nothing saved while typing
    await userEvent.tab();
    expect(changes).toHaveLength(1);
    expect(changes[0].columns[0].title).toBe("Ideas");
  });

  it("restores the old column title when cleared", async () => {
    render(<Harness />);
    const input = within(column("col-backlog")).getByLabelText("Column title");
    await userEvent.clear(input);
    await userEvent.tab();
    expect(input).toHaveValue("Backlog");
    expect(changes).toHaveLength(0);
  });

  it("adds a card", async () => {
    render(<Harness />);
    const backlog = column("col-backlog");
    await userEvent.click(within(backlog).getByRole("button", { name: "Add a card" }));
    await userEvent.type(within(backlog).getByLabelText("Card title"), "New card");
    await userEvent.type(within(backlog).getByLabelText("Details"), "Notes");
    await userEvent.click(within(backlog).getByRole("button", { name: "Add card" }));
    expect(within(backlog).getByText("New card")).toBeInTheDocument();
    expect(within(backlog).getByTestId("column-count")).toHaveTextContent("3");
  });

  it("edits card fields and moves it to another column from the card dialog", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Align roadmap themes" }));
    const dialog = screen.getByRole("dialog", { name: "Edit card" });
    expect(within(dialog).getByLabelText("Title")).toHaveFocus();
    expect(within(dialog).getByLabelText("Title")).toHaveAttribute("maxlength", "200");
    expect(within(dialog).getByLabelText("Details")).toHaveAttribute("maxlength", "5000");
    await userEvent.clear(within(dialog).getByLabelText("Title"));
    await userEvent.type(within(dialog).getByLabelText("Title"), "Roadmap v2");
    await userEvent.click(within(dialog).getByLabelText("Low"));
    await userEvent.type(within(dialog).getByLabelText("Due date"), "2099-03-04");
    await userEvent.clear(within(dialog).getByLabelText("Labels"));
    await userEvent.type(within(dialog).getByLabelText("Labels"), "Planning, Q2");
    await userEvent.selectOptions(within(dialog).getByLabelText("Column"), "col-review");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save card" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const saved = changes.at(-1)!;
    expect(saved.cards["card-1"]).toMatchObject({
      title: "Roadmap v2",
      priority: "low",
      dueDate: "2099-03-04",
      labels: ["planning", "q2"],
    });
    expect(within(column("col-review")).getByText("Roadmap v2")).toBeInTheDocument();
    expect(within(column("col-backlog")).queryByText("Roadmap v2")).not.toBeInTheDocument();
  });

  it("edits a card checklist", async () => {
    render(<Harness />);
    const card = screen.getByTestId("card-card-5");
    expect(within(card).getByTestId("card-checklist")).toHaveTextContent("1/2");

    await userEvent.click(screen.getByRole("button", { name: "Edit Design card layout" }));
    const dialog = screen.getByRole("dialog", { name: "Edit card" });
    expect(within(dialog).getByText("1 of 2 done")).toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText("New checklist item"), "Review with team{Enter}");
    expect(screen.getByRole("dialog")).toBeInTheDocument(); // Enter added an item, did not submit
    await userEvent.click(within(dialog).getByLabelText("Done: Test with dense lists"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove Pick a type scale" }));
    expect(within(dialog).getByText("1 of 2 done")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Save card" }));

    const saved = changes.at(-1)!.cards["card-5"].checklist;
    expect(saved.map(({ text, done }) => ({ text, done }))).toEqual([
      { text: "Test with dense lists", done: true },
      { text: "Review with team", done: false },
    ]);
    expect(within(screen.getByTestId("card-card-5")).getByTestId("card-checklist")).toHaveTextContent("1/2");
  });

  it("cancels card edits without saving", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Align roadmap themes" }));
    await userEvent.type(screen.getByLabelText("Title"), " changed");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(changes).toHaveLength(0);
    expect(screen.getByText("Align roadmap themes")).toBeInTheDocument();
  });

  it("deletes a card after confirming", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Align roadmap themes" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete card" }));
    expect(screen.queryByText("Align roadmap themes")).not.toBeInTheDocument();
    expect(changes.at(-1)!.cards["card-1"]).toBeUndefined();
  });

  it("undoes a deleted card back to its original position", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Refine status language" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete card" }));
    expect(screen.queryByTestId("card-card-4")).not.toBeInTheDocument();
    expect(screen.getByText(/Deleted .Refine status language./)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(changes.at(-1)!.columns[2].cardIds).toEqual(["card-4", "card-5"]);
    expect(changes.at(-1)!.cards["card-4"].title).toBe("Refine status language");
    expect(screen.queryByText(/Deleted/)).not.toBeInTheDocument();
  });

  it("dismisses the undo message", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Refine status language" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete card" }));
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/Deleted/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("card-card-4")).not.toBeInTheDocument();
  });

  it("archives a card from the card dialog", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Ship marketing page" }));
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(screen.queryByTestId("card-card-7")).not.toBeInTheDocument();
    expect(changes.at(-1)!.archived).toEqual({ "card-7": "col-done" });
    expect(changes.at(-1)!.cards["card-7"]).toBeDefined();
  });

  it("archives every card in a column from its settings", async () => {
    render(<Harness />);
    const done = column("col-done");
    await userEvent.click(within(done).getByRole("button", { name: "Done settings" }));
    await userEvent.click(screen.getByRole("button", { name: "Archive 2 cards" }));
    expect(within(done).getByTestId("column-count")).toHaveTextContent("0");
    expect(changes.at(-1)!.archived).toEqual({ "card-7": "col-done", "card-8": "col-done" });
  });

  it("keeps archived cards when other edits happen", async () => {
    render(<Harness start={{ ...initialData, archived: { "card-7": "col-done" }, columns: initialData.columns.map((c) => c.id === "col-done" ? { ...c, cardIds: ["card-8"] } : c) }} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Close onboarding sprint" }));
    await userEvent.click(screen.getByRole("button", { name: "Save card" }));
    expect(changes.at(-1)!.archived).toEqual({ "card-7": "col-done" });
  });

  it("filters by due date", () => {
    const board = structuredClone(initialData);
    board.cards["card-2"].dueDate = "2000-01-01";
    render(<Harness start={board} filters={{ ...emptyFilters, due: "overdue" }} />);
    expect(screen.getAllByTestId(/^card-card-/)).toHaveLength(1);
    expect(screen.getByTestId("card-card-2")).toBeInTheDocument();
  });

  it("shows only cards matching the filters", () => {
    render(<Harness filters={{ ...emptyFilters, label: "design" }} />);
    expect(screen.getByText("Prototype analytics view")).toBeInTheDocument();
    expect(screen.getByText("Design card layout")).toBeInTheDocument();
    expect(screen.queryByText("Align roadmap themes")).not.toBeInTheDocument();
    expect(within(column("col-backlog")).getByText("No matching cards")).toBeInTheDocument();
    // Counts still reflect every card in the column
    expect(within(column("col-backlog")).getByTestId("column-count")).toHaveTextContent("2");
  });

  it("sets a WIP limit and flags columns over it", async () => {
    render(<Harness />);
    const progress = column("col-progress");
    await userEvent.click(within(progress).getByRole("button", { name: "In Progress settings" }));
    await userEvent.type(screen.getByLabelText("Work-in-progress limit"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Save limit" }));
    expect(changes.at(-1)!.columns[2].wipLimit).toBe(1);
    expect(within(progress).getByTestId("column-count")).toHaveTextContent("2/1");
    expect(within(progress).getByText("Over the limit of 1")).toBeInTheDocument();
  });

  it("marks overdue cards", () => {
    const board = structuredClone(initialData);
    board.cards["card-2"].dueDate = "2000-01-01";
    board.cards["card-7"].dueDate = "2000-01-01";
    render(<Harness start={board} />);
    expect(within(screen.getByTestId("card-card-2")).getByTestId("card-due")).toHaveTextContent(/^Overdue/);
    expect(within(screen.getByTestId("card-card-7")).getByTestId("card-due")).toHaveTextContent(/^Due/);
  });
});
