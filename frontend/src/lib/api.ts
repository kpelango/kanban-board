import type { BoardData } from "@/lib/kanban";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatResponse = {
  reply: string;
  board: BoardData | null;
};

export const fetchBoard = async (): Promise<BoardData> => {
  const response = await fetch("/api/board");
  if (!response.ok) {
    throw new Error("Failed to load board");
  }
  return (await response.json()) as BoardData;
};

export const saveBoard = async (board: BoardData): Promise<BoardData> => {
  const response = await fetch("/api/board", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(board),
  });
  if (!response.ok) {
    throw new Error("Failed to save board");
  }
  return (await response.json()) as BoardData;
};

export const sendChatMessage = async (
  message: string,
  history: ChatMessage[]
): Promise<ChatResponse> => {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      detail?: string;
    } | null;
    throw new Error(data?.detail || "Failed to get a response from AI");
  }
  return (await response.json()) as ChatResponse;
};

export const fetchChatHistory = async (): Promise<ChatMessage[]> => {
  const response = await fetch("/api/chat/history");
  if (!response.ok) {
    throw new Error("Failed to load chat history");
  }
  const data = (await response.json()) as { messages: ChatMessage[] };
  return data.messages;
};

export const clearChatHistory = async (): Promise<void> => {
  const response = await fetch("/api/chat/history", { method: "DELETE" });
  if (!response.ok) {
    throw new Error("Failed to clear chat history");
  }
};
