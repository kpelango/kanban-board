import { boardFileName, parseBoardFile, toBoardFile } from "@/lib/boardFile";
import { initialData } from "@/test/fixtures";

describe("board files", () => {
  it("round-trips an exported board", () => {
    const text = toBoardFile("Launch plan", initialData);
    expect(JSON.parse(text)).toMatchObject({ kanbanStudio: 1, name: "Launch plan" });
    expect(parseBoardFile(text, "whatever.json")).toEqual({ name: "Launch plan", board: initialData });
  });

  it("accepts a bare board and names it after the file", () => {
    expect(parseBoardFile(JSON.stringify(initialData), "Q3 Roadmap.json")).toEqual({
      name: "Q3 Roadmap",
      board: initialData,
    });
  });

  it("rejects files that are not boards", () => {
    expect(() => parseBoardFile("{not json", "x.json")).toThrow("not valid JSON");
    expect(() => parseBoardFile('{"hello": 1}', "x.json")).toThrow("not a Kanban Studio board");
  });

  it("builds safe file names", () => {
    expect(boardFileName("Q3 Roadmap / Draft!")).toBe("q3-roadmap-draft.json");
    expect(boardFileName("***")).toBe("board.json");
  });
});
