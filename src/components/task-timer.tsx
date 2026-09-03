"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  startTimer,
  pauseTimer,
  resumeTimer,
  finishTimer,
  adjustTimer,
  discardTimer,
  restoreTimer,
  type TimerState,
} from "@/server/timer";
import { elapsedSeconds, formatClock, secondsToHours } from "@/lib/timer-utils";
import {
  FormError,
  FormSuccess,
  useActionToast,
  useToast,
} from "@/components/ui";

const initial: TimerState = {};

export type ActiveSession = {
  id: string;
  taskId: string;
  taskTitle: string;
  status: "running" | "paused";
  accumulatedSeconds: number;
  resumedAt: string | null;
  startedAt: string;
};

/** Live readout. Ticks the display only — the value itself is derived from
 *  timestamps, so a missed tick or a slept laptop cannot lose time. */
function Clock({ session }: { session: ActiveSession }) {
  // Only "now" lives in state; the elapsed value is derived from it on every
  // render. Nothing accumulates in the component, so a missed tick, a slept
  // laptop or a remount cannot drift the number.
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (session.status !== "running") return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [session.status]);

  const seconds = elapsedSeconds(
    {
      status: session.status,
      accumulatedSeconds: session.accumulatedSeconds,
      resumedAt: session.resumedAt,
    },
    nowMs,
  );

  return (
    <div className="flex items-baseline gap-2">
      {/* Server and client render a second or two apart; the tick corrects it
          immediately, so the initial mismatch is not worth a warning. */}
      <span
        suppressHydrationWarning
        className="font-mono text-[30px] leading-none tracking-tight tabular-nums"
      >
        {formatClock(seconds)}
      </span>
      <span suppressHydrationWarning className="text-xs text-fg-muted">
        {secondsToHours(seconds).toFixed(2)}h
      </span>
    </div>
  );
}

/**
 * Pause / Resume / Discard.
 *
 * Awaits inside a transition rather than using useActionState, because a
 * successful discard unmounts this whole panel during revalidation — the
 * result would be handed to a component that no longer exists, which is why
 * these actions' messages were never seen. The toast lives up in the shell.
 *
 * Discard deletes accumulated time outright on one click. The action returns
 * everything needed to re-insert it, so undo is a replay.
 */
function TimerActionButton({
  action,
  sessionId,
  label,
  className,
  undoWith,
}: {
  action: (fd: FormData) => Promise<TimerState>;
  sessionId: string;
  label: string;
  className: string;
  /** Given the result's undoToken, the action that puts it back. */
  undoWith?: (fd: FormData) => Promise<TimerState>;
}) {
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const run = () => {
    const fd = new FormData();
    fd.set("sessionId", sessionId);

    startTransition(async () => {
      const state = await action(fd);

      if (state.error) {
        toast({ message: state.error, tone: "error" });
        return;
      }
      if (!state.ok) return;

      const token = state.undoToken;
      toast({
        message: state.message ?? "Done.",
        undo:
          undoWith && token
            ? {
                run: async () => {
                  const undoData = new FormData();
                  undoData.set("undoToken", token);
                  const r = await undoWith(undoData);
                  if (r.error) toast({ message: r.error, tone: "error" });
                },
              }
            : undefined,
      });
    });
  };

  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      className={className}
    >
      {pending ? "…" : label}
    </button>
  );
}

/**
 * Start button for a task with no timer running.
 *
 * Transition rather than useActionState for the same reason as the panel: on
 * success the row re-renders as "TIMING" and this button is gone, so anything
 * watching the returned state never sees it.
 */
export function StartTimerButton({
  taskId,
  disabled,
  label = "Start",
  blockedReason,
}: {
  taskId: string;
  disabled?: boolean;
  label?: string;
  /** Why the button is off. Shown, not just put in a title= nobody can reach. */
  blockedReason?: string;
}) {
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  const run = () => {
    const fd = new FormData();
    fd.set("taskId", taskId);
    startTransition(async () => {
      const state = await startTimer(fd);
      if (state.error) toast({ message: state.error, tone: "error" });
      else if (state.ok) toast({ message: state.message ?? "Timer started." });
    });
  };

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending || disabled}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5
                   text-xs font-bold transition-[color,background-color,border-color] duration-150 ease-out-quad hover:border-border-strong
                   disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="h-[7px] w-[7px] rounded-full bg-brand" aria-hidden />
        {pending ? "…" : label}
      </button>
      {disabled && blockedReason && (
        <span className="max-w-[220px] text-right text-2xs text-fg-muted">
          {blockedReason}
        </span>
      )}
    </span>
  );
}

/** The bar shown while a session is open. */
export function ActiveTimerPanel({ session }: { session: ActiveSession }) {
  const [finishState, finishAction, finishing] = useActionState(
    finishTimer,
    initial,
  );
  const [adjustState, adjustAction, adjusting] = useActionState(
    adjustTimer,
    initial,
  );
  const [showAdjust, setShowAdjust] = useState(false);
  const running = session.status === "running";

  return (
    <section className="panel border-l-[3px] border-l-brand p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="eyebrow m-0">
          {running ? "TIMER RUNNING" : "TIMER PAUSED"}
        </p>
        <span
          className={`h-[7px] w-[7px] rounded-full ${running ? "animate-pulse bg-brand" : "bg-fg-subtle"}`}
          aria-hidden
        />
      </div>

      <h3 className="m-0 mb-1 text-lg font-bold">{session.taskTitle}</h3>
      <div className="mb-4">
        <Clock session={session} />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {running ? (
          <TimerActionButton
            action={pauseTimer}
            sessionId={session.id}
            label="Pause"
            className="btn-secondary btn-sm"
          />
        ) : (
          <TimerActionButton
            action={resumeTimer}
            sessionId={session.id}
            label="Resume"
            className="btn-secondary btn-sm"
          />
        )}
        <button
          type="button"
          onClick={() => setShowAdjust((v) => !v)}
          className="btn-secondary btn-sm"
        >
          Correct time
        </button>
        <TimerActionButton
          action={discardTimer}
          sessionId={session.id}
          label="Discard"
          className="btn-ghost btn-sm btn-ghost-danger"
          undoWith={restoreTimer}
        />
      </div>

      {showAdjust && (
        <form
          action={adjustAction}
          className="mb-4 space-y-2 rounded-lg bg-surface-2 p-3"
        >
          <input type="hidden" name="sessionId" value={session.id} />
          <p className="m-0 text-xs text-fg-muted">
            Forgot to stop it? Set the real time. The measured value is kept
            alongside the correction.
          </p>
          <div className="flex gap-2">
            <input
              name="minutes"
              type="number"
              min={1}
              required
              placeholder="Minutes"
              className="field"
              aria-label="Corrected minutes"
            />
          </div>
          <input
            name="reason"
            required
            placeholder="Why (e.g. left running over lunch)"
            className="field"
            aria-label="Reason for correction"
          />
          {adjustState.error && (
            <p role="alert" className="text-xs text-danger">
              {adjustState.error}
            </p>
          )}
          <button
            type="submit"
            disabled={adjusting}
            className="btn-secondary btn-sm w-full"
          >
            {adjusting ? "Saving…" : "Apply correction"}
          </button>
        </form>
      )}

      <form action={finishAction} className="space-y-2 border-t border-border pt-4">
        <input type="hidden" name="sessionId" value={session.id} />
        <label className="label" htmlFor="finish-note">
          What you finished <span className="text-fg-subtle">(internal)</span>
        </label>
        <textarea
          id="finish-note"
          name="note"
          rows={2}
          required
          className="field"
          placeholder="Hero completed for desktop/mobile. Ready for QA."
        />

        <label className="label" htmlFor="finish-status">
          Move task to
        </label>
        <select id="finish-status" name="resultingStatus" className="field">
          <option value="in_review">Ready for review</option>
          <option value="done">Done</option>
          <option value="in_progress">Still in progress</option>
        </select>

        {finishState.error && (
          <FormError>{finishState.error}</FormError>
        )}
        {finishState.ok && finishState.message && (
          <FormSuccess>{finishState.message}</FormSuccess>
        )}

        <button type="submit" disabled={finishing} className="btn-primary w-full">
          {finishing ? "Logging…" : "Finish & log time"}
        </button>
        <p className="m-0 text-2xs text-fg-subtle">
          Hours are taken from the timer, not typed.
        </p>
      </form>
    </section>
  );
}
