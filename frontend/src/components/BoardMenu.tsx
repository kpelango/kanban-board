"use client";

import { errorText } from "@/lib/api";
import { useRef, useState, type FormEvent } from "react";
import clsx from "clsx";
import type { BoardSummary } from "@/lib/api";
import {
  ErrorText,
  buttonDanger,
  buttonPrimary,
  buttonSecondary,
  inputClass,
  labelClass,
  menuItemClass,
  popoverClass,
  useDismiss,
} from "@/components/ui";

type BoardMenuProps = {
  boards: BoardSummary[];
  activeBoardId: number;
  onOpen: () => void;
  onSelect: (boardId: number) => void;
  onCreate: (name: string, template: "sample" | "blank") => Promise<void>;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onDuplicate: () => Promise<void>;
  onExport: () => void;
  onImport: (file: File) => Promise<void>;
};

type Panel = "list" | "create" | "rename" | "delete";

export const BoardMenu = ({
  boards,
  activeBoardId,
  onOpen,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onDuplicate,
  onExport,
  onImport,
}: BoardMenuProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>("list");
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<"sample" | "blank">("blank");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeBoard = boards.find((board) => board.id === activeBoardId);

  const close = () => {
    setIsOpen(false);
    setPanel("list");
    setError(null);
  };
  useDismiss(containerRef, isOpen, close);

  const toggle = () => {
    if (isOpen) {
      close();
    } else {
      setIsOpen(true);
      onOpen();
    }
  };

  const showPanel = (next: Panel) => {
    setPanel(next);
    setError(null);
    setName(next === "rename" ? activeBoard?.name ?? "" : "");
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      close();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const submitName = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) {
      return;
    }
    void run(() => (panel === "create" ? onCreate(name.trim(), template) : onRename(name.trim())));
  };

  return (
    <div ref={containerRef} className="relative min-w-0">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="group flex max-w-full items-center gap-2 rounded-md text-left"
      >
        <h1 className="truncate font-display text-lg leading-tight font-semibold text-white sm:text-[22px]">
          {activeBoard?.name ?? "Loading..."}
        </h1>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="shrink-0 text-yellow transition group-hover:translate-y-0.5"
        >
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </svg>
        <span className="sr-only">Switch board</span>
      </button>

      {isOpen && (
        <div className={clsx(popoverClass, "left-0 w-[min(340px,calc(100vw-2rem))]")} role="dialog" aria-label="Boards">
          {panel === "list" && (
            <>
              <p className="px-2 pt-1 pb-2 text-sm text-muted">Your boards</p>
              <ul className="max-h-72 overflow-y-auto" aria-label="Your boards">
                {boards.map((board) => (
                  <li key={board.id}>
                    <button
                      type="button"
                      aria-current={board.id === activeBoardId ? "true" : undefined}
                      onClick={() => {
                        onSelect(board.id);
                        close();
                      }}
                      className={clsx(
                        "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-surface",
                        board.id === activeBoardId && "bg-surface"
                      )}
                    >
                      <span
                        className={clsx(
                          "h-6 w-1 shrink-0 rounded-full",
                          board.id === activeBoardId ? "bg-yellow" : "bg-transparent"
                        )}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate font-bold">{board.name}</span>
                      <span className="text-sm text-muted tabular-nums">
                        {board.cardCount} {board.cardCount === 1 ? "card" : "cards"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-2 grid gap-1 border-t border-stroke pt-2">
                <button type="button" onClick={() => showPanel("create")} className={clsx(menuItemClass, "text-link")}>
                  New board
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(onDuplicate)}
                  className={menuItemClass}
                >
                  Duplicate this board
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onExport();
                    close();
                  }}
                  className={menuItemClass}
                >
                  Export as JSON
                </button>
                <label className={clsx(menuItemClass, "cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-blue")}>
                  Import a board
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) {
                        void run(() => onImport(file));
                      }
                    }}
                  />
                </label>
                {error && <ErrorText>{error}</ErrorText>}
                <button type="button" onClick={() => showPanel("rename")} className={menuItemClass}>
                  Rename this board
                </button>
                <button
                  type="button"
                  onClick={() => showPanel("delete")}
                  disabled={boards.length <= 1}
                  title={boards.length <= 1 ? "You need at least one board" : undefined}
                  className={clsx(menuItemClass, "text-danger hover:bg-danger-soft disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-transparent")}
                >
                  Delete this board
                </button>
              </div>
            </>
          )}

          {(panel === "create" || panel === "rename") && (
            <form onSubmit={submitName} className="space-y-3 p-2">
              <div>
                <label htmlFor="board-name" className={labelClass}>
                  {panel === "create" ? "New board name" : "Board name"}
                </label>
                <input
                  id="board-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={80}
                  autoFocus
                  required
                  className={`mt-1.5 ${inputClass}`}
                />
              </div>
              {panel === "create" && (
                <div>
                  <label htmlFor="board-template" className={labelClass}>
                    Start with
                  </label>
                  <select
                    id="board-template"
                    value={template}
                    onChange={(event) => setTemplate(event.target.value as "sample" | "blank")}
                    className={`mt-1.5 ${inputClass}`}
                  >
                    <option value="blank">Empty columns</option>
                    <option value="sample">Sample cards</option>
                  </select>
                </div>
              )}
              {error && <ErrorText>{error}</ErrorText>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => showPanel("list")} className={buttonSecondary}>
                  Back
                </button>
                <button type="submit" disabled={busy} className={buttonPrimary}>
                  {panel === "create" ? "Create board" : "Save name"}
                </button>
              </div>
            </form>
          )}

          {panel === "delete" && (
            <div className="space-y-3 p-2">
              <p className="text-[15px]">
                Delete <strong>{activeBoard?.name}</strong> with all its cards and AI chats? This
                cannot be undone.
              </p>
              {error && <ErrorText>{error}</ErrorText>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => showPanel("list")} className={buttonSecondary}>
                  Back
                </button>
                <button type="button" disabled={busy} onClick={() => void run(onDelete)} className={buttonDanger}>
                  Delete board
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
