"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { elapsedSeconds, formatClock } from "@/lib/timer-utils";

/**
 * The running timer, visible on every route.
 *
 * It used to live only in the project page's right rail, which meant it
 * disappeared the moment you navigated anywhere else — and that rail is itself
 * hidden below 1280px. A timer you cannot see is a timer you forget to stop,
 * and this system bills against those hours.
 *
 * Same derivation as the full panel: only "now" is state, the elapsed value
 * comes from the timestamps, so a slept laptop cannot drift it.
 */
export function TimerChip({
  projectId,
  taskTitle,
  status,
  accumulatedSeconds,
  resumedAt,
}: {
  projectId: string;
  taskTitle: string;
  status: "running" | "paused";
  accumulatedSeconds: number;
  resumedAt: string | null;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (status !== "running") return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [status]);

  const seconds = elapsedSeconds(
    { status, accumulatedSeconds, resumedAt },
    nowMs,
  );

  return (
    <Link
      href={`/projects/${projectId}`}
      className="flex min-h-[34px] shrink-0 items-center gap-2 rounded-lg border border-border
                 bg-surface px-2.5 transition-[color,background-color,border-color] duration-150 ease-out-quad hover:border-border-strong"
      title={`${status === "running" ? "Timing" : "Paused"}: ${taskTitle}`}
    >
      <span
        aria-hidden
        className={`h-[7px] w-[7px] shrink-0 rounded-full ${
          status === "running" ? "animate-pulse bg-brand" : "bg-fg-subtle"
        }`}
      />
      <span className="sr-only">
        {status === "running" ? "Timer running on" : "Timer paused on"}
      </span>
      <span className="hidden max-w-[160px] truncate text-2xs font-bold text-fg-muted sm:block">
        {taskTitle}
      </span>
      <span
        suppressHydrationWarning
        className="font-mono text-xs font-bold tabular-nums"
      >
        {formatClock(seconds)}
      </span>
    </Link>
  );
}
