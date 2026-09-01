import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import { blockers, projects, tasks, timeSessions, workLogs } from "@/db/schema";
import {
  addBusinessHours,
  businessHoursBetween,
  HOURS_PER_DAY,
} from "@/lib/business-time";
import { elapsedSeconds, RUNAWAY_TIMER_HOURS } from "@/lib/timer-utils";
import { notify } from "./notifications";

/** Level 2 waits a further full shift after the level 1 breach. */
const ESCALATION_STEP_HOURS = HOURS_PER_DAY;
/** One shift without a word. Derived, so it tracks the shift if hours change. */
const STALE_TASK_HOURS = HOURS_PER_DAY;

/**
 * How far past its estimate a task goes before anyone is told.
 *
 * 25% is slack for a normal misjudgement; beyond that it is a signal. On
 * fixed-price work an overrun is not a margin curiosity, it is the earliest
 * evidence that the delivery date is at risk — and unlike every other slip
 * detector here it needs nobody to report anything, because the hours are
 * already being logged anyway.
 */
const OVERRUN_FACTOR = 1.25;

/**
 * Escalates blockers that have blown their SLA.
 *
 * Escalation targets the person who owes the answer, never the person who is
 * stuck. That distinction is the whole point: a developer waiting on Shopify
 * access has done their job by reporting it, and pressure belongs on whoever
 * can grant that access.
 */
export async function escalateBlockers() {
  const now = new Date();

  const due = await db
    .select({
      id: blockers.id,
      projectId: blockers.projectId,
      taskId: blockers.taskId,
      assignedToId: blockers.assignedToId,
      reportedById: blockers.reportedById,
      ownerSide: blockers.ownerSide,
      description: blockers.description,
      escalationLevel: blockers.escalationLevel,
      slaDueAt: blockers.slaDueAt,
      projectName: projects.name,
      pmId: projects.pmId,
      deliveryLeadId: projects.deliveryLeadId,
      salesOwnerId: projects.salesOwnerId,
    })
    .from(blockers)
    .innerJoin(projects, eq(blockers.projectId, projects.id))
    .where(
      and(
        ne(blockers.status, "resolved"),
        lt(blockers.slaDueAt, now),
        lt(blockers.escalationLevel, 2),
      ),
    );

  let escalated = 0;

  for (const b of due) {
    const overdueHours = b.slaDueAt
      ? businessHoursBetween(b.slaDueAt, now)
      : 0;

    // Level 1 immediately at breach; level 2 only after a further working day.
    const nextLevel =
      b.escalationLevel === 0
        ? 1
        : overdueHours >= ESCALATION_STEP_HOURS
          ? 2
          : b.escalationLevel;

    if (nextLevel === b.escalationLevel) continue;

    const escalateTo =
      b.ownerSide === "client"
        ? (b.pmId ?? b.salesOwnerId)
        : (b.pmId ?? b.deliveryLeadId);

    const recipients = new Set<string>();
    if (b.assignedToId) recipients.add(b.assignedToId);
    if (nextLevel >= 1 && escalateTo) recipients.add(escalateTo);

    for (const userId of recipients) {
      await notify({
        userId,
        kind: "blocker_escalated",
        title: `Escalated (L${nextLevel}): ${b.projectName}`,
        body:
          b.ownerSide === "client"
            ? `Client dependency unresolved for ${Math.round(overdueHours)}h of working time. ${b.description}`
            : `Blocker unresolved past SLA. ${b.description}`,
        projectId: b.projectId,
        taskId: b.taskId,
        blockerId: b.id,
        isActionable: true,
        dedupeKey: `blocker_esc:${b.id}:L${nextLevel}`,
      });
    }

    await db
      .update(blockers)
      .set({ escalationLevel: nextLevel })
      .where(eq(blockers.id, b.id));

    escalated++;
  }

  return { checked: due.length, escalated };
}

/**
 * Flags in-progress tasks that have gone a working day with no word.
 *
 * Tasks with an open blocker are skipped outright. Nagging someone for an
 * update on work they have already told you they cannot proceed with is how a
 * reporting system loses credibility, and it is the fastest route to developers
 * writing "still working on it" every day to keep the robot quiet.
 */
export async function flagStaleTasks() {
  const cutoff = addBusinessHours(new Date(), -STALE_TASK_HOURS);

  const blockedTaskIds = await db
    .select({ taskId: blockers.taskId })
    .from(blockers)
    .where(and(ne(blockers.status, "resolved"), isNotNull(blockers.taskId)));

  const excluded = blockedTaskIds
    .map((r) => r.taskId)
    .filter((id): id is string => !!id);

  const stale = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      projectId: tasks.projectId,
      assigneeId: tasks.assigneeId,
      lastUpdateAt: tasks.lastUpdateAt,
      projectName: projects.name,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(
      and(
        eq(tasks.status, "in_progress"),
        eq(projects.lifecycle, "active"),
        isNotNull(tasks.assigneeId),
        or(isNull(tasks.lastUpdateAt), lt(tasks.lastUpdateAt, cutoff)),
        // Parameterised, not concatenated. The previous version built an
        // ARRAY['<uuid>'::uuid, ...] literal by hand, which grew without bound
        // as open blockers accumulated. `and()` drops an undefined term, so an
        // empty exclusion list needs no special case in the SQL.
        excluded.length > 0 ? notInArray(tasks.id, excluded) : undefined,
      ),
    );

  for (const t of stale) {
    if (!t.assigneeId) continue;
    await notify({
      userId: t.assigneeId,
      kind: "update_missing",
      title: `Update needed: ${t.title}`,
      body: `${t.projectName} — no progress logged in about a working day. A one-line note is enough, or report a blocker if you are stuck.`,
      projectId: t.projectId,
      taskId: t.id,
      isActionable: true,
      dedupeKey: `update_missing:${t.id}`,
    });
  }

  return { flagged: stale.length };
}

/**
 * Recomputes project health from facts rather than from anyone's opinion.
 * Health is derived here and nowhere else, so the dashboard can never drift
 * out of step with the underlying blockers and deadlines.
 */
export async function recomputeProjectHealth() {
  const now = new Date();

  const active = await db
    .select({
      id: projects.id,
      health: projects.health,
      pmId: projects.pmId,
      name: projects.name,
    })
    .from(projects)
    .where(eq(projects.lifecycle, "active"));

  if (active.length === 0) return { checked: 0, changed: 0 };
  const ids = active.map((p) => p.id);

  // Three grouped queries instead of two per project. At fifteen projects
  // sharing a 60s cron budget with four other sweeps, the loop was the wrong
  // shape; it also made health cost more the healthier the company got.
  const blockerAgg = await db
    .select({
      projectId: blockers.projectId,
      total: sql<number>`count(*)::int`,
      breached: sql<number>`count(*) filter (where ${blockers.slaDueAt} < now())::int`,
    })
    .from(blockers)
    .where(and(inArray(blockers.projectId, ids), ne(blockers.status, "resolved")))
    .groupBy(blockers.projectId);

  const overdueAgg = await db
    .select({
      projectId: tasks.projectId,
      n: sql<number>`count(*)::int`,
    })
    .from(tasks)
    .where(
      and(
        inArray(tasks.projectId, ids),
        ne(tasks.status, "done"),
        lt(tasks.dueDate, now),
      ),
    )
    .groupBy(tasks.projectId);

  // Unfinished work already past its estimate. Included because every other
  // input to health depends on somebody reporting something; this one does not.
  const overrunAgg = await db
    .select({
      projectId: tasks.projectId,
      n: sql<number>`count(distinct ${tasks.id})::int`,
    })
    .from(tasks)
    .innerJoin(workLogs, eq(workLogs.taskId, tasks.id))
    .where(
      and(
        inArray(tasks.projectId, ids),
        ne(tasks.status, "done"),
        isNull(workLogs.deletedAt),
        isNotNull(tasks.estimatedHours),
      ),
    )
    .groupBy(tasks.projectId, tasks.id, tasks.estimatedHours)
    .having(
      sql`sum(${workLogs.hours}) > ${tasks.estimatedHours} * ${OVERRUN_FACTOR}`,
    );

  const byBlocker = new Map(blockerAgg.map((r) => [r.projectId, r]));
  const byOverdue = new Map(overdueAgg.map((r) => [r.projectId, r.n]));
  const overrunCount = new Map<string, number>();
  for (const r of overrunAgg) {
    overrunCount.set(r.projectId, (overrunCount.get(r.projectId) ?? 0) + 1);
  }

  let changed = 0;

  for (const p of active) {
    const b = byBlocker.get(p.id);
    const overdue = byOverdue.get(p.id) ?? 0;
    const overruns = overrunCount.get(p.id) ?? 0;

    let health: "on_track" | "at_risk" | "blocked" = "on_track";
    if ((b?.breached ?? 0) > 0) health = "blocked";
    else if (overdue > 0 || (b?.total ?? 0) > 1 || overruns > 0) {
      health = "at_risk";
    }

    if (health === p.health) continue;

    await db
      .update(projects)
      .set({ health, updatedAt: new Date() })
      .where(eq(projects.id, p.id));
    changed++;

    if (health !== "on_track" && p.pmId) {
      await notify({
        userId: p.pmId,
        kind: "project_at_risk",
        title: `${p.name} is now ${health.replace("_", " ")}`,
        body:
          health === "blocked"
            ? "A blocker has been sitting past its SLA."
            : overruns > 0 && overdue === 0
              ? `${overruns} task${overruns === 1 ? " is" : "s are"} past estimate and unfinished.`
              : "Overdue tasks or multiple open blockers.",
        projectId: p.id,
        isActionable: true,
        dedupeKey: `health:${p.id}:${health}`,
      });
    }
  }

  return { checked: active.length, changed };
}

/**
 * Catches timers somebody forgot to stop.
 *
 * Left alone these silently inflate a developer's logged hours, which is worse
 * than losing the entry: a wrong number that looks precise. The nudge goes to
 * the person timing, not their lead — it is a mistake, not a misconduct.
 */
export async function flagRunawayTimers() {
  const open = await db
    .select({
      id: timeSessions.id,
      userId: timeSessions.userId,
      projectId: timeSessions.projectId,
      status: timeSessions.status,
      accumulatedSeconds: timeSessions.accumulatedSeconds,
      resumedAt: timeSessions.resumedAt,
      taskTitle: tasks.title,
    })
    .from(timeSessions)
    .innerJoin(tasks, eq(timeSessions.taskId, tasks.id))
    .where(eq(timeSessions.status, "running"));

  let flagged = 0;
  for (const s of open) {
    const hours =
      elapsedSeconds({
        status: "running",
        accumulatedSeconds: s.accumulatedSeconds,
        resumedAt: s.resumedAt,
      }) / 3600;
    if (hours < RUNAWAY_TIMER_HOURS) continue;

    await notify({
      userId: s.userId,
      kind: "timer_left_running",
      title: `Timer still running on ${s.taskTitle}`,
      body: `It has been going ${Math.floor(hours)}h. If you forgot to stop it, correct the time on the project page — the reason is recorded.`,
      projectId: s.projectId,
      isActionable: true,
      dedupeKey: `runaway_timer:${s.id}`,
    });
    flagged++;
  }
  return { flagged };
}

/**
 * Flags work that has burned well past its estimate and is still not done.
 *
 * Goes to the person doing it and the project's PM — not as blame, but because
 * the earlier somebody knows a fixed-price job is running long, the more
 * options they still have.
 */
export async function flagEstimateOverruns() {
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      projectId: tasks.projectId,
      assigneeId: tasks.assigneeId,
      estimated: tasks.estimatedHours,
      logged: sql<string>`sum(${workLogs.hours})`,
      projectName: projects.name,
      pmId: projects.pmId,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .innerJoin(workLogs, eq(workLogs.taskId, tasks.id))
    .where(
      and(
        ne(tasks.status, "done"),
        eq(projects.lifecycle, "active"),
        isNull(workLogs.deletedAt),
        isNotNull(tasks.estimatedHours),
      ),
    )
    .groupBy(tasks.id, projects.name, projects.pmId)
    .having(
      sql`sum(${workLogs.hours}) > ${tasks.estimatedHours} * ${OVERRUN_FACTOR}`,
    );

  let flagged = 0;
  for (const t of rows) {
    const logged = Number(t.logged ?? 0);
    const estimated = Number(t.estimated ?? 0);
    if (estimated <= 0) continue;

    const over = Math.round((logged / estimated - 1) * 100);
    const body = `${t.projectName} — ${logged.toFixed(1)}h logged against a ${estimated.toFixed(1)}h estimate (${over}% over) and not finished. If the scope grew, say so now rather than at the deadline.`;

    // Both are told once, and only once, per task.
    const recipients = new Set<string>();
    if (t.assigneeId) recipients.add(t.assigneeId);
    if (t.pmId) recipients.add(t.pmId);

    for (const userId of recipients) {
      await notify({
        userId,
        kind: "task_stalled",
        title: `Over estimate: ${t.title}`,
        body,
        projectId: t.projectId,
        taskId: t.id,
        isActionable: true,
        dedupeKey: `overrun:${t.id}`,
      });
    }
    flagged++;
  }

  return { flagged };
}

export async function runAllSweeps() {
  const escalation = await escalateBlockers();
  const stale = await flagStaleTasks();
  // Overruns run before health so the recompute sees them in the same pass.
  const overruns = await flagEstimateOverruns();
  const health = await recomputeProjectHealth();
  const timers = await flagRunawayTimers();
  return { escalation, stale, overruns, health, timers };
}
