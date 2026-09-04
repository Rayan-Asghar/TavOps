import { describe, expect, it } from "vitest";
import { readTriStateCheckbox } from "./form-checkbox";

describe("readTriStateCheckbox", () => {
  it("reads a ticked box as true", () => {
    expect(readTriStateCheckbox(["false", "true"])).toBe(true);
  });

  it("reads an unticked box as false, not as absent", () => {
    expect(readTriStateCheckbox(["false"])).toBe(false);
  });

  it("reads a form without the control as null, not as false", () => {
    // The distinction the whole helper exists for: null means "inherit".
    expect(readTriStateCheckbox([])).toBeNull();
  });

  it("takes the checkbox over its hidden companion regardless of count", () => {
    expect(readTriStateCheckbox(["false", "true"])).toBe(true);
    expect(readTriStateCheckbox(["true"])).toBe(true);
  });
});
