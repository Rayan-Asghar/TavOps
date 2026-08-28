import { describe, expect, it } from "vitest";
import {
  a1Range,
  columnToIndex,
  indexToColumn,
  isRetryableSheetsError,
} from "./sheets";

/**
 * Every case here is a bug that was found by review before the first real
 * Google call, or one that would look like Google's fault if it regressed.
 */

describe("a1Range", () => {
  it("leaves a plain tab name unquoted", () => {
    expect(a1Range("Sheet1", "A:F")).toBe("Sheet1!A:F");
    expect(a1Range("Time_Log", "A1")).toBe("Time_Log!A1");
  });

  it("quotes a name containing a space", () => {
    // Unquoted, `Time Log!A:F` comes back as "Unable to parse range" — and
    // client tabs are called things like "Dev Hours" far more often than
    // "Sheet1", so this is the normal case.
    expect(a1Range("Time Log", "A:F")).toBe("'Time Log'!A:F");
  });

  it("quotes a name starting with a digit", () => {
    expect(a1Range("2026 Hours", "A1")).toBe("'2026 Hours'!A1");
  });

  it("doubles an embedded single quote", () => {
    expect(a1Range("Bob's Tab", "A1")).toBe("'Bob''s Tab'!A1");
  });

  it("quotes names with punctuation", () => {
    expect(a1Range("Aug-2026", "A1")).toBe("'Aug-2026'!A1");
    expect(a1Range("Hours (client)", "A1")).toBe("'Hours (client)'!A1");
  });
});

describe("columnToIndex", () => {
  it("maps single letters from zero", () => {
    expect(columnToIndex("A")).toBe(0);
    expect(columnToIndex("Z")).toBe(25);
  });

  it("maps two-letter columns", () => {
    expect(columnToIndex("AA")).toBe(26);
    expect(columnToIndex("AB")).toBe(27);
    expect(columnToIndex("BA")).toBe(52);
  });

  it("accepts lower case", () => {
    expect(columnToIndex("ab")).toBe(columnToIndex("AB"));
  });

  it("rejects a numeric column instead of silently misplacing the value", () => {
    // A mapping of "1" rather than "A" produced a negative index, and the
    // value vanished into a stray array property rather than erroring.
    expect(() => columnToIndex("1")).toThrow(/column letter/i);
    expect(() => columnToIndex("")).toThrow();
    expect(() => columnToIndex("A1")).toThrow();
    expect(() => columnToIndex("A ")).toThrow();
  });
});

describe("indexToColumn", () => {
  it("is the inverse of columnToIndex", () => {
    for (const col of ["A", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]) {
      expect(indexToColumn(columnToIndex(col))).toBe(col);
    }
  });

  it("carries correctly past Z", () => {
    expect(indexToColumn(25)).toBe("Z");
    expect(indexToColumn(26)).toBe("AA");
    expect(indexToColumn(51)).toBe("AZ");
    expect(indexToColumn(701)).toBe("ZZ");
    expect(indexToColumn(702)).toBe("AAA");
  });
});

describe("isRetryableSheetsError", () => {
  it("retries rate limits and server errors", () => {
    expect(isRetryableSheetsError({ code: 429 })).toBe(true);
    expect(isRetryableSheetsError({ code: 500 })).toBe(true);
    expect(isRetryableSheetsError({ code: 503 })).toBe(true);
    expect(isRetryableSheetsError({ status: 502 })).toBe(true);
  });

  it("does not retry an unshared or missing sheet", () => {
    // Retrying a 403 three times just delays telling an admin to fix sharing.
    expect(isRetryableSheetsError({ code: 403 })).toBe(false);
    expect(isRetryableSheetsError({ code: 404 })).toBe(false);
    expect(isRetryableSheetsError({ code: 400 })).toBe(false);
  });

  it("retries when there is no status to judge by", () => {
    // A socket hang-up or DNS blip has no HTTP status and is worth retrying.
    expect(isRetryableSheetsError(new Error("socket hang up"))).toBe(true);
    expect(isRetryableSheetsError(undefined)).toBe(true);
  });
});
