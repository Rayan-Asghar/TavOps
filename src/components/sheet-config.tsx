"use client";

import { useActionState, useState } from "react";
import {
  inspectSheet,
  inspectTab,
  saveSheetMapping,
  applyClientTemplate,
  testSheetConnection,
  toggleSheetSync,
  retryFailedSyncs,
  disconnectSheet,
  type SheetState,
} from "@/server/sheet-actions";
import { SHEET_FIELDS } from "@/server/sheet-schemas";
import type { SheetStatus } from "@/server/sheet-queries";
import { Badge } from "./badges";
import { CopyField } from "./copy-field";

const initial: SheetState = {};

function Msg({ state }: { state: SheetState }) {
  if (state.error)
    return (
      <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[11px] font-medium text-danger">
        {state.error}
      </p>
    );
  if (state.ok && state.message)
    return (
      <p className="rounded-lg bg-ok-soft px-3 py-2 text-[11px] font-medium text-ok">
        {state.message}
      </p>
    );
  return null;
}

/**
 * Attaching a client sheet, per project.
 *
 * Every project has its own spreadsheet and whichever head runs that project
 * connects it themselves. There is one shared service account: access comes
 * from sharing each sheet with that address, not from separate credentials per
 * person — so the address is the first thing on screen, not buried in docs.
 */
export function SheetConfig({
  projectId,
  status,
  serviceAccountEmail,
}: {
  projectId: string;
  status: SheetStatus;
  serviceAccountEmail: string | null;
}) {
  const [inspectState, inspectAction, inspecting] = useActionState(inspectSheet, initial);
  const [tabState, tabAction, switchingTab] = useActionState(inspectTab, initial);
  const [saveState, saveAction, saving] = useActionState(saveSheetMapping, initial);
  const [tplState, tplAction, applyingTpl] = useActionState(applyClientTemplate, initial);
  const [testState, testAction, testing] = useActionState(testSheetConnection, initial);
  const [reconfiguring, setReconfiguring] = useState(false);

  // The newer of the two inspections wins, so switching tabs refreshes headers.
  const inspection = tabState.inspection ?? inspectState.inspection;
  const conn = status.connection;
  // Archived reads as disconnected: the record is kept for the audit trail, but
  // the project needs setting up again before anything reaches the client.
  const connected = conn && conn.status !== "archived" && !reconfiguring;
  const syncing = conn?.status === "active";

  if (!serviceAccountEmail) {
    return (
      <section className="panel p-5">
        <p className="eyebrow m-0">SHEETS SYNC</p>
        <p className="m-0 mt-2 text-[12px] text-fg-muted">
          Google Sheets is not configured on the server. An admin needs to set
          the service account credentials before projects can connect sheets.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {/* Who to share with. Nothing works until this is done, so it leads. */}
      <section className="panel p-5">
        <p className="eyebrow m-0">STEP 1 — SHARE THE SHEET</p>
        <p className="m-0 mb-3 mt-1 text-[12px] text-fg-muted">
          Open the client&rsquo;s spreadsheet, press <b>Share</b>, and give this
          address <b>Editor</b> access. Every project uses the same address.
        </p>
        <CopyField value={serviceAccountEmail} label="Share with" />
      </section>

      {connected ? (
        <>
          <section className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">CONNECTED</p>
                <h3 className="m-0 text-[16px] tracking-[-.03em]">
                  {conn!.tabName}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                {syncing ? (
                  <Badge tone="green">Syncing</Badge>
                ) : (
                  <Badge tone="neutral">Paused</Badge>
                )}
                <Badge tone="blue">{conn!.mode}</Badge>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-4">
              {[
                ["Synced", String(status.succeeded)],
                ["Queued", String(status.pending)],
                ["Failed", String(status.failed)],
                [
                  "Last sync",
                  conn!.lastSyncAt
                    ? conn!.lastSyncAt.toLocaleDateString("en-US", {
                        month: "short",
                        day: "2-digit",
                      })
                    : "never",
                ],
              ].map(([label, value]) => (
                <div key={label} className="bg-surface px-4 py-3">
                  <div className="text-[9px] font-black uppercase tracking-[.12em] text-fg-muted">
                    {label}
                  </div>
                  <div
                    className={`mt-0.5 text-[16px] font-extrabold ${
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
                  This sheet is not accepting updates
                </p>
                <p className="m-0 mt-1 font-mono text-[10px] text-danger">
                  {conn!.errorMessage}
                </p>
              </div>
            )}

            {status.failed > 0 && status.lastError && (
              <div className="border-b border-border bg-danger-soft px-5 py-3">
                <p className="m-0 text-[11px] font-bold text-danger">
                  {status.failed} update{status.failed === 1 ? "" : "s"} did not
                  reach the sheet
                </p>
                <p className="m-0 mt-1 font-mono text-[10px] text-danger">
                  {status.lastError}
                </p>
                <form action={retryFailedSyncs} className="mt-2">
                  <input type="hidden" name="projectId" value={projectId} />
                  <button type="submit" className="btn-secondary py-1.5 text-[11px]">
                    Retry them
                  </button>
                </form>
              </div>
            )}

            <div className="px-5 py-4">
              <p className="eyebrow m-0">COLUMN MAPPING</p>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {SHEET_FIELDS.map((f) => {
                  const col = conn!.columnMap[f.key];
                  return (
                    <li key={f.key} className="flex items-center gap-2 text-[11px]">
                      <span className="w-[70px] text-fg-muted">{f.label}</span>
                      <span aria-hidden className="text-fg-subtle">→</span>
                      {col ? (
                        <span className="font-mono font-bold">column {col}</span>
                      ) : (
                        <span className="text-fg-subtle">not written</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-border px-5 py-4">
              <form action={testAction}>
                <input type="hidden" name="projectId" value={projectId} />
                <button type="submit" disabled={testing} className="btn-secondary py-2 text-[12px]">
                  {testing ? "Testing…" : "Test connection"}
                </button>
              </form>
              <button
                type="button"
                onClick={() => setReconfiguring(true)}
                className="btn-secondary py-2 text-[12px]"
              >
                Change sheet
              </button>
              <form action={toggleSheetSync}>
                <input type="hidden" name="projectId" value={projectId} />
                <input
                  type="hidden"
                  name="enabled"
                  value={syncing ? "false" : "true"}
                />
                <button type="submit" className="btn-secondary py-2 text-[12px]">
                  {syncing ? "Pause syncing" : "Resume syncing"}
                </button>
              </form>
              <form action={disconnectSheet} className="ml-auto">
                <input type="hidden" name="projectId" value={projectId} />
                <button
                  type="submit"
                  className="px-3 py-2 text-[11px] font-bold text-fg-muted hover:text-danger"
                >
                  Disconnect
                </button>
              </form>
            </div>

            {(testState.error || testState.ok) && (
              <div className="px-5 pb-4">
                <Msg state={testState} />
              </div>
            )}
          </section>
        </>
      ) : (
        <>
          {/* The common case first. Most clients take the sheet we give them,
              so hand-mapping columns is a step that usually need not exist. */}
          <section className="panel p-5">
            <p className="eyebrow m-0">STEP 2 — USE THE TAVREN TEMPLATE</p>
            <p className="m-0 mb-3 mt-1 text-[12px] text-fg-muted">
              For a blank sheet. Writes the standard header row and connects it
              in one step — no column mapping. If the client sent their own
              layout, skip this and map the columns below instead.
            </p>
            <form action={tplAction} className="space-y-3">
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="sheetName" value="Sheet1" />
              <div>
                <label className="sr-only" htmlFor="tplUrl">
                  Google Sheet link
                </label>
                <input
                  id="tplUrl"
                  name="sheetUrl"
                  required
                  className="field"
                  placeholder="https://docs.google.com/spreadsheets/d/…"
                />
              </div>
              <Msg state={tplState} />
              <button
                type="submit"
                disabled={applyingTpl}
                className="btn-primary py-2 text-[12px]"
              >
                {applyingTpl ? "Writing…" : "Set up with the template"}
              </button>
            </form>
          </section>

          <section className="panel p-5">
            <p className="eyebrow m-0">OR — MAP THE CLIENT&rsquo;S OWN SHEET</p>
            <form action={inspectAction} className="mt-2 space-y-3">
              <input type="hidden" name="projectId" value={projectId} />
              <div>
                <label className="sr-only" htmlFor="sheetUrl">
                  Google Sheet link
                </label>
                <input
                  id="sheetUrl"
                  name="sheetUrl"
                  required
                  className="field"
                  placeholder="https://docs.google.com/spreadsheets/d/…"
                  defaultValue={
                    conn
                      ? `https://docs.google.com/spreadsheets/d/${conn.spreadsheetId}/edit`
                      : ""
                  }
                />
                <p className="mt-1 text-[9px] text-fg-subtle">
                  Paste the whole URL from your browser.
                </p>
              </div>
              <Msg state={inspectState} />
              <div className="flex gap-2">
                <button type="submit" disabled={inspecting} className="btn-primary py-2 text-[12px]">
                  {inspecting ? "Checking…" : "Check access"}
                </button>
                {reconfiguring && (
                  <button
                    type="button"
                    onClick={() => setReconfiguring(false)}
                    className="px-3 text-[11px] font-bold text-fg-muted"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </section>

          {inspection && (
            <section className="panel p-5">
              <p className="eyebrow m-0">STEP 3 — MAP THE COLUMNS</p>
              <p className="m-0 mb-3 mt-1 text-[12px]">
                Opened <b>{inspection.title}</b>
              </p>

              {/* Changing the tab re-reads its headers, so the suggestions
                  match the tab actually chosen. */}
              <form action={tabAction} className="mb-4 flex flex-wrap items-end gap-2">
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="spreadsheetId" value={inspection.spreadsheetId} />
                <div className="min-w-[180px] flex-1">
                  <label className="label" htmlFor="sheetName">Tab</label>
                  <select id="sheetName" name="sheetName" className="field" defaultValue={inspection.tabs[0]}>
                    {inspection.tabs.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <button type="submit" disabled={switchingTab} className="btn-secondary py-2 text-[12px]">
                  {switchingTab ? "Reading…" : "Read headers"}
                </button>
              </form>

              <form action={saveAction} className="space-y-4">
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="spreadsheetId" value={inspection.spreadsheetId} />
                <input type="hidden" name="sheetName" value={inspection.tabs[0]} />
                <input type="hidden" name="headerRow" value="1" />

                <div>
                  <label className="label" htmlFor="mode">How to write</label>
                  <select id="mode" name="mode" className="field" defaultValue="append">
                    <option value="append">Append — add a new row per update</option>
                    <option value="update">Update — fill an existing row per task</option>
                  </select>
                  <p className="mt-1 text-[9px] text-fg-subtle">
                    Update mode needs each task to carry its sheet row number.
                  </p>
                </div>

                <div>
                  <span className="label">Columns</span>
                  <div className="grid gap-2">
                    {SHEET_FIELDS.map((f) => (
                      <div key={f.key} className="grid grid-cols-[110px_80px_1fr] items-center gap-2">
                        <label className="text-[11px] font-bold" htmlFor={`col-${f.key}`}>
                          {f.label}
                        </label>
                        <input
                          id={`col-${f.key}`}
                          name={`col.${f.key}`}
                          defaultValue={inspection.suggested[f.key] ?? ""}
                          placeholder="—"
                          maxLength={3}
                          className="field text-center font-mono uppercase"
                        />
                        <span className="truncate text-[10px] text-fg-muted">
                          {inspection.headers.find(
                            (h) => h.column === (inspection.suggested[f.key] ?? ""),
                          )?.label ?? f.hint}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] text-fg-muted">
                    Leave a field blank to never write that column. Anything not
                    listed here is never touched, so the client&rsquo;s own
                    columns are safe.
                  </p>
                </div>

                <div>
                  <label className="label" htmlFor="clientOwned">
                    Columns the client maintains
                  </label>
                  <input
                    id="clientOwned"
                    name="clientOwnedColumns"
                    className="field font-mono uppercase"
                    placeholder="e.g. G, H"
                    pattern="[A-Za-z, ]*"
                  />
                  <p className="mt-1 text-[10px] text-fg-muted">
                    Optional belt-and-braces. Columns listed here are refused by
                    the sync worker even if something later maps a field onto
                    them, so a client&rsquo;s approvals or comments cannot be
                    overwritten by a mistake in this form.
                  </p>
                </div>

                <Msg state={saveState} />
                <button type="submit" disabled={saving} className="btn-primary w-full">
                  {saving ? "Saving…" : "Connect this sheet"}
                </button>
              </form>
            </section>
          )}
        </>
      )}
    </div>
  );
}
