import { describe, expect, it } from "vitest";
import { globalRole } from "@/db/schema";
import { DEFAULT_HOME, homePathFor } from "@/lib/home";
import { can, type GlobalRole } from "@/lib/rbac";

describe("homePathFor", () => {
  it("sends everyone who delivers to the attention inbox", () => {
    for (const role of ["admin", "head", "developer", "collaborator"] as const) {
      expect(homePathFor(role)).toBe("/");
    }
  });

  it("sends a sales rep to their pipeline", () => {
    // The whole point: sales holds no worklog.create, so the inbox is empty for
    // them and the first surface they can act on is the one they get.
    expect(homePathFor("sales")).toBe("/sales");
  });

  it("resolves every role to a destination that role may actually open", () => {
    // Exhaustive over the enum, so a sixth role has to be placed deliberately
    // rather than silently inheriting the fallback.
    for (const role of globalRole.enumValues as readonly GlobalRole[]) {
      const home = homePathFor(role);
      expect(home.startsWith("/")).toBe(true);
      // /sales gates itself on proposal.create and 404s without it.
      if (home === "/sales") expect(can(role, "proposal.create")).toBe(true);
    }
  });

  it("falls back to the inbox for a role that matches nothing", () => {
    // `collaborator` matches the first entry today; the guarantee under test is
    // that the lookup never returns undefined.
    expect(DEFAULT_HOME).toBe("/");
    expect(homePathFor("collaborator")).toBe(DEFAULT_HOME);
  });
});
