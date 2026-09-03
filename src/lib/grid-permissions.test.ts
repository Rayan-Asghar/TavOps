import { describe, expect, it } from "vitest";
import { rowLock, isEditable, LOCK_REASONS } from "./grid-permissions";

const ME = "11111111-1111-1111-1111-111111111111";
const THEM = "22222222-2222-2222-2222-222222222222";

const viewer = (over: Partial<Parameters<typeof rowLock>[1]> = {}) => ({
  actorId: ME,
  canEditOthers: false,
  invoicedThrough: null as string | null,
  ...over,
});

const row = (over: Partial<Parameters<typeof rowLock>[0]> = {}) => ({
  workDate: new Date("2026-09-15T00:00:00.000Z"),
  userId: ME,
  ...over,
});

describe("rowLock", () => {
  it("leaves your own unbilled entry open", () => {
    expect(rowLock(row(), viewer())).toBeNull();
    expect(isEditable(row(), viewer())).toBe(true);
  });

  it("locks somebody else's entry without worklog.edit", () => {
    expect(rowLock(row({ userId: THEM }), viewer())).toBe("not-yours");
  });

  it("opens somebody else's entry with worklog.edit", () => {
    expect(
      rowLock(row({ userId: THEM }), viewer({ canEditOthers: true })),
    ).toBeNull();
  });

  it("locks an invoiced entry for everyone, including someone who may edit others", () => {
    const v = viewer({ canEditOthers: true, invoicedThrough: "2026-09-30" });
    expect(rowLock(row(), v)).toBe("invoiced");
    expect(rowLock(row({ userId: THEM }), v)).toBe("invoiced");
  });

  it("prefers 'invoiced' over 'not-yours' — it is the more useful thing to say", () => {
    // Both apply. The billing lock is the one that will not lift for anybody,
    // so it is the reason worth showing.
    expect(
      rowLock(row({ userId: THEM }), viewer({ invoicedThrough: "2026-09-30" })),
    ).toBe("invoiced");
  });

  it("treats the invoiced boundary as inclusive", () => {
    const onTheDay = row({ workDate: new Date("2026-09-30T00:00:00.000Z") });
    const dayAfter = row({ workDate: new Date("2026-10-01T00:00:00.000Z") });
    expect(rowLock(onTheDay, viewer({ invoicedThrough: "2026-09-30" }))).toBe(
      "invoiced",
    );
    expect(rowLock(dayAfter, viewer({ invoicedThrough: "2026-09-30" }))).toBeNull();
  });

  it("reports a removed entry as removed, whoever it belongs to", () => {
    expect(rowLock(row({ deleted: true }), viewer())).toBe("removed");
  });

  it("has a sentence for every reason it can give", () => {
    for (const reason of ["invoiced", "not-yours", "removed"] as const) {
      expect(LOCK_REASONS[reason]).toMatch(/\S/);
    }
  });
});
