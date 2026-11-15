import { useState, type FormEvent } from "react";
import { buttonPrimary, buttonSecondary, inputClass } from "@/components/ui";

type NewCardFormProps = {
  onAdd: (title: string, details: string) => void;
};

export const NewCardForm = ({ onAdd }: NewCardFormProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");

  const close = () => {
    setIsOpen(false);
    setTitle("");
    setDetails("");
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) {
      return;
    }
    onAdd(title.trim(), details.trim());
    close();
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="mx-1.5 mt-1 flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-bold text-ink-soft transition hover:bg-white hover:text-link"
      >
        <span aria-hidden="true" className="text-lg leading-none">+</span>
        Add a card
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mx-1.5 mt-1 space-y-2 rounded-md border border-stroke bg-white p-2.5">
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Card title"
        aria-label="Card title"
        maxLength={200}
        autoFocus
        required
        className={inputClass}
      />
      <textarea
        value={details}
        onChange={(event) => setDetails(event.target.value)}
        placeholder="Details"
        aria-label="Details"
        maxLength={5000}
        rows={2}
        className={`resize-none ${inputClass}`}
      />
      <div className="flex gap-2">
        <button type="submit" className={buttonPrimary}>
          Add card
        </button>
        <button type="button" onClick={close} className={buttonSecondary}>
          Cancel
        </button>
      </div>
    </form>
  );
};
