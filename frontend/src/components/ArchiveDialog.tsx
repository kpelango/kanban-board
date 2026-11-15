"use client";

import { useState } from "react";
import { deleteArchivedCard, restoreCard, type BoardData } from "@/lib/kanban";
import { Modal, buttonDanger, buttonSecondary } from "@/components/ui";

type ArchiveDialogProps = {
  board: BoardData;
  onChange: (updater: (prev: BoardData) => BoardData) => void;
  onClose: () => void;
};

export const ArchiveDialog = ({ board, onChange, onClose }: ArchiveDialogProps) => {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const entries = Object.entries(board.archived);
  const columnTitle = (columnId: string) =>
    board.columns.find((column) => column.id === columnId)?.title ?? columnId;

  return (
    <Modal title="Archived cards" onClose={onClose} wide>
      {entries.length === 0 ? (
        <p className="text-[15px] text-muted">
          Nothing archived. Archive cards from the card editor or a column&apos;s settings.
        </p>
      ) : (
        <ul className="divide-y divide-stroke">
          {entries.map(([cardId, columnId]) => {
            const card = board.cards[cardId];
            return (
              <li key={cardId} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display font-semibold text-navy">{card.title}</p>
                  <p className="text-sm text-muted">From {columnTitle(columnId)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onChange((prev) => restoreCard(prev, cardId))}
                  className={buttonSecondary}
                  aria-label={`Restore ${card.title}`}
                >
                  Restore
                </button>
                {confirmingId === cardId ? (
                  <button
                    type="button"
                    onClick={() => {
                      onChange((prev) => deleteArchivedCard(prev, cardId));
                      setConfirmingId(null);
                    }}
                    className={buttonDanger}
                  >
                    Delete forever
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingId(cardId)}
                    className={buttonDanger}
                    aria-label={`Delete ${card.title}`}
                  >
                    Delete
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
};
