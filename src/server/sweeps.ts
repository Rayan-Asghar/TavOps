import { and, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { blockers, projects, proposals, tasks, timeSessions } from "@/db/schema";
import { addBusinessHours, businessHoursBetween } from "@/lib/business-time";
import { elapsedSeconds, RUNAWAY_TIMER_HOURS } from "@/lib/timer-utils";
import { notify } from "./notifications";

const ESCALATION_STEP_HOURS = 8;
const STALE_TASK_HOURS = 9; // roughly one working day without a word

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
    .where(and(ne(blockers.status, "resolved"), sql`${blockers.taskId} is not null`));

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
        sql`${tasks.assigneeId} is not null`,
        or(isNull(tasks.lastUpdateAt), lt(tasks.lastUpdateAt, cutoff)),
        excluded.length > 0
          ? sql`${tasks.id} <> ALL(${sql.raw(`ARRAY[${excluded.map((id) => `'${id}'::uuid`).join(",")}]`)})`
          : sql`true`,
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
    .select({ id: projects.id, health: projects.health, pmId: projects.pmId, name: projects.name, internalDueDate: projects.internalDueDate })
    .from(projects)
    .where(eq(projects.lifecycle, "active"));

  let changed = 0;

  for (const p of active) {
    const [openBlockers] = await db
      .select({
        total: sql<number>`count(*)::int`,
        breached: sql<number>`count(*) filter (where ${blockers.slaDueAt} < now())::int`,
      })
      .from(blockers)
      .where(and(eq(blockers.projectId, p.id), ne(blockers.status, "resolved")));

    const [overdue] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, p.id),
          ne(tasks.status, "done"),
          lt(tasks.dueDate, now),
        ),
      );

    let health: "on_track" | "at_risk" | "blocked" = "on_track";
    if ((openBlockers?.breached ?? 0) > 0) health = "blocked";
    else if ((overdue?.n ?? 0) > 0 || (openBlockers?.total ?? 0) > 1) {
      health = "at_risk";
    }

    if (health !== p.health) {
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
              : "Overdue tasks or multiple open blockers.",
          projectId: p.id,
          isActionable: true,
          dedupeKey: `health:${p.id}:${health}`,
        });
      }
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

/** Proposals whose follow-up date has passed and that are still in play. */
export async function flagDueFollowUps() {
  const due = await db
    .select({
      id: proposals.id,
      ownerId: proposals.ownerId,
      jobTitle: proposals.jobTitle,
    })
    .from(proposals)
    .where(
      and(
        lt(proposals.followUpDueAt, new Date()),
        ne(proposals.status, "won"),
        ne(proposals.status, "lost"),
      ),
    );

  for (const p of due) {
    await notify({
      userId: p.ownerId,
      kind: "followup_due",
      title: `Follow up: ${p.jobTitle}`,
      body: "No movement since you sent this. Nudge the client or mark it lost.",
      isActionable: true,
      dedupeKey: `followup:${p.id}`,
    });
  }
  return { due: due.length };
}

export async function runAllSweeps() {
  const escalation = await escalateBlockers();
  const stale = await flagStaleTasks();
  const health = await recomputeProjectHealth();
  const timers = await flagRunawayTimers();
  const followUps = await flagDueFollowUps();
  return { escalation, stale, health, timers, followUps };
}
