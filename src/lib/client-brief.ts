/**
 * The client brief.
 *
 * A sales owner talking to a client needs to know where their project stands.
 * The project page cannot answer that for them: the activity feed is gated on
 * `worklog.viewAll`, which sales does not have, so a rep sees an empty panel.
 *
 * Opening the feed to them is the wrong fix. The only note a work log carries
 * is `internalNotes` — internal by construction — and handing raw developer
 * notes to the person on the phone with the client is how internal candour
 * leaks outward. So the brief is *derived* instead: counts, client-owned
 * blockers, and dates. Every field here is safe to read aloud.
 *
 * Kept apart from the queries, like digest-format, because this is the part
 * whose wording will be argued about and it should be testable without a
 * database or a server.
 */

export type ClientBrief = {
  code: string;
  name: string;
  clientName: string | null;
  tasksDone: number;
  tasksTotal: number;
  /** Exact, not inferred: `in_review` is a real status a task sits in. */
  tasksInReview: number;
  /** The client-facing date, never the internal one. The gap is our buffer. */
  clientDueDate: Date | null;
  /** Open blockers whose ownerSide is 'client' — what we are waiting on them for. */
  waitingOnClient: string[];
  /** Date only. When work last moved; never who did it, or for how long. */
  lastMovementAt: Date | null;
};

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 864e5);
}

/**
 * Plain text, so a rep can paste it into email, WhatsApp or a Slack DM without
 * it arriving as broken markup.
 *
 * Deliberately absent: hours, internal notes, the internal deadline, who is
 * assigned to what, and anything derived from money. A rep pastes this
 * verbatim — whatever is in it is what the client hears.
 */
export function renderClientBrief(b: ClientBrief, now = new Date()): string {
  const out: string[] = [`${b.code} — ${b.name}`];
  if (b.clientName) out.push(`Client: ${b.clientName}`);
  out.push("");

  if (b.tasksTotal > 0) {
    const pct = Math.round((b.tasksDone / b.tasksTotal) * 100);
    out.push(`Progress: ${b.tasksDone} of ${b.tasksTotal} items done (${pct}%)`);
  } else {
    // Not "0%": a project with no tasks yet has not stalled, it has not been
    // planned, and those must not read the same to someone about to quote it.
    out.push("Progress: not broken into items yet");
  }

  if (b.tasksInReview > 0) {
    out.push(`In review: ${b.tasksInReview}`);
  }

  if (b.clientDueDate) out.push(`Target date: ${day(b.clientDueDate)}`);

  if (b.lastMovementAt) {
    const age = daysBetween(b.lastMovementAt, now);
    const when =
      age <= 0 ? "today" : age === 1 ? "yesterday" : `${age} days ago`;
    out.push(`Last movement: ${when}`);
  } else {
    out.push("Last movement: nothing logged yet");
  }

  if (b.waitingOnClient.length > 0) {
    out.push("", "Waiting on the client:");
    for (const w of b.waitingOnClient) out.push(`- ${w}`);
  }

  return out.join("\n");
}
