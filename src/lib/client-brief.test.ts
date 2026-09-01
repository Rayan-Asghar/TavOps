import { describe, expect, it } from "vitest";
import { renderClientBrief, type ClientBrief } from "@/lib/client-brief";

const NOW = new Date("2026-09-01T10:00:00Z");

const brief = (over: Partial<ClientBrief> = {}): ClientBrief => ({
  code: "NW-014",
  name: "Northwind Shopify build",
  clientName: "Northwind Trading",
  tasksDone: 12,
  tasksTotal: 18,
  tasksInReview: 2,
  clientDueDate: new Date("2026-09-14T00:00:00Z"),
  waitingOnClient: [],
  lastMovementAt: new Date("2026-08-30T09:00:00Z"),
  ...over,
});

describe("renderClientBrief", () => {
  it("leads with the project and the client, so a pasted brief identifies itself", () => {
    const out = renderClientBrief(brief(), NOW);
    expect(out.startsWith("NW-014 — Northwind Shopify build")).toBe(true);
    expect(out).toContain("Client: Northwind Trading");
  });

  it("states progress as a count and a percentage", () => {
    expect(renderClientBrief(brief(), NOW)).toContain(
      "Progress: 12 of 18 items done (67%)",
    );
  });

  it("does not report an unplanned project as 0% done", () => {
    const out = renderClientBrief(
      brief({ tasksDone: 0, tasksTotal: 0, tasksInReview: 0 }),
      NOW,
    );
    expect(out).toContain("not broken into items yet");
    expect(out).not.toContain("0%");
  });

  it("omits the review line when nothing is in review", () => {
    expect(renderClientBrief(brief({ tasksInReview: 0 }), NOW)).not.toContain(
      "In review",
    );
  });

  it("ages the last movement in days rather than printing a raw date", () => {
    expect(renderClientBrief(brief(), NOW)).toContain("Last movement: 2 days ago");
  });

  it("says today and yesterday rather than 0 and 1 days ago", () => {
    const today = renderClientBrief(
      brief({ lastMovementAt: new Date("2026-09-01T08:00:00Z") }),
      NOW,
    );
    const yesterday = renderClientBrief(
      brief({ lastMovementAt: new Date("2026-08-31T08:00:00Z") }),
      NOW,
    );
    expect(today).toContain("Last movement: today");
    expect(yesterday).toContain("Last movement: yesterday");
  });

  it("distinguishes a project with no logged work from a stale one", () => {
    expect(renderClientBrief(brief({ lastMovementAt: null }), NOW)).toContain(
      "nothing logged yet",
    );
  });

  it("lists what the client is holding up, since that is the point of the call", () => {
    const out = renderClientBrief(
      brief({
        waitingOnClient: ["Klaviyo account access", "Final homepage copy"],
      }),
      NOW,
    );
    expect(out).toContain("Waiting on the client:");
    expect(out).toContain("- Klaviyo account access");
    expect(out).toContain("- Final homepage copy");
  });

  it("omits the waiting section entirely when the ball is with us", () => {
    expect(renderClientBrief(brief(), NOW)).not.toContain("Waiting on the client");
  });

  it("carries the client date and never an internal one", () => {
    // The brief type has no internal-deadline field at all; this asserts the
    // date that IS carried is the client-facing one it was given.
    expect(renderClientBrief(brief(), NOW)).toContain("Target date: 2026-09-14");
  });

  it("renders a client-less project without printing an empty client line", () => {
    const out = renderClientBrief(brief({ clientName: null }), NOW);
    expect(out).not.toContain("Client:");
    expect(out).toContain("Progress:");
  });

  /**
   * The guard the whole design rests on. A rep pastes this verbatim, so the
   * renderer must be incapable of emitting anything internal — hours, work-log
   * notes, author names or money. Those fields are absent from ClientBrief by
   * construction; this fails loudly if someone adds one back.
   */
  it("cannot leak internal vocabulary into a brief meant for a client", () => {
    const out = renderClientBrief(
      brief({ waitingOnClient: ["Staging credentials"] }),
      NOW,
    ).toLowerCase();
    for (const banned of [
      "hour",
      "internal",
      "logged by",
      "estimate",
      "budget",
      "margin",
      "$",
    ]) {
      expect(out).not.toContain(banned);
    }
  });
});
