import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { makeUser, owner, resetDb } from "./harness";

/**
 * Revoking a session before its token expires.
 *
 * A JWT is believed for twelve hours, so deactivating somebody used to take
 * effect whenever their token happened to lapse. What is tested here is that
 * the version bump actually happens on the paths that matter — the pure
 * comparison has its own unit tests.
 */

const state = vi.hoisted(() => ({
  actor: null as
    | { id: string; globalRole: string; sessionVersion?: number }
    | null,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
// A plain factory, not `importActual`: the real module reaches next-auth,
// which reaches `next/server`, which does not load in a fixture test. The
// error class is restated here because `authz.ts` imports it.
vi.mock("@/lib/auth", () => ({
  getActor: async () => state.actor,
  requireActor: async () => {
    if (!state.actor) throw new Error("Not signed in.");
    return state.actor;
  },
  UnauthenticatedError: class extends Error {},
}));

const { setUserActiveAction, resetPasswordAction } = await import(
  "@/server/user-actions"
);
const { loadPageActor } = await import("@/lib/authz");

beforeEach(async () => {
  await resetDb();
  state.actor = null;
});
afterAll(async () => {
  await owner.end();
});

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function versionOf(userId: string) {
  const [row] = await db
    .select({ v: users.sessionVersion })
    .from(users)
    .where(eq(users.id, userId));
  return row.v;
}

describe("the version bumps where it must", () => {
  it("bumps on deactivation", async () => {
    const admin = await makeUser({ role: "admin" });
    const target = await makeUser({});
    state.actor = { id: admin, globalRole: "admin" };

    const before = await versionOf(target);
    await setUserActiveAction({}, form({ userId: target, active: "false" }));

    expect(await versionOf(target)).toBe(before + 1);
  });

  it("bumps on REACTIVATION too", async () => {
    // The version is a revocation counter, not a state flag. Skipping this
    // would let a token minted before the deactivation work again after.
    const admin = await makeUser({ role: "admin" });
    const target = await makeUser({});
    state.actor = { id: admin, globalRole: "admin" };

    await setUserActiveAction({}, form({ userId: target, active: "false" }));
    const afterOff = await versionOf(target);
    await setUserActiveAction({}, form({ userId: target, active: "true" }));

    expect(await versionOf(target)).toBe(afterOff + 1);
  });

  it("bumps on a password reset", async () => {
    // A reset exists because somebody lost control of the old password;
    // leaving their sessions alive would defeat it.
    const admin = await makeUser({ role: "admin" });
    const target = await makeUser({});
    state.actor = { id: admin, globalRole: "admin" };

    const before = await versionOf(target);
    await resetPasswordAction({}, form({ userId: target }));

    expect(await versionOf(target)).toBe(before + 1);
  });
});

describe("loadPageActor honours the verdict", () => {
  it("returns the actor while the session is current", async () => {
    const userId = await makeUser({ role: "developer" });
    state.actor = { id: userId, globalRole: "developer", sessionVersion: 1 };

    expect(await loadPageActor()).toMatchObject({ id: userId });
  });

  it("returns null once the version has moved on", async () => {
    const userId = await makeUser({ role: "developer" });
    state.actor = { id: userId, globalRole: "developer", sessionVersion: 1 };

    await db
      .update(users)
      .set({ sessionVersion: 2 })
      .where(eq(users.id, userId));

    expect(await loadPageActor()).toBeNull();
  });

  it("returns null for a deactivated account, not a stale role", async () => {
    const userId = await makeUser({ role: "admin" });
    state.actor = { id: userId, globalRole: "admin", sessionVersion: 1 };

    await db.update(users).set({ isActive: false }).where(eq(users.id, userId));

    expect(await loadPageActor()).toBeNull();
  });

  it("reads the ROLE from the database, not from the token", async () => {
    // The token's role is twelve hours stale by design; a demotion has to bite
    // on the next request.
    const userId = await makeUser({ role: "developer" });
    state.actor = { id: userId, globalRole: "admin", sessionVersion: 1 };

    expect(await loadPageActor()).toMatchObject({ globalRole: "developer" });
  });
});
