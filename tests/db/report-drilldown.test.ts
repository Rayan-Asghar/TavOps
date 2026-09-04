import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { timesheet } from "@/server/reports";
import { uncostedWorkLogIds } from "@/server/margin-queries";
import { makeProject, makeRate, makeUser, makeWorkLog, owner, resetDb } from "./harness";

/**
 * The reconciliation strip's drill-downs.
 *
 * Every cell is a link, and a link that returns the wrong rows is worse than a
 * figure with no link at all — it looks like the figure is wrong. Two of these
 * failure modes are silent, which is why they are pinned here.
 */

beforeEach(resetDb);
afterAll(async () => {
  await owner.end();
});

const range = {
  from: new Date("2026-09-01T00:00:00Z"),
  to: new Date("2026-09-30T00:00:00Z"),
};

describe("the billable drill-down", () => {
  it("returns each half, and the halves add up to the whole", async () => {
    const projectId = await makeProject({});
    const userId = await makeUser({});
    await makeWorkLog({ projectId, userId, hours: "3.00", workDate: "2026-09-10" });
    await makeWorkLog({
      projectId,
      userId,
      hours: "1.50",
      workDate: "2026-09-11",
      billable: false,
    });

    const all = await timesheet(range, null, {});
    const yes = await timesheet(range, null, { billable: true });
    const no = await timesheet(range, null, { billable: false });

    expect(all).toHaveLength(2);
    expect(yes).toHaveLength(1);
    expect(no).toHaveLength(1);
    expect(yes.length + no.length).toBe(all.length);
    expect(no[0].hours).toBe(1.5);
    expect(no[0].billable).toBe(false);
  });

  it("treats an absent filter as BOTH, not as false", async () => {
    const projectId = await makeProject({});
    const userId = await makeUser({});
    await makeWorkLog({ projectId, userId, workDate: "2026-09-10" });

    expect(await timesheet(range, null, {})).toHaveLength(1);
  });
});

describe("the not-costed drill-down", () => {
  it("returns an empty result, NOT the whole table, when nothing matches", async () => {
    // The failure this pins: `inArray(id, [])` compiles to `IN ()`, which
    // matches every row. An empty drill-down would then show the full
    // timesheet — the exact opposite of what the link promised.
    const projectId = await makeProject({});
    const userId = await makeUser({});
    await makeWorkLog({ projectId, userId, workDate: "2026-09-10" });
    await makeWorkLog({ projectId, userId, workDate: "2026-09-11" });

    expect(await timesheet(range, null, { workLogIds: [] })).toEqual([]);
  });

  it("finds entries with no rate, and drops them once one exists", async () => {
    const projectId = await makeProject({});
    const userId = await makeUser({});
    await makeWorkLog({ projectId, userId, workDate: "2026-09-10" });

    // No rate yet: the entry is costed `unrated`, so it counts as not costed.
    const before = await uncostedWorkLogIds(range, null, "admin");
    expect(before).toHaveLength(1);

    const rows = await timesheet(range, null, { workLogIds: before });
    expect(rows).toHaveLength(1);
  });

  it("returns nothing to a role that cannot see finance", async () => {
    const projectId = await makeProject({});
    const userId = await makeUser({});
    await makeRate(userId, "10.00");
    await makeWorkLog({ projectId, userId, workDate: "2026-09-10" });

    expect(await uncostedWorkLogIds(range, null, "developer")).toEqual([]);
  });

  it("returns nothing for an empty scope rather than everything", async () => {
    const projectId = await makeProject({});
    const userId = await makeUser({});
    await makeWorkLog({ projectId, userId, workDate: "2026-09-10" });

    expect(await uncostedWorkLogIds(range, [], "admin")).toEqual([]);
  });
});
