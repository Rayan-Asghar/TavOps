import { describe, expect, it } from "vitest";
import {
  TEMPLATE_HEADERS,
  checkHeaders,
  headerHash,
  locateRow,
  parseSpreadsheetId,
  templateCopyUrl,
  toCells,
} from "./sheet-template";

// Widened: several cases deliberately put a wrong value in a column.
const headers: string[] = [...TEMPLATE_HEADERS];

describe("checkHeaders", () => {
  it("accepts the template", () => {
    const result = checkHeaders(headers);
    expect(result.ok).toBe(true);
  });

  it("ignores case and stray whitespace, which are not layout changes", () => {
    const result = checkHeaders(headers.map((h) => ` ${h.toUpperCase()} `));
    expect(result.ok).toBe(true);
  });

  it("names the column and both values when one header is wrong", () => {
    const wrong = [...headers];
    wrong[4] = "Time";
    const result = checkHeaders(wrong);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("Column E");
      expect(result.reason).toContain("Hours");
      expect(result.reason).toContain("Time");
    }
  });

  it("catches an inserted column, which is the case that would corrupt writes", () => {
    // Somebody adds "Client" at B: everything from there on shifts right, so
    // Hours would land in the Work Done column if this were allowed through.
    const shifted = [headers[0], "Client", ...headers.slice(1)];
    const result = checkHeaders(shifted);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("Column B");
  });

  it("reports an empty cell differently from a wrong one", () => {
    const missing = [...headers];
    missing[7] = "";
    const result = checkHeaders(missing);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("is empty");
  });

  it("rejects a sheet with no header row at all", () => {
    expect(checkHeaders([]).ok).toBe(false);
  });

  it("ignores columns a team adds to the right of the template", () => {
    // Tavren writes A-H only, so a human-maintained Blocker column at I is
    // theirs to keep and must not read as drift.
    expect(checkHeaders([...headers, "Blocker", "Notes"]).ok).toBe(true);
  });
});

describe("headerHash", () => {
  it("is stable across case and whitespace", () => {
    expect(headerHash(headers)).toBe(headerHash(headers.map((h) => ` ${h} `)));
    expect(headerHash(headers)).toBe(
      headerHash(headers.map((h) => h.toLowerCase())),
    );
  });

  it("changes when a column is renamed", () => {
    const renamed = [...headers];
    renamed[5] = "Summary";
    expect(headerHash(renamed)).not.toBe(headerHash(headers));
  });

  it("changes when columns are reordered", () => {
    const swapped = [...headers];
    [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
    expect(headerHash(swapped)).not.toBe(headerHash(headers));
  });
});

describe("toCells", () => {
  it("emits one cell per template header, in order", () => {
    const cells = toCells({
      date: "2026-09-02",
      developer: "Ahmed",
      project: "Temple Skin",
      task: "Mobile Homepage",
      hours: "2.50",
      workDone: "Fixed responsive layout",
      status: "In Progress",
      workLogId: "wl-1",
    });
    expect(cells).toHaveLength(TEMPLATE_HEADERS.length);
    expect(cells[4]).toBe("2.50");
    expect(cells[7]).toBe("wl-1");
  });
});

describe("locateRow", () => {
  // Column H as read from the sheet, first data row is 2.
  const column = ["wl-a", "wl-b", "wl-c"];

  it("uses the hint when it still points at the right entry", () => {
    expect(locateRow(column, "wl-b", 3)).toBe(3);
  });

  it("finds the row when the hint is stale, and reports where it moved to", () => {
    // Somebody inserted a row above: wl-b is now at 3, hint still says 2.
    expect(locateRow(column, "wl-b", 2)).toBe(3);
  });

  it("finds the row with no hint at all", () => {
    expect(locateRow(column, "wl-c", null)).toBe(4);
  });

  it("returns null when a human deleted the row", () => {
    // The caller must skip rather than guess: writing to a row number whose id
    // is gone is how an unrelated entry gets overwritten.
    expect(locateRow(column, "wl-missing", 2)).toBeNull();
  });

  it("survives a hint pointing past the end of the sheet", () => {
    expect(locateRow(column, "wl-a", 99)).toBe(2);
  });

  it("ignores a hint above the first data row", () => {
    // Row 1 is the header; a hint of 1 must never be trusted.
    expect(locateRow(column, "wl-a", 1)).toBe(2);
  });

  it("matches ids that the sheet padded with whitespace", () => {
    expect(locateRow([" wl-a ", "wl-b"], "wl-a", null)).toBe(2);
  });
});

describe("parseSpreadsheetId", () => {
  it("takes the id out of a pasted browser URL", () => {
    expect(
      parseSpreadsheetId(
        "https://docs.google.com/spreadsheets/d/1AbC-dEf_23/edit#gid=0",
      ),
    ).toBe("1AbC-dEf_23");
  });

  it("accepts a bare id", () => {
    expect(parseSpreadsheetId("1AbCdEfGhIjKlMnOpQrStUvWxYz")).toBe(
      "1AbCdEfGhIjKlMnOpQrStUvWxYz",
    );
  });

  it("rejects something that is not a sheet link", () => {
    expect(parseSpreadsheetId("https://example.com/nope")).toBeNull();
    expect(parseSpreadsheetId("")).toBeNull();
    expect(parseSpreadsheetId("short")).toBeNull();
  });
});

describe("templateCopyUrl", () => {
  it("points at Google's copy endpoint, so the copy lands in the user's Drive", () => {
    expect(templateCopyUrl("TPL123")).toBe(
      "https://docs.google.com/spreadsheets/d/TPL123/copy",
    );
  });
});
