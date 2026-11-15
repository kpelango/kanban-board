/** SQLite CURRENT_TIMESTAMP values ("YYYY-MM-DD HH:MM:SS") are UTC. */
export const parseServerTime = (timestamp: string) => new Date(`${timestamp.replace(" ", "T")}Z`);

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
