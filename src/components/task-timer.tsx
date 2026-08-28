"use client";

import { useActionState, useEffect, useState } from "react";
import {
  startTimer,
  pauseTimer,
  resumeTimer,
  finishTimer,
  adjustTimer,
  discardTimer,
  type TimerState,
} from "@/server/timer";
import { elapsedSeconds, formatClock, secondsToHours } from "@/lib/timer-utils";

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
      <span suppressHydrationWarning className="text-[10px] text-fg-muted">
        {secondsToHours(seconds).toFixed(2)}h
      </span>
    </div>
  );
}

/** Wraps a TimerState-returning action so a plain <form action> can use it and
 *  still surface the error instead of swallowing it. */
function TimerActionButton({
  action,
  sessionId,
  label,
  className,
}: {
  action: (fd: FormData) => Promise<TimerState>;
  sessionId: string;
  label: string;
  className: string;
}) {
  const [state, formAction, pending] = useActionState(
    async (_p: TimerState, fd: FormData) => action(fd),
    initial,
  );
  return (
    <form action={formAction} className="inline-flex flex-col">
      <input type="hidden" name="sessionId" value={sessionId} />
      <button type="submit" disabled={pending} className={className}>
        {pending ? "…" : label}
      </button>
      {state.error && (
        <span role="alert" className="mt-1 text-[9px] text-danger">
          {state.error}
        </span>
      )}
    </form>
  );
}

/** Start button for a task with no timer running. */
export function StartTimerButton({
  taskId,
  disabled,
  label = "Start",
}: {
  taskId: string;
  disabled?: boolean;
  label?: string;
}) {
  const [state, action, pending] = useActionState(
    async (_p: TimerState, fd: FormData) => startTimer(fd),
    initial,
  );

  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="taskId" value={taskId} />
      <button
        type="submit"
        disabled={pending || disabled}
        title={disabled ? "Finish your running timer first" : undefined}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5
                   text-[10px] font-bold transition-colors hover:border-border-strong
                   disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="h-[7px] w-[7px] rounded-full bg-brand" aria-hidden />
        {pending ? "…" : label}
      </button>
      {state.error && (
        <span role="alert" className="max-w-[220px] text-right text-[9px] text-danger">
          {state.error}
        </span>
      )}
    </form>
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

      <h3 className="m-0 mb-1 text-[15px] font-bold">{session.taskTitle}</h3>
      <div className="mb-4">
        <Clock session={session} />
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {running ? (
          <TimerActionButton
            action={pauseTimer}
            sessionId={session.id}
            label="Pause"
            className="btn-secondary px-3 py-1.5 text-[11px]"
          />
        ) : (
          <TimerActionButton
            action={resumeTimer}
            sessionId={session.id}
            label="Resume"
            className="btn-secondary px-3 py-1.5 text-[11px]"
          />
        )}
        <button
          type="button"
          onClick={() => setShowAdjust((v) => !v)}
          className="btn-secondary px-3 py-1.5 text-[11px]"
        >
          Correct time
        </button>
        <TimerActionButton
          action={discardTimer}
          sessionId={session.id}
          label="Discard"
          className="px-2 py-1.5 text-[11px] font-bold text-fg-muted hover:text-danger"
        />
      </div>

      {showAdjust && (
        <form
          action={adjustAction}
          className="mb-4 space-y-2 rounded-lg bg-surface-2 p-3"
        >
          <input type="hidden" name="sessionId" value={session.id} />
          <p className="m-0 text-[10px] text-fg-muted">
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
            <p role="alert" className="text-[10px] text-danger">
              {adjustState.error}
            </p>
          )}
          <button
            type="submit"
            disabled={adjusting}
            className="btn-secondary w-full py-1.5 text-[11px]"
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

        {/* Same split as the manual form: only this line can reach a client. */}
        <label className="label" htmlFor="finish-client">
          Line for the client <span className="text-fg-subtle">(optional)</span>
        </label>
        <input
          id="finish-client"
          name="clientUpdate"
          maxLength={300}
          className="field"
          placeholder="Homepage complete and in review."
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
          <p
            role="alert"
            className="rounded-lg bg-danger-soft px-3 py-2 text-[11px] font-medium text-danger"
          >
            {finishState.error}
          </p>
        )}
        {finishState.ok && finishState.message && (
          <p className="rounded-lg bg-ok-soft px-3 py-2 text-[11px] font-medium text-ok">
            {finishState.message}
          </p>
        )}

        <button type="submit" disabled={finishing} className="btn-primary w-full">
          {finishing ? "Logging…" : "Finish & log time"}
        </button>
        <p className="m-0 text-[9px] text-fg-subtle">
          Hours are taken from the timer, not typed.
        </p>
      </form>
    </section>
  );
}
