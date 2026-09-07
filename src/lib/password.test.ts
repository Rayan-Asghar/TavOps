import { describe, expect, it } from "vitest";
import { generatePassword } from "./password";

describe("generatePassword", () => {
  it("is the requested length", () => {
    expect(generatePassword()).toHaveLength(16);
    expect(generatePassword(24)).toHaveLength(24);
  });

  it("omits characters that are ambiguous when retyped", () => {
    // 0/O and 1/l/I turn a handover message into a support request.
    const sample = Array.from({ length: 200 }, () => generatePassword()).join("");
    for (const ch of ["0", "O", "1", "l", "I"]) {
      expect(sample, `contains ${ch}`).not.toContain(ch);
    }
  });

  it("does not repeat itself", () => {
    const many = new Set(Array.from({ length: 500 }, () => generatePassword()));
    expect(many.size).toBe(500);
  });
});
