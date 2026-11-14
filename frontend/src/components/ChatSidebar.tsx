"use client";

import { useState, type FormEvent } from "react";
import clsx from "clsx";
import { sendChatMessage, type ChatMessage } from "@/lib/api";
import type { BoardData } from "@/lib/kanban";

type ChatSidebarProps = {
  isOpen: boolean;
  onClose: () => void;
  onBoardUpdate: (updatedBoard: BoardData) => void;
};

export const ChatSidebar = ({
  isOpen,
  onClose,
  onBoardUpdate,
}: ChatSidebarProps) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) {
    return null;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isSending) {
      return;
    }

    const historySnapshot = messages;
    const userMessage: ChatMessage = { role: "user", content: trimmed };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setError(null);
    setIsSending(true);

    try {
      const response = await sendChatMessage(trimmed, historySnapshot);
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: response.reply,
      };
      setMessages((prev) => [...prev, assistantMessage]);
      if (response.board) {
        onBoardUpdate(response.board);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to complete AI request."
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <aside
      aria-label="AI Assistant Sidebar"
      data-testid="ai-chat-sidebar"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-[var(--stroke)] bg-white shadow-[0_18px_40px_rgba(3,33,71,0.2)]"
    >
      <div className="flex items-center justify-between border-b border-[var(--stroke)] px-6 py-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent-yellow)]" />
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--primary-blue)]">
              Kanban AI
            </p>
          </div>
          <h2 className="mt-1 font-display text-xl font-semibold text-[var(--navy-dark)]">
            Project Assistant
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close AI Assistant"
          className="rounded-full border border-[var(--stroke)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-[var(--gray-text)] transition hover:border-[var(--navy-dark)] hover:text-[var(--navy-dark)]"
        >
          Close
        </button>
      </div>

      <div
        data-testid="ai-chat-messages"
        className="flex-1 space-y-4 overflow-y-auto bg-[var(--surface)] p-6"
      >
        {messages.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[var(--stroke)] bg-white p-5 text-sm leading-6 text-[var(--gray-text)]">
            <p className="font-semibold text-[var(--navy-dark)]">
              Ask about your board or request changes.
            </p>
            <p className="mt-2">
              Try asking: &ldquo;Add a card to Backlog called Launch beta&rdquo; or
              &ldquo;Move Align roadmap themes to Review&rdquo;.
            </p>
          </div>
        )}

        {messages.map((msg, index) => (
          <div
            key={`${msg.role}-${index}`}
            data-testid={`chat-message-${msg.role}`}
            className={clsx(
              "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6",
              msg.role === "user"
                ? "ml-auto bg-[var(--primary-blue)] text-white"
                : "mr-auto border border-[var(--stroke)] bg-white text-[var(--navy-dark)] shadow-sm"
            )}
          >
            {msg.content}
          </div>
        ))}

        {isSending && (
          <div
            data-testid="ai-chat-loading"
            className="mr-auto max-w-[85%] rounded-2xl border border-[var(--stroke)] bg-white px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]"
          >
            Thinking...
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-semibold text-red-700"
          >
            {error}
          </p>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-[var(--stroke)] bg-white p-4"
      >
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask AI to create, edit, or move cards..."
            aria-label="AI chat input"
            disabled={isSending}
            className="flex-1 rounded-xl border border-[var(--stroke)] bg-[var(--surface)] px-4 py-3 text-sm font-medium text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)] focus:bg-white disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={isSending || !input.trim()}
            className="rounded-full bg-[var(--secondary-purple)] px-5 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:brightness-110 disabled:opacity-60"
          >
            Send
          </button>
        </div>
      </form>
    </aside>
  );
};
