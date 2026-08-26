import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getActor } from "@/lib/auth";
import { inboxFor, unresolvedCount } from "@/server/notifications";
import { dismissNotification } from "@/server/inbox-actions";
import { AppShell } from "@/components/app-shell";
import { Badge, type Tone } from "@/components/badges";

const KIND_LABEL: Record<string, { label: string; tone: Tone }> = {
  blocker_opened: { label: "Blocker", tone: "red" },
  blocker_escalated: { label: "Escalated", tone: "red" },
  blocker_resolved: { label: "Resolved", tone: "green" },
  task_assigned: { label: "Assigned", tone: "blue" },
  task_needs_review: { label: "Review", tone: "violet" },
  task_stalled: { label: "Stalled", tone: "amber" },
  update_missing: { label: "Update due", tone: "amber" },
  sync_failed: { label: "Sync failed", tone: "red" },
  project_at_risk: { label: "At risk", tone: "amber" },
};

function timeAgo(d: Date): string {
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function InboxPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const [me] = await db
    .select({ name: users.name, globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  const [items, count] = await Promise.all([
    inboxFor(actor.id),
    unresolvedCount(actor.id),
  ]);

  const actionable = items.filter((i) => i.isActionable);
  const informational = items.filter((i) => !i.isActionable);

  return (
    <AppShell
      userName={me?.name ?? "Unknown"}
      userRole={me?.globalRole ?? "developer"}
      inboxCount={count}
    >
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-fg">Needs attention</h1>
        <p className="mt-1 text-sm text-fg-muted">
          {actionable.length === 0
            ? "Nothing waiting on you right now."
            : `${actionable.length} item${actionable.length === 1 ? "" : "s"} waiting on you.`}
        </p>
      </div>

      {actionable.length > 0 && (
        <ul className="mb-8 space-y-2">
          {actionable.map((n) => {
            const meta = KIND_LABEL[n.kind] ?? { label: n.kind, tone: "neutral" as Tone };
            return (
              <li key={n.id} className="card flex items-start gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    <span className="text-xs text-fg-subtle">
                      {timeAgo(n.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-fg">{n.title}</p>
                  {n.body && (
                    <p className="mt-1 text-sm text-fg-muted">{n.body}</p>
                  )}
                  {n.projectId && (
                    <Link
                      href={`/projects/${n.projectId}`}
                      className="mt-2 inline-block text-xs font-medium text-brand hover:underline"
                    >
                      Open project →
                    </Link>
                  )}
                </div>
                <form action={dismissNotification}>
                  <input type="hidden" name="id" value={n.id} />
                  <button type="submit" className="btn-ghost text-xs">
                    Dismiss
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}

      {informational.length > 0 && (
        <>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">
            Recent
          </h2>
          <ul className="space-y-2">
            {informational.map((n) => {
              const meta = KIND_LABEL[n.kind] ?? { label: n.kind, tone: "neutral" as Tone };
              return (
                <li
                  key={n.id}
                  className="card flex items-center gap-3 px-4 py-3 text-sm"
                >
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  <span className="min-w-0 flex-1 truncate text-fg">
                    {n.title}
                  </span>
                  <span className="text-xs text-fg-subtle">
                    {timeAgo(n.createdAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {items.length === 0 && (
        <div className="card p-10 text-center">
          <p className="text-sm text-fg-muted">
            Your inbox is clear. Nice.
          </p>
        </div>
      )}
    </AppShell>
  );
}
