import { beforeEach, afterAll, describe, expect, it } from "vitest";
import {
  owner,
  resetDb,
  makeUser,
  makeProject,
  addMember,
  makeWorkLog,
  makeTask,
  setInvoicedThrough,
} from "./harness";
import { loadWorkGrid, monthBounds } from "@/server/grid-queries";
import type { Actor } from "@/lib/access";

const actorFor = (id: string, role: Actor["globalRole"] = "developer"): Actor => ({
  id,
  globalRole: role,
  accessExpiresAt: null,
});

beforeEach(resetDb);
afterAll(() => owner.end());

/** A project with two developers who have both logged in September. */
async function scenario() {
  const dev = await makeUser({ role: "developer", name: "Ahmed" });
  const other = await makeUser({ role: "developer", name: "Sara" });
  const projectId = await makeProject({ code: "ACME" });
  await addMember(projectId, dev, "developer");
  await addMember(projectId, other, "developer");

  const mine = await makeWorkLog({
    projectId,
    userId: dev,
    hours: "6.50",
    workDate: "2026-09-03",
  });
  const theirs = await makeWorkLog({
    projectId,
    userId: other,
    hours: "4.00",
    workDate: "2026-09-03",
  });
  return { dev, other, projectId, mine, theirs };
}

describe("monthBounds", () => {
  it("spans the month in UTC, end-exclusive", () => {
    const { start, next } = monthBounds("2026-09");
    expect(start.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(next.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("rolls the year over at December", () => {
    expect(monthBounds("2026-12").next.toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });

  it("refuses a month it cannot read", () => {
    expect(() => monthBounds("2026-13")).toThrow(/Pick a month/);
    expect(() => monthBounds("September")).toThrow(/Pick a month/);
  });
});

describe("loadWorkGrid", () => {
  it("returns the month's entries for the whole project to someone who sees everyone", async () => {
    const { projectId } = await scenario();
    const head = await makeUser({ role: "head" });

    const grid = await loadWorkGrid(actorFor(head, "head"), "head", {
      projectId,
      month: "2026-09",
    });

    expect(grid.rows).toHaveLength(2);
    expect(grid.rows.map((r) => r.personName).sort()).toEqual(["Ahmed", "Sara"]);
    expect(grid.totals).toEqual({
      totalHours: "10.50",
      daysLogged: 1,
      entries: 2,
    });
    expect(grid.monthLabel).toBe("September 2026");
  });

  it("shows a developer only their own rows, filter or no filter", async () => {
    const { dev, projectId } = await scenario();

    const grid = await loadWorkGrid(actorFor(dev), "developer", {
      projectId,
      month: "2026-09",
    });

    expect(grid.rows).toHaveLength(1);
    expect(grid.rows[0].personName).toBe("Ahmed");
    expect(grid.personId).toBe(dev);
    expect(grid.seesEveryone).toBe(false);
  });

  it("refuses a developer asking for somebody else by name", async () => {
    const { dev, other, projectId } = await scenario();

    await expect(
      loadWorkGrid(actorFor(dev), "developer", {
        projectId,
        personId: other,
        month: "2026-09",
      }),
    ).rejects.toThrow(/Missing capability: worklog\.viewAll/);
  });

  it("narrows to one person when asked by someone who may look", async () => {
    const { other, projectId } = await scenario();
    const head = await makeUser({ role: "head" });

    const grid = await loadWorkGrid(actorFor(head, "head"), "head", {
      projectId,
      personId: other,
      month: "2026-09",
    });

    expect(grid.rows.map((r) => r.personName)).toEqual(["Sara"]);
    expect(grid.totals.totalHours).toBe("4.00");
  });

  it("never returns a removed entry", async () => {
    const { dev, projectId, mine } = await scenario();
    await owner`UPDATE work_logs SET deleted_at = now() WHERE id = ${mine.id}`;

    const grid = await loadWorkGrid(actorFor(dev), "developer", {
      projectId,
      month: "2026-09",
    });

    expect(grid.rows).toHaveLength(0);
    expect(grid.totals.entries).toBe(0);
  });

  it("keeps months apart", async () => {
    const { dev, projectId } = await scenario();
    await makeWorkLog({
      projectId,
      userId: dev,
      hours: "1.00",
      workDate: "2026-08-31",
    });

    const sep = await loadWorkGrid(actorFor(dev), "developer", {
      projectId,
      month: "2026-09",
    });
    const aug = await loadWorkGrid(actorFor(dev), "developer", {
      projectId,
      month: "2026-08",
    });

    expect(sep.rows).toHaveLength(1);
    expect(aug.rows).toHaveLength(1);
    expect(aug.rows[0].workDate).toBe("2026-08-31");
    // Both months are offered as tabs, newest first, labelled like the sheet.
    expect(sep.months.map((m) => m.label)).toEqual([
      "September 2026",
      "August 2026",
    ]);
  });

  it("locks rows inside the invoiced period, for everyone", async () => {
    const { projectId } = await scenario();
    await setInvoicedThrough(projectId, "2026-09-30");
    const admin = await makeUser({ role: "admin" });

    const grid = await loadWorkGrid(actorFor(admin, "admin"), "admin", {
      projectId,
      month: "2026-09",
    });

    expect(grid.rows.every((r) => r.lock === "invoiced")).toBe(true);
    expect(grid.rows.every((r) => !r.editable)).toBe(true);
    expect(grid.monthLocked).toBe(true);
  });

  it("marks somebody else's row not-yours, and opens it for a head", async () => {
    const { projectId } = await scenario();
    const pm = await makeUser({ role: "head", name: "Lead" });
    const observer = await makeUser({ role: "admin", name: "Watcher" });

    const asHead = await loadWorkGrid(actorFor(pm, "head"), "head", {
      projectId,
      month: "2026-09",
    });
    expect(asHead.rows.every((r) => r.editable)).toBe(true);
    expect(asHead.canEditOthers).toBe(true);

    // An admin sees everyone too; the point is that the verdict is per row and
    // computed server-side, never inferred by the client from a user id.
    const asAdmin = await loadWorkGrid(actorFor(observer, "admin"), "admin", {
      projectId,
      month: "2026-09",
    });
    expect(asAdmin.rows.every((r) => r.lock === null)).toBe(true);
  });

  it("never leaks who logged what beyond the name it renders", async () => {
    const { projectId } = await scenario();
    const head = await makeUser({ role: "head" });

    const grid = await loadWorkGrid(actorFor(head, "head"), "head", {
      projectId,
      month: "2026-09",
    });

    for (const row of grid.rows) {
      expect(row).not.toHaveProperty("userId");
      // A verdict is sent instead, so the grid knows whose row it is without
      // being told who everybody is.
      expect(typeof row.isMine).toBe("boolean");
    }
    const head2 = grid.rows.filter((r) => r.isMine);
    expect(head2).toHaveLength(0);
  });

  it("marks entries a timer produced", async () => {
    const { dev, projectId, mine } = await scenario();
    const taskId = await makeTask({ projectId, assigneeId: dev });
    await owner`
      INSERT INTO time_sessions (task_id, project_id, user_id, status, work_log_id)
      VALUES (${taskId}, ${projectId}, ${dev}, 'completed', ${mine.id})`;

    const grid = await loadWorkGrid(actorFor(dev), "developer", {
      projectId,
      month: "2026-09",
    });

    expect(grid.rows[0].fromTimer).toBe(true);
  });

  it("counts an entry once even when two sessions claim it", async () => {
    // adjustTimer can resurrect a completed session, which then finishes again
    // and produces a second row. A join would double the entry; EXISTS does not.
    const { dev, projectId, mine } = await scenario();
    const taskId = await makeTask({ projectId, assigneeId: dev });
    for (let i = 0; i < 2; i++) {
      await owner`
        INSERT INTO time_sessions (task_id, project_id, user_id, status, work_log_id)
        VALUES (${taskId}, ${projectId}, ${dev}, 'completed', ${mine.id})`;
    }

    const grid = await loadWorkGrid(actorFor(dev), "developer", {
      projectId,
      month: "2026-09",
    });

    expect(grid.rows).toHaveLength(1);
    expect(grid.totals.totalHours).toBe("6.50");
  });

  it("refuses a project the actor cannot reach, before reading any row", async () => {
    const outsider = await makeUser({ role: "developer" });
    const { projectId } = await scenario();

    await expect(
      loadWorkGrid(actorFor(outsider), "developer", {
        projectId,
        month: "2026-09",
      }),
    ).rejects.toThrow();
  });

  it("offers anyone with entries in the filter, not just members", async () => {
    // A PM or admin can log against a project without a project_members row.
    // A filter that cannot select somebody whose rows are on screen is broken.
    const { projectId } = await scenario();
    const lead = await makeUser({ role: "head", name: "Zoe Lead" });
    await makeWorkLog({
      projectId,
      userId: lead,
      hours: "1.00",
      workDate: "2026-09-04",
    });

    const grid = await loadWorkGrid(actorFor(lead, "head"), "head", {
      projectId,
      month: "2026-09",
    });

    expect(grid.people.map((p) => p.name).sort()).toEqual([
      "Ahmed",
      "Sara",
      "Zoe Lead",
    ]);
  });

  it("offers open tasks and hides finished ones", async () => {
    const { dev, projectId } = await scenario();
    await makeTask({ projectId, title: "Open one" });
    await makeTask({ projectId, title: "Finished", status: "done" });

    const grid = await loadWorkGrid(actorFor(dev), "developer", {
      projectId,
      month: "2026-09",
    });

    expect(grid.assignableTasks.map((t) => t.title)).toEqual(["Open one"]);
  });
});
