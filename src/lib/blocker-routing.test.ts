import { describe, expect, it } from "vitest";
import {
  CATEGORY_LABELS,
  resolveBlockerRouting,
  type BlockerCategory,
  type RoutingContext,
} from "./blocker-routing";

const REPORTER = "u-reporter";
const PM = "u-pm";
const LEAD = "u-lead";
const SALES = "u-sales";
const TECH = "u-tech";
const OTHER_DEV = "u-otherdev";

/** A fully-staffed project: every owner named, no project-role overrides. */
function ctx(over: Partial<RoutingContext> = {}): RoutingContext {
  return {
    category: "other",
    severity: "normal",
    reporterId: REPORTER,
    project: { pmId: PM, deliveryLeadId: LEAD, salesOwnerId: SALES },
    projectRoles: {},
    ...over,
  };
}

const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS) as BlockerCategory[];

describe("every category routes somewhere", () => {
  it("never leaves a blocker unassigned on a staffed project", () => {
    for (const category of ALL_CATEGORIES) {
      const r = resolveBlockerRouting(ctx({ category }));
      expect(r.assigneeId, category).toBeTruthy();
    }
  });

  it("has a label for every category", () => {
    for (const category of ALL_CATEGORIES) {
      expect(CATEGORY_LABELS[category], category).toBeTruthy();
    }
  });
});

describe("who owns what", () => {
  it("sends client dependencies to the sales owner", () => {
    for (const category of [
      "missing_access",
      "missing_asset",
      "client_approval",
      "waiting_on_client",
    ] as BlockerCategory[]) {
      const r = resolveBlockerRouting(ctx({ category }));
      expect(r.assigneeId, category).toBe(SALES);
    }
  });

  it("sends a sales overpromise to the deal owner, not the lead", () => {
    // It is our fault, not the client's — but the rep is the one who answers.
    const r = resolveBlockerRouting(ctx({ category: "commercial_scope" }));
    expect(r.assigneeId).toBe(SALES);
    expect(r.ownerSide).toBe("internal");
  });

  it("sends scope and requirement questions to the PM", () => {
    for (const category of [
      "unclear_requirement",
      "scope_conflict",
      "needs_decision",
    ] as BlockerCategory[]) {
      const r = resolveBlockerRouting(ctx({ category }));
      expect(r.assigneeId, category).toBe(PM);
    }
  });

  it("sends build-and-fix work to the delivery lead", () => {
    for (const category of [
      "technical",
      "qa_issue",
      "production_incident",
      "other",
    ] as BlockerCategory[]) {
      const r = resolveBlockerRouting(ctx({ category }));
      expect(r.assigneeId, category).toBe(LEAD);
    }
  });

  it("sends a dependency straight to the developer being waited on", () => {
    const r = resolveBlockerRouting(
      ctx({ category: "dependency_dev", blockedOnUserId: OTHER_DEV }),
    );
    expect(r.assigneeId).toBe(OTHER_DEV);
    expect(r.rule).toBe("dependency_dev");
  });

  it("falls back to the delivery lead when no developer is named", () => {
    const r = resolveBlockerRouting(ctx({ category: "dependency_dev" }));
    expect(r.assigneeId).toBe(LEAD);
  });
});

describe("a project role beats the project default", () => {
  it("routes technical work to the project's own tech lead", () => {
    const r = resolveBlockerRouting(
      ctx({ category: "technical", projectRoles: { tech_lead: TECH } }),
    );
    expect(r.assigneeId).toBe(TECH);
  });

  it("routes client work to the project's own sales owner", () => {
    const r = resolveBlockerRouting(
      ctx({ category: "missing_access", projectRoles: { sales_owner: "u-rep2" } }),
    );
    expect(r.assigneeId).toBe("u-rep2");
  });
});

describe("fallback when the project is thinly staffed", () => {
  it("uses the PM when there is no sales owner", () => {
    const r = resolveBlockerRouting(
      ctx({
        category: "missing_access",
        project: { pmId: PM, deliveryLeadId: LEAD, salesOwnerId: null },
      }),
    );
    expect(r.assigneeId).toBe(PM);
  });

  it("uses the PM when there is no delivery lead", () => {
    const r = resolveBlockerRouting(
      ctx({
        category: "technical",
        project: { pmId: PM, deliveryLeadId: null, salesOwnerId: SALES },
      }),
    );
    expect(r.assigneeId).toBe(PM);
  });

  it("returns null rather than guessing on an unstaffed project", () => {
    const r = resolveBlockerRouting(
      ctx({
        category: "technical",
        project: { pmId: null, deliveryLeadId: null, salesOwnerId: null },
      }),
    );
    expect(r.assigneeId).toBeNull();
    expect(r.watcherIds).toEqual([]);
  });
});

describe("watchers", () => {
  it("copies exactly one person, never a crowd", () => {
    for (const category of ALL_CATEGORIES) {
      const r = resolveBlockerRouting(ctx({ category }));
      expect(r.watcherIds.length, category).toBeLessThanOrEqual(1);
    }
  });

  it("copies the PM on delivery work", () => {
    const r = resolveBlockerRouting(ctx({ category: "technical" }));
    expect(r.watcherIds).toEqual([PM]);
  });

  it("copies the delivery lead when the PM is already the assignee", () => {
    // Otherwise a PM-owned blocker would have nobody watching it at all.
    const r = resolveBlockerRouting(ctx({ category: "needs_decision" }));
    expect(r.assigneeId).toBe(PM);
    expect(r.watcherIds).toEqual([LEAD]);
  });

  it("never copies the assignee to themselves", () => {
    for (const category of ALL_CATEGORIES) {
      const r = resolveBlockerRouting(ctx({ category }));
      expect(r.watcherIds, category).not.toContain(r.assigneeId);
    }
  });

  it("never tells the reporter about their own report", () => {
    // The reporter is the PM here; they should not be copied on their own item.
    const r = resolveBlockerRouting(
      ctx({ category: "technical", reporterId: PM }),
    );
    expect(r.watcherIds).not.toContain(PM);
  });
});

describe("the clock", () => {
  it("marks only genuine client dependencies as client-owned", () => {
    const clientOwned = ALL_CATEGORIES.filter(
      (c) => resolveBlockerRouting(ctx({ category: c })).ownerSide === "client",
    );
    expect(clientOwned.sort()).toEqual(
      ["client_approval", "missing_access", "missing_asset", "waiting_on_client"].sort(),
    );
  });

  it("gives a faster window to a more severe blocker", () => {
    const hours = (severity: RoutingContext["severity"]) =>
      resolveBlockerRouting(ctx({ category: "technical", severity })).slaHours;

    expect(hours("critical")).toBeLessThan(hours("high"));
    expect(hours("high")).toBeLessThan(hours("normal"));
    expect(hours("normal")).toBeLessThan(hours("low"));
  });

  it("forces a production incident to critical whatever was ticked", () => {
    const r = resolveBlockerRouting(
      ctx({ category: "production_incident", severity: "low" }),
    );
    expect(r.slaHours).toBe(
      resolveBlockerRouting(ctx({ category: "technical", severity: "critical" }))
        .slaHours,
    );
  });
});

describe("the explanation", () => {
  it("is always present, so routing is never a black box", () => {
    for (const category of ALL_CATEGORIES) {
      expect(
        resolveBlockerRouting(ctx({ category })).explanation.length,
        category,
      ).toBeGreaterThan(0);
    }
  });
});
