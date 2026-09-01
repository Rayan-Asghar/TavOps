"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { tasks, timeSessions, users } from "@/db/schema";
import { requireActor } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/access";
import { assertCan } from "@/lib/rbac";
import { elapsedSeconds, secondsToHours } from "@/lib/timer-utils";
import { recordWorkInTx } from "./record-work";
import {
  adjustTimerSchema,
  finishTimerSchema,
  startTimerSchema,
} from "./timer-schemas";
import { safeErrorMessage } from "./action-errors";
import { writeAudit } from "./audit";

export type TimerState = { error?: string; ok?: boolean; message?: string };

function fail(err: unknown): TimerState {
  return { error: safeErrorMessage(err, "timer") };
}

/** The one session a person may have open. Null when nothing is being timed. */
export async function activeSessionFor(userId: string) {
  const [row] = await db
    .select({
      id: timeSessions.id,
      taskId: timeSessions.taskId,
      projectId: timeSessions.projectId,
      status: timeSessions.status,
      accumulatedSeconds: timeSessions.accumulatedSeconds,
      resumedAt: timeSessions.resumedAt,
      startedAt: timeSessions.startedAt,
      taskTitle: tasks.title,
    })
    .from(timeSessions)
    .innerJoin(tasks, eq(timeSessions.taskId, tasks.id))
    .where(
      and(eq(timeSessions.userId, userId), ne(timeSessions.status, "completed")),
    )
    .limit(1);
  return row ?? null;
}

export async function startTimer(formData: FormData): Promise<TimerState> {
  try {
    const actor = await requireActor();
    assertCan(actor.globalRole, "worklog.create");
    const { taskId } = startTimerSchema.parse({
      taskId: String(formData.get("taskId") ?? ""),
    });

    const [task] = await db
      .select({
        id: tasks.id,
        projectId: tasks.projectId,
        title: tasks.title,
        assigneeId: tasks.assigneeId,
      })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (!task) return { error: "That task no longer exists." };

    await assertProjectAccess(actor, task.projectId);

    // Timing someone else's task would file their hours under your name, so
    // the action refuses it. Hiding the button is not enough — this is the
    // check that actually holds against a direct request.
    if (task.assigneeId && task.assigneeId !== actor.id) {
      const [owner] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, task.assigneeId))
        .limit(1);
      return {
        error: `That task is assigned to ${owner?.name ?? "someone else"}. Reassign it first if you are taking it over.`,
      };
    }

    // One clock at a time. Silently stopping the other timer would quietly
    // discard time somebody is still earning, so this refuses and names it.
    const existing = await activeSessionFor(actor.id);
    if (existing) {
      return {
        error:
          existing.taskId === taskId
            ? "You already have a timer on this task."
            : `A timer is already running on "${existing.taskTitle}". Finish or pause it first.`,
      };
    }

    await db.transaction(async (tx) => {
      // Picking up unassigned work claims it, so the task and the hours agree
      // about who did it.
      if (!task.assigneeId) {
        await tx
          .update(tasks)
          .set({ assigneeId: actor.id, updatedAt: new Date() })
          .where(eq(tasks.id, task.id));
      }

      await tx.insert(timeSessions).values({
        taskId: task.id,
        projectId: task.projectId,
        userId: actor.id,
        status: "running",
        resumedAt: new Date(),
        accumulatedSeconds: 0,
      });
    });

    revalidatePath(`/projects/${task.projectId}`);
    return { ok: true, message: `Timer started on ${task.title}.` };
  } catch (err) {
    return fail(err);
  }
}

async function loadOwnSession(sessionId: string, userId: string) {
  const [row] = await db
    .select()
    .from(timeSessions)
    .where(and(eq(timeSessions.id, sessionId), eq(timeSessions.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function pauseTimer(formData: FormData): Promise<TimerState> {
  try {
    const actor = await requireActor();
    const session = await loadOwnSession(
      String(formData.get("sessionId") ?? ""),
      actor.id,
    );
    if (!session) return { error: "Timer not found." };
    if (session.status !== "running") return { error: "That timer is not running." };

    // Bank the current segment, then drop the marker.
    await db
      .update(timeSessions)
      .set({
        status: "paused",
        accumulatedSeconds: elapsedSeconds(session),
        resumedAt: null,
      })
      .where(eq(timeSessions.id, session.id));

    revalidatePath(`/projects/${session.projectId}`);
    return { ok: true, message: "Paused." };
  } catch (err) {
    return fail(err);
  }
}

export async function resumeTimer(formData: FormData): Promise<TimerState> {
  try {
    const actor = await requireActor();
    const session = await loadOwnSession(
      String(formData.get("sessionId") ?? ""),
      actor.id,
    );
    if (!session) return { error: "Timer not found." };
    if (session.status !== "paused") return { error: "That timer is not paused." };

    await db
      .update(timeSessions)
      .set({ status: "running", resumedAt: new Date() })
      .where(eq(timeSessions.id, session.id));

    revalidatePath(`/projects/${session.projectId}`);
    return { ok: true, message: "Resumed." };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Ends the session and turns it into a work log through the same fan-out the
 * manual form uses, so the revision chain and reviewer notification behave
 * identically whether the hours were typed or measured.
 */
export async function finishTimer(
  _prev: TimerState,
  formData: FormData,
): Promise<TimerState> {
  try {
    const actor = await requireActor();
    assertCan(actor.globalRole, "worklog.create");

    const data = finishTimerSchema.parse({
      sessionId: String(formData.get("sessionId") ?? ""),
      note: String(formData.get("note") ?? ""),
      resultingStatus: String(formData.get("resultingStatus") || "in_review"),
    });

    const session = await loadOwnSession(data.sessionId, actor.id);
    if (!session) return { error: "Timer not found." };
    if (session.status === "completed")
      return { error: "That timer is already finished." };

    await assertProjectAccess(actor, session.projectId);

    const seconds = elapsedSeconds(session);
    const hours = secondsToHours(seconds);
    if (hours <= 0) {
      return {
        error: "Less than a minute tracked. Use the manual form for this one.",
      };
    }

    await db.transaction(async (tx) => {
      const recorded = await recordWorkInTx(tx, {
        projectId: session.projectId,
        taskId: session.taskId,
        userId: actor.id,
        hours,
        internalNotes: data.note,
        resultingStatus: data.resultingStatus,
      });

      await tx
        .update(timeSessions)
        .set({
          status: "completed",
          endedAt: new Date(),
          accumulatedSeconds: seconds,
          resumedAt: null,
          completionNote: data.note,
          workLogId: recorded.entry.id,
        })
        .where(eq(timeSessions.id, session.id));
    });

    revalidatePath(`/projects/${session.projectId}`);
    revalidatePath("/");
    return { ok: true, message: `Logged ${hours.toFixed(2)}h.` };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Corrects a session somebody forgot to stop. The reason is mandatory and the
 * original measured value is left in place — an adjustment should be visible
 * as an adjustment, not overwrite the evidence.
 */
export async function adjustTimer(
  _prev: TimerState,
  formData: FormData,
): Promise<TimerState> {
  try {
    const actor = await requireActor();
    const data = adjustTimerSchema.parse({
      sessionId: String(formData.get("sessionId") ?? ""),
      minutes: formData.get("minutes"),
      reason: String(formData.get("reason") ?? ""),
    });

    const session = await loadOwnSession(data.sessionId, actor.id);
    if (!session) return { error: "Timer not found." };

    const corrected = data.minutes * 60;

    await db.transaction(async (tx) => {
      await tx
        .update(timeSessions)
        .set({
          status: "paused",
          accumulatedSeconds: corrected,
          adjustedSeconds: corrected,
          adjustmentReason: data.reason,
          resumedAt: null,
        })
        .where(eq(timeSessions.id, session.id));

      await writeAudit(tx, {
        actorId: actor.id,
        projectId: session.projectId,
        entityType: "time_session",
        entityId: session.id,
        action: "timer.adjust",
        before: { seconds: elapsedSeconds(session) },
        after: { seconds: corrected, reason: data.reason },
      });
    });

    revalidatePath(`/projects/${session.projectId}`);
    return { ok: true, message: "Time corrected." };
  } catch (err) {
    return fail(err);
  }
}

/** Abandons a session without logging anything. */
export async function discardTimer(formData: FormData): Promise<TimerState> {
  try {
    const actor = await requireActor();
    const session = await loadOwnSession(
      String(formData.get("sessionId") ?? ""),
      actor.id,
    );
    if (!session) return { error: "Timer not found." };

    await db.delete(timeSessions).where(eq(timeSessions.id, session.id));
    revalidatePath(`/projects/${session.projectId}`);
    return { ok: true, message: "Timer discarded. Nothing was logged." };
  } catch (err) {
    return fail(err);
  }
}
