import { useState, type FormEvent, type KeyboardEvent } from "react";
import clsx from "clsx";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Card, Column } from "@/lib/kanban";
import { KanbanCard } from "@/components/KanbanCard";
import { NewCardForm } from "@/components/NewCardForm";
import { Modal, buttonGhost, buttonPrimary, buttonSecondary, inputClass, labelClass } from "@/components/ui";

type KanbanColumnProps = {
  column: Column;
  /** Position in the flow, 1-5 */
  stage: number;
  cards: Card[];
  totalCount: number;
  isOverdue: (card: Card) => boolean;
  onRename: (columnId: string, title: string) => void;
  onSetWipLimit: (columnId: string, limit: number | null) => void;
  onArchiveAll: (columnId: string) => void;
  onAddCard: (columnId: string, title: string, details: string) => void;
  onOpenCard: (cardId: string) => void;
};

const ColumnTitle = ({ column, onRename }: Pick<KanbanColumnProps, "column" | "onRename">) => {
  const [draft, setDraft] = useState(column.title);
  const [syncedTitle, setSyncedTitle] = useState(column.title);
  if (column.title !== syncedTitle) {
    // The title changed elsewhere (AI or another edit): show the new value
    setSyncedTitle(column.title);
    setDraft(column.title);
  }

  const commit = () => {
    const next = draft.trim();
    if (!next) {
      setDraft(column.title);
    } else if (next !== column.title) {
      onRename(column.id, next);
    }
  };

  const handleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      setDraft(column.title);
      requestAnimationFrame(() => (event.target as HTMLInputElement).blur());
    }
  };

  return (
    <input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={handleKey}
      maxLength={40}
      aria-label="Column title"
      className="max-w-full min-w-0 rounded bg-transparent px-1 py-0.5 font-display text-base font-semibold text-navy outline-none [field-sizing:content] hover:bg-white focus:bg-white"
    />
  );
};

const ColumnSettingsDialog = ({
  column,
  onSave,
  onArchiveAll,
  onClose,
}: {
  column: Column;
  onSave: (limit: number | null) => void;
  onArchiveAll: () => void;
  onClose: () => void;
}) => {
  const [value, setValue] = useState(column.wipLimit ? String(column.wipLimit) : "");
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const limit = Number.parseInt(value, 10);
    onSave(Number.isNaN(limit) ? null : Math.min(Math.max(limit, 1), 99));
  };
  return (
    <Modal title={`${column.title} settings`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="wip-limit" className={labelClass}>
            Work-in-progress limit
          </label>
          <input
            id="wip-limit"
            type="number"
            min={1}
            max={99}
            inputMode="numeric"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="No limit"
            className={`mt-1.5 ${inputClass}`}
          />
          <p className="mt-1.5 text-sm text-muted">
            The column is flagged when it holds more cards than this. Leave empty for no limit.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={buttonSecondary}>
            Cancel
          </button>
          <button type="submit" className={buttonPrimary}>
            Save limit
          </button>
        </div>
      </form>
      {column.cardIds.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-stroke pt-4">
          <p className="text-sm text-ink-soft">
            Move every card in this column to the archive. You can restore them later.
          </p>
          <button type="button" onClick={onArchiveAll} className={buttonSecondary}>
            Archive {column.cardIds.length} {column.cardIds.length === 1 ? "card" : "cards"}
          </button>
        </div>
      )}
    </Modal>
  );
};

export const KanbanColumn = ({
  column,
  stage,
  cards,
  totalCount,
  isOverdue,
  onRename,
  onSetWipLimit,
  onArchiveAll,
  onAddCard,
  onOpenCard,
}: KanbanColumnProps) => {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const [showSettings, setShowSettings] = useState(false);
  const limit = column.wipLimit ?? null;
  const overLimit = limit !== null && totalCount > limit;
  const atLimit = limit !== null && totalCount === limit;

  return (
    <section
      ref={setNodeRef}
      id={`lane-${column.id}`}
      className="flex w-[86vw] max-w-[360px] shrink-0 snap-center flex-col px-1.5 sm:w-[300px] @6xl:w-auto @6xl:max-w-none @6xl:shrink"
      data-testid={`column-${column.id}`}
    >
      <header className="px-1.5">
        <div className="flex items-end gap-1.5 pb-2">
          <span aria-hidden="true" className="font-numeral text-4xl leading-[0.8] font-bold text-navy">
            {stage}
          </span>
          <ColumnTitle column={column} onRename={onRename} />
          <span
            data-testid="column-count"
            className={clsx(
              "rounded-full px-2 py-0.5 text-xs font-bold tabular-nums",
              overLimit ? "bg-danger text-white" : atLimit ? "bg-yellow text-navy" : "bg-lane text-ink-soft"
            )}
            title={limit ? `Limit ${limit}` : undefined}
          >
            {limit ? `${totalCount}/${limit}` : totalCount}
          </span>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className={clsx(buttonGhost, "ml-auto")}
            aria-label={`${column.title} settings`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="5" cy="12" r="2" fill="currentColor" />
              <circle cx="12" cy="12" r="2" fill="currentColor" />
              <circle cx="19" cy="12" r="2" fill="currentColor" />
            </svg>
          </button>
        </div>
      </header>
      {/* The flow rail: one yellow line through every stage; a stage over its limit turns red */}
      <div
        aria-hidden="true"
        className={clsx("-mx-1.5 h-[3px]", overLimit ? "bg-danger" : "bg-yellow")}
      />
      {overLimit && (
        <p className="mx-1.5 mt-1.5 text-xs font-bold text-danger">Over the limit of {limit}</p>
      )}

      <div
        className={clsx(
          "mt-2 flex min-h-28 flex-col gap-2 rounded-lg p-1.5 transition-colors",
          isOver && "bg-lane"
        )}
      >
        <SortableContext items={cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
          {cards.map((card) => (
            <KanbanCard key={card.id} card={card} overdue={isOverdue(card)} onOpen={onOpenCard} />
          ))}
        </SortableContext>
        {cards.length === 0 && (
          <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-stroke-strong px-3 py-6 text-center text-sm text-muted">
            {totalCount === 0 ? "Drop a card here" : "No matching cards"}
          </div>
        )}
      </div>
      <NewCardForm onAdd={(title, details) => onAddCard(column.id, title, details)} />

      {showSettings && (
        <ColumnSettingsDialog
          column={column}
          onClose={() => setShowSettings(false)}
          onArchiveAll={() => {
            onArchiveAll(column.id);
            setShowSettings(false);
          }}
          onSave={(value) => {
            onSetWipLimit(column.id, value);
            setShowSettings(false);
          }}
        />
      )}
    </section>
  );
};
