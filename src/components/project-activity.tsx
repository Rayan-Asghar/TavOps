import type { ProjectDetail } from "@/server/project-queries";
import { WorkLogActions } from "./work-log-actions";

import { EmptyRow } from "@/components/ui";
type ActivityRow = NonNullable<ProjectDetail>["activityRows"][number];

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
}

/**
 * The project's work-log feed.
 *
 * A server component: the rows are already loaded, and only the per-entry
 * correction control needs to be interactive. Keeping the list on the server
 * means the notes never ship as client props for entries nobody expands.
 *
 * `seesAllActivity` changes what the list *contains* — that filtering happens
 * in the query, not here — so the heading has to say which of the two the
 * reader is looking at. A partial list that presents itself as the whole one is
 * how somebody concludes a colleague logged nothing.
 */
export function ProjectActivity({
  rows,
  seesAllActivity,
  canEditOthersWork,
  actorId,
}: {
  rows: ActivityRow[];
  seesAllActivity: boolean;
  canEditOthersWork: boolean;
  actorId: string;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">
            {seesAllActivity
              ? "EVERYONE ON THIS PROJECT"
              : "ONLY ENTRIES YOU LOGGED"}
          </p>
          <h3 className="m-0 text-lg tracking-[-.03em]">
            {seesAllActivity ? "Activity" : "Your activity"}
          </h3>
        </div>
        <span className="text-xs text-fg-muted">
          {rows.length} entr{rows.length === 1 ? "y" : "ies"}
        </span>
      </div>

      <div className="px-5 py-1">
        {rows.length === 0 ? (
          <EmptyRow>{seesAllActivity
              ? "Nothing logged yet."
              : "You have not logged anything on this project yet."}</EmptyRow>
        ) : (
          rows.map((l) => (
            <div
              key={l.id}
              className="grid grid-cols-[14px_1fr] gap-2.5 border-b border-border py-3.5 last:border-b-0"
            >
              <span className="mt-1 h-[7px] w-[7px] rounded-full bg-brand" />
              <div className="min-w-0">
                <strong className="text-xs">{l.notes}</strong>
                <p className="m-0 mt-1 text-xs text-fg-muted">
                  {l.taskTitle ?? "General project work"} ·{" "}
                  {Number(l.hours).toFixed(2)}h
                </p>
                <small className="text-2xs text-fg-subtle">
                  {fmtDate(l.workDate)} · {l.userName}
                </small>
                {(canEditOthersWork || l.userId === actorId) && (
                  <WorkLogActions
                    workLogId={l.id}
                    hours={l.hours}
                    notes={l.notes}
                    workDate={l.workDate.toISOString().slice(0, 10)}
                  />
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
