import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { accessibleProjectIds, canAccessProject } from "@/lib/access";
import { can } from "@/lib/rbac";
import { windowMargin } from "@/server/margin-queries";
import { blockersAssignedTo, pendingHandoffCount } from "@/server/proposal-queries";
import {
  addMember,
  makeFinancials,
  makeProject,
  makeUser,
  owner,
  resetDb,
} from "./harness";

/**
 * What a sales rep can and cannot see after the win.
 *
 * The owner's rule was "visibility, not ownership", and most of this file is
 * proving the second half. These are the assertions that would fail quietly if
 * somebody later granted `finance.view` to `sales` for convenience, or widened
 * a query's scope while chasing a different bug.
 */

let rep: string;
let otherRep: string;
let head: string;

const RANGE = {
  from: new Date(Date.now() - 30 * 86_400_000),
  to: new Date(),
};

beforeEach(async () => {
  await resetDb();
  rep = await makeUser({ role: "sales", name: "Rep" });
  otherRep = await makeUser({ role: "sales", name: "Other rep" });
  head = await makeUser({ role: "head", name: "Head" });
});

afterAll(async () => {
  await owner.end({ timeout: 5 });
});

const actorFor = (id: string) => ({
  id,
  globalRole: "sales" as const,
  name: "Rep",
  email: `${id}@example.test`,
});

describe("what a rep can reach", () => {
  it("sees the projects they sold and nothing else", async () => {
    const mine = await makeProject({ code: "MINE", salesOwnerId: rep });
    const theirs = await makeProject({ code: "THEIRS", salesOwnerId: otherRep });

    const scope = await accessibleProjectIds(actorFor(rep));
    expect(scope).not.toBeNull();
    expect(scope).toContain(mine);
    expect(scope).not.toContain(theirs);

    expect(await canAccessProject(actorFor(rep), mine)).toBe(true);
    expect(await canAccessProject(actorFor(rep), theirs)).toBe(false);
  });

  it("does not become org-wide by holding a sales role", async () => {
    // `scope === null` is the org-wide answer. A rep must never get it.
    await makeProject({ code: "A", salesOwnerId: rep });
    expect(await accessibleProjectIds(actorFor(rep))).not.toBeNull();
  });
});

describe("what stays withheld", () => {
  it("gives a rep no money, even on the project they sold", async () => {
    const mine = await makeProject({ code: "MINE", salesOwnerId: rep });
    await makeFinancials(mine, "25000.00");

    // Two locks, and the test asserts the outer one. The RLS backstop is the
    // inner one and has its own file.
    const margin = await windowMargin(RANGE, [mine], "sales");
    expect(margin).toBeNull();
    // The head on the same project does get it, so this is the capability
    // talking and not an empty database.
    expect(await windowMargin(RANGE, [mine], "head")).not.toBeNull();
  });

  it("keeps the capabilities that would turn visibility into ownership off", async () => {
    for (const cap of [
      "finance.view",
      "rates.view",
      "project.create",
      "project.edit",
      "project.viewAll",
      "worklog.create",
      "user.manage",
    ] as const) {
      expect(can("sales", cap), cap).toBe(false);
    }
  });

  it("counts only the rep's own handoff backlog", async () => {
    for (const [ownerId, n] of [
      [rep, 2],
      [otherRep, 3],
    ] as const) {
      for (let i = 0; i < n; i++) {
        await owner`
          INSERT INTO proposals (id, owner_id, job_title, status, sent_at, decided_at)
          VALUES (${randomUUID()}, ${ownerId}, 'Won job', 'won', now(), now())`;
      }
    }
    expect(await pendingHandoffCount(rep, false)).toBe(2);
    // A head sees the whole backlog, because converting it is their job.
    expect(await pendingHandoffCount(head, true)).toBe(5);
  });
});

describe("blockers routed to the deal owner", () => {
  it("shows a rep what was put in their hands, and nobody else's", async () => {
    const mine = await makeProject({ code: "MINE", salesOwnerId: rep });
    await addMember(mine, rep, "sales_owner");

    const make = (assignee: string, description: string) => owner`
      INSERT INTO blockers (id, project_id, reported_by_id, assigned_to_id,
                            category, owner_side, description, severity, status)
      VALUES (${randomUUID()}, ${mine}, ${head}, ${assignee},
              'waiting_on_client', 'client', ${description}, 'normal', 'open')`;

    await make(rep, "Client has gone quiet on the brief");
    await make(otherRep, "Not this rep's problem");

    const mineRows = await blockersAssignedTo(rep);
    expect(mineRows).toHaveLength(1);
    expect(mineRows[0].description).toBe("Client has gone quiet on the brief");
    expect(mineRows[0].projectCode).toBe("MINE");
  });

  it("drops a blocker once it is resolved", async () => {
    const mine = await makeProject({ code: "MINE", salesOwnerId: rep });
    await owner`
      INSERT INTO blockers (id, project_id, reported_by_id, assigned_to_id,
                            category, owner_side, description, severity, status)
      VALUES (${randomUUID()}, ${mine}, ${head}, ${rep},
              'waiting_on_client', 'client', 'Answered already', 'normal', 'resolved')`;
    expect(await blockersAssignedTo(rep)).toHaveLength(0);
  });
});
