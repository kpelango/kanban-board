export type Priority = "none" | "low" | "medium" | "high";

export type ChecklistItem = {
  id: string;
  text: string;
  done: boolean;
};

export type Card = {
  id: string;
  title: string;
  details: string;
  priority: Priority;
  dueDate: string | null;
  labels: string[];
  checklist: ChecklistItem[];
};

export type Column = {
  id: string;
  title: string;
  cardIds: string[];
  wipLimit?: number | null;
};

export type BoardData = {
  columns: Column[];
  cards: Record<string, Card>;
  /** Archived card id -> column it was archived from (where it is restored to) */
  archived: Record<string, string>;
};

export const PRIORITIES: Priority[] = ["none", "low", "medium", "high"];

export const PRIORITY_LABELS: Record<Priority, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
};
export const DONE_COLUMN_ID = "col-done";

export const newCard = (
  id: string,
  title: string,
  details: string,
  extra: Partial<Card> = {}
): Card => ({
  id,
  title,
  details,
  priority: "none",
  dueDate: null,
  labels: [],
  checklist: [],
  ...extra,
});

const isColumnId = (columns: Column[], id: string) =>
  columns.some((column) => column.id === id);

export const findColumnId = (columns: Column[], id: string) => {
  if (isColumnId(columns, id)) {
    return id;
  }
  return columns.find((column) => column.cardIds.includes(id))?.id;
};

export const moveCard = (
  columns: Column[],
  activeId: string,
  overId: string
): Column[] => {
  const activeColumnId = findColumnId(columns, activeId);
  const overColumnId = findColumnId(columns, overId);

  if (!activeColumnId || !overColumnId) {
    return columns;
  }

  const activeColumn = columns.find((column) => column.id === activeColumnId)!;
  const overColumn = columns.find((column) => column.id === overColumnId)!;

  const isOverColumn = isColumnId(columns, overId);

  if (activeColumnId === overColumnId) {
    if (isOverColumn) {
      const nextCardIds = activeColumn.cardIds.filter((cardId) => cardId !== activeId);
      nextCardIds.push(activeId);
      return columns.map((column) =>
        column.id === activeColumnId ? { ...column, cardIds: nextCardIds } : column
      );
    }

    const oldIndex = activeColumn.cardIds.indexOf(activeId);
    const newIndex = activeColumn.cardIds.indexOf(overId);

    if (oldIndex === newIndex) {
      return columns;
    }

    const nextCardIds = [...activeColumn.cardIds];
    nextCardIds.splice(oldIndex, 1);
    nextCardIds.splice(newIndex, 0, activeId);

    return columns.map((column) =>
      column.id === activeColumnId ? { ...column, cardIds: nextCardIds } : column
    );
  }

  const nextActiveCardIds = activeColumn.cardIds.filter((cardId) => cardId !== activeId);

  const nextOverCardIds = [...overColumn.cardIds];
  if (isOverColumn) {
    nextOverCardIds.push(activeId);
  } else {
    nextOverCardIds.splice(overColumn.cardIds.indexOf(overId), 0, activeId);
  }

  return columns.map((column) => {
    if (column.id === activeColumnId) {
      return { ...column, cardIds: nextActiveCardIds };
    }
    if (column.id === overColumnId) {
      return { ...column, cardIds: nextOverCardIds };
    }
    return column;
  });
};

export const createId = (prefix: string) => {
  const randomPart = Math.random().toString(36).slice(2, 8);
  const timePart = Date.now().toString(36);
  return `${prefix}-${randomPart}${timePart}`;
};

// Dates are plain YYYY-MM-DD strings in the user's local time zone.
export const todayISO = (now = new Date()) => {
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};

export const isOverdue = (card: Card, columnId: string | undefined, today: string) =>
  card.dueDate !== null && card.dueDate < today && columnId !== DONE_COLUMN_ID;

export type DueFilter = "all" | "overdue" | "week" | "none";

export type CardFilters = {
  query: string;
  priority: Priority | "all";
  label: string;
  due: DueFilter;
};

export const emptyFilters: CardFilters = { query: "", priority: "all", label: "", due: "all" };

export const hasActiveFilters = (filters: CardFilters) =>
  filters.query.trim() !== "" ||
  filters.priority !== "all" ||
  filters.label !== "" ||
  filters.due !== "all";

export const addDays = (isoDate: string, days: number) => {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setDate(date.getDate() + days);
  return todayISO(date);
};

const matchesDue = (card: Card, due: DueFilter, columnId: string | undefined, today: string) => {
  switch (due) {
    case "overdue":
      return isOverdue(card, columnId, today);
    case "week":
      return card.dueDate !== null && card.dueDate >= today && card.dueDate <= addDays(today, 6);
    case "none":
      return card.dueDate === null;
    default:
      return true;
  }
};

export const matchesFilters = (
  card: Card,
  filters: CardFilters,
  columnId?: string,
  today = todayISO()
) => {
  const query = filters.query.trim().toLowerCase();
  if (
    query &&
    ![card.title, card.details, ...card.labels, ...card.checklist.map((item) => item.text)].some(
      (text) => text.toLowerCase().includes(query)
    )
  ) {
    return false;
  }
  if (filters.priority !== "all" && card.priority !== filters.priority) {
    return false;
  }
  if (filters.label && !card.labels.includes(filters.label)) {
    return false;
  }
  return matchesDue(card, filters.due, columnId, today);
};

export const boardLabels = (board: BoardData) =>
  [...new Set(Object.values(board.cards).flatMap((c) => c.labels))].sort();

export const boardStats = (board: BoardData, today: string) => {
  let overdue = 0;
  for (const column of board.columns) {
    for (const cardId of column.cardIds) {
      if (isOverdue(board.cards[cardId], column.id, today)) {
        overdue += 1;
      }
    }
  }
  const done = board.columns.find((c) => c.id === DONE_COLUMN_ID)?.cardIds.length ?? 0;
  const total = board.columns.reduce((sum, column) => sum + column.cardIds.length, 0);
  return { total, done, overdue, archived: Object.keys(board.archived).length };
};

export const parseLabels = (text: string) =>
  [
    ...new Set(
      text
        .split(",")
        .map((label) => label.trim().toLowerCase().slice(0, 30))
        .filter(Boolean)
    ),
  ].slice(0, 10);

export const moveCardToColumn = (
  columns: Column[],
  cardId: string,
  targetColumnId: string
): Column[] => {
  const from = findColumnId(columns, cardId);
  if (!from || from === targetColumnId) {
    return columns;
  }
  return moveCard(columns, cardId, targetColumnId);
};

export const checklistProgress = (card: Card) => ({
  done: card.checklist.filter((item) => item.done).length,
  total: card.checklist.length,
});

const omit = <T,>(record: Record<string, T>, key: string) =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

export const archiveCards = (board: BoardData, cardIds: string[]): BoardData => {
  const ids = new Set(cardIds);
  const archived = { ...board.archived };
  for (const column of board.columns) {
    for (const cardId of column.cardIds) {
      if (ids.has(cardId)) {
        archived[cardId] = column.id;
      }
    }
  }
  return {
    ...board,
    archived,
    columns: board.columns.map((column) => ({
      ...column,
      cardIds: column.cardIds.filter((id) => !ids.has(id)),
    })),
  };
};

/** Puts a card into a column at an index (clamped to the end). */
export const insertCard = (
  board: BoardData,
  card: Card,
  columnId: string,
  index = Infinity
): BoardData => ({
  ...board,
  cards: { ...board.cards, [card.id]: card },
  columns: board.columns.map((column) => {
    if (column.id !== columnId) {
      return column;
    }
    const cardIds = [...column.cardIds];
    cardIds.splice(Math.min(index, cardIds.length), 0, card.id);
    return { ...column, cardIds };
  }),
});

export const deleteCard = (board: BoardData, cardId: string): BoardData => ({
  ...board,
  cards: omit(board.cards, cardId),
  columns: board.columns.map((column) => ({
    ...column,
    cardIds: column.cardIds.filter((id) => id !== cardId),
  })),
});

export const restoreCard = (board: BoardData, cardId: string): BoardData => {
  const columnId = board.archived[cardId];
  if (!columnId) {
    return board;
  }
  return {
    ...board,
    archived: omit(board.archived, cardId),
    columns: board.columns.map((column) =>
      column.id === columnId ? { ...column, cardIds: [...column.cardIds, cardId] } : column
    ),
  };
};

export const deleteArchivedCard = (board: BoardData, cardId: string): BoardData => {
  return { ...board, archived: omit(board.archived, cardId), cards: omit(board.cards, cardId) };
};
