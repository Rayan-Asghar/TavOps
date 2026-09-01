"use client";

import { useActionState, useState } from "react";
import {
  connectSheet,
  disconnectSheet,
  retryFailedSyncs,
  toggleSheetSync,
} from "@/server/sheet-connection";
import type { SheetStatus } from "@/server/sheet-queries";
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
 * The project's work-log sheet.
 *
 * One sheet per project, written one way. Developers never see this — they log
 * work and Tavren decides which sheet the entry belongs in from the project on
 * the task. Only whoever runs the project attaches it, once.
 *
 * The service-account address leads, because nothing works until the sheet is
 * shared with it and that is the step people forget.
 */
export function SheetPanel({
  projectId,
  status,
  serviceAccountEmail,
  templateCopyHref,
}: {
  projectId: string;
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
          the service account credentials before projects can attach a sheet.
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
          <b>Editor</b> access. Every project uses the same address, and nothing
          syncs until this is done.
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
                  fields={{ projectId }}
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
              Every work log on this project, one row each: date, developer,
              project, task, hours
              {conn!.visibility === "internal" ? ", what was done" : ""}, and
              status. Corrections update the row they belong to; a removed entry
              stays as a zero-hour row marked <b>Removed</b>.
            </p>
            <p className="m-0 mt-2 text-[10px] text-fg-subtle">
              Tavren writes columns A–H only. Anything you keep to the right of
              them is yours and is never touched.
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
              fields={{ projectId, enabled: syncing ? "false" : "true" }}
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
                fields={{ projectId }}
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
          <p className="eyebrow m-0">STEP 2 — ATTACH THE SHEET</p>

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
            <input type="hidden" name="projectId" value={projectId} />
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
                Add this project&rsquo;s existing work logs to the sheet
                <span className="block text-[10px] text-fg-subtle">
                  Otherwise it starts empty and only new entries appear.
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
