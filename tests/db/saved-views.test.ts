import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeUser, owner, resetDb } from "./harness";

/**
 * Saved views: the ownership and allow-list rules.
 *
 * The interesting cases are not "does a row get written" but who can see and
 * remove one, and whether a user-supplied path can point off the app.
 */

const state = vi.hoisted(() => ({
  actor: null as { id: string; globalRole: string } | null,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  getActor: async () => state.actor,
  requireActor: async () => {
    if (!state.actor) throw new Error("Not signed in.");
    return state.actor;
  },
}));

const { saveViewAction, deleteViewAction } = await import(
  "@/server/saved-view-actions"
);
const { viewsFor } = await import("@/server/saved-view-queries");

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
const save = (f: Record<string, string>) => saveViewAction({}, form(f));

describe("saving", () => {
  it("stores a view and lists it back", async () => {
    const userId = await makeUser({});
    state.actor = { id: userId, globalRole: "developer" };

    const res = await save({
      name: "My open work",
      path: "/tasks",
      query: "?assignee=me&page=3",
    });
    expect(res.ok).toBe(true);

    const views = await viewsFor("/tasks", userId);
    expect(views).toHaveLength(1);
    // Paging is dropped: a view is a set of filters, not page 3 of them.
    expect(views[0].query).toBe("assignee=me");
    expect(views[0].isMine).toBe(true);
  });

  it("corrects an existing view rather than duplicating it", async () => {
    const userId = await makeUser({});
    state.actor = { id: userId, globalRole: "developer" };

    await save({ name: "Mine", path: "/tasks", query: "status=todo" });
    await save({ name: "Mine", path: "/tasks", query: "status=in_review" });

    const views = await viewsFor("/tasks", userId);
    expect(views).toHaveLength(1);
    expect(views[0].query).toBe("status=in_review");
  });

  it("REFUSES a path that is not a list screen", async () => {
    // The open-redirect guard. A stored URL that later gets navigated to is
    // how a bookmark feature walks a colleague off the application.
    const userId = await makeUser({});
    state.actor = { id: userId, globalRole: "developer" };

    for (const path of [
      "https://evil.example/tasks",
      "//evil.example",
      "/tasks/../admin/users",
      "/admin/users",
    ]) {
      const res = await save({ name: "Bad", path, query: "" });
      expect(res.ok, path).toBeFalsy();
    }
    expect(await viewsFor("/tasks", userId)).toHaveLength(0);
  });

  it("refuses an unnamed view", async () => {
    const userId = await makeUser({});
    state.actor = { id: userId, globalRole: "developer" };
    expect((await save({ name: " ", path: "/tasks", query: "" })).ok).toBeFalsy();
  });
});

describe("who sees what", () => {
  it("keeps a private view private", async () => {
    const mine = await makeUser({});
    const other = await makeUser({});

    state.actor = { id: mine, globalRole: "developer" };
    await save({ name: "Private", path: "/tasks", query: "status=todo" });

    expect(await viewsFor("/tasks", other)).toHaveLength(0);
  });

  it("shows a shared view to everyone, marked as not theirs", async () => {
    const mine = await makeUser({});
    const other = await makeUser({});

    state.actor = { id: mine, globalRole: "developer" };
    await save({
      name: "Team triage",
      path: "/tasks",
      query: "status=in_review",
      isShared: "on",
    });

    const theirs = await viewsFor("/tasks", other);
    expect(theirs).toHaveLength(1);
    expect(theirs[0].isShared).toBe(true);
    expect(theirs[0].isMine).toBe(false);
  });

  it("does not leak views from another screen", async () => {
    const userId = await makeUser({});
    state.actor = { id: userId, globalRole: "developer" };
    await save({ name: "Tasks one", path: "/tasks", query: "status=todo" });

    expect(await viewsFor("/projects", userId)).toHaveLength(0);
  });
});

describe("removing", () => {
  it("removes your own", async () => {
    const userId = await makeUser({});
    state.actor = { id: userId, globalRole: "developer" };
    await save({ name: "Mine", path: "/tasks", query: "status=todo" });

    const [v] = await viewsFor("/tasks", userId);
    const res = await deleteViewAction({}, form({ id: v.id }));

    expect(res.ok).toBe(true);
    expect(await viewsFor("/tasks", userId)).toHaveLength(0);
  });

  it("refuses to remove somebody else's shared view", async () => {
    const mine = await makeUser({});
    const other = await makeUser({});

    state.actor = { id: mine, globalRole: "developer" };
    await save({
      name: "Team triage",
      path: "/tasks",
      query: "status=todo",
      isShared: "on",
    });
    const [v] = await viewsFor("/tasks", mine);

    state.actor = { id: other, globalRole: "admin" };
    const res = await deleteViewAction({}, form({ id: v.id }));

    expect(res.ok).toBeFalsy();
    expect(await viewsFor("/tasks", mine)).toHaveLength(1);
  });
});
