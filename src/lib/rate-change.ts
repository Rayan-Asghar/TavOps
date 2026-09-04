/**
 * Changing what somebody is paid, without rewriting what work already cost.
 *
 * `user_rates` is a history table, so a raise is a NEW ROW and never an UPDATE.
 * Editing the open row in place would silently restate every entry already
 * costed against it — the exact failure `src/server/costing.ts` snapshots to
 * avoid, reintroduced from the other end.
 *
 * A change therefore has two halves, which must happen together: close the
 * current open row, and open a new one at the same instant. `resolveRate` reads
 * the window as HALF-OPEN — [effectiveFrom, effectiveTo) — so the closing date
 * and the new start date are the SAME date. Setting them a day apart leaves a
 * gap where the person has no rate and their hours silently become `unrated`;
 * overlapping them makes `resolveRate` return `ambiguous` and refuse to cost
 * anything at all. Both failures are quiet, which is why this is a tested
 * function and not three lines inside an action.
 *
 * Pure: no database, so every boundary case is unit-testable.
 */

export type OpenRate = {
  id: string;
  effectiveFrom: Date;
};

export type NewRate = {
  internalCostPerHour: string;
  billableRatePerHour: string | null;
  currency: string;
};

export type RateChangePlan =
  | {
      ok: true;
      /** Null when the person has never had a rate. */
      closePrevious: { id: string; effectiveTo: Date } | null;
      insert: NewRate & { effectiveFrom: Date };
    }
  | { ok: false; reason: "not-after-current" };

/** Midnight UTC on that calendar day — the granularity rates change at. */
export function startOfUtcDay(d: Date): Date {
  return new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

export function planRateChange(
  current: OpenRate | null,
  next: NewRate,
  effectiveFrom: Date,
): RateChangePlan {
  const from = startOfUtcDay(effectiveFrom);

  if (current) {
    // Equal is refused as well as earlier. A new row starting the same day the
    // old one did would leave the old row covering [x, x) — zero days — which
    // is not a correction of history, it is a deletion of it.
    if (from.getTime() <= startOfUtcDay(current.effectiveFrom).getTime()) {
      return { ok: false, reason: "not-after-current" };
    }
  }

  return {
    ok: true,
    closePrevious: current ? { id: current.id, effectiveTo: from } : null,
    insert: { ...next, effectiveFrom: from },
  };
}
