import Link from "next/link";
import { Badge, type Tone } from "./badges";
import { ArrowRightIcon } from "./icons";
import { SnoozeButton } from "./snooze-button";
import { DismissButton } from "./dismiss-button";
import { KIND_META, SIGNAL_COLOR, type Signal } from "@/lib/tone";
import { timeAgo } from "@/lib/format";

/**
 * The triage queue.
 *
 * There was a bare-letter keyboard model here — `J`/`K` to move a cursor, `E` to
 * clear, `S` to snooze — built because 2.1 describes Linear's. It came out
 * again: on a queue that is usually two or three items long, reaching for a
 * cursor is slower than clicking the row you are already looking at, and it cost
 * a permanent hint line to teach something nobody needed. ⌘K stays, because a
 * search palette earns its keystroke; single letters firing globally did not.
 *
 * Losing it also makes this a **server component** again — no client bundle for
 * a list of links.
 *
 * 1.3 is what actually matters here and still holds: every action sits on the
 * row, so clearing an item never requires opening a detail view. r18 too — the
 * stripe is conditional, so a queue of routine items carries no red at all
 * rather than shouting on every line.
 */

export type QueueItem = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  projectId: string | null;
  createdAt: Date;
};

/** Only the signals that mean "worse than the rest" get an edge. */
const STRIPE: Record<Signal, string> = {
  critical: "border-l-danger",
  warning: "border-l-signal-warn",
  review: "border-l-transparent",
  waiting: "border-l-transparent",
};

export function AttentionQueue({ items }: { items: QueueItem[] }) {
  const hrefFor = (n: QueueItem) =>
    n.kind === "task_needs_review"
      ? "/review"
      : n.projectId
        ? `/projects/${n.projectId}`
        : null;

  return (
    <ul>
      {items.map((n) => {
        const meta = KIND_META[n.kind] ?? {
          label: n.kind,
          tone: "neutral" as Tone,
          signal: "waiting" as Signal,
        };
        const href = hrefFor(n);
        return (
          <li
            key={n.id}
            className={`attention-row border-l-[3px] ${STRIPE[meta.signal]}`}
          >
            <span
              className={`mt-1.5 signal ${SIGNAL_COLOR[meta.signal]}`}
              aria-hidden
            />
            <div className="min-w-0">
              <strong className="block text-xs">{n.title}</strong>
              {n.body && (
                <span className="mt-0.5 block text-xs text-fg-muted">
                  {n.body}
                </span>
              )}
              <span className="mt-1 block text-2xs text-fg-subtle">
                {timeAgo(n.createdAt)}
              </span>
            </div>
            <div className="col-start-2 flex flex-wrap items-center gap-3 sm:col-start-auto sm:shrink-0 sm:justify-end">
              <Badge tone={meta.tone}>{meta.label}</Badge>
              {/* Review items open the queue rather than the project: the queue
                  is where the approve / send-back decision is made, and it
                  carries the revision round. */}
              {href && (
                <Link
                  href={href}
                  className="btn-text"
                  aria-label={`${n.kind === "task_needs_review" ? "Open review queue" : "Open project"} for: ${n.title}`}
                >
                  {n.kind === "task_needs_review" ? "Review" : "Open"}{" "}
                  <ArrowRightIcon />
                </Link>
              )}
              <SnoozeButton id={n.id} title={n.title} />
              <DismissButton id={n.id} title={n.title} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
