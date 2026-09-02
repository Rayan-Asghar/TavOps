"use client";

import { useActionState, useState } from "react";
import {
  connectSheet,
  disconnectSheet,
  retryFailedSyncs,
  toggleSheetSync,
} from "@/server/sheet-connection";
import type { SheetOwner, SheetStatus } from "@/server/sheet-queries";
import { ActionButton, FormError, FormSuccess } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";
import { Badge } from "./badges";
import { CopyField } from "./copy-field";

const initial: ActionState = {};

function fmtWhen(d: Date | null): string {
  if (!d) return "never";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * One person's work-log sheet on one project.
 *
 * Written one way. The developer never sees this panel — they log work in
 * Tavren, and the entry goes to the sheet for that project and that person.
 * Two developers on a project keep two sheets and never appear in each
 * other's.
 *
 * The service-account address leads, because nothing works until the sheet is
 * shared with it and that is the step people forget.
 */
export function SheetPanel({
  owner,
  personName,
  status,
  serviceAccountEmail,
  templateCopyHref,
}: {
  owner: SheetOwner;
  /** Whose sheet this is, for the headings. */
  personName: string;
  status: SheetStatus;
  serviceAccountEmail: string | null;
  /** Null when no template is configured on the server. */
  templateCopyHref: string | null;
}) {
  const [connectState, connectAction, connecting] = useActionState(
    connectSheet,
    initial,
  );
  const [reconnecting, setReconnecting] = useState(false);

  const conn = status.connection;
  const connected = conn && !reconnecting;
  const syncing = conn?.status === "active";

  if (!serviceAccountEmail) {
    return (
      <section className="panel p-5">
        <p className="eyebrow m-0">WORK LOG SHEET</p>
        <p className="m-0 mt-2 text-[12px] text-fg-muted">
          Google Sheets is not configured on the server. An admin needs to set
          the service account credentials before a sheet can be attached.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="panel p-5">
        <p className="eyebrow m-0">STEP 1 — SHARE THE SHEET</p>
        <p className="m-0 mb-3 mt-1 text-[12px] text-fg-muted">
          Open the spreadsheet, press <b>Share</b>, and give this address{" "}
          <b>Editor</b> access. Every sheet uses the same address, and nothing
          syncs until this is done. Anyone else with Editor should be set to{" "}
          <b>Viewer</b> — edits made in the sheet are never read back, and are
          overwritten by the next correction.
        </p>
        <CopyField value={serviceAccountEmail} label="Share with" />
      </section>

      {connected ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">CONNECTED</p>
              <h3 className="m-0 text-base tracking-[-.03em]">{conn!.tabName}</h3>
            </div>
            <div className="flex items-center gap-2">
              {conn!.status === "error" ? (
                <Badge tone="red">Not syncing</Badge>
              ) : syncing ? (
                <Badge tone="green">Syncing</Badge>
              ) : (
                <Badge tone="neutral">Paused</Badge>
              )}
              {conn!.visibility === "shareable" && (
                <Badge tone="blue">Notes withheld</Badge>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-4">
            {[
              ["Synced", String(status.synced)],
              ["Queued", String(status.queued)],
              ["Failed", String(status.failed)],
              ["Last sync", fmtWhen(conn!.lastSyncAt)],
            ].map(([label, value]) => (
              <div key={label} className="bg-surface px-4 py-3">
                <div className="text-[9px] font-black uppercase tracking-[.12em] text-fg-muted">
                  {label}
                </div>
                <div
                  className={`mt-0.5 text-base font-extrabold ${
                    label === "Failed" && status.failed > 0 ? "text-danger" : ""
                  }`}
                >
                  {value}
                </div>
              </div>
            ))}
          </div>

          {conn!.status === "error" && conn!.errorMessage && (
            <div className="border-b border-border bg-danger-soft px-5 py-3">
              <p className="m-0 text-[11px] font-bold text-danger">
                This sheet has stopped accepting updates
              </p>
              <p className="m-0 mt-1 font-mono text-[10px] text-danger">
                {conn!.errorMessage}
              </p>
              <div className="mt-2">
                <ActionButton
                  action={retryFailedSyncs}
                  fields={{ connectionId: conn!.id }}
                  pendingLabel="Retrying…"
                >
                  Retry
                </ActionButton>
              </div>
            </div>
          )}

          <div className="px-5 py-4">
            <p className="eyebrow m-0">WHAT GOES ACROSS</p>
            <p className="m-0 mt-1.5 text-[11px] text-fg-muted">
              Every hour {personName} logs on this project, one row each: the
              date and the hours
              {conn!.visibility === "internal" ? ", and what was done" : ""}.
              Entries go into the tab for their month, and Tavren adds each new
              month&rsquo;s tab itself. Corrections update the row they belong
              to; a removed entry stays as a zero-hour row.
            </p>
            <p className="m-0 mt-2 text-[10px] text-fg-subtle">
              Tavren fills the date, hours, notes and a hidden id. The project
              column, the link column and the totals at the top are yours — it
              never writes to them.
            </p>
            <a
              href={conn!.spreadsheetUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary btn-sm mt-3 inline-block"
            >
              Open sheet
            </a>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-border px-5 py-4">
            <ActionButton
              action={toggleSheetSync}
              fields={{
                connectionId: conn!.id,
                enabled: syncing ? "false" : "true",
              }}
            >
              {syncing ? "Pause syncing" : "Resume syncing"}
            </ActionButton>
            <button
              type="button"
              onClick={() => setReconnecting(true)}
              className="btn-secondary btn-sm"
            >
              Change sheet
            </button>
            <div className="ml-auto">
              <ActionButton
                action={disconnectSheet}
                fields={{ connectionId: conn!.id }}
                confirm="Disconnect?"
                className="px-3 py-2 text-[11px] font-bold text-fg-muted hover:text-danger"
              >
                Disconnect
              </ActionButton>
            </div>
          </div>
        </section>
      ) : (
        <section className="panel p-5">
          <p className="eyebrow m-0">STEP 2 — ATTACH {personName.toUpperCase()}&rsquo;S SHEET</p>

          {templateCopyHref && (
            <div className="mt-2 rounded-lg border border-border bg-surface-2 p-3">
              <p className="m-0 text-[11px] font-bold">
                Starting fresh? Take a copy of the Tavren template.
              </p>
              <p className="m-0 mt-1 text-[10px] text-fg-muted">
                It opens in your own Google Drive, owned by you. Name it
                something like <i>Client — Project — Work Log</i>, share it with
                the address above, then paste its link below.
              </p>
              <a
                href={templateCopyHref}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary btn-sm mt-2 inline-block"
              >
                Copy the template
              </a>
            </div>
          )}

          <form action={connectAction} className="mt-3 space-y-3">
            <input type="hidden" name="projectId" value={owner.projectId} />
            <input type="hidden" name="userId" value={owner.userId} />
            <div>
              <label className="label" htmlFor="sheetUrl">
                Google Sheet link
              </label>
              <input
                id="sheetUrl"
                name="sheetUrl"
                required
                className="field"
                placeholder="https://docs.google.com/spreadsheets/d/…"
                defaultValue={conn?.spreadsheetUrl ?? ""}
              />
              <p className="mt-1 text-[9px] text-fg-subtle">
                Paste the whole URL from your browser. The sheet must already be
                the Tavren template — its columns are not configurable.
              </p>
            </div>

            <div>
              <label className="label" htmlFor="visibility">
                Who reads this sheet
              </label>
              <select
                id="visibility"
                name="visibility"
                className="field"
                defaultValue={conn?.visibility ?? "internal"}
              >
                <option value="internal">
                  Internal only — include what was done
                </option>
                <option value="shareable">
                  May be shared outside Tavren — leave that column empty
                </option>
              </select>
              <p className="mt-1 text-[10px] text-fg-muted">
                Work notes are written for the team. Choosing the second option
                withholds them from every row written after it, so a sheet that
                later gets shared does not carry them.
              </p>
            </div>

            <label className="flex items-start gap-2 text-[11px]">
              <input
                type="checkbox"
                name="backfill"
                value="true"
                defaultChecked
                className="mt-0.5"
              />
              <span>
                Add {personName}&rsquo;s existing work on this project
                <span className="block text-[10px] text-fg-subtle">
                  Only their entries, only on this project. Otherwise the sheet
                  starts empty and just new work appears.
                </span>
              </span>
            </label>

            {connectState.error && <FormError>{connectState.error}</FormError>}
            {connectState.ok && connectState.message && (
              <FormSuccess>{connectState.message}</FormSuccess>
            )}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={connecting}
                className="btn-primary btn-sm"
              >
                {connecting ? "Checking…" : "Connect this sheet"}
              </button>
              {reconnecting && (
                <button
                  type="button"
                  onClick={() => setReconnecting(false)}
                  className="px-3 text-[11px] font-bold text-fg-muted"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
