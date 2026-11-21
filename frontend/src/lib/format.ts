/** Server timestamps are ISO 8601 with a UTC offset ("2026-11-14T10:30:00+00:00"). */
export const parseServerTime = (timestamp: string) => new Date(timestamp);

export const formatDateTime = (timestamp: string) =>
  parseServerTime(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export const formatDate = (timestamp: string) =>
  parseServerTime(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

/** Card due dates are plain local dates ("YYYY-MM-DD"). */
export const formatDueDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
