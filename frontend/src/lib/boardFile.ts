import type { BoardData } from "@/lib/kanban";

/** File format for exported boards. Imports also accept a bare BoardData object. */
export type BoardFile = { kanbanStudio: 1; name: string; board: BoardData };

export const toBoardFile = (name: string, board: BoardData): string =>
  JSON.stringify({ kanbanStudio: 1, name, board } satisfies BoardFile, null, 2);

export const boardFileName = (name: string) =>
  `${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "board"}.json`;

const isBoardData = (value: unknown): value is BoardData =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as BoardData).columns) &&
  typeof (value as BoardData).cards === "object";

/** Reads an exported board; the server does the full validation when it is saved. */
export const parseBoardFile = (text: string, fileName: string): { name: string; board: BoardData } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  const fallbackName = fileName.replace(/\.json$/i, "").slice(0, 80) || "Imported board";
  if (isBoardData(parsed)) {
    return { name: fallbackName, board: parsed };
  }
  const file = parsed as Partial<BoardFile>;
  if (isBoardData(file.board)) {
    const name = typeof file.name === "string" && file.name.trim() ? file.name.trim() : fallbackName;
    return { name: name.slice(0, 80), board: file.board };
  }
  throw new Error("This file is not a Kanban Studio board.");
};
