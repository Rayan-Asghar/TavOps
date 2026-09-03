"use client";

import { useEffect, useState, useTransition } from "react";
import { elapsedSeconds, secondsToHours, formatClock } from "@/lib/timer-utils";
import { finishTimer, pauseTimer, resumeTimer } from "@/server/timer";
import { useToast } from "@/components/ui";
import { TimerIcon } from "@/components/icons";
import type { GridColumn } from "@/lib/grid-columns";

/**
 * A timer that is still running, shown in the grid as a row that is not an
 * entry yet.
 *
 * The hours tick, but nothing here accumulates: the value is recomputed from
 * the server's `accumulated_seconds` and `resumed_at` on every render, which is
 * the rule `timer-utils.ts` states in its own header — elapsed time is always
 * derived, never ticked. A missed tick, a slept laptop or a remount therefore
 * cannot drift it.
 *
 * It sits outside the totals on purpose. Time that has not been logged has not
 * been logged, and folding it into "total hours" would make the strip disagree
 * with both the database and the sheet.
 */

export type GridTimerSession = {
  id: string;
  taskTitle: string;
  status: "running" | "paused";
  accumulatedSeconds: number;
  resumedAt: string | null;
};

export function GridTimerRow({
  session,
  columns,
  rowIndex,
  note,
  onNote,
}: {
  session: GridTimerSession;
  columns: readonly GridColumn[];
  rowIndex: number;
  note: string;
  onNote: (v: string) => void;
}) {
  const seconds = useTick(session);
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const act = (fn: () => Promise<{ error?: string; message?: string }>) =>
    startTransition(async () => {
      const r = await fn();
      if (r.error) toast({ message: r.error, tone: "error" });
      else if (r.message) toast({ message: r.message });
    });

  const finish = () => {
    if (note.trim().length < 3) {
      toast({
        message: "Say what you did in the notes cell before finishing.",
        tone: "error",
      });
      return;
    }
    act(async () => {
      const form = new FormData();
      form.append("sessionId", session.id);
      form.append("note", note.trim());
      form.append("resultingStatus", "in_review");
      return finishTimer({}, form);
    });
  };

  const simple = (fn: (f: FormData) => Promise<{ error?: string; message?: string }>) =>
    act(async () => {
      const form = new FormData();
      form.append("sessionId", session.id);
      return fn(form);
    });

  return (
    <tr
      role="row"
      aria-rowindex={rowIndex + 2}
      data-timer="running"
      className="border-b border-border bg-warn-soft"
    >
      <td role="gridcell" aria-colindex={1} className="border-r border-border text-center">
        <span className="inline-flex text-fg" title="Timer running">
          <TimerIcon className="h-3.5 w-3.5" />
          <span className="sr-only">Timer running</span>
        </span>
      </td>
      {columns.map((col, c) => (
        <td
          key={col.key}
          role="gridcell"
          aria-colindex={c + 2}
          aria-readonly={col.key === "notes" ? undefined : true}
          className={`h-[32px] border-r border-border px-3 align-middle last:border-r-0
            ${col.align === "right" ? "text-right tabular-nums" : "text-left"}`}
        >
          {col.key === "date" && (
            <span className="font-bold text-fg">{formatClock(seconds)}</span>
          )}
          {col.key === "person" && <span className="text-fg-muted">{session.taskTitle}</span>}
          {col.key === "hours" && (
            <span className="font-bold text-fg">
              {secondsToHours(seconds).toFixed(2)}
            </span>
          )}
          {col.key === "notes" && (
            <input
              value={note}
              onChange={(e) => onNote(e.target.value)}
              placeholder="What did you do? Needed before you can finish."
              aria-label="Completion note for the running timer"
              className="h-[28px] w-full border-0 bg-transparent text-xs text-fg outline-none placeholder:text-fg-subtle"
            />
          )}
          {col.key === "id" && (
            <span className="flex justify-end gap-1.5">
              {session.status === "running" ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => simple(pauseTimer)}
                  className="btn-ghost btn-xs"
                >
                  Pause
                </button>
              ) : (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => simple(resumeTimer)}
                  className="btn-ghost btn-xs"
                >
                  Resume
                </button>
              )}
              <button
                type="button"
                disabled={pending}
                onClick={finish}
                className="btn-primary btn-xs"
              >
                {pending ? "…" : "Finish"}
              </button>
            </span>
          )}
        </td>
      ))}
    </tr>
  );
}

/** Re-renders once a second while running; the number itself is derived. */
function useTick(session: GridTimerSession): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (session.status !== "running") return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [session.status]);
  return elapsedSeconds(session, nowMs);
}
