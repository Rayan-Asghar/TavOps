import { describe, expect, it } from "vitest";
import { resolveBillable } from "./billable";

describe("resolveBillable", () => {
  it("defaults to billable when nothing classifies the work", () => {
    expect(resolveBillable({})).toEqual({ billable: true, source: "default" });
  });

  it("inherits from the task's type with nobody touching a checkbox", () => {
    // The case the whole design exists for: Business Development is real work
    // that no client pays for, and no one should have to remember that.
    expect(resolveBillable({ taskTypeBillable: false })).toEqual({
      billable: false,
      source: "task-type",
    });
  });

  it("lets the work log's own type beat the task's", () => {
    // A client call logged against a Programming task is still a client call.
    expect(
      resolveBillable({ entryTypeBillable: false, taskTypeBillable: true }),
    ).toEqual({ billable: false, source: "entry-type" });
  });

  it("lets an explicit choice beat every inherited value", () => {
    expect(
      resolveBillable({
        entryOverride: true,
        entryTypeBillable: false,
        taskTypeBillable: false,
      }),
    ).toEqual({ billable: true, source: "override" });
  });

  it("treats an explicit false as a choice, not as absence", () => {
    // The bug this pins: `if (override)` would drop a deliberate false and
    // silently bill the entry.
    expect(resolveBillable({ entryOverride: false, taskTypeBillable: true })).toEqual(
      { billable: false, source: "override" },
    );
  });

  it("treats null and undefined alike as 'not stated'", () => {
    expect(resolveBillable({ entryOverride: null, taskTypeBillable: false })).toEqual(
      { billable: false, source: "task-type" },
    );
  });
});
