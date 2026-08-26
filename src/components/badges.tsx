import type { ReactNode } from "react";

/* Tinted fills rather than solid ones: on a near-black surface a saturated
   block of colour fights the crimson brand accent for attention, and the
   accent has to stay the loudest thing on the page. */
const TONES = {
  neutral: "bg-surface-3 text-fg-muted border-border-strong",
  green: "bg-ok/12 text-ok border-ok/30",
  amber: "bg-warn/12 text-warn border-warn/30",
  red: "bg-danger/15 text-danger border-danger/35",
  blue: "bg-info/12 text-info border-info/30",
  violet: "bg-[#a78bfa]/12 text-[#a78bfa] border-[#a78bfa]/30",
} as const;

export type Tone = keyof typeof TONES;

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

const HEALTH_TONE: Record<string, Tone> = {
  on_track: "green",
  at_risk: "amber",
  blocked: "red",
};

export function HealthBadge({ health }: { health: string }) {
  return (
    <Badge tone={HEALTH_TONE[health] ?? "neutral"}>
      {health.replace("_", " ")}
    </Badge>
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
      {status.replace("_", " ")}
    </Badge>
  );
}
