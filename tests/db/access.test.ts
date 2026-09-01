import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  canAccessProject,
  accessibleProjectIds,
  isActorExpired,
  type Actor,
} from "@/lib/access";
import {
  addMember,
  makeProject,
  makeUser,
  owner,
  resetDb,
} from "./harness";

/**
 * Project scoping, against a real database.
 *
 * This is the check that stops someone editing /projects/12 to /projects/13 and
 * reading another team's work. It is a SQL predicate over three ownership
 * columns and an expiry-aware membership join, so a mocked client would only
 * prove the mock works. These are the cases the predicate has to get right.
 */

const yesterday = new Date(Date.now() - 86_400_000);
const tomorrow = new Date(Date.now() + 86_400_000);

const actorFor = (
  id: string,
  role: Actor["globalRole"] = "developer",
  accessExpiresAt: Date | null = null,
): Actor => ({ id, globalRole: role, accessExpiresAt });

beforeEach(resetDb);
afterAll(async () => {
  await owner.end();
});

describe("canAccessProject", () => {
  it("lets an admin and a head reach a project they have no link to", async () => {
    const stranger = await makeUser({ role: "admin" });
    const head = await makeUser({ role: "head" });
    const projectId = await makeProject({});

    expect(await canAccessProject(actorFor(stranger, "admin"), projectId)).toBe(true);
    expect(await canAccessProject(actorFor(head, "head"), projectId)).toBe(true);
  });

  it("refuses a developer with no membership and no ownership", async () => {
    const dev = await makeUser({});
    const projectId = await makeProject({});
    expect(await canAccessProject(actorFor(dev), projectId)).toBe(false);
  });

  it("allows each of the three ownership columns", async () => {
    for (const column of ["pmId", "deliveryLeadId", "salesOwnerId"] as const) {
      const dev = await makeUser({});
      const projectId = await makeProject({ [column]: dev });
      expect(await canAccessProject(actorFor(dev), projectId)).toBe(true);
    }
  });

  it("allows a plain member", async () => {
    const dev = await makeUser({});
    const projectId = await makeProject({});
    await addMember(projectId, dev);
    expect(await canAccessProject(actorFor(dev), projectId)).toBe(true);
  });

  it("treats a membership that has already expired as no membership", async () => {
    const dev = await makeUser({});
    const projectId = await makeProject({});
    await addMember(projectId, dev, "developer", yesterday);
    expect(await canAccessProject(actorFor(dev), projectId)).toBe(false);
  });

  it("honours a membership that expires in the future", async () => {
    const dev = await makeUser({});
    const projectId = await makeProject({});
    await addMember(projectId, dev, "developer", tomorrow);
    expect(await canAccessProject(actorFor(dev), projectId)).toBe(true);
  });

  it("locks out a collaborator whose own access has lapsed, membership or not", async () => {
    const temp = await makeUser({ role: "collaborator" });
    const projectId = await makeProject({});
    await addMember(projectId, temp);
    expect(
      await canAccessProject(actorFor(temp, "collaborator", yesterday), projectId),
    ).toBe(false);
  });

  it("locks out an expired actor even when they are a head", async () => {
    // Expiry is checked before the role shortcut; otherwise a lapsed
    // contractor promoted to head would keep org-wide reach forever.
    const head = await makeUser({ role: "head" });
    const projectId = await makeProject({});
    expect(
      await canAccessProject(actorFor(head, "head", yesterday), projectId),
    ).toBe(false);
  });

  it("does not leak access between two unrelated projects", async () => {
    const dev = await makeUser({});
    const mine = await makeProject({});
    const theirs = await makeProject({});
    await addMember(mine, dev);
    expect(await canAccessProject(actorFor(dev), mine)).toBe(true);
    expect(await canAccessProject(actorFor(dev), theirs)).toBe(false);
  });
});

describe("accessibleProjectIds", () => {
  it("returns null — meaning unrestricted — for org-wide roles", async () => {
    const admin = await makeUser({ role: "admin" });
    await makeProject({});
    expect(await accessibleProjectIds(actorFor(admin, "admin"))).toBeNull();
  });

  it("returns exactly the owned and member projects, and no others", async () => {
    const dev = await makeUser({});
    const owned = await makeProject({ pmId: dev });
    const member = await makeProject({});
    const unrelated = await makeProject({});
    await addMember(member, dev);

    const ids = await accessibleProjectIds(actorFor(dev));
    expect(ids).not.toBeNull();
    expect(new Set(ids)).toEqual(new Set([owned, member]));
    expect(ids).not.toContain(unrelated);
  });

  it("de-duplicates a project that is both owned and joined", async () => {
    const dev = await makeUser({});
    const projectId = await makeProject({ pmId: dev });
    await addMember(projectId, dev, "pm");
    expect(await accessibleProjectIds(actorFor(dev))).toEqual([projectId]);
  });

  it("returns an empty list, not null, for an expired actor", async () => {
    // The difference matters: null means "no restriction" downstream, so
    // returning it here would hand a lapsed account every project.
    const dev = await makeUser({});
    const projectId = await makeProject({ pmId: dev });
    await addMember(projectId, dev);
    expect(await accessibleProjectIds(actorFor(dev, "developer", yesterday))).toEqual([]);
  });

  it("excludes a project whose membership has lapsed", async () => {
    const dev = await makeUser({});
    const projectId = await makeProject({});
    await addMember(projectId, dev, "developer", yesterday);
    expect(await accessibleProjectIds(actorFor(dev))).toEqual([]);
  });
});

describe("isActorExpired", () => {
  it("is false when no expiry is set", () => {
    expect(isActorExpired(actorFor("x"))).toBe(false);
  });

  it("is true at the moment of expiry, not only after it", () => {
    const now = new Date();
    expect(isActorExpired(actorFor("x", "developer", now), now)).toBe(true);
  });
});
