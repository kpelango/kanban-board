"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { KanbanBoard } from "@/components/KanbanBoard";
import { BoardMenu } from "@/components/BoardMenu";
import { BoardToolbar } from "@/components/BoardToolbar";
import { ChatSidebar } from "@/components/ChatSidebar";
import { AccountDialog } from "@/components/AccountDialog";
import { ArchiveDialog } from "@/components/ArchiveDialog";
import { UsersDialog } from "@/components/UsersDialog";
import { BrandMark, ErrorText, menuItemClass, popoverClass, useDismiss } from "@/components/ui";
import {
  createBoard,
  deleteBoard,
  fetchBoard,
  listBoards,
  renameBoard,
  saveBoard,
  type BoardSummary,
  errorText,
} from "@/lib/api";
import { emptyFilters, type BoardData, type CardFilters } from "@/lib/kanban";
import { boardFileName, parseBoardFile, toBoardFile } from "@/lib/boardFile";

const LAST_BOARD_KEY = "kanban-studio:last-board";

const readLastBoard = (username: string) => {
  try {
    return Number(localStorage.getItem(`${LAST_BOARD_KEY}:${username}`)) || null;
  } catch {
    return null;
  }
};

const writeLastBoard = (username: string, boardId: number) => {
  try {
    localStorage.setItem(`${LAST_BOARD_KEY}:${username}`, String(boardId));
  } catch {
    // Remembering the last board is a convenience only
  }
};

type WorkspaceProps = {
  username: string;
  isAdmin?: boolean;
  isGuest?: boolean;
  onLogout: () => void;
};

export const Workspace = ({ username, isAdmin = false, isGuest = false, onLogout }: WorkspaceProps) => {
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<number | null>(null);
  const [board, setBoard] = useState<BoardData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [filters, setFilters] = useState<CardFilters>(emptyFilters);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showAccountDialog, setShowAccountDialog] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  const boardRef = useRef<BoardData | null>(null);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const requestedBoardId = useRef<number | null>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  useDismiss(accountRef, showAccountMenu, () => setShowAccountMenu(false));

  const replaceBoard = (next: BoardData | null) => {
    boardRef.current = next;
    setBoard(next);
  };

  const openBoard = useCallback(
    async (boardId: number) => {
      requestedBoardId.current = boardId;
      setActiveBoardId(boardId);
      replaceBoard(null);
      setLoadError(null);
      setFilters(emptyFilters);
      setSaveState("idle");
      writeLastBoard(username, boardId);
      try {
        const loaded = await fetchBoard(boardId);
        // Ignore responses for boards the user has already switched away from
        if (requestedBoardId.current === boardId) {
          replaceBoard(loaded);
        }
      } catch (err) {
        if (requestedBoardId.current === boardId) {
          setLoadError(errorText(err, "Could not load this board."));
        }
      }
    },
    [username]
  );

  const refreshBoards = async () => {
    const items = await listBoards();
    setBoards(items);
    return items;
  };

  useEffect(() => {
    let current = true;
    listBoards()
      .then((items) => {
        if (!current) {
          return;
        }
        setBoards(items);
        const remembered = readLastBoard(username);
        const target = items.find((b) => b.id === remembered) ?? items[0];
        if (target) {
          void openBoard(target.id);
        }
      })
      .catch(() => current && setLoadError("Could not load your boards."));
    return () => {
      current = false;
    };
  }, [openBoard, username]);

  const updateBoard = (updater: (prev: BoardData) => BoardData) => {
    const prev = boardRef.current;
    if (!prev || activeBoardId === null) {
      return;
    }
    const next = updater(prev);
    if (next === prev) {
      return;
    }
    replaceBoard(next);
    setSaveState("saving");
    const boardId = activeBoardId;
    // Saves run one after another so the server always ends with the latest board
    saveQueue.current = saveQueue.current
      .then(() => saveBoard(boardId, next))
      .then(
        () => boardRef.current === next && setSaveState("saved"),
        () => setSaveState("error")
      );
  };

  const handleCreate = async (name: string, template: "sample" | "blank", data?: BoardData) => {
    const created = await createBoard(name, template, data);
    setBoards((prev) => [...prev, created]);
    await openBoard(created.id);
  };

  const handleRename = async (name: string) => {
    if (activeBoardId === null) {
      return;
    }
    const renamed = await renameBoard(activeBoardId, name);
    setBoards((prev) => prev.map((b) => (b.id === renamed.id ? renamed : b)));
  };

  const handleDelete = async () => {
    if (activeBoardId === null) {
      return;
    }
    await deleteBoard(activeBoardId);
    const remaining = await refreshBoards();
    setIsChatOpen(false);
    await openBoard(remaining[0].id);
  };

  const activeBoard = boards.find((b) => b.id === activeBoardId);

  const handleDuplicate = async () => {
    await saveQueue.current;
    if (boardRef.current && activeBoard) {
      await handleCreate(`${activeBoard.name} copy`.slice(0, 80), "blank", boardRef.current);
    }
  };

  const handleExport = () => {
    if (!boardRef.current || !activeBoard) {
      return;
    }
    const url = URL.createObjectURL(
      new Blob([toBoardFile(activeBoard.name, boardRef.current)], { type: "application/json" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = boardFileName(activeBoard.name);
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (file: File) => {
    const { name, board: data } = parseBoardFile(await file.text(), file.name);
    await handleCreate(name, "blank", data);
  };

  return (
    <div className="min-h-dvh" data-testid={board ? "kanban-board-loaded" : "kanban-board-loading"}>
      <div className={clsx("transition-[padding]", isChatOpen && "sm:pr-[420px]")}>
        <header className="bg-navy text-white">
          <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4 sm:h-16 sm:px-6">
            <span className="hidden shrink-0 items-center gap-2 font-display text-[15px] font-semibold text-white/80 md:flex">
              <BrandMark />
              Kanban Studio
            </span>
            <span aria-hidden="true" className="hidden h-6 w-px bg-white/20 md:block" />
            <div className="min-w-0 flex-1">
              {activeBoardId !== null && (
                <BoardMenu
                  boards={boards}
                  activeBoardId={activeBoardId}
                  onOpen={() => void refreshBoards().catch(() => null)}
                  onSelect={(id) => void openBoard(id)}
                  onCreate={handleCreate}
                  onRename={handleRename}
                  onDelete={handleDelete}
                  onDuplicate={handleDuplicate}
                  onExport={handleExport}
                  onImport={handleImport}
                />
              )}
            </div>
            <span role="status" className="sr-only shrink-0 text-sm text-white/60 lg:not-sr-only">
              {saveState === "saving" && "Saving..."}
              {saveState === "saved" && "All changes saved"}
            </span>
            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              <button
                type="button"
                onClick={() => setIsChatOpen((prev) => !prev)}
                aria-pressed={isChatOpen}
                className={clsx(
                  "rounded-md px-3 py-1.5 text-sm font-bold transition",
                  isChatOpen
                    ? "bg-white/15 text-yellow ring-1 ring-yellow/60 ring-inset"
                    : "bg-yellow text-navy hover:brightness-105"
                )}
              >
                AI assistant
              </button>
              <div ref={accountRef} className="relative">
                <button
                  type="button"
                  onClick={() => setShowAccountMenu((prev) => !prev)}
                  aria-expanded={showAccountMenu}
                  aria-label={`Account menu for ${username}`}
                  className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm font-bold text-white/90 hover:bg-white/10"
                >
                  <span
                    aria-hidden="true"
                    className="grid h-7 w-7 place-items-center rounded-full bg-blue font-display text-sm text-white uppercase"
                  >
                    {username.slice(0, 1)}
                  </span>
                  <span className="hidden max-w-32 truncate xl:inline">{username}</span>
                </button>
                {showAccountMenu && (
                  <div className={clsx(popoverClass, "right-0 w-60")}>
                    {isGuest && (
                      <p className="mb-1 border-b border-stroke px-3 pt-1 pb-2.5 text-sm text-muted">
                        Guest account, deleted after 24 hours
                      </p>
                    )}
                    <div role="menu" aria-label="Account">
                      {!isGuest && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setShowAccountMenu(false);
                            setShowAccountDialog(true);
                          }}
                          className={menuItemClass}
                        >
                          Account settings
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setShowAccountMenu(false);
                            setShowUsers(true);
                          }}
                          className={menuItemClass}
                        >
                          Manage users
                        </button>
                      )}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={onLogout}
                        className={menuItemClass}
                      >
                        Log out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="@container mx-auto max-w-[1600px] px-4 pt-5 sm:px-6">
          {saveState === "error" && (
            <div className="mb-3">
              <ErrorText>Your last change was not saved. Check the server and try again.</ErrorText>
            </div>
          )}
          {loadError && <ErrorText>{loadError}</ErrorText>}
          {board && (
            <>
              <BoardToolbar
                board={board}
                filters={filters}
                onChange={setFilters}
                onOpenArchive={() => setShowArchive(true)}
              />
              <KanbanBoard key={activeBoardId} board={board} filters={filters} onChange={updateBoard} />
            </>
          )}
          {!board && !loadError && <p className="py-16 text-center text-muted">Loading board...</p>}
        </main>
      </div>

      {activeBoardId !== null && (
        <ChatSidebar
          boardId={activeBoardId}
          boardName={activeBoard?.name ?? "this board"}
          isOpen={isChatOpen}
          onClose={() => setIsChatOpen(false)}
          // The assistant reads the board from the server, so pending edits must land first
          beforeSend={() => saveQueue.current}
          onBoardUpdate={replaceBoard}
        />
      )}

      {showArchive && board && (
        <ArchiveDialog board={board} onChange={updateBoard} onClose={() => setShowArchive(false)} />
      )}

      {showUsers && <UsersDialog currentUsername={username} onClose={() => setShowUsers(false)} />}

      {showAccountDialog && (
        <AccountDialog
          username={username}
          onClose={() => setShowAccountDialog(false)}
          onAccountDeleted={onLogout}
        />
      )}
    </div>
  );
};
