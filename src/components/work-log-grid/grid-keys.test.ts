import { describe, expect, it } from "vitest";
import { keyToAction, isPrintable, type KeyEventLike } from "./grid-keys";

const k = (key: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("navigating", () => {
  it("moves with the arrow keys", () => {
    expect(keyToAction(k("ArrowDown"), false)).toEqual({ kind: "move", dr: 1, dc: 0 });
    expect(keyToAction(k("ArrowLeft"), false)).toEqual({ kind: "move", dr: 0, dc: -1 });
  });

  it("moves right on Tab and left on Shift+Tab, like a spreadsheet", () => {
    expect(keyToAction(k("Tab"), false)).toEqual({ kind: "move", dr: 0, dc: 1 });
    expect(keyToAction(k("Tab", { shiftKey: true }), false)).toEqual({
      kind: "move",
      dr: 0,
      dc: -1,
    });
  });

  it("goes to the row ends, and to the grid ends with a modifier", () => {
    expect(keyToAction(k("Home"), false)).toMatchObject({ axis: "row", to: "first" });
    expect(keyToAction(k("End", { ctrlKey: true }), false)).toMatchObject({
      axis: "grid",
      to: "last",
    });
  });

  it("opens an editor on Enter and leaves the grid on Escape", () => {
    expect(keyToAction(k("Enter"), false)).toEqual({ kind: "edit" });
    expect(keyToAction(k("Escape"), false)).toEqual({ kind: "exit" });
  });

  it("starts an edit from a printable character, seeding it", () => {
    expect(keyToAction(k("7"), false)).toEqual({ kind: "edit", seed: "7" });
    expect(keyToAction(k("é"), false)).toEqual({ kind: "edit", seed: "é" });
  });

  it("does not mistake a named key or a shortcut for typing", () => {
    expect(keyToAction(k("F5"), false)).toEqual({ kind: "none" });
    // Paste is left to the browser: the clipboard arrives on the paste event,
    // which is the only way to read it without a permission prompt.
    expect(keyToAction(k("v", { metaKey: true }), false)).toEqual({ kind: "none" });
    expect(keyToAction(k("z", { ctrlKey: true }), false)).toEqual({ kind: "none" });
  });

  it("extends a selection with Shift and an arrow", () => {
    expect(keyToAction(k("ArrowDown", { shiftKey: true }), false)).toEqual({
      kind: "extend",
      dr: 1,
      dc: 0,
    });
    expect(keyToAction(k("ArrowRight", { shiftKey: true }), false)).toEqual({
      kind: "extend",
      dr: 0,
      dc: 1,
    });
  });

  it("claims copy and select-all from the page", () => {
    expect(keyToAction(k("c", { ctrlKey: true }), false)).toEqual({ kind: "copy" });
    expect(keyToAction(k("C", { metaKey: true }), false)).toEqual({ kind: "copy" });
    expect(keyToAction(k("a", { ctrlKey: true }), false)).toEqual({ kind: "selectAll" });
  });
});

describe("editing", () => {
  it("commits down on Enter and up on Shift+Enter", () => {
    expect(keyToAction(k("Enter"), true)).toEqual({ kind: "commit", dr: 1, dc: 0 });
    expect(keyToAction(k("Enter", { shiftKey: true }), true)).toEqual({
      kind: "commit",
      dr: -1,
      dc: 0,
    });
  });

  it("commits sideways on Tab", () => {
    expect(keyToAction(k("Tab"), true)).toEqual({ kind: "commit", dr: 0, dc: 1 });
  });

  it("abandons the edit on Escape", () => {
    expect(keyToAction(k("Escape"), true)).toEqual({ kind: "cancel" });
  });

  it("leaves everything else to the input", () => {
    // The browser's own undo, caret movement and selection belong to the text
    // field while it is open; intercepting them would make the cell behave
    // unlike every other input in the app.
    for (const key of ["a", "ArrowLeft", "Home", "z", "Backspace", "Delete"]) {
      expect(keyToAction(k(key), true)).toEqual({ kind: "none" });
      expect(keyToAction(k(key, { ctrlKey: true }), true)).toEqual({ kind: "none" });
    }
  });
});

describe("isPrintable", () => {
  it("counts one code point, not one UTF-16 unit", () => {
    expect(isPrintable("a")).toBe(true);
    expect(isPrintable("—")).toBe(true);
    expect(isPrintable("ArrowUp")).toBe(false);
    expect(isPrintable("")).toBe(false);
  });
});
