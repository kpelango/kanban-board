import type { BoardData } from "@/lib/kanban";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  /** Set locally on assistant replies that changed the board */
  boardUpdated?: boolean;
};

/** Fired on any 401; the app treats it as a lost session only while someone is signed in. */
export const SESSION_EXPIRED_EVENT = "pm:session-expired";

export type BoardSummary = {
  id: number;
  name: string;
  cardCount: number;
  updatedAt: string;
};

export type ConversationSummary = {
  id: number;
  boardId: number;
  title: string;
  updatedAt: string;
};

export type Conversation = ConversationSummary & { messages: ChatMessage[] };

export type SendMessageResponse = {
  reply: string;
  board: BoardData | null;
  conversation: ConversationSummary;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

/** A user-facing message for anything thrown by these helpers (or fetch itself). */
export const errorText = (err: unknown, fallback = "Something went wrong. Try again.") =>
  err instanceof Error ? err.message : fallback;

const errorMessage = (detail: unknown, fallback: string) => {
  if (typeof detail === "string") {
    return detail;
  }
  // FastAPI validation errors: [{ msg: "..." }]
  if (Array.isArray(detail) && typeof detail[0]?.msg === "string") {
    return detail[0].msg.replace(/^Value error, /, "");
  }
  return fallback;
};

const request = async <T>(
  url: string,
  options: { method?: string; body?: unknown } = {},
  fallbackError = "Something went wrong. Try again."
): Promise<T> => {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (response.status === 401) {
    // page.tsx ignores this when nobody is signed in (failed sign-in, startup check)
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    throw new ApiError(errorMessage(data?.detail, fallbackError), response.status);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
};

// Auth

export type User = { username: string; isAdmin: boolean };

export type UserSummary = {
  id: number;
  username: string;
  isAdmin: boolean;
  createdAt: string;
  boardCount: number;
};

export const getMe = () => request<User>("/api/auth/me");

export const login = (username: string, password: string) =>
  request<User>("/api/auth/login", { method: "POST", body: { username, password } });

export const register = (username: string, password: string) =>
  request<User>("/api/auth/register", { method: "POST", body: { username, password } });

export const logout = () => request<void>("/api/auth/logout", { method: "POST" });

export const changePassword = (currentPassword: string, newPassword: string) =>
  request<void>("/api/auth/password", {
    method: "PUT",
    body: { currentPassword, newPassword },
  });

export const deleteAccount = (password: string) =>
  request<void>("/api/auth/account", { method: "DELETE", body: { password } });

// Boards

export const listBoards = () => request<BoardSummary[]>("/api/boards");

export const createBoard = (name: string, template: "sample" | "blank", data?: BoardData) =>
  request<BoardSummary>(
    "/api/boards",
    { method: "POST", body: data ? { name, template, data } : { name, template } },
    "Could not create the board."
  );

export const fetchBoard = (boardId: number) =>
  request<BoardData>(`/api/boards/${boardId}`, {}, "Could not load this board.");

export const saveBoard = (boardId: number, board: BoardData) =>
  request<BoardData>(`/api/boards/${boardId}`, { method: "PUT", body: board });

export const renameBoard = (boardId: number, name: string) =>
  request<BoardSummary>(`/api/boards/${boardId}`, { method: "PATCH", body: { name } });

export const deleteBoard = (boardId: number) =>
  request<void>(`/api/boards/${boardId}`, { method: "DELETE" });

// Conversations

export const listConversations = (boardId: number) =>
  request<ConversationSummary[]>(`/api/boards/${boardId}/conversations`);

export const createConversation = (boardId: number) =>
  request<ConversationSummary>(`/api/boards/${boardId}/conversations`, {
    method: "POST",
    body: {},
  });

export const fetchConversation = (conversationId: number) =>
  request<Conversation>(`/api/conversations/${conversationId}`);

export const renameConversation = (conversationId: number, name: string) =>
  request<ConversationSummary>(`/api/conversations/${conversationId}`, {
    method: "PATCH",
    body: { name },
  });

export const deleteConversation = (conversationId: number) =>
  request<void>(`/api/conversations/${conversationId}`, { method: "DELETE" });

export const sendMessage = (conversationId: number, message: string) =>
  request<SendMessageResponse>(
    `/api/conversations/${conversationId}/messages`,
    { method: "POST", body: { message } },
    "The assistant did not respond. Try again."
  );

// Admin

export const listUsers = () => request<UserSummary[]>("/api/admin/users");

export const resetUserPassword = (userId: number, newPassword: string) =>
  request<void>(`/api/admin/users/${userId}/password`, { method: "PUT", body: { newPassword } });

export const setUserAdmin = (userId: number, isAdmin: boolean) =>
  request<UserSummary>(`/api/admin/users/${userId}`, { method: "PATCH", body: { isAdmin } });

export const deleteUser = (userId: number) =>
  request<void>(`/api/admin/users/${userId}`, { method: "DELETE" });
