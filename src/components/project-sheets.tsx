import Link from "next/link";
import type { MemberSheet } from "@/server/sheet-queries";
import { Badge } from "./badges";
import { CopyField } from "./copy-field";

/**
 * Who on this project has a work-log sheet.
 *
 * A sheet belongs to one person on one project, so this is the place both are
 * visible at once. Two developers here keep two sheets; the same developer on
 * another project keeps a different one there.
 *
 * The service-account address leads because nothing syncs until each sheet is
 * shared with it, and that is the step people forget.
 */
export function ProjectSheets({
  projectId,
  members,
  serviceAccountEmail,
  selectedUserId,
}: {
  projectId: string;
  members: MemberSheet[];
  serviceAccountEmail: string | null;
  selectedUserId?: string;
}) {
  if (!serviceAccountEmail) {
    return (
      <section className="panel p-5">
        <p className="eyebrow m-0">WORK LOG SHEETS</p>
        <p className="m-0 mt-2 text-[12px] text-fg-muted">
          Google Sheets is not configured on the server. An admin needs to set
          the service account credentials before sheets can be allotted.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="panel p-5">
        <p className="eyebrow m-0">SHARE EVERY SHEET WITH THIS ADDRESS</p>
        <p className="m-0 mb-3 mt-1 text-[12px] text-fg-muted">
          Each person&rsquo;s sheet needs <b>Editor</b> access for this address,
          and nothing syncs until it has it. Everyone else should be{" "}
          <b>Viewer</b> — edits made in a sheet are never read back, and are
          overwritten by the next correction.
        </p>
        <CopyField value={serviceAccountEmail} label="Share with" />
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">ONE SHEET PER PERSON</p>
            <h3 className="m-0 text-base tracking-[-.03em]">
              Who logs to which sheet
            </h3>
          </div>
          <span className="text-[11px] text-fg-muted">
            a tab per month, added automatically
          </span>
        </div>

        <div className="px-5 py-1">
          {members.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-fg-muted">
              Nobody is on this project yet. Add people on the Team tab first —
              a sheet belongs to a person, so there is nobody to allot one to.
            </p>
          ) : (
            members.map((m) => (
              <div
                key={m.userId}
                className="flex flex-wrap items-center gap-3 border-b border-border py-3 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-bold">{m.name}</div>
                  <div className="text-[9px] text-fg-subtle">{m.role}</div>
                </div>

                {m.status === "error" ? (
                  <Badge tone="red">Not syncing</Badge>
                ) : m.status === "paused" ? (
                  <Badge tone="neutral">Paused</Badge>
                ) : m.status ? (
                  <Badge tone="green">Syncing</Badge>
                ) : (
                  <Badge tone="neutral">No sheet</Badge>
                )}

                {m.failed > 0 && (
                  <span className="text-[10px] font-bold text-danger">
                    {m.failed} failed
                  </span>
                )}
                {m.queued > 0 && (
                  <span className="text-[10px] text-fg-muted">
                    {m.queued} queued
                  </span>
                )}

                {m.spreadsheetUrl && (
                  <a
                    href={m.spreadsheetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-bold text-fg-muted hover:text-fg"
                  >
                    Open
                  </a>
                )}

                <Link
                  href={`/projects/${projectId}?tab=sheet&person=${m.userId}`}
                  className="btn-secondary btn-sm"
                  aria-current={selectedUserId === m.userId ? "true" : undefined}
                >
                  {m.connectionId ? "Change" : "Allot a sheet"}
                </Link>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
