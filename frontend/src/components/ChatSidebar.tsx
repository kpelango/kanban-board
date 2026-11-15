"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import clsx from "clsx";
import {
  createConversation,
  deleteConversation,
  fetchConversation,
  listConversations,
  renameConversation,
  sendMessage,
  type ChatMessage,
  type ConversationSummary,
  errorText,
} from "@/lib/api";
import type { BoardData } from "@/lib/kanban";
import { formatDateTime } from "@/lib/format";
import { CheckIcon, CloseIcon, ErrorText, buttonGhost, buttonPrimary } from "@/components/ui";

type ChatSidebarProps = {
  boardId: number;
  boardName: string;
  isOpen: boolean;
  onClose: () => void;
  beforeSend?: () => Promise<unknown>;
  onBoardUpdate: (updatedBoard: BoardData) => void;
};

export const ChatSidebar = ({
  boardId,
  boardName,
  isOpen,
  onClose,
  beforeSend,
  onBoardUpdate,
}: ChatSidebarProps) => {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [showList, setShowList] = useState(false);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const requestedConversation = useRef<number | null>(null);
  const active = conversations.find((c) => c.id === activeId) ?? null;

  const openConversation = async (conversationId: number | null) => {
    requestedConversation.current = conversationId;
    setActiveId(conversationId);
    setShowList(false);
    setError(null);
    setMessages([]);
    if (conversationId !== null) {
      try {
        const { messages: loaded } = await fetchConversation(conversationId);
        if (requestedConversation.current === conversationId) {
          setMessages(loaded);
        }
      } catch {
        setError("Could not load this chat.");
      }
    }
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    let current = true;
    listConversations(boardId)
      .then(async (items) => {
        if (!current) {
          return;
        }
        setConversations(items);
        await openConversation(items[0]?.id ?? null);
      })
      .catch(() => setError("Could not load your chats."));
    return () => {
      current = false;
    };
  }, [boardId, isOpen]);

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages, isSending]);

  if (!isOpen) {
    return null;
  }

  const upsertConversation = (summary: ConversationSummary) =>
    setConversations((prev) => [summary, ...prev.filter((c) => c.id !== summary.id)]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isSending) {
      return;
    }
    setShowList(false);
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setError(null);
    setIsSending(true);
    try {
      await beforeSend?.();
      let conversationId = activeId;
      if (conversationId === null) {
        const created = await createConversation(boardId);
        upsertConversation(created);
        setActiveId(created.id);
        conversationId = created.id;
      }
      const response = await sendMessage(conversationId, text);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: response.reply, boardUpdated: response.board !== null },
      ]);
      upsertConversation(response.conversation);
      if (response.board) {
        onBoardUpdate(response.board);
      }
    } catch (err) {
      setError(errorText(err, "The assistant did not respond. Try again."));
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleSend();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void handleSend();
    }
  };

  const handleDelete = async (conversationId: number) => {
    await deleteConversation(conversationId).catch(() => null);
    setConversations((prev) => prev.filter((c) => c.id !== conversationId));
    if (conversationId === activeId) {
      setActiveId(null);
      setMessages([]);
    }
  };

  const handleRename = async (title: string) => {
    if (!active || !title.trim() || title.trim() === active.title) {
      return;
    }
    upsertConversation(await renameConversation(active.id, title.trim()));
  };

  return (
    <aside
      aria-label="AI assistant"
      data-testid="ai-chat-sidebar"
      className="fixed inset-0 z-40 flex flex-col bg-white sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[420px] sm:border-l sm:border-stroke sm:shadow-[var(--shadow-lift)]"
    >
      <header className="flex items-center gap-2 border-b border-stroke px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted">Assistant for {boardName}</p>
          {active && !showList ? (
            <input
              key={`${active.id}-${active.title}`}
              defaultValue={active.title}
              onBlur={(event) => void handleRename(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
              maxLength={80}
              aria-label="Chat title"
              className="w-full truncate rounded bg-transparent font-display text-lg font-semibold text-navy outline-none hover:bg-surface focus:bg-surface"
            />
          ) : (
            <h2 className="font-display text-lg font-semibold text-navy">
              {showList ? "All chats" : "New chat"}
            </h2>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowList((prev) => !prev)}
          className={buttonGhost}
          aria-pressed={showList}
        >
          Chats{conversations.length > 0 && ` (${conversations.length})`}
        </button>
        <button
          type="button"
          onClick={() => void openConversation(null)}
          className={buttonGhost}
          disabled={isSending}
        >
          New chat
        </button>
        <button type="button" onClick={onClose} className={buttonGhost} aria-label="Close AI assistant">
          <CloseIcon />
        </button>
      </header>

      {showList ? (
        <ul className="flex-1 overflow-y-auto p-2" aria-label="Chats">
          {conversations.length === 0 && (
            <li className="p-4 text-[15px] text-muted">No chats on this board yet.</li>
          )}
          {conversations.map((conversation) => (
            <li key={conversation.id} className="group flex items-center gap-1 rounded-md hover:bg-surface">
              <button
                type="button"
                onClick={() => void openConversation(conversation.id)}
                className="min-w-0 flex-1 px-3 py-2.5 text-left"
              >
                <span
                  className={clsx(
                    "block truncate font-bold",
                    conversation.id === activeId ? "text-link" : "text-navy"
                  )}
                >
                  {conversation.title}
                </span>
                <span className="text-sm text-muted">{formatDateTime(conversation.updatedAt)}</span>
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(conversation.id)}
                className={clsx(buttonGhost, "mr-1 text-danger hover:text-danger")}
                aria-label={`Delete chat ${conversation.title}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div ref={messagesRef} data-testid="ai-chat-messages" className="flex-1 space-y-3 overflow-y-auto bg-surface p-4">
          {messages.length === 0 && !isSending && (
            <div className="rounded-lg border border-stroke bg-white p-4 text-[15px] leading-relaxed text-ink-soft">
              <p className="font-bold text-navy">Ask about this board or tell it what to change.</p>
              <p className="mt-2">For example:</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>Add a high priority card to Backlog called Launch beta</li>
                <li>Move everything labelled design to Review</li>
                <li>Which cards are overdue?</li>
              </ul>
            </div>
          )}
          {messages.map((msg, index) => (
            <div key={`${msg.role}-${index}`} className={msg.role === "user" ? "flex justify-end" : ""}>
              <div
                data-testid={`chat-message-${msg.role}`}
                className={clsx(
                  "max-w-[88%] rounded-lg px-3.5 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap",
                  msg.role === "user"
                    ? "bg-navy text-white"
                    : "w-fit border border-stroke bg-white text-ink"
                )}
              >
                {msg.content}
              </div>
              {msg.boardUpdated && (
                <p className="mt-1 flex items-center gap-1.5 text-sm font-bold text-success">
                  <CheckIcon />
                  Updated the board
                </p>
              )}
            </div>
          ))}
          {isSending && (
            <div data-testid="ai-chat-loading" className="mr-auto rounded-lg border border-stroke bg-white px-3.5 py-2.5 text-[15px] text-muted">
              Working on it...
            </div>
          )}
          {error && <ErrorText>{error}</ErrorText>}
        </div>
      )}

      <form onSubmit={handleSubmit} className="border-t border-stroke bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            maxLength={4000}
            placeholder="Ask or tell the assistant..."
            aria-label="AI chat input"
            disabled={isSending}
            className="max-h-40 min-h-11 flex-1 resize-none rounded-md border border-stroke bg-surface px-3 py-2 text-[15px] text-ink outline-none focus:border-blue focus:bg-white disabled:opacity-60"
          />
          <button type="submit" disabled={isSending || !input.trim()} className={buttonPrimary}>
            Send
          </button>
        </div>
      </form>
    </aside>
  );
};
