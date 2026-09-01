import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("writes a header and rows separated by CRLF", () => {
    expect(toCsv(["a", "b"], [[1, 2]])).toBe("a,b\r\n1,2\r\n");
  });

  it("quotes values containing a comma", () => {
    expect(toCsv(["a"], [["x,y"]])).toBe('a\r\n"x,y"\r\n');
  });

  it("doubles embedded quotes", () => {
    expect(toCsv(["a"], [['say "hi"']])).toBe('a\r\n"say ""hi"""\r\n');
  });

  it("quotes values containing a newline, so the row survives", () => {
    expect(toCsv(["a"], [["one\ntwo"]])).toBe('a\r\n"one\ntwo"\r\n');
  });

  it("renders null and undefined as empty, not as the word", () => {
    expect(toCsv(["a", "b"], [[null, undefined]])).toBe("a,b\r\n,\r\n");
  });

  it("defuses cells a spreadsheet would execute as a formula", () => {
    // A note beginning with any of these is data, not a formula.
    for (const lead of ["=", "+", "-", "@"]) {
      expect(toCsv(["a"], [[`${lead}cmd`]])).toBe(`a\r\n'${lead}cmd\r\n`);
    }
  });

  it("still quotes a defused cell that also contains a comma", () => {
    expect(toCsv(["a"], [["=a,b"]])).toBe(`a\r\n"'=a,b"\r\n`);
  });

  it("leaves ordinary text untouched", () => {
    expect(toCsv(["a"], [["Hero section done"]])).toBe("a\r\nHero section done\r\n");
  });

  it("handles no rows", () => {
    expect(toCsv(["a", "b"], [])).toBe("a,b\r\n");
  });
});
