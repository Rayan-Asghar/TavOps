import { describe, expect, it } from "vitest";
import { renderDigest, type Digest, type ProjectLine } from "@/lib/digest-format";

const base: ProjectLine = {
  code: "NW-001",
  name: "Northwind",
  health: "on_track",
  doneTasks: 3,
  totalTasks: 4,
  loggedHours: 66,
  estimatedHours: 54,
  openBlockers: 0,
  overdueTasks: 0,
  lastActivityAt: new Date("2026-08-27T15:00:00Z"),
};

const digest = (over: Partial<Digest> = {}): Digest => ({
  generatedAt: new Date("2026-08-27T13:00:00Z"),
  projects: [base],
  stuckBlockers: [],
  silentProjects: [],
  ...over,
});

describe("renderDigest", () => {
  it("leads with the date so a re-post is obviously a re-post", () => {
    expect(renderDigest(digest())).toContain("2026-08-27");
  });

  it("shows hours against estimate, which is the fixed-price warning", () => {
    const out = renderDigest(digest());
    expect(out).toContain("66.0h of 54.0h (122%)");
    expect(out).toContain("OVER");
  });

  it("does not shout OVER when inside the estimate", () => {
    const out = renderDigest(
      digest({ projects: [{ ...base, loggedHours: 20 }] }),
    );
    expect(out).toContain("(37%)");
    expect(out).not.toContain("OVER");
  });

  it("omits the hours clause entirely when nothing is estimated", () => {
    const out = renderDigest(
      digest({ projects: [{ ...base, estimatedHours: 0, loggedHours: 12 }] }),
    );
    expect(out).toContain("12.0h logged");
    expect(out).not.toContain("of 0.0h");
  });

  it("names who a stuck blocker is with, and whose side it is", () => {
    const out = renderDigest(
      digest({
        stuckBlockers: [
          {
            project: "NW-001 Northwind",
            description: "No Shopify admin access",
            assignee: "Saqlain",
            hoursOpen: 30,
            ownerSide: "client",
          },
        ],
      }),
    );
    expect(out).toContain("30h with Saqlain (client)");
    expect(out).toContain("No Shopify admin access");
  });

  it("says so plainly when a blocker has nobody on it", () => {
    const out = renderDigest(
      digest({
        stuckBlockers: [
          {
            project: "X",
            description: "d",
            assignee: null,
            hoursOpen: 40,
            ownerSide: "internal",
          },
        ],
      }),
    );
    expect(out).toContain("nobody assigned");
  });

  it("lists projects nobody has logged against", () => {
    const out = renderDigest(digest({ silentProjects: [base] }));
    expect(out).toContain("No update in over a shift");
    expect(out).toContain("NW-001");
  });

  it("stays quiet when there is nothing wrong", () => {
    const clean: ProjectLine = {
      ...base,
      loggedHours: 10,
      estimatedHours: 54,
      openBlockers: 0,
      overdueTasks: 0,
    };
    const out = renderDigest(digest({ projects: [clean] }));
    expect(out).not.toContain("Blocked and waiting");
    expect(out).not.toContain("Over estimate");
    expect(out).not.toContain("No update in over a shift");
  });

  it("handles having no active projects at all", () => {
    expect(renderDigest(digest({ projects: [] }))).toContain(
      "No active projects.",
    );
  });
});
