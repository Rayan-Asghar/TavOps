import { describe, expect, it } from "vitest";
import { GRID_COLUMNS } from "./grid-columns";
import { parseTsv, toTsv, planPaste, type PasteTargetRow } from "./grid-paste";

// The grid as rendered with a Person column: date, label, person, hours, notes,
// link, id — indexes 0..6.
const columns = GRID_COLUMNS;

const ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const row = (over: Partial<PasteTargetRow> = {}): PasteTargetRow => ({
  rowKey: over.id ?? ID_A,
  id: ID_A,
  workDate: "2026-09-01",
  hours: "2.00",
  notes: "Original note.",
  editable: true,
  isDraft: false,
  ...over,
});

const draft = (): PasteTargetRow => ({
  rowKey: "draft-1",
  id: "",
  workDate: "",
  hours: "",
  notes: "",
  editable: true,
  isDraft: true,
});

const plan = (over: Partial<Parameters<typeof planPaste>[0]>) =>
  planPaste({
    block: [],
    anchor: { r: 0, c: 0 },
    rows: [],
    columns,
    month: "2026-09",
    canCreate: true,
    ...over,
  });

describe("parseTsv", () => {
  it("splits rows and columns, and tolerates either line ending", () => {
    expect(parseTsv("a\tb\r\nc\td")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("drops the trailing newline a spreadsheet adds", () => {
    expect(parseTsv("a\tb\n")).toEqual([["a", "b"]]);
    expect(parseTsv("")).toEqual([]);
  });

  it("keeps empty cells, which are a real value in a block", () => {
    expect(parseTsv("a\t\tc")).toEqual([["a", "", "c"]]);
  });
});

describe("toTsv", () => {
  it("substitutes tabs and newlines rather than escaping them", () => {
    // TSV has no quoting: either character would shear the block into the
    // wrong shape on the way into a spreadsheet.
    expect(toTsv([["a\tb", "c\nd"]])).toBe("a b\tc · d");
  });
});

describe("planPaste — positional", () => {
  it("corrects the row it lands on", () => {
    const p = plan({
      block: [["2026-09-05", "", "", "6.5", "Rewritten."]],
      anchor: { r: 0, c: 0 },
      rows: [row()],
    });

    expect(p.refused).toEqual([]);
    expect(p.creates).toEqual([]);
    expect(p.updates).toHaveLength(1);
    expect(p.updates[0].changes).toEqual({
      workDate: "2026-09-05",
      hours: "6.50",
      notes: "Rewritten.",
    });
    expect(p.updates[0].workLogId).toBe(ID_A);
  });

  it("treats rows past the last one as new entries", () => {
    const p = plan({
      block: [
        ["2026-09-05", "", "", "1", "First."],
        ["2026-09-06", "", "", "2", "Second."],
      ],
      anchor: { r: 0, c: 0 },
      rows: [row(), draft()],
    });

    expect(p.updates).toHaveLength(1);
    expect(p.creates).toEqual([
      { workDate: "2026-09-06", hours: "2.00", notes: "Second." },
    ]);
  });

  it("reports nothing to do when the values already match", () => {
    const p = plan({
      block: [["2026-09-01", "", "", "2.00", "Original note."]],
      rows: [row()],
    });
    expect(p.updates).toEqual([]);
    expect(p.refused).toEqual([]);
  });

  it("only writes the columns the grid owns", () => {
    // Columns B (label), Person, E (Link) and F (id) are never written.
    const p = plan({
      block: [["2026-09-05", "TAMPERED", "Someone Else", "3", "Note.", "http://x", "junk"]],
      rows: [row()],
    });
    expect(Object.keys(p.updates[0].changes).sort()).toEqual([
      "hours",
      "notes",
      "workDate",
    ]);
  });

  it("counts columns that fall off the right-hand edge", () => {
    const p = plan({
      block: [["2026-09-05", "x", "y"]],
      anchor: { r: 0, c: 5 },
      rows: [row()],
    });
    expect(p.truncatedCols).toBe(1);
  });
});

describe("planPaste — matching by work log id", () => {
  it("addresses rows by id when the block carries them, whatever their order", () => {
    // The workflow this exists for: copy the month out of the sheet, sort or
    // edit it in Excel, paste it back. Position is worthless after a sort.
    const rows = [row({ id: ID_A, rowKey: ID_A }), row({ id: ID_B, rowKey: ID_B, hours: "5.00" })];
    const p = plan({
      block: [
        ["2026-09-02", "", "", "9", "Second row first.", "", ID_B],
        ["2026-09-03", "", "", "8", "First row second.", "", ID_A],
      ],
      rows,
    });

    expect(p.matchedById).toBe(true);
    expect(p.refused).toEqual([]);
    expect(p.updates.map((u) => u.workLogId)).toEqual([ID_B, ID_A]);
    expect(p.updates[0].changes.hours).toBe("9.00");
  });

  it("refuses a row whose id is not in this month rather than creating one", () => {
    const p = plan({
      block: [["2026-09-02", "", "", "9", "Note.", "", ID_B]],
      rows: [row({ id: ID_A, rowKey: ID_A })],
    });
    expect(p.updates).toEqual([]);
    expect(p.creates).toEqual([]);
    expect(p.refused[0].reason).toMatch(/not in this month/);
  });

  it("refuses a half-identified block rather than guessing for the odd row", () => {
    const p = plan({
      block: [
        ["2026-09-02", "", "", "9", "Has an id.", "", ID_A],
        ["2026-09-03", "", "", "8", "Has none.", "", ""],
      ],
      rows: [row({ id: ID_A, rowKey: ID_A })],
    });
    expect(p.updates).toHaveLength(1);
    expect(p.refused[0].reason).toMatch(/no work log id/);
  });
});

describe("planPaste — a block shaped like the sheet", () => {
  // The sheet has six columns and no Person column; the grid renders Person as
  // a third column. Read positionally, a six-wide sheet block would put hours
  // into the notes cell — so the sheet's shape is recognised instead.
  const sheetRow = (id: string) => [
    "2026-09-05",
    "", // the sheet's own label column
    "6.5",
    "Straight from the sheet.",
    "", // Link
    id,
  ];

  it("reads a six-wide block in the sheet's column order", () => {
    const p = plan({ block: [sheetRow(ID_A)], rows: [row()] });

    expect(p.sheetShaped).toBe(true);
    expect(p.refused).toEqual([]);
    expect(p.updates[0].changes).toEqual({
      workDate: "2026-09-05",
      hours: "6.50",
      notes: "Straight from the sheet.",
    });
  });

  it("still matches those rows by their work log id", () => {
    const rows = [
      row({ id: ID_A, rowKey: ID_A }),
      row({ id: ID_B, rowKey: ID_B }),
    ];
    const p = plan({ block: [sheetRow(ID_B)], rows });
    expect(p.matchedById).toBe(true);
    expect(p.updates[0].workLogId).toBe(ID_B);
  });

  it("stays positional for a block that is not the sheet's shape", () => {
    const p = plan({
      block: [["2026-09-05", "", "", "6.5", "Note."]],
      rows: [row()],
    });
    expect(p.sheetShaped).toBe(false);
    expect(p.updates[0].changes.hours).toBe("6.50");
  });

  it("stays positional when the paste starts part-way across", () => {
    // Six cells dropped in the middle of the grid are not a sheet block.
    const p = plan({
      block: [["1", "2", "3", "4", "5", "6"]],
      anchor: { r: 0, c: 3 },
      rows: [row()],
    });
    expect(p.sheetShaped).toBe(false);
  });
});

describe("planPaste — refusals", () => {
  it("refuses a locked row and lets the rest through", () => {
    const p = plan({
      block: [
        ["2026-09-05", "", "", "1", "One."],
        ["2026-09-06", "", "", "2", "Two."],
      ],
      rows: [
        row({ id: ID_A, rowKey: ID_A, editable: false }),
        row({ id: ID_B, rowKey: ID_B }),
      ],
    });
    expect(p.refused).toHaveLength(1);
    expect(p.refused[0].blockRow).toBe(1);
    expect(p.updates).toHaveLength(1);
  });

  it("refuses a date in another month", () => {
    const p = plan({
      block: [["2026-10-01", "", "", "1", "Next month."]],
      rows: [row()],
    });
    expect(p.refused[0].reason).toMatch(/outside the month/);
  });

  it("refuses an unreadable value, naming the row it was on", () => {
    const p = plan({
      block: [
        ["2026-09-05", "", "", "1", "Fine."],
        ["2026-09-06", "", "", "8:30", "Clock notation."],
      ],
      rows: [row(), draft()],
    });
    expect(p.refused).toEqual([
      { blockRow: 2, reason: "Write 8.5 rather than 8:30." },
    ]);
    expect(p.updates).toHaveLength(1);
  });

  it("will not create a half-written entry", () => {
    const p = plan({
      block: [["2026-09-06", "", "", "", ""]],
      rows: [draft()],
    });
    expect(p.creates).toEqual([]);
    expect(p.refused[0].reason).toMatch(/needs a date, hours and a note/);
  });

  it("refuses new entries outright when the viewer cannot create", () => {
    const p = plan({
      block: [["2026-09-06", "", "", "2", "Note."]],
      rows: [],
      canCreate: false,
    });
    expect(p.creates).toEqual([]);
    expect(p.refused).toHaveLength(1);
  });

  it("refuses a block that lands entirely on columns the grid never writes", () => {
    const p = plan({
      block: [["nope"]],
      anchor: { r: 0, c: 1 }, // the label column
      rows: [row()],
    });
    expect(p.refused[0].reason).toMatch(/lands on a column the grid writes/);
  });
});
