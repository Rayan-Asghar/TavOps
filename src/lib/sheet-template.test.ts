import { describe, expect, it } from "vitest";
import {
  FIRST_DATA_ROW,
  HEADER_ROW,
  TEMPLATE_HEADERS,
  bannerRows,
  checkHeaders,
  formatSheetDate,
  headerHash,
  locateRow,
  monthTabName,
  parseSpreadsheetId,
  templateCopyUrl,
  toCells,
} from "./sheet-template";

/** A correct header row, with the per-sheet label in column B. */
const headers = (label = "Dr V Clinic"): string[] => [
  "Date",
  label,
  "Hours",
  "Notes — Work Done",
  "Link (if any)",
  "Work Log ID",
];

describe("checkHeaders", () => {
  it("accepts the layout the team already uses", () => {
    expect(checkHeaders(headers()).ok).toBe(true);
  });

  it("ignores case and stray whitespace, which are not layout changes", () => {
    const result = checkHeaders(headers().map((h) => ` ${h.toUpperCase()} `));
    expect(result.ok).toBe(true);
  });

  it("does not care what column B says, because it names the sheet", () => {
    // Every sheet has a different project there by design.
    expect(checkHeaders(headers("Northwind")).ok).toBe(true);
    expect(checkHeaders(headers("")).ok).toBe(true);
  });

  it("names the column and both values when a fixed header is wrong", () => {
    const wrong = headers();
    wrong[2] = "Time";
    const result = checkHeaders(wrong);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("Column C");
      expect(result.reason).toContain("Hours");
      expect(result.reason).toContain("Time");
    }
  });

  it("catches an inserted column, the case that would corrupt writes", () => {
    // Everything shifts right, so Hours would land under Notes.
    const shifted = ["Date", "Dr V Clinic", "Client", "Hours", "Notes — Work Done"];
    const result = checkHeaders(shifted);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("Column C");
  });

  it("adopts a hand-kept sheet that has no id column yet", () => {
    // The team never knew to add it; refusing an otherwise-correct sheet over
    // a column Tavren itself introduced would be obtuse.
    const withoutId = headers().slice(0, 5);
    const result = checkHeaders(withoutId);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.needsIdColumn).toBe(true);
  });

  it("does not ask for the id column when it is already there", () => {
    const result = checkHeaders(headers());
    if (result.ok) expect(result.needsIdColumn).toBe(false);
  });

  it("hashes a sheet the same before and after the id heading is added", () => {
    // Otherwise adding the column we just asked for would read as drift.
    const before = checkHeaders(headers().slice(0, 5));
    const after = checkHeaders(headers());
    expect(before.ok && after.ok && before.hash).toBe(
      after.ok ? after.hash : null,
    );
  });

  it("rejects a sheet with no header row at all", () => {
    expect(checkHeaders([]).ok).toBe(false);
  });
});

describe("headerHash", () => {
  it("is the same across sheets that differ only by their label", () => {
    expect(headerHash(headers("Dr V Clinic"))).toBe(
      headerHash(headers("Northwind")),
    );
  });

  it("changes when a fixed column is renamed", () => {
    const renamed = headers();
    renamed[3] = "Summary";
    expect(headerHash(renamed)).not.toBe(headerHash(headers()));
  });

  it("changes when columns are reordered", () => {
    const swapped = headers();
    [swapped[0], swapped[2]] = [swapped[2], swapped[0]];
    expect(headerHash(swapped)).not.toBe(headerHash(headers()));
  });
});

describe("toCells", () => {
  it("writes only the columns Tavren owns, and holds the others open", () => {
    const cells = toCells({
      date: "Wed, 02 Sep 2026",
      hours: "2.50",
      workDone: "Fixed responsive layout",
      workLogId: "wl-1",
    });
    expect(cells).toHaveLength(TEMPLATE_HEADERS.length);
    expect(cells[0]).toBe("Wed, 02 Sep 2026");
    // B is the sheet's label and E is the team's link column: empty, not absent,
    // or every value after them shifts a column left on append.
    expect(cells[1]).toBe("");
    expect(cells[4]).toBe("");
    expect(cells[2]).toBe("2.50");
    expect(cells[5]).toBe("wl-1");
  });
});

describe("formatSheetDate", () => {
  const at = (s: string) => new Date(`${s}T12:00:00.000Z`);

  it("matches the format the team's sheets already use", () => {
    expect(formatSheetDate(at("2026-08-01"))).toBe("Sat, 01 Aug 2026");
  });

  it("pads single-digit days", () => {
    expect(formatSheetDate(at("2026-09-02"))).toBe("Wed, 02 Sep 2026");
  });

  it("reads the day from UTC, so a late shift stays on its own date", () => {
    // 23:30 UTC is still that calendar day, which is the day the team means.
    expect(formatSheetDate(new Date("2026-08-31T23:30:00.000Z"))).toBe(
      "Mon, 31 Aug 2026",
    );
  });
});

describe("monthTabName", () => {
  const at = (s: string) => new Date(`${s}T12:00:00.000Z`);

  it("names the tab the entry belongs in", () => {
    expect(monthTabName(at("2026-08-14"))).toBe("August 2026");
  });

  it("rolls over on the first of the month, not before", () => {
    expect(monthTabName(at("2026-08-31"))).toBe("August 2026");
    expect(monthTabName(at("2026-09-01"))).toBe("September 2026");
  });

  it("crosses a year end", () => {
    expect(monthTabName(at("2026-12-31"))).toBe("December 2026");
    expect(monthTabName(at("2027-01-01"))).toBe("January 2027");
  });
});

describe("bannerRows", () => {
  it("puts the header on the row everything else assumes", () => {
    const rows = bannerRows("August 2026", "Dr V Clinic");
    expect(rows).toHaveLength(HEADER_ROW);
    expect(rows[HEADER_ROW - 1][0]).toBe("Date");
    expect(rows[HEADER_ROW - 1][1]).toBe("Dr V Clinic");
  });

  it("totals with formulas starting at the first data row", () => {
    // A number written once is wrong the moment anything below changes.
    const summary = bannerRows("August 2026", "X")[5];
    expect(summary[1]).toContain(`C${FIRST_DATA_ROW}:C`);
    expect(summary[1]).toContain("SUM");
    expect(summary[2]).toContain(`A${FIRST_DATA_ROW}:A`);
  });

  it("titles the sheet with its month", () => {
    expect(bannerRows("August 2026", "X")[0][0]).toBe(
      "TAVREN — AUGUST 2026 WORK LOG",
    );
  });
});

describe("locateRow", () => {
  // Column F as read from the sheet; the first entry sits at FIRST_DATA_ROW.
  const column = ["wl-a", "wl-b", "wl-c"];

  it("uses the hint when it still points at the right entry", () => {
    expect(locateRow(column, "wl-b", FIRST_DATA_ROW + 1)).toBe(FIRST_DATA_ROW + 1);
  });

  it("finds the row when the hint is stale", () => {
    // Somebody inserted a row above, so every stored position moved down one.
    expect(locateRow(column, "wl-b", FIRST_DATA_ROW)).toBe(FIRST_DATA_ROW + 1);
  });

  it("finds the row with no hint at all", () => {
    expect(locateRow(column, "wl-c", null)).toBe(FIRST_DATA_ROW + 2);
  });

  it("returns null when a human deleted the row", () => {
    expect(locateRow(column, "wl-missing", FIRST_DATA_ROW)).toBeNull();
  });

  it("never trusts a hint pointing into the banner", () => {
    // Rows 1-8 are the title, summary and header; writing there would destroy
    // the formulas the team reads.
    expect(locateRow(column, "wl-a", 6)).toBe(FIRST_DATA_ROW);
    expect(locateRow(column, "wl-a", HEADER_ROW)).toBe(FIRST_DATA_ROW);
  });

  it("survives a hint pointing past the end of the sheet", () => {
    expect(locateRow(column, "wl-a", 999)).toBe(FIRST_DATA_ROW);
  });
});

describe("parseSpreadsheetId", () => {
  it("takes the id out of a pasted browser URL", () => {
    expect(
      parseSpreadsheetId(
        "https://docs.google.com/spreadsheets/d/1AbC-dEf_23/edit?gid=105764406#gid=105764406",
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
