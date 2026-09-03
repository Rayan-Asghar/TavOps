import type { ReactNode } from "react";
import { CheckIcon, InboxIcon, ProjectsIcon } from "../icons";

/**
 * Empty states, typed.
 *
 * There used to be one component here that every page reused with different
 * copy. DESIGN-STANDARD 2.2 makes that an explicit [FAIL IF], and r40/r41 say
 * why: an empty region has to distinguish *empty* from *loading* from *broken*,
 * and the three reasons a region is empty want three different answers.
 *
 *  - `blank-slate` — nothing has ever been created. Teach, and offer the one
 *     action that fixes it.
 *  - `no-results`  — a filter excluded everything. Say what was searched, and
 *     offer a way back. Never a dead end.
 *  - `cleared`     — the work is genuinely done. This is a completion state,
 *     not an absence; 5.8 calls a queue reaching zero the one place elaborate
 *     motion is earned.
 *
 * Copy rules from 2.2: Title Case titles, sentence-case descriptions that add
 * information rather than restating the title, CTA labels as Verb + Noun, and
 * at most one primary action — "three CTAs is a smell".
 */

export type EmptyVariant = "blank-slate" | "no-results" | "cleared";

const ICON: Record<EmptyVariant, ReactNode> = {
  "blank-slate": <ProjectsIcon className="h-5 w-5" />,
  "no-results": <InboxIcon className="h-5 w-5" />,
  cleared: <CheckIcon className="h-4 w-4" />,
};

/** Tone is carried by the mark, never by colour alone — the title says it too. */
const TONE: Record<EmptyVariant, string> = {
  "blank-slate": "border-border bg-surface-2 text-fg-muted",
  "no-results": "border-border bg-surface-2 text-fg-muted",
  cleared: "border-ok/30 bg-ok-soft text-ok",
};

/** Stands alone on a page and draws its own panel. */
export function EmptyState({
  variant = "blank-slate",
  title,
  action,
  className = "",
  children,
}: {
  variant?: EmptyVariant;
  /** Title Case. Omit only when the description alone is the whole message. */
  title?: string;
  /** One primary action. Verb + Noun. */
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`panel flex flex-col items-center gap-3 px-6 py-12 text-center ${className}`}
      /* r40: after an async filter this region replaces content the user was
         reading, so its arrival has to be announced rather than silently swapped. */
      {...(variant === "no-results" ? { role: "status", "aria-live": "polite" as const } : {})}
    >
      <span
        aria-hidden
        className={`grid h-10 w-10 place-items-center rounded-full border ${TONE[variant]}`}
      >
        {ICON[variant]}
      </span>
      {title && (
        <h3 className="m-0 text-base font-bold tracking-[-.01em] text-fg">{title}</h3>
      )}
      <p className="m-0 max-w-[46ch] text-sm text-fg-muted">{children}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** Sits inside a panel that already has a header, so it draws no frame of its own. */
export function EmptyRow({
  variant = "blank-slate",
  children,
}: {
  variant?: EmptyVariant;
  children: ReactNode;
}) {
  return (
    <p
      className="m-0 px-5 py-10 text-center text-xs text-fg-muted"
      {...(variant === "no-results" ? { role: "status", "aria-live": "polite" as const } : {})}
    >
      {children}
    </p>
  );
}

/** Sits inside a table body, spanning every column. */
export function EmptyCell({
  colSpan,
  variant = "no-results",
  children,
}: {
  colSpan: number;
  variant?: EmptyVariant;
  children: ReactNode;
}) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="px-5 py-10 text-center text-xs text-fg-muted"
        {...(variant === "no-results" ? { role: "status", "aria-live": "polite" as const } : {})}
      >
        {children}
      </td>
    </tr>
  );
}
