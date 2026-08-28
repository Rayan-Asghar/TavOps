import { describe, expect, it } from "vitest";
import { chunk } from "./webhooks";

describe("chunk", () => {
  it("leaves a short message alone", () => {
    expect(chunk("hello\nworld", 100)).toEqual(["hello\nworld"]);
  });

  it("splits on line boundaries so a project never straddles two messages", () => {
    const lines = ["aaaa", "bbbb", "cccc", "dddd"];
    const parts = chunk(lines.join("\n"), 10);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(10);
    // Every original line survives intact somewhere.
    for (const l of lines) expect(parts.some((p) => p.includes(l))).toBe(true);
  });

  it("hard-cuts a single line longer than the limit rather than dropping it", () => {
    const parts = chunk("x".repeat(25), 10);
    expect(parts).toEqual(["x".repeat(10), "x".repeat(10), "x".repeat(5)]);
  });

  it("loses no content overall", () => {
    const text = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    const parts = chunk(text, 30);
    expect(parts.join("\n")).toBe(text);
  });

  it("returns nothing for an empty message", () => {
    expect(chunk("", 100)).toEqual([]);
  });

  it("keeps every part within Discord's limit by default", () => {
    const text = Array.from({ length: 500 }, (_, i) => `• PROJ-${i} something`).join("\n");
    for (const p of chunk(text)) expect(p.length).toBeLessThanOrEqual(1900);
  });
});
