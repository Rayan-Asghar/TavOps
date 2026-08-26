import type { ReactNode } from "react";
import { CheckIcon, AlertIcon } from "./icons";

/* Soft-tinted pills on a light canvas, per the reference. Crimson is reserved
   for brand actions and true urgency, so danger uses the deeper red. */
const TONES = {
  neutral: "bg-[#ededed] text-[#555]",
  green: "bg-ok-soft text-ok",
  amber: "bg-warn-soft text-warn",
  red: "bg-danger-soft text-danger",
  blue: "bg-info-soft text-info",
  violet: "bg-[#efe9fb] text-[#5b3fa8]",
} as const;

export type Tone = keyof typeof TONES;

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
      <span className="inline-flex items-center gap-1.5 text-[8px] font-black uppercase tracking-[.09em] text-danger">
        <AlertIcon /> At Risk
      </span>
    );
  }
  if (health === "at_risk") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[8px] font-black uppercase tracking-[.09em] text-warn">
        <AlertIcon /> Attention
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[8px] font-black uppercase tracking-[.09em] text-ok">
      <CheckIcon /> Healthy
    </span>
  );
}

const TASK_TONE: Record<string, Tone> = {
  todo: "neutral",
  in_progress: "blue",
  blocked: "red",
  in_review: "violet",
  done: "green",
};

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
        accent ? "bg-fg text-white" : "bg-surface"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className={`text-[9px] font-black uppercase tracking-[.12em] ${
            accent ? "text-[#aaa]" : "text-fg-muted"
          }`}
        >
          {label}
        </span>
        {change && (
          <span
            className={`text-[9px] font-semibold ${
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
      <strong className="mt-6 block text-[43px] leading-none tracking-[-.055em]">
        {value}
      </strong>
      {typeof progress === "number" && (
        <div className="progress">
          <span style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
        </div>
      )}
      {note && (
        <p
          className={`mt-3.5 max-w-[220px] text-[11px] ${
            accent ? "text-[#aaa]" : "text-fg-muted"
          }`}
        >
          {note}
        </p>
      )}
    </article>
  );
}
