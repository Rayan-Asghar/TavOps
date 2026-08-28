import { describe, expect, it } from "vitest";
import {
  assertCan,
  can,
  canInProject,
  CAPABILITIES,
  ForbiddenError,
  seesAllProjects,
} from "./rbac";

describe("global role capabilities", () => {
  it("gives admin everything", () => {
    for (const cap of CAPABILITIES) expect(can("admin", cap)).toBe(true);
  });

  it("keeps pay data admin-only", () => {
    // Deliberate: the heads are partners and may well want this, but pay data
    // is not granted by inference. If this flips it must be a decision.
    expect(can("admin", "rates.view")).toBe(true);
    expect(can("head", "rates.view")).toBe(false);
    expect(can("sales", "rates.view")).toBe(false);
    expect(can("developer", "rates.view")).toBe(false);
    expect(can("collaborator", "rates.view")).toBe(false);
  });

  it("lets heads see project money but not pay rates", () => {
    expect(can("head", "finance.view")).toBe(true);
    expect(can("head", "rates.view")).toBe(false);
  });

  it("hides other people's timesheets from everyone below head", () => {
    expect(can("admin", "worklog.viewAll")).toBe(true);
    expect(can("head", "worklog.viewAll")).toBe(true);
    expect(can("sales", "worklog.viewAll")).toBe(false);
    expect(can("developer", "worklog.viewAll")).toBe(false);
    expect(can("collaborator", "worklog.viewAll")).toBe(false);
  });

  it("hides the client-facing deadline from delivery staff", () => {
    // The internal date is the buffer; anyone who can see both knows the real
    // deadline is the later one.
    expect(can("developer", "deadline.viewClient")).toBe(false);
    expect(can("collaborator", "deadline.viewClient")).toBe(false);
    expect(can("sales", "deadline.viewClient")).toBe(true);
    expect(can("head", "deadline.viewClient")).toBe(true);
  });

  it("keeps user management away from non-admins", () => {
    expect(can("head", "user.manage")).toBe(false);
    expect(can("developer", "user.manage")).toBe(false);
  });

  it("lets every working role log work and raise a blocker", () => {
    for (const role of ["head", "sales", "developer", "collaborator"] as const) {
      expect(can(role, "worklog.create")).toBe(true);
      expect(can(role, "blocker.create")).toBe(true);
    }
  });

  it("does not let a collaborator edit tasks", () => {
    expect(can("developer", "task.edit")).toBe(true);
    expect(can("collaborator", "task.edit")).toBe(false);
  });
});

describe("canInProject", () => {
  it("grants via the project role when the global role lacks it", () => {
    // The point of the whole mechanism: a plain developer who is PM on one
    // project manages sheets on that project and nowhere else.
    expect(can("developer", "sheets.client.manage")).toBe(false);
    expect(canInProject("developer", "pm", "sheets.client.manage")).toBe(true);
    expect(canInProject("developer", "tech_lead", "sheet.configure")).toBe(true);
  });

  it("does not leak that grant to other project roles", () => {
    expect(canInProject("developer", "developer", "sheet.configure")).toBe(false);
    expect(canInProject("developer", "qa", "sheet.configure")).toBe(false);
    expect(canInProject("developer", "observer", "sheet.configure")).toBe(false);
  });

  it("lets the global role win when it already suffices", () => {
    expect(canInProject("admin", null, "rates.view")).toBe(true);
    expect(canInProject("head", "observer", "project.viewAll")).toBe(true);
  });

  it("falls back to the global answer with no project role", () => {
    expect(canInProject("developer", null, "sheet.configure")).toBe(false);
    expect(canInProject("developer", null, "worklog.create")).toBe(true);
  });

  it("never grants pay data through a project role", () => {
    // rates.view is not in any PROJECT_ROLE_CAPABILITIES list, and must not be.
    for (const r of ["pm", "tech_lead", "sales_owner", "qa", "developer", "observer"] as const) {
      expect(canInProject("developer", r, "rates.view")).toBe(false);
      expect(canInProject("head", r, "rates.view")).toBe(false);
    }
  });

  it("gives a sales owner the client deadline but not sheet control", () => {
    expect(canInProject("developer", "sales_owner", "deadline.viewClient")).toBe(true);
    expect(canInProject("developer", "sales_owner", "sheet.configure")).toBe(false);
  });
});

describe("seesAllProjects", () => {
  it("is limited to admin and head", () => {
    expect(seesAllProjects("admin")).toBe(true);
    expect(seesAllProjects("head")).toBe(true);
    expect(seesAllProjects("sales")).toBe(false);
    expect(seesAllProjects("developer")).toBe(false);
    expect(seesAllProjects("collaborator")).toBe(false);
  });
});

describe("assertCan", () => {
  it("throws ForbiddenError naming the capability", () => {
    expect(() => assertCan("developer", "user.manage")).toThrow(ForbiddenError);
    expect(() => assertCan("developer", "user.manage")).toThrow("user.manage");
  });

  it("is silent when the capability is held", () => {
    expect(() => assertCan("admin", "user.manage")).not.toThrow();
  });
});
