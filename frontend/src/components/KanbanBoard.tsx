"use client";

import { useEffect, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { KanbanColumn } from "@/components/KanbanColumn";
import { CardFace } from "@/components/KanbanCard";
import { CardDialog } from "@/components/CardDialog";
import { CloseIcon } from "@/components/ui";
import {
  archiveCards,
  createId,
  deleteCard,
  findColumnId,
  insertCard,
  isOverdue,
  matchesFilters,
  moveCard,
  moveCardToColumn,
  newCard,
  todayISO,
  type BoardData,
  type Card,
  type CardFilters,
} from "@/lib/kanban";

const collisionDetectionStrategy: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCorners(args);
};

type KanbanBoardProps = {
  board: BoardData;
  filters: CardFilters;
  onChange: (updater: (prev: BoardData) => BoardData) => void;
};

export const KanbanBoard = ({ board, filters, onChange }: KanbanBoardProps) => {
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [lastDeleted, setLastDeleted] = useState<{
    card: Card;
    columnId: string;
    index: number;
  } | null>(null);

  useEffect(() => {
    if (!lastDeleted) {
      return;
    }
    const timer = setTimeout(() => setLastDeleted(null), 8000);
    return () => clearTimeout(timer);
  }, [lastDeleted]);
  const today = todayISO();

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragStart = (event: DragStartEvent) => setActiveCardId(String(event.active.id));

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveCardId(null);
    if (!over || active.id === over.id) {
      return;
    }
    onChange((prev) => ({
      ...prev,
      columns: moveCard(prev.columns, String(active.id), String(over.id)),
    }));
  };

  const handleRenameColumn = (columnId: string, title: string) =>
    onChange((prev) => ({
      ...prev,
      columns: prev.columns.map((column) => (column.id === columnId ? { ...column, title } : column)),
    }));

  const handleSetWipLimit = (columnId: string, wipLimit: number | null) =>
    onChange((prev) => ({
      ...prev,
      columns: prev.columns.map((column) =>
        column.id === columnId ? { ...column, wipLimit } : column
      ),
    }));

  const handleArchiveAll = (columnId: string) =>
    onChange((prev) =>
      archiveCards(prev, prev.columns.find((column) => column.id === columnId)?.cardIds ?? [])
    );

  const handleArchiveCard = (cardId: string) => {
    onChange((prev) => archiveCards(prev, [cardId]));
    setOpenCardId(null);
  };

  const handleAddCard = (columnId: string, title: string, details: string) => {
    const card = newCard(createId("card"), title, details);
    onChange((prev) => insertCard(prev, card, columnId));
  };

  const handleSaveCard = (card: Card, columnId: string) => {
    onChange((prev) => ({
      ...prev,
      cards: { ...prev.cards, [card.id]: card },
      columns: moveCardToColumn(prev.columns, card.id, columnId),
    }));
    setOpenCardId(null);
  };

  const handleDeleteCard = (cardId: string) => {
    const columnId = findColumnId(board.columns, cardId);
    if (columnId) {
      setLastDeleted({
        card: board.cards[cardId],
        columnId,
        index: board.columns.find((c) => c.id === columnId)!.cardIds.indexOf(cardId),
      });
    }
    onChange((prev) => deleteCard(prev, cardId));
    setOpenCardId(null);
  };

  const handleUndoDelete = () => {
    if (!lastDeleted) {
      return;
    }
    const { card, columnId, index } = lastDeleted;
    onChange((prev) => insertCard(prev, card, columnId, index));
    setLastDeleted(null);
  };

  const activeCard = activeCardId ? board.cards[activeCardId] : null;
  const openCard = openCardId ? board.cards[openCardId] : null;

  return (
    <>
      <nav
        aria-label="Columns"
        className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-3 @6xl:hidden"
      >
        {board.columns.map((column, index) => (
          <a
            key={column.id}
            href={`#lane-${column.id}`}
            onClick={(event) => {
              event.preventDefault();
              document
                .getElementById(`lane-${column.id}`)
                ?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
            }}
            className="flex shrink-0 items-baseline gap-1.5 rounded-full border border-stroke bg-white px-3 py-1.5 text-sm font-bold text-ink"
          >
            <span aria-hidden="true" className="font-numeral text-base leading-none text-navy">
              {index + 1}
            </span>
            {column.title} <span className="text-muted">{column.cardIds.length}</span>
          </a>
        ))}
      </nav>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetectionStrategy}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveCardId(null)}
      >
        <section
          aria-label="Board columns"
          className="-mx-4 flex snap-x snap-mandatory items-stretch overflow-x-auto px-4 pb-6 @6xl:mx-0 @6xl:grid @6xl:grid-cols-5 @6xl:overflow-visible @6xl:px-0"
        >
          {board.columns.map((column, index) => {
            const cards = column.cardIds
              .map((cardId) => board.cards[cardId])
              .filter((card) => matchesFilters(card, filters, column.id, today));
            return (
              <KanbanColumn
                key={column.id}
                column={column}
                stage={index + 1}
                cards={cards}
                totalCount={column.cardIds.length}
                isOverdue={(card) => isOverdue(card, column.id, today)}
                onRename={handleRenameColumn}
                onSetWipLimit={handleSetWipLimit}
                onArchiveAll={handleArchiveAll}
                onAddCard={handleAddCard}
                onOpenCard={setOpenCardId}
              />
            );
          })}
        </section>
        <DragOverlay>
          {activeCard ? (
            <div className="w-[280px] rotate-1 shadow-[var(--shadow-lift)]">
              <CardFace card={activeCard} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {openCard && (
        <CardDialog
          key={openCard.id}
          card={openCard}
          columnId={findColumnId(board.columns, openCard.id) ?? board.columns[0].id}
          columns={board.columns}
          onSave={handleSaveCard}
          onDelete={() => handleDeleteCard(openCard.id)}
          onArchive={() => handleArchiveCard(openCard.id)}
          onClose={() => setOpenCardId(null)}
        />
      )}

      {lastDeleted && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-50 flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-lg bg-navy px-4 py-3 text-[15px] text-white shadow-[var(--shadow-lift)]"
        >
          <span className="min-w-0 flex-1 truncate">Deleted &ldquo;{lastDeleted.card.title}&rdquo;</span>
          <button
            type="button"
            onClick={handleUndoDelete}
            className="rounded-md px-2 py-1 font-bold text-yellow hover:bg-white/10"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={() => setLastDeleted(null)}
            aria-label="Dismiss"
            className="rounded-md p-1 text-white/70 hover:bg-white/10 hover:text-white"
          >
            <CloseIcon size={16} />
          </button>
        </div>
      )}
    </>
  );
};
