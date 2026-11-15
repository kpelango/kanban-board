"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import clsx from "clsx";

export const buttonPrimary =
  "inline-flex items-center justify-center gap-2 rounded-md bg-purple px-4 py-2 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-60";
export const buttonSecondary =
  "inline-flex items-center justify-center gap-2 rounded-md border border-stroke bg-white px-3 py-2 text-sm font-bold text-ink transition hover:border-blue hover:text-link disabled:opacity-60";
export const buttonGhost =
  "inline-flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-sm font-bold text-ink-soft transition hover:bg-lane hover:text-ink";
export const buttonDanger =
  "inline-flex items-center justify-center gap-2 rounded-md border border-danger/30 bg-white px-3 py-2 text-sm font-bold text-danger transition hover:bg-danger-soft disabled:opacity-60";
export const inputClass =
  "w-full rounded-md border border-stroke bg-white px-3 py-2 text-[15px] text-ink outline-none transition placeholder:text-muted focus:border-blue focus:ring-2 focus:ring-blue/20";
export const labelClass = "block text-sm font-bold text-ink-soft";

export const CloseIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export const CheckIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 12l5 5L20 6" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
  </svg>
);

/** Three card slots, the first one filled: the Kanban Studio mark */
export const BrandMark = ({ className = "h-3.5 w-[5px]" }: { className?: string }) => (
  <span aria-hidden="true" className="flex gap-[3px]">
    {[0, 1, 2].map((i) => (
      <span key={i} className={clsx(className, "rounded-[1px]", i === 0 ? "bg-yellow" : "bg-white/35")} />
    ))}
  </span>
);

export const ErrorText = ({ children }: { children: ReactNode }) => (
  <p
    role="alert"
    className="rounded-md border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-danger"
  >
    {children}
  </p>
);

type ModalProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
};

export const Modal = ({ title, onClose, children, wide }: ModalProps) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Prefer the first form field; fall back to the first button (the close button)
    (
      panel?.querySelector<HTMLElement>("input, textarea, select") ??
      panel?.querySelector<HTMLElement>("button")
    )?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previous?.focus?.();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-navy/45 sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx(
          "max-h-[92dvh] w-full overflow-y-auto rounded-t-xl bg-white p-5 shadow-[var(--shadow-lift)] sm:rounded-xl sm:p-6",
          wide ? "sm:max-w-xl" : "sm:max-w-md"
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="font-display text-xl font-semibold text-navy">{title}</h2>
          <button type="button" onClick={onClose} className={buttonGhost} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

/** Calls onDismiss on Escape or on a pointer press outside the referenced element. */
export const useDismiss = (
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onDismiss: () => void
) => {
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  });
  useEffect(() => {
    if (!active) {
      return;
    }
    const handlePointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onDismissRef.current();
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismissRef.current();
      }
    };
    document.addEventListener("pointerdown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [active, ref]);
};

export const menuItemClass =
  "w-full rounded-md px-3 py-2 text-left font-bold text-ink-soft hover:bg-surface";

export const popoverClass =
  "absolute z-40 mt-2 rounded-lg border border-stroke bg-white p-2 text-ink shadow-[var(--shadow-lift)]";
