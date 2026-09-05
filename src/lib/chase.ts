import { addBusinessHours, businessHoursBetween, HOURS_PER_DAY } from "@/lib/business-time";
import type { proposalStatus } from "@/db/schema";

export type ProposalStatus = (typeof proposalStatus.enumValues)[number];

/**
 * When a proposal is due a chase.
 *
 * ## This is not the thing 0011 deleted
 *
 * That migration dropped `follow_up_due_at` because it was a column a rep had
 * to fill in: the system asked for a plan and then nagged about the plan, which
 * is pipeline management this team does not do. Nothing here asks for a date.
 * The clock starts at an event that already happened — the bid, or the last
 * chase — and the cutoff comes from the status. A rep who never touches the
 * feature still gets a correct queue, which is the test a derived signal has to
 * pass and the one the dropped column failed.
 *
 * The functions here take no caller-supplied due date, deliberately. There is a
 * test asserting exactly that, because the easiest way to undo this decision is
 * to add an optional parameter "just for the one case".
 *
 * Everything is measured in BUSINESS hours, like the blocker SLA clock, so a
 * bid sent on Friday evening is not cold on Sunday morning.
 */

/**
 * How long each status may sit before somebody should chase it.
 *
 * Derived from `HOURS_PER_DAY` so they track the shift the way the blocker and
 * stale-task cutoffs do. They are not one number because these are not one
 * situation: silence after a bid nobody opened is ordinary, and a booked
 * meeting that has gone quiet is a different and worse problem.
 */
export const CHASE_AFTER_DAYS: Record<ProposalStatus, number | null> = {
  // Nothing has happened yet. Most bids die here and that is normal; three days
  // is long enough that chasing is not noise and short enough to still matter.
  sent: 3,
  // They opened it and said nothing. That is a signal, so the clock is shorter.
  viewed: 2,
  // They replied. The ball is usually with us, which is the point of the queue.
  responded: 2,
  // A meeting happened or is booked and then silence. The worst kind, because
  // it is the furthest anyone got.
  meeting: 5,
  // They are serious and undecided. Chase, but do not crowd.
  qualified: 3,
  // Decided. There is nothing to chase.
  won: null,
  lost: null,
};

/**
 * How many unanswered chases before the queue stops asking.
 *
 * Without this the same row reappears every morning forever, and a queue that
 * cannot be emptied is one people stop reading. At the limit the proposal is
 * not silently dropped — it is surfaced as something to close out, which is a
 * decision a person makes, not one this module makes for them.
 */
export const CHASE_LIMIT = 4;

export type ChaseInput = {
  status: ProposalStatus;
  sentAt: Date;
  lastChasedAt: Date | null;
  chaseCount?: number;
};

/** The event the clock runs from: the last chase, or failing that the bid. */
export function chaseClockFrom(input: ChaseInput): Date {
  return input.lastChasedAt ?? input.sentAt;
}

/**
 * The moment a chase falls due, or null if this proposal is never due one.
 *
 * Null covers both decided statuses and a proposal already chased to the limit.
 */
export function chaseDueAt(input: ChaseInput): Date | null {
  const days = CHASE_AFTER_DAYS[input.status];
  if (days === null) return null;
  if ((input.chaseCount ?? 0) >= CHASE_LIMIT) return null;
  return addBusinessHours(chaseClockFrom(input), days * HOURS_PER_DAY);
}

export type ChaseState = {
  /** Due now: the queue shows it and the sweep notifies its owner. */
  due: boolean;
  dueAt: Date | null;
  /** Business hours since the clock started. The "cold for" column. */
  coldHours: number;
  /**
   * Chased to the limit with nothing back. Not due — asking again is not the
   * next action — but it needs closing out rather than forgetting.
   */
  exhausted: boolean;
  /** Why, in the words the screen uses. */
  reason: string;
};

const DECIDED: Partial<Record<ProposalStatus, string>> = {
  won: "Won — nothing to chase.",
  lost: "Lost — nothing to chase.",
};

export function chaseState(input: ChaseInput, now: Date): ChaseState {
  const coldHours = Math.max(0, businessHoursBetween(chaseClockFrom(input), now));
  const decided = DECIDED[input.status];
  if (decided) {
    return { due: false, dueAt: null, coldHours, exhausted: false, reason: decided };
  }

  const chases = input.chaseCount ?? 0;
  if (chases >= CHASE_LIMIT) {
    return {
      due: false,
      dueAt: null,
      coldHours,
      exhausted: true,
      reason: `Chased ${chases} times with no reply. Close it out.`,
    };
  }

  const dueAt = chaseDueAt(input);
  const due = dueAt !== null && now >= dueAt;
  const days = CHASE_AFTER_DAYS[input.status] ?? 0;
  return {
    due,
    dueAt,
    coldHours,
    exhausted: false,
    reason: due
      ? chases === 0
        ? `${SILENCE_SINCE[input.status] ?? "Nothing"} ${workingDays(coldHours)}.`
        : `Chased ${chases === 1 ? "once" : `${chases} times`}, nothing since ${workingDays(coldHours)}.`
      : `Due a chase after ${days} working ${days === 1 ? "day" : "days"}.`,
  };
}

/**
 * What the silence means, per status.
 *
 * One phrase for all five was wrong on four of them: telling a rep there has
 * been "no word since it was sent" about a proposal the client REPLIED to
 * contradicts the status badge sitting next to it, and a queue that argues with
 * itself is one people stop trusting.
 */
const SILENCE_SINCE: Partial<Record<ProposalStatus, string>> = {
  sent: "No word since it was sent",
  viewed: "Opened, and nothing since",
  responded: "They replied, then went quiet",
  meeting: "A meeting, then quiet",
  qualified: "Qualified, and no decision since",
};

/** Business hours as the working days a person would say out loud. */
export function workingDays(businessHours: number): string {
  const d = Math.floor(businessHours / HOURS_PER_DAY);
  if (d < 1) return "today";
  return d === 1 ? "1 working day ago" : `${d} working days ago`;
}
