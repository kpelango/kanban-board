import type { KeyboardEventHandler } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import clsx from "clsx";
import { PRIORITY_LABELS, checklistProgress, type Card, type Priority } from "@/lib/kanban";
import { CheckIcon } from "@/components/ui";
import { formatDueDate } from "@/lib/format";

const priorityStyles: Record<Priority, { stripe: string; badge: string }> = {
  none: { stripe: "bg-transparent", badge: "" },
  low: { stripe: "bg-blue", badge: "bg-blue/12 text-link" },
  medium: { stripe: "bg-yellow", badge: "bg-yellow/20 text-yellow-text" },
  high: { stripe: "bg-purple", badge: "bg-purple/12 text-purple" },
};

type CardFaceProps = {
  card: Card;
  overdue?: boolean;
  onOpen?: () => void;
};

export const CardFace = ({ card, overdue, onOpen }: CardFaceProps) => {
  const priority = priorityStyles[card.priority];
  const progress = checklistProgress(card);
  const hasMeta =
    card.priority !== "none" || card.dueDate || card.labels.length > 0 || progress.total > 0;
  return (
    <div className="relative rounded-md border border-stroke bg-white px-3.5 pt-3.5 pb-3 transition-colors hover:border-stroke-strong">
      {/* Priority tab on the top edge, like the colored tab of a paper kanban card */}
      <span
        className={clsx("absolute -top-px left-3.5 h-[5px] w-9 rounded-b-sm", priority.stripe)}
        aria-hidden="true"
      />
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Edit ${card.title}`}
          className="block w-full pr-6 text-left font-display text-[15px] leading-snug font-semibold text-navy hover:text-link"
        >
          {card.title}
        </button>
      ) : (
        <p className="pr-6 font-display text-[15px] leading-snug font-semibold text-navy">{card.title}</p>
      )}
      {card.details && (
        <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-ink-soft">{card.details}</p>
      )}
      {hasMeta && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs font-bold">
          {card.priority !== "none" && (
            <span className={clsx("rounded px-1.5 py-0.5", priority.badge)}>{PRIORITY_LABELS[card.priority]}</span>
          )}
          {card.dueDate && (
            <span
              data-testid="card-due"
              className={clsx(
                "rounded px-1.5 py-0.5",
                overdue ? "bg-danger-soft text-danger" : "bg-surface text-ink-soft"
              )}
            >
              {overdue ? "Overdue " : "Due "}
              {formatDueDate(card.dueDate)}
            </span>
          )}
          {progress.total > 0 && (
            <span
              data-testid="card-checklist"
              aria-label={`Checklist ${progress.done} of ${progress.total} done`}
              className={clsx(
                "inline-flex items-center gap-1.5 rounded px-1.5 py-0.5",
                progress.done === progress.total ? "bg-success/12 text-success" : "bg-surface text-ink-soft"
              )}
            >
              <CheckIcon size={12} />
              {progress.done}/{progress.total}
            </span>
          )}
          {card.labels.map((label) => (
            <span key={label} className="rounded-full border border-stroke px-2 py-0.5 text-ink-soft">
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

type KanbanCardProps = {
  card: Card;
  overdue: boolean;
  onOpen: (cardId: string) => void;
};

export const KanbanCard = ({ card, overdue, onOpen }: KanbanCardProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id });
  // Mouse and touch can drag from anywhere on the card; the keyboard drags via the grip
  // handle, so the card itself is not an interactive element wrapping the Edit button.
  const { onKeyDown, ...pointerListeners } = listeners ?? {};

  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx("relative touch-manipulation", isDragging && "opacity-40")}
      {...pointerListeners}
      data-testid={`card-${card.id}`}
    >
      <CardFace card={card} overdue={overdue} onOpen={() => onOpen(card.id)} />
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        onKeyDown={onKeyDown as KeyboardEventHandler<HTMLButtonElement> | undefined}
        aria-roledescription="Draggable card"
        aria-label={`Move ${card.title}`}
        className="absolute top-2.5 right-1.5 cursor-grab rounded p-1 text-stroke-strong hover:bg-surface hover:text-ink-soft"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
          {[6, 12, 18].map((y) =>
            [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.8" fill="currentColor" />)
          )}
        </svg>
      </button>
    </article>
  );
};
