import { errorText } from "@/lib/api";
import { formatDueDate, parseServerTime } from "@/lib/format";

describe("format helpers", () => {
  it("reads SQLite timestamps as UTC", () => {
    expect(parseServerTime("2026-11-14 10:30:00").toISOString()).toBe("2026-11-14T10:30:00.000Z");
  });

  it("formats due dates as local calendar dates", () => {
    const expected = new Date(2026, 0, 31).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    expect(formatDueDate("2026-01-31")).toBe(expected);
  });

  it("turns thrown values into user-facing messages", () => {
    expect(errorText(new Error("Board not found"))).toBe("Board not found");
    expect(errorText("weird")).toBe("Something went wrong. Try again.");
    expect(errorText(null, "Could not load")).toBe("Could not load");
  });
});
