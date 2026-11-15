"use client";

import { useState, type FormEvent } from "react";
import { PRIORITIES, PRIORITY_LABELS, parseLabels, type Card, type Column, type Priority } from "@/lib/kanban";
import { ChecklistEditor } from "@/components/ChecklistEditor";
import {
  Modal,
  buttonDanger,
  buttonPrimary,
  buttonSecondary,
  inputClass,
  labelClass,
} from "@/components/ui";

type CardDialogProps = {
  card: Card;
  columnId: string;
  columns: Column[];
  onSave: (card: Card, columnId: string) => void;
  onDelete: () => void;
  onArchive: () => void;
  onClose: () => void;
};

export const CardDialog = ({
  card,
  columnId,
  columns,
  onSave,
  onDelete,
  onArchive,
  onClose,
}: CardDialogProps) => {
  const [title, setTitle] = useState(card.title);
  const [details, setDetails] = useState(card.details);
  const [priority, setPriority] = useState<Priority>(card.priority);
  const [dueDate, setDueDate] = useState(card.dueDate ?? "");
  const [labels, setLabels] = useState(card.labels.join(", "));
  const [checklist, setChecklist] = useState(card.checklist);
  const [targetColumn, setTargetColumn] = useState(columnId);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) {
      return;
    }
    onSave(
      {
        ...card,
        title: title.trim(),
        details: details.trim(),
        priority,
        dueDate: dueDate || null,
        labels: parseLabels(labels),
        checklist: checklist
          .map((item) => ({ ...item, text: item.text.trim() }))
          .filter((item) => item.text),
      },
      targetColumn
    );
  };

  return (
    <Modal title="Edit card" onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="card-title" className={labelClass}>
            Title
          </label>
          <input
            id="card-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            required
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label htmlFor="card-details" className={labelClass}>
            Details
          </label>
          <textarea
            id="card-details"
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            maxLength={5000}
            rows={4}
            className={`mt-1.5 resize-y ${inputClass}`}
          />
        </div>

        <fieldset>
          <legend className={labelClass}>Priority</legend>
          <div className="mt-1.5 grid grid-cols-4 gap-1 rounded-md bg-lane p-1">
            {PRIORITIES.map((value) => (
              <label
                key={value}
                className="cursor-pointer rounded px-2 py-1.5 text-center text-sm font-bold text-ink-soft has-[:checked]:bg-white has-[:checked]:text-navy has-[:checked]:shadow-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-blue"
              >
                <input
                  type="radio"
                  name="priority"
                  value={value}
                  checked={priority === value}
                  onChange={() => setPriority(value)}
                  className="sr-only"
                />
                {PRIORITY_LABELS[value]}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="card-due" className={labelClass}>
              Due date
            </label>
            <input
              id="card-due"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
          <div>
            <label htmlFor="card-column" className={labelClass}>
              Column
            </label>
            <select
              id="card-column"
              value={targetColumn}
              onChange={(event) => setTargetColumn(event.target.value)}
              className={`mt-1.5 ${inputClass}`}
            >
              {columns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="card-labels" className={labelClass}>
            Labels
          </label>
          <input
            id="card-labels"
            value={labels}
            onChange={(event) => setLabels(event.target.value)}
            placeholder="design, research"
            className={`mt-1.5 ${inputClass}`}
          />
          <p className="mt-1.5 text-sm text-muted">Separate labels with commas.</p>
        </div>

        <ChecklistEditor items={checklist} onChange={setChecklist} />

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stroke pt-4">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-danger">Delete this card?</span>
              <button type="button" onClick={onDelete} className={buttonDanger}>
                Delete card
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className={buttonSecondary}>
                Keep
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmDelete(true)} className={buttonDanger}>
                Delete
              </button>
              <button type="button" onClick={onArchive} className={buttonSecondary}>
                Archive
              </button>
            </div>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className={buttonSecondary}>
              Cancel
            </button>
            <button type="submit" className={buttonPrimary}>
              Save card
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
};
