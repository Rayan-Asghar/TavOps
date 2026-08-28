/**
 * Digest formatting.
 *
 * Kept apart from the queries for the same reason blocker-routing is kept apart
 * from blockers: this is the part whose wording will be argued about, and it
 * should be testable without a database or a server.
 */

export type ProjectLine = {
  code: string;
  name: string;
  health: string;
  doneTasks: number;
  totalTasks: number;
  loggedHours: number;
  estimatedHours: number;
  openBlockers: number;
  overdueTasks: number;
  lastActivityAt: Date | null;
};

export type Digest = {
  generatedAt: Date;
  projects: ProjectLine[];
  stuckBlockers: {
    project: string;
    description: string;
    assignee: string | null;
    hoursOpen: number;
    ownerSide: string;
  }[];
  silentProjects: ProjectLine[];
};

function projectLine(p: ProjectLine): string {
  const parts = [`${p.code} ${p.name}`];

  if (p.totalTasks > 0) parts.push(`${p.doneTasks}/${p.totalTasks} tasks`);

  if (p.estimatedHours > 0) {
    const pct = Math.round((p.loggedHours / p.estimatedHours) * 100);
    // On fixed-price work this is the number that matters: burning the
    // estimate is the earliest warning that the deadline is at risk.
    parts.push(
      `${p.loggedHours.toFixed(1)}h of ${p.estimatedHours.toFixed(1)}h (${pct}%)${
        pct > 100 ? " OVER" : ""
      }`,
    );
  } else if (p.loggedHours > 0) {
    parts.push(`${p.loggedHours.toFixed(1)}h logged`);
  }

  if (p.openBlockers > 0) parts.push(`${p.openBlockers} blocked`);
  if (p.overdueTasks > 0) parts.push(`${p.overdueTasks} overdue`);
  if (p.health !== "on_track") parts.push(p.health.replace("_", " "));

  return `• ${parts.join(" — ")}`;
}

/** Plain text, because it has to read the same in Discord, Slack and WhatsApp. */
export function renderDigest(d: Digest): string {
  const date = d.generatedAt.toISOString().slice(0, 10);
  const out: string[] = [`**Tavren — ${date}**`, ""];

  if (d.projects.length === 0) {
    out.push("No active projects.");
    return out.join("\n");
  }

  out.push("**Projects**");
  for (const p of d.projects) out.push(projectLine(p));

  if (d.stuckBlockers.length > 0) {
    out.push("", "**Blocked and waiting**");
    for (const b of d.stuckBlockers) {
      const who = b.assignee ?? "nobody assigned";
      const side = b.ownerSide === "client" ? "client" : "us";
      out.push(
        `• ${b.project} — ${b.hoursOpen}h with ${who} (${side}): ${b.description}`,
      );
    }
  }

  if (d.silentProjects.length > 0) {
    out.push("", "**No update in over a shift**");
    out.push(d.silentProjects.map((p) => p.code).join(", "));
  }

  const totalOver = d.projects.filter(
    (p) => p.estimatedHours > 0 && p.loggedHours > p.estimatedHours,
  );
  if (totalOver.length > 0) {
    out.push("", "**Over estimate**");
    out.push(totalOver.map((p) => p.code).join(", "));
  }

  return out.join("\n");
}
