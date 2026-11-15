import {
  addDays,
  archiveCards,
  deleteArchivedCard,
  deleteCard,
  insertCard,
  newCard,
  restoreCard,
  boardLabels,
  boardStats,
  checklistProgress,
  emptyFilters,
  hasActiveFilters,
  isOverdue,
  matchesFilters,
  moveCard,
  moveCardToColumn,
  parseLabels,
  todayISO,
  type Card,
  type Column,
} from "@/lib/kanban";
import { initialData } from "@/test/fixtures";

const card = (extra: Partial<Card> = {}): Card => ({
  id: "c",
  title: "Write launch notes",
  details: "Share with the support team",
  priority: "none",
  dueDate: null,
  labels: [],
  checklist: [],
  ...extra,
});

describe("moveCard", () => {
  const baseColumns: Column[] = [
    { id: "col-a", title: "A", cardIds: ["card-1", "card-2"] },
    { id: "col-b", title: "B", cardIds: ["card-3"] },
  ];

  it("reorders cards in the same column", () => {
    const result = moveCard(baseColumns, "card-2", "card-1");
    expect(result[0].cardIds).toEqual(["card-2", "card-1"]);
  });

  it("moves cards to another column", () => {
    const result = moveCard(baseColumns, "card-2", "card-3");
    expect(result[0].cardIds).toEqual(["card-1"]);
    expect(result[1].cardIds).toEqual(["card-2", "card-3"]);
  });

  it("drops cards to the end of a column", () => {
    const result = moveCard(baseColumns, "card-1", "col-b");
    expect(result[0].cardIds).toEqual(["card-2"]);
    expect(result[1].cardIds).toEqual(["card-3", "card-1"]);
  });

  it("ignores unknown ids", () => {
    expect(moveCard(baseColumns, "card-x", "col-b")).toBe(baseColumns);
  });
});

describe("moveCardToColumn", () => {
  const columns: Column[] = [
    { id: "col-a", title: "A", cardIds: ["card-1"] },
    { id: "col-b", title: "B", cardIds: ["card-2"] },
  ];

  it("appends the card to the target column", () => {
    const result = moveCardToColumn(columns, "card-1", "col-b");
    expect(result[0].cardIds).toEqual([]);
    expect(result[1].cardIds).toEqual(["card-2", "card-1"]);
  });

  it("keeps the order when the card is already there", () => {
    expect(moveCardToColumn(columns, "card-1", "col-a")).toBe(columns);
  });
});

describe("todayISO", () => {
  it("formats the local date", () => {
    expect(todayISO(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});

describe("isOverdue", () => {
  it("flags past due dates outside Done", () => {
    expect(isOverdue(card({ dueDate: "2026-01-01" }), "col-backlog", "2026-01-02")).toBe(true);
    expect(isOverdue(card({ dueDate: "2026-01-02" }), "col-backlog", "2026-01-02")).toBe(false);
    expect(isOverdue(card({ dueDate: "2026-01-01" }), "col-done", "2026-01-02")).toBe(false);
    expect(isOverdue(card(), "col-backlog", "2026-01-02")).toBe(false);
  });
});

describe("matchesFilters", () => {
  const target = card({ priority: "high", labels: ["design", "web"] });

  it("matches everything with empty filters", () => {
    expect(hasActiveFilters(emptyFilters)).toBe(false);
    expect(matchesFilters(target, emptyFilters)).toBe(true);
  });

  it("searches title, details, and labels case-insensitively", () => {
    expect(matchesFilters(target, { ...emptyFilters, query: "LAUNCH" })).toBe(true);
    expect(matchesFilters(target, { ...emptyFilters, query: "support" })).toBe(true);
    expect(matchesFilters(target, { ...emptyFilters, query: "web" })).toBe(true);
    expect(matchesFilters(target, { ...emptyFilters, query: "billing" })).toBe(false);
  });

  it("filters by priority and label", () => {
    expect(matchesFilters(target, { ...emptyFilters, priority: "high" })).toBe(true);
    expect(matchesFilters(target, { ...emptyFilters, priority: "low" })).toBe(false);
    expect(matchesFilters(target, { ...emptyFilters, label: "design" })).toBe(true);
    expect(matchesFilters(target, { ...emptyFilters, label: "qa" })).toBe(false);
    expect(hasActiveFilters({ ...emptyFilters, label: "qa" })).toBe(true);
  });
});

describe("board helpers", () => {
  it("collects sorted unique labels", () => {
    expect(boardLabels(initialData)).toEqual(["design", "qa", "research", "strategy"]);
  });

  it("counts total, done, and overdue cards", () => {
    const board = structuredClone(initialData);
    board.cards["card-1"].dueDate = "2026-01-01";
    board.cards["card-7"].dueDate = "2026-01-01"; // in Done, not overdue
    expect(boardStats(board, "2026-02-01")).toEqual({ total: 8, done: 2, overdue: 1, archived: 0 });
  });

  it("parses comma separated labels", () => {
    expect(parseLabels(" Design, web,,design , ")).toEqual(["design", "web"]);
    expect(parseLabels("a".repeat(40))).toEqual(["a".repeat(30)]);
    expect(parseLabels(Array.from({ length: 12 }, (_, i) => `l${i}`).join(","))).toHaveLength(10);
  });
});

describe("checklistProgress", () => {
  it("counts done and total items", () => {
    expect(checklistProgress(card())).toEqual({ done: 0, total: 0 });
    expect(
      checklistProgress(
        card({
          checklist: [
            { id: "a", text: "One", done: true },
            { id: "b", text: "Two", done: false },
            { id: "c", text: "Three", done: true },
          ],
        })
      )
    ).toEqual({ done: 2, total: 3 });
  });
});

describe("due date filter", () => {
  const today = "2026-03-10";
  const due = (dueDate: string | null) => card({ dueDate });

  it("adds days across month boundaries", () => {
    expect(addDays("2026-01-30", 3)).toBe("2026-02-02");
  });

  it("matches overdue cards outside Done", () => {
    const filters = { ...emptyFilters, due: "overdue" as const };
    expect(matchesFilters(due("2026-03-09"), filters, "col-backlog", today)).toBe(true);
    expect(matchesFilters(due("2026-03-09"), filters, "col-done", today)).toBe(false);
    expect(matchesFilters(due("2026-03-10"), filters, "col-backlog", today)).toBe(false);
  });

  it("matches cards due within the next 7 days", () => {
    const filters = { ...emptyFilters, due: "week" as const };
    expect(matchesFilters(due("2026-03-10"), filters, "col-backlog", today)).toBe(true);
    expect(matchesFilters(due("2026-03-16"), filters, "col-backlog", today)).toBe(true);
    expect(matchesFilters(due("2026-03-17"), filters, "col-backlog", today)).toBe(false);
    expect(matchesFilters(due("2026-03-09"), filters, "col-backlog", today)).toBe(false);
    expect(matchesFilters(due(null), filters, "col-backlog", today)).toBe(false);
  });

  it("matches cards without a due date", () => {
    const filters = { ...emptyFilters, due: "none" as const };
    expect(hasActiveFilters(filters)).toBe(true);
    expect(matchesFilters(due(null), filters)).toBe(true);
    expect(matchesFilters(due("2026-03-10"), filters)).toBe(false);
  });

  it("searches checklist items", () => {
    const withChecklist = card({ checklist: [{ id: "a", text: "Book venue", done: false }] });
    expect(matchesFilters(withChecklist, { ...emptyFilters, query: "venue" })).toBe(true);
  });
});

describe("archive helpers", () => {
  it("archives cards with the column they came from", () => {
    const board = archiveCards(initialData, ["card-1", "card-7"]);
    expect(board.archived).toEqual({ "card-1": "col-backlog", "card-7": "col-done" });
    expect(board.columns[0].cardIds).toEqual(["card-2"]);
    expect(board.columns[4].cardIds).toEqual(["card-8"]);
    expect(board.cards["card-1"]).toBeDefined();
    expect(boardStats(board, "2026-01-01")).toMatchObject({ total: 6, done: 1, archived: 2 });
  });

  it("restores a card to the end of its original column", () => {
    const board = restoreCard(archiveCards(initialData, ["card-1"]), "card-1");
    expect(board.archived).toEqual({});
    expect(board.columns[0].cardIds).toEqual(["card-2", "card-1"]);
    expect(restoreCard(board, "card-unknown")).toBe(board);
  });

  it("deletes an archived card for good", () => {
    const board = deleteArchivedCard(archiveCards(initialData, ["card-1"]), "card-1");
    expect(board.archived).toEqual({});
    expect(board.cards["card-1"]).toBeUndefined();
  });

  it("deletes a card and puts it back at its old index", () => {
    const card = initialData.cards["card-4"];
    const removed = deleteCard(initialData, "card-4");
    expect(removed.cards["card-4"]).toBeUndefined();
    expect(removed.columns[2].cardIds).toEqual(["card-5"]);
    const restored = insertCard(removed, card, "col-progress", 0);
    expect(restored.columns[2].cardIds).toEqual(["card-4", "card-5"]);
    expect(restored.archived).toBe(initialData.archived);
  });

  it("appends a new card to the end of a column by default", () => {
    const board = insertCard(initialData, newCard("card-new", "New", ""), "col-review");
    expect(board.columns[3].cardIds).toEqual(["card-6", "card-new"]);
    expect(board.cards["card-new"]).toMatchObject({ priority: "none", labels: [], checklist: [] });
  });
});
