import { newCard, type BoardData } from "@/lib/kanban";

/** Mirrors the backend sample board (INITIAL_BOARD_DATA) */
export const initialData: BoardData = {
  columns: [
    { id: "col-backlog", title: "Backlog", cardIds: ["card-1", "card-2"] },
    { id: "col-discovery", title: "Discovery", cardIds: ["card-3"] },
    { id: "col-progress", title: "In Progress", cardIds: ["card-4", "card-5"] },
    { id: "col-review", title: "Review", cardIds: ["card-6"] },
    { id: "col-done", title: "Done", cardIds: ["card-7", "card-8"] },
  ],
  cards: {
    "card-1": newCard(
      "card-1",
      "Align roadmap themes",
      "Draft quarterly themes with impact statements and metrics.",
      { priority: "high", labels: ["strategy"] },
    ),
    "card-2": newCard(
      "card-2",
      "Gather customer signals",
      "Review support tags, sales notes, and churn feedback.",
      { labels: ["research"] },
    ),
    "card-3": newCard(
      "card-3",
      "Prototype analytics view",
      "Sketch initial dashboard layout and key drill-downs.",
      { priority: "medium", labels: ["design"] },
    ),
    "card-4": newCard(
      "card-4",
      "Refine status language",
      "Standardize column labels and tone across the board.",
      { priority: "low" },
    ),
    "card-5": newCard(
      "card-5",
      "Design card layout",
      "Add hierarchy and spacing for scanning dense lists.",
      {
        priority: "medium",
        labels: ["design"],
        checklist: [
          { id: "item-1", text: "Pick a type scale", done: true },
          { id: "item-2", text: "Test with dense lists", done: false },
        ],
      },
    ),
    "card-6": newCard(
      "card-6",
      "QA micro-interactions",
      "Verify hover, focus, and loading states.",
      {
        labels: ["qa"],
      },
    ),
    "card-7": newCard(
      "card-7",
      "Ship marketing page",
      "Final copy approved and asset pack delivered.",
    ),
    "card-8": newCard(
      "card-8",
      "Close onboarding sprint",
      "Document release notes and share internally.",
    ),
  },
  archived: {},
};
