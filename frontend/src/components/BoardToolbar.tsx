import { useEffect, useRef } from "react";
import {
  boardLabels,
  boardStats,
  PRIORITIES,
  PRIORITY_LABELS,
  emptyFilters,
  hasActiveFilters,
  todayISO,
  type BoardData,
  type CardFilters,
  type DueFilter,
  type Priority,
} from "@/lib/kanban";
import clsx from "clsx";
import { buttonGhost, inputClass } from "@/components/ui";

type BoardToolbarProps = {
  board: BoardData;
  filters: CardFilters;
  onChange: (filters: CardFilters) => void;
  onOpenArchive: () => void;
};

const selectClass = clsx(inputClass, "min-w-0 px-2 text-sm sm:w-auto");

export const BoardToolbar = ({
  board,
  filters,
  onChange,
  onOpenArchive,
}: BoardToolbarProps) => {
  const stats = boardStats(board, todayISO());
  const labels = boardLabels(board);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing =
        target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (
        event.key === "/" &&
        !typing &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div
        className="grid grid-cols-3 items-center gap-2 sm:flex sm:flex-wrap"
        role="search"
      >
        <div className="relative col-span-3 sm:w-64">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
          >
            <circle
              cx="11"
              cy="11"
              r="6.5"
              stroke="currentColor"
              strokeWidth="2"
              fill="none"
            />
            <path
              d="M16 16l4.5 4.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <input
            ref={searchRef}
            type="search"
            value={filters.query}
            onChange={(event) =>
              onChange({ ...filters, query: event.target.value })
            }
            placeholder="Search cards (press /)"
            aria-label="Search cards"
            className={clsx(inputClass, "pl-9")}
          />
        </div>
        <select
          value={filters.priority}
          onChange={(event) =>
            onChange({
              ...filters,
              priority: event.target.value as Priority | "all",
            })
          }
          aria-label="Filter by priority"
          className={selectClass}
        >
          <option value="all">Any priority</option>
          {[...PRIORITIES].reverse().map((priority) => (
            <option key={priority} value={priority}>
              {priority === "none" ? "No priority" : PRIORITY_LABELS[priority]}
            </option>
          ))}
        </select>
        <select
          value={filters.label}
          onChange={(event) =>
            onChange({ ...filters, label: event.target.value })
          }
          aria-label="Filter by label"
          className={selectClass}
        >
          <option value="">Any label</option>
          {labels.map((label) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={filters.due}
          onChange={(event) =>
            onChange({ ...filters, due: event.target.value as DueFilter })
          }
          aria-label="Filter by due date"
          className={selectClass}
        >
          <option value="all">Any date</option>
          <option value="overdue">Overdue</option>
          <option value="week">Due in 7 days</option>
          <option value="none">No due date</option>
        </select>
        {hasActiveFilters(filters) && (
          <button
            type="button"
            onClick={() => onChange(emptyFilters)}
            className={`${buttonGhost} col-span-3 justify-self-start`}
          >
            Clear filters
          </button>
        )}
      </div>
      <div className="flex items-center gap-5">
        <dl
          className="flex gap-5 text-sm text-ink-soft"
          aria-label="Board summary"
        >
          {(
            [
              ["Cards", "total"],
              ["Done", "done"],
              ["Overdue", "overdue"],
            ] as const
          ).map(([label, key]) => (
            <div key={key} className="flex items-baseline gap-1.5">
              <dt>{label}</dt>
              <dd
                data-testid={`stat-${key}`}
                className={clsx(
                  "font-display text-lg font-semibold tabular-nums",
                  key === "overdue" && stats.overdue
                    ? "text-danger"
                    : "text-navy",
                )}
              >
                {stats[key]}
              </dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          onClick={onOpenArchive}
          className={`${buttonGhost} ml-auto lg:ml-0`}
          aria-label={`Archived cards (${stats.archived})`}
        >
          Archived{" "}
          <span className="text-muted tabular-nums">{stats.archived}</span>
        </button>
      </div>
    </div>
  );
};
