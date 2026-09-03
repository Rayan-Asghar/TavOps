import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  inboxFor,
  notify,
  resolveNotification,
  snoozeNotification,
  snoozedFor,
  unresolvedCount,
  unsnoozeNotification,
} from "@/server/notifications";
import { makeUser, owner, resetDb } from "./harness";

/**
 * Snooze, against a real database.
 *
 * The interesting half is not "hide until a time" — it is that a snooze also
 * ends early when the same condition recurs (DESIGN-STANDARD 2.1). That lives in
 * an `onConflictDoUpdate ... setWhere` on the dedupe index, which is exactly the
 * kind of thing a mocked client would happily lie about: the conflict target,
 * the partial guard, and the interaction with a NULL dedupe key are all database
 * behaviour, not application behaviour.
 */

const HOUR = 60 * 60 * 1000;

async function seed(userId: string, dedupeKey: string | null = "k1") {
  await notify({
    userId,
    kind: "sync_failed",
    title: "Sheet sync failed",
    isActionable: true,
    dedupeKey,
  });
  const [row] = await inboxFor(userId);
  return row;
}

describe("snoozing", () => {
  beforeEach(resetDb);
  afterAll(() => owner.end());

  it("hides the item until its time, then lets it back", async () => {
    const user = await makeUser({}); // returns the id string, not a row
    const n = await seed(user);

    await snoozeNotification(n.id, user, new Date(Date.now() + HOUR));
    expect(await inboxFor(user)).toHaveLength(0);
    expect(await unresolvedCount(user)).toBe(0);

    // Not resolved — deferred. 2.6: it has to stay queryable, or people stop
    // deferring at all.
    const [still] = await owner`
      select resolved_at from notifications where id = ${n.id}`;
    expect(still.resolved_at).toBeNull();
    expect(await snoozedFor(user)).toHaveLength(1);

    // Once the moment passes it returns on its own, with no sweep to run.
    await owner`
      update notifications set snoozed_until = now() - interval '1 minute'
       where id = ${n.id}`;
    expect(await inboxFor(user)).toHaveLength(1);
    expect(await unresolvedCount(user)).toBe(1);
  });

  it("wakes early when the same condition happens again", async () => {
    const user = await makeUser({}); // returns the id string, not a row
    const n = await seed(user);
    await snoozeNotification(n.id, user, new Date(Date.now() + 24 * HOUR));
    expect(await inboxFor(user)).toHaveLength(0);

    // The sync fails again tomorrow-ish. Snoozing the first failure must not
    // swallow the second.
    await seed(user);

    const back = await inboxFor(user);
    expect(back).toHaveLength(1);
    expect(back[0].id).toBe(n.id); // woken, not duplicated
  });

  it("does not duplicate rows when a deduped condition recurs un-snoozed", async () => {
    const user = await makeUser({}); // returns the id string, not a row
    await seed(user);
    await seed(user);
    await seed(user);
    // The original reason for the dedupe index: a nightly sweep must not add a
    // line a day for the same condition.
    expect(await inboxFor(user)).toHaveLength(1);
  });

  it("still inserts every row when there is no dedupe key", async () => {
    const user = await makeUser({}); // returns the id string, not a row
    // NULLs are distinct in the unique index on purpose, so "do not collapse
    // this one" keeps working. Waking must not have capped un-keyed rows at one.
    await seed(user, null);
    await seed(user, null);
    expect(await inboxFor(user)).toHaveLength(2);
  });

  it("un-snoozes on demand", async () => {
    const user = await makeUser({}); // returns the id string, not a row
    const n = await seed(user);
    await snoozeNotification(n.id, user, new Date(Date.now() + HOUR));
    await unsnoozeNotification(n.id, user);
    expect(await inboxFor(user)).toHaveLength(1);
    expect(await snoozedFor(user)).toHaveLength(0);
  });

  it("refuses to snooze something already dealt with", async () => {
    const user = await makeUser({}); // returns the id string, not a row
    const n = await seed(user);
    await resolveNotification(n.id, user, "handled in standup");

    await snoozeNotification(n.id, user, new Date(Date.now() + HOUR));
    const [row] = await owner`
      select snoozed_until, dismiss_note from notifications where id = ${n.id}`;
    expect(row.snoozed_until).toBeNull();
    expect(row.dismiss_note).toBe("handled in standup");
  });

  it("scopes every operation to the owner of the row", async () => {
    const [mine, theirs] = await Promise.all([makeUser({}), makeUser({})]);
    const n = await seed(mine);

    await snoozeNotification(n.id, theirs, new Date(Date.now() + HOUR));
    expect(await inboxFor(mine)).toHaveLength(1); // untouched

    await resolveNotification(n.id, theirs);
    expect(await inboxFor(mine)).toHaveLength(1); // still untouched
  });
});
