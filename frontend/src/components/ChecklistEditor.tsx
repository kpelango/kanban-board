import { useState, type KeyboardEvent } from "react";
import { createId, type ChecklistItem } from "@/lib/kanban";
import { buttonGhost, buttonSecondary, inputClass, labelClass, CloseIcon } from "@/components/ui";

type ChecklistEditorProps = {
  items: ChecklistItem[];
  onChange: (items: ChecklistItem[]) => void;
};

export const ChecklistEditor = ({ items, onChange }: ChecklistEditorProps) => {
  const [draft, setDraft] = useState("");
  const done = items.filter((item) => item.done).length;

  const add = () => {
    const text = draft.trim();
    if (!text || items.length >= 50) {
      return;
    }
    onChange([...items, { id: createId("item"), text: text.slice(0, 200), done: false }]);
    setDraft("");
  };

  const update = (id: string, patch: Partial<ChecklistItem>) =>
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const handleDraftKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      // Enter adds an item instead of submitting the card form
      event.preventDefault();
      add();
    }
  };

  return (
    <fieldset>
      <div className="flex items-baseline justify-between">
        <legend className={labelClass}>Checklist</legend>
        {items.length > 0 && (
          <span className="text-sm text-muted tabular-nums">
            {done} of {items.length} done
          </span>
        )}
      </div>
      {items.length > 0 && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-lane" aria-hidden="true">
          <div
            className="h-full rounded-full bg-success transition-[width]"
            style={{ width: `${(done / items.length) * 100}%` }}
          />
        </div>
      )}
      <ul className="mt-2 space-y-1">
        {items.map((item) => (
          <li key={item.id} className="group flex items-center gap-2">
            <input
              type="checkbox"
              checked={item.done}
              onChange={(event) => update(item.id, { done: event.target.checked })}
              aria-label={`Done: ${item.text}`}
              className="h-4 w-4 shrink-0 accent-[var(--secondary-purple)]"
            />
            <input
              value={item.text}
              onChange={(event) => update(item.id, { text: event.target.value })}
              maxLength={200}
              aria-label="Checklist item"
              className={`flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-[15px] outline-none hover:border-stroke focus:border-blue ${
                item.done ? "text-muted line-through" : "text-ink"
              }`}
            />
            <button
              type="button"
              onClick={() => onChange(items.filter((other) => other.id !== item.id))}
              className={buttonGhost}
              aria-label={`Remove ${item.text}`}
            >
              <CloseIcon size={14} />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleDraftKey}
          maxLength={200}
          placeholder="Add a subtask"
          aria-label="New checklist item"
          className={inputClass}
        />
        <button type="button" onClick={add} className={buttonSecondary} disabled={!draft.trim()}>
          Add
        </button>
      </div>
    </fieldset>
  );
};
