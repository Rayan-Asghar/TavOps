/**
 * The grid's keyboard map, as a pure function.
 *
 * Separated from the component so the behaviour that makes this feel like a
 * spreadsheet — rather than a table with inputs in it — is testable without
 * mounting anything. The component's job is to apply the action; deciding what
 * a keystroke means is decided here.
 */

export type GridAction =
  | { kind: "move"; dr: number; dc: number }
  | { kind: "extend"; dr: number; dc: number }
  | { kind: "selectAll" }
  | { kind: "copy" }
  | { kind: "moveEdge"; axis: "row" | "col" | "grid"; to: "first" | "last" }
  | { kind: "edit"; seed?: string }
  | { kind: "commit"; dr: number; dc: number }
  | { kind: "cancel" }
  | { kind: "remove" }
  | { kind: "exit" }
  | { kind: "none" };

export type KeyEventLike = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

const NONE: GridAction = { kind: "none" };

export function keyToAction(e: KeyEventLike, editing: boolean): GridAction {
  const mod = e.ctrlKey || e.metaKey;

  if (editing) {
    // While an editor is open the browser owns the text: undo, selection and
    // caret movement all belong to the input, and intercepting them would make
    // the cell behave unlike every other text field in the app.
    switch (e.key) {
      case "Enter":
        return { kind: "commit", dr: e.shiftKey ? -1 : 1, dc: 0 };
      case "Tab":
        return { kind: "commit", dr: 0, dc: e.shiftKey ? -1 : 1 };
      case "Escape":
        return { kind: "cancel" };
      default:
        return NONE;
    }
  }

  // Copy and select-all are the two shortcuts the grid claims from the page;
  // everything else with a modifier is left to the browser.
  if (mod && (e.key === "c" || e.key === "C")) return { kind: "copy" };
  if (mod && (e.key === "a" || e.key === "A")) return { kind: "selectAll" };

  const arrow: Record<string, [number, number]> = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
  };
  const step = arrow[e.key];
  if (step) {
    // Shift extends the selection from its anchor instead of moving it, which
    // is what makes a range copyable.
    return e.shiftKey
      ? { kind: "extend", dr: step[0], dc: step[1] }
      : { kind: "move", dr: step[0], dc: step[1] };
  }

  switch (e.key) {
    case "PageUp":
      return { kind: "move", dr: -15, dc: 0 };
    case "PageDown":
      return { kind: "move", dr: 15, dc: 0 };
    case "Home":
      return mod
        ? { kind: "moveEdge", axis: "grid", to: "first" }
        : { kind: "moveEdge", axis: "row", to: "first" };
    case "End":
      return mod
        ? { kind: "moveEdge", axis: "grid", to: "last" }
        : { kind: "moveEdge", axis: "row", to: "last" };
    // Tab moves right, which is Sheets and Excel rather than the ARIA grid
    // pattern's "Tab leaves the grid". Taking the users' side on a surface
    // whose whole point is that it behaves like a spreadsheet; Escape is the
    // keyboard way out, and the grid says so beneath it.
    case "Tab":
      return { kind: "move", dr: 0, dc: e.shiftKey ? -1 : 1 };
    case "Enter":
    case "F2":
      return { kind: "edit" };
    case "Escape":
      return { kind: "exit" };
    case "Backspace":
    case "Delete":
      return { kind: "remove" };
    default:
      break;
  }

  // Type-to-replace: a printable character starts an edit with the cell
  // cleared and that character already in it.
  if (!mod && !e.altKey && isPrintable(e.key)) {
    return { kind: "edit", seed: e.key };
  }
  return NONE;
}

/**
 * One code point, so `a` and `é` count but `ArrowUp` and `F5` do not. Named
 * keys are always longer than a single character, which is what makes this
 * check sufficient without a keycode table.
 */
export function isPrintable(key: string): boolean {
  return [...key].length === 1;
}
