/**
 * Connects: how many we have, and whether we can still bid.
 *
 * Pure. No database, no clock of its own — everything comes in as arguments so
 * the thresholds can be tested without a fixture.
 *
 * This module deliberately answers only the operational question. It does NOT
 * price a spend: assigning dollars to a bid needs a costing basis, and a basis
 * chosen for a report is a number somebody will price a hiring decision off.
 * Money lives on `purchase` rows in the ledger and nowhere else — see 0023.
 */

/**
 * Below this, the next bid may simply not be placeable.
 *
 * 16 is the most one boosted bid can cost on Upwork today. Phrased that way on
 * purpose: "you cannot place another boosted bid" is a fact, where "connects
 * are low" is an opinion, and an alert that states a fact is one people act on.
 *
 * A named constant rather than a settings row because there is no settings
 * table yet. It moves to `/settings` when Phase 5 lands.
 */
export const CONNECTS_FLOOR = 16;

/** One working week of runway. Below it, buying is this week's problem. */
export const RUNWAY_DAYS_WARNING = 5;

export type ConnectsHealth = {
  /** 0 fine · 1 running out · 2 cannot place a boosted bid. */
  level: 0 | 1 | 2;
  balance: number;
  /**
   * Working days of bidding left at the recent rate, or null when there is no
   * spend history to derive it from. Never 0 and never Infinity: both are
   * claims this cannot support, and the standing rule here is that an
   * unknowable number is null rather than a plausible-looking one.
   */
  runwayDays: number | null;
  /** The sentence the screen and the notification both use. */
  reason: string;
};

export function connectsHealth(input: {
  balance: number;
  /** Connects spent (positive) over the window below. */
  spentInWindow: number;
  /** Working days the window covers. Must be > 0 to derive a runway. */
  windowDays: number;
}): ConnectsHealth {
  const { balance, spentInWindow, windowDays } = input;

  const perDay =
    windowDays > 0 && spentInWindow > 0 ? spentInWindow / windowDays : null;
  const runwayDays =
    perDay === null ? null : Math.max(0, Math.floor(balance / perDay));

  if (balance < CONNECTS_FLOOR) {
    return {
      level: 2,
      balance,
      runwayDays,
      reason:
        balance <= 0
          ? "No connects left. Nothing can be bid on until some are bought."
          : `${balance} connects left — not enough to place a boosted bid.`,
    };
  }

  if (runwayDays !== null && runwayDays <= RUNWAY_DAYS_WARNING) {
    return {
      level: 1,
      balance,
      runwayDays,
      reason: `${balance} connects, about ${runwayDays} working ${
        runwayDays === 1 ? "day" : "days"
      } of bidding left at the recent rate.`,
    };
  }

  return {
    level: 0,
    balance,
    runwayDays,
    reason:
      runwayDays === null
        ? `${balance} connects. No recent bids to judge a burn rate from.`
        : `${balance} connects, about ${runwayDays} working days of bidding left.`,
  };
}

/** Dedupe key for the alert: the LEVEL, never the balance. */
export function connectsAlertKey(level: 1 | 2): string {
  /* Keying on the balance would file a fresh inbox row every time it moved by
     one, which is how a warning becomes noise. Keying on the level means the
     row appears once per threshold crossed, and `flagLowConnects` resolves the
     levels no longer breached when a purchase lifts it back. */
  return `connects_low:L${level}`;
}

/** Cents to a display string. Purchases are the only priced rows. */
export function connectsSpend(amountCents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amountCents / 100);
}
