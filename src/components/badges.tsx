import type { ReactNode } from "react";
import { CheckIcon, AlertIcon } from "./icons";

import { TASK_TONE, type Tone } from "@/lib/tone";

export type { Tone };
/* Soft-tinted pills on a light canvas, per the reference. Crimson is reserved
   for brand actions and true urgency, so danger uses the deeper red. */
const TONES: Record<Tone, string> = {
  neutral: "bg-neutral-soft text-neutral",
  green: "bg-ok-soft text-ok",
  amber: "bg-warn-soft text-warn",
  red: "bg-danger-soft text-danger",
  blue: "bg-info-soft text-info",
  violet: "bg-violet-soft text-violet",
};

export function Badge({
  tone = "blue",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return <span className={`tag ${TONES[tone]}`}>{children}</span>;
}

/** Health reads as a word plus a mark, never colour alone. */
export function HealthBadge({ health }: { health: string }) {
  if (health === "blocked") {
    return (
      <span className="inline-flex items-center gap-1.5 text-2xs font-black uppercase tracking-[.09em] text-danger">
        <AlertIcon /> At Risk
      </span>
    );
  }
  if (health === "at_risk") {
    return (
      <span className="inline-flex items-center gap-1.5 text-2xs font-black uppercase tracking-[.09em] text-warn">
        <AlertIcon /> Attention
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-2xs font-black uppercase tracking-[.09em] text-ok">
      <CheckIcon /> Healthy
    </span>
  );
}


export function TaskStatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={TASK_TONE[status] ?? "neutral"}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

/** Bordered metric tile. The grid draws its own left/top edge so the cards
 *  tile seamlessly without doubled borders. */
export function MetricGrid({ children }: { children: ReactNode }) {
  return (
    <section className="my-6 grid grid-cols-1 border-l border-t border-border sm:grid-cols-2 xl:grid-cols-4">
      {children}
    </section>
  );
}

export function MetricCard({
  label,
  value,
  note,
  change,
  changeTone,
  progress,
  accent = false,
}: {
  label: string;
  value: string;
  note?: string;
  change?: string;
  changeTone?: "positive" | "negative";
  progress?: number;
  accent?: boolean;
}) {
  return (
    <article
      className={`min-h-[180px] border-b border-r border-border p-5 ${
        accent ? "bg-fill-strong text-fill-strong-fg" : "bg-surface"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className={`text-2xs font-black uppercase tracking-[.12em] ${
            accent ? "text-nav-fg-muted" : "text-fg-muted"
          }`}
        >
          {label}
        </span>
        {change && (
          <span
            className={`text-2xs font-semibold ${
              changeTone === "positive"
                ? "text-ok"
                : changeTone === "negative"
                  ? "text-brand"
                  : "text-fg-muted"
            }`}
          >
            {change}
          </span>
        )}
      </div>
      <strong className="mt-6 block text-5xl leading-none tracking-[-.055em]">
        {value}
      </strong>
      {typeof progress === "number" && (
        <div className="progress">
          <span style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </div>
      )}
      {note && (
        <p
          className={`mt-3.5 max-w-[220px] text-xs ${
            accent ? "text-nav-fg-muted" : "text-fg-muted"
          }`}
        >
          {note}
        </p>
      )}
    </article>
  );
}
