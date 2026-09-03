"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  SHEET_COLUMN_ORDER,
  VISIBLE_COLUMNS,
  type GridColumn,
} from "@/lib/grid-columns";
import { LOCK_REASONS, type RowLock } from "@/lib/grid-permissions";
import { gridTotals } from "@/lib/grid-totals";
import { elapsedSeconds, secondsToHours } from "@/lib/timer-utils";
import { parseGridDate, parseHours, formatHours } from "@/lib/grid-parse";
import {
  parseTsv,
  toTsv,
  planPaste,
  type PastePlan,
} from "@/lib/grid-paste";
import { useRouter } from "next/navigation";
import { saveWorkLogGrid } from "@/server/work-logs";
import type { RowOutcome } from "@/server/grid-schemas";
import type { GridRow } from "@/server/grid-queries";
import { useToast } from "@/components/ui";
import { AlertIcon, CheckIcon, LockIcon, TimerIcon } from "@/components/icons";
import { GridTotalsStrip } from "@/components/grid-totals-strip";
import { keyToAction } from "./grid-keys";
import { PasteReview } from "./paste-review";
import { GridTimerRow, type GridTimerSession } from "./grid-timer-row";
import type { CellRef, EditableRow, RowStatus } from "./grid-types";

/**
 * The work-log grid.
 *
 * Laid out column for column like the project's Google sheet, including the two
 * columns Tavren never writes — B, the sheet's own label, and E, Link. They are
 * rendered greyed rather than dropped: dropping them would shift every column
 * after them, and a six-wide block copied out of the sheet would paste one
 * column out of true.
 *
 * **There is no Save button.** Every cell commits when you leave it, so there is
 * never more than one uncommitted value on screen. That is what reconciles a
 * client-side grid with this app's rule that shareable UI state lives in the
 * URL: the project, person and month decide which rows are fetched and who may
 * see them and stay in the query string, while a half-typed "1.5" — which is
 * neither shareable nor an access decision — stays here.
 *
 * The client is authoritative for the rows it is showing: a commit returns the
 * new revision id and the row is updated in place rather than the route being
 * revalidated, because revalidating on every cell would re-render the page
 * under the cursor dozens of times a session.
 *
 * `DataTable`/`Th`/`Td` are deliberately not reused. Their stated value is that
 * they settle on one table treatment, and a grid needs `role`, `tabIndex`,
 * `data-*` and handlers on the cells; widening them with grid-only props would
 * cost every other table its consistency. The row height differs too — 42px
 * there, 32px here, because a spreadsheet is read by the column.
 */

const LOCK_IDS: Record<RowLock, string> = {
  invoiced: "grid-lock-invoiced",
  "not-yours": "grid-lock-not-yours",
  removed: "grid-lock-removed",
};

type Props = {
  rows: GridRow[];
  projectId: string;
  personId: string | null;
  month: string;
  showPerson: boolean;
  monthLocked: boolean;
  canCreate: boolean;
  /** Rendered in a draft row before it has been saved. */
  viewerName: string;
  /** The viewer's running timer, when it is on this project. */
  timer: GridTimerSession | null;
};

export function WorkLogGrid({
  rows: serverRows,
  projectId,
  personId,
  month,
  showPerson,
  monthLocked,
  canCreate,
  viewerName,
  timer,
}: Props) {
  const columns = useMemo(
    () => VISIBLE_COLUMNS.filter((c) => c.key !== "person" || showPerson),
    [showPerson],
  );

  const [rows, setRows] = useState<EditableRow[]>(() =>
    serverRows.map(toEditable),
  );
  const [active, setActive] = useState<CellRef>({ r: 0, c: 0 });
  // The other corner of a range. Equal to `active` when nothing is selected.
  const [anchor, setAnchor] = useState<CellRef>({ r: 0, c: 0 });
  const [plan, setPlan] = useState<PastePlan | null>(null);
  const [pasteReason, setPasteReason] = useState("");
  const [timerNote, setTimerNote] = useState("");
  // Every cell saves on its own, so there is no submit button to report back
  // through and no dialog to land on. Without this a screen-reader user gets no
  // confirmation that anything was written, or that a row was refused.
  const [announcement, setAnnouncement] = useState("");
  // Open from the start when the grid holds a row belonging to somebody else,
  // because that is exactly when a reason will be demanded on save.
  const [showReason, setShowReason] = useState(() =>
    serverRows.some((r) => !r.isMine),
  );
  const [applying, setApplying] = useState(false);
  const [editing, setEditing] = useState<{ cell: CellRef; value: string } | null>(
    null,
  );
  const [status, setStatus] = useState<Record<string, RowStatus>>({});
  const [reason, setReason] = useState("");
  const [, startTransition] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const tableRef = useRef<HTMLTableElement>(null);

  // A blank row at the foot, so starting a new entry is one keystroke rather
  // than a button. It is held as state rather than derived, because a date
  // typed before the hours has to survive until the row is complete enough to
  // send — deriving it would discard every keystroke but the last.
  const draftable = canCreate && !monthLocked;
  const [draft, setDraft] = useState<EditableRow>(() =>
    blankRow(personId, viewerName),
  );
  const shown: EditableRow[] = useMemo(
    () => (draftable ? [...rows, draft] : rows),
    [rows, draftable, draft],
  );

  const totals = useMemo(
    () =>
      gridTotals(
        rows
          .filter((r) => !r.removed)
          .map((r) => ({ workDate: r.workDate, hours: r.hours })),
      ),
    [rows],
  );

  const focusCell = useCallback((cell: CellRef) => {
    const el = tableRef.current?.querySelector<HTMLElement>(
      `[data-r="${cell.r}"][data-c="${cell.c}"]`,
    );
    el?.focus();
  }, []);

  const clamp = useCallback(
    (cell: CellRef): CellRef => ({
      r: Math.max(0, Math.min(shown.length - 1, cell.r)),
      c: Math.max(0, Math.min(columns.length - 1, cell.c)),
    }),
    [shown.length, columns.length],
  );

  const move = useCallback(
    (from: CellRef, dr: number, dc: number) => {
      const next = clamp({ r: from.r + dr, c: from.c + dc });
      setActive(next);
      setAnchor(next);
    },
    [clamp],
  );

  const rect = useMemo(
    () => ({
      r0: Math.min(anchor.r, active.r),
      r1: Math.max(anchor.r, active.r),
      c0: Math.min(anchor.c, active.c),
      c1: Math.max(anchor.c, active.c),
    }),
    [anchor, active],
  );
  const hasRange = rect.r0 !== rect.r1 || rect.c0 !== rect.c1;

  // Focus follows the active cell once the DOM reflects it. Doing this in the
  // handler races the re-render: committing an edit unmounts the input, and the
  // cell being moved to may not exist yet when the keystroke is still running.
  useEffect(() => {
    if (!editing) focusCell(active);
  }, [active, editing, focusCell]);

  const applyOutcomes = useCallback(
    (outcomes: RowOutcome[], sentDraft?: EditableRow) => {
      for (const o of outcomes) {
        if (o.status === "rejected") {
          setStatus((s) => ({
            ...s,
            [o.rowKey]: { state: "error", message: o.error, field: o.field },
          }));
          setAnnouncement(`Not saved. ${o.error}`);
          toast({ message: o.error, tone: "error" });
          continue;
        }
        setStatus((s) => ({ ...s, [o.rowKey]: { state: "saved" } }));
        setAnnouncement(
          o.status === "removed" ? "Entry removed." : "Entry saved.",
        );
        if (o.status === "created" && sentDraft?.rowKey === o.rowKey) {
          // The draft became an entry; it joins the rows and a fresh blank one
          // takes its place at the foot.
          //
          // The guard is not belt and braces: React invokes a state updater
          // twice under StrictMode, so an updater that appended unconditionally
          // would show every new entry twice — and double its hours in the
          // totals, which is exactly the sort of wrong number this grid exists
          // to stop people writing down.
          const created = {
            ...sentDraft,
            id: o.workLogId,
            revisionId: o.revisionId,
            isDraft: false,
            editable: true,
          };
          setRows((rs) =>
            rs.some((r) => r.rowKey === o.rowKey) ? rs : [...rs, created],
          );
          setDraft(blankRow(personId, viewerName));
        }
        if (o.status === "updated") {
          setRows((rs) =>
            rs.map((r) =>
              r.rowKey === o.rowKey
                ? { ...r, revisionId: o.revisionId }
                : r,
            ),
          );
        }
        if (o.status === "removed") {
          setRows((rs) =>
            rs.map((r) =>
              r.rowKey === o.rowKey ? { ...r, removed: true, lock: "removed" } : r,
            ),
          );
        }
      }
    },
    [toast, personId, viewerName],
  );

  /** Sends one row and folds the result back in. */
  const commitRow = useCallback(
    (rowIndex: number, patch: Partial<EditableRow>) => {
      const current = shown[rowIndex];
      if (!current) return;
      const next = { ...current, ...patch };
      const isDraft = current.isDraft;

      if (isDraft) {
        // Keep every keystroke, but do not send a half-written entry: a work
        // log needs a day, an amount and a note, and the server would reject
        // anything less.
        setDraft(next);
        if (!next.hours || !next.notes.trim() || !next.workDate) return;
      } else {
        const unchanged =
          current.hours === next.hours &&
          current.notes === next.notes &&
          current.workDate === next.workDate;
        if (unchanged) return;
        setRows((rs) => rs.map((r, i) => (i === rowIndex ? next : r)));
      }
      setStatus((s) => ({ ...s, [next.rowKey]: { state: "saving" } }));

      startTransition(async () => {
        const payload = isDraft
          ? {
              op: "create" as const,
              rowKey: next.rowKey,
              workDate: next.workDate,
              hours: Number(next.hours),
              internalNotes: next.notes,
              ...(personId ? { userId: personId } : {}),
            }
          : {
              op: "update" as const,
              rowKey: next.rowKey,
              workLogId: next.id,
              expectedRevisionId: next.revisionId,
              workDate: next.workDate,
              hours: Number(next.hours),
              internalNotes: next.notes,
            };

        const result = await saveWorkLogGrid({
          projectId,
          personId,
          month,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          rows: [payload],
        });

        if (result.error) {
          setStatus((s) => ({
            ...s,
            [next.rowKey]: { state: "error", message: result.error },
          }));
          toast({ message: result.error, tone: "error" });
          return;
        }
        applyOutcomes(result.rows ?? [], isDraft ? next : undefined);
      });
    },
    [shown, projectId, personId, month, reason, toast, applyOutcomes],
  );

  const removeRow = useCallback(
    (rowIndex: number) => {
      const row = shown[rowIndex];
      if (!row || row.isDraft || !row.editable || row.removed) return;

      setStatus((s) => ({ ...s, [row.rowKey]: { state: "saving" } }));
      startTransition(async () => {
        const result = await saveWorkLogGrid({
          projectId,
          personId,
          month,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          rows: [
            {
              op: "remove",
              rowKey: row.rowKey,
              workLogId: row.id,
              expectedRevisionId: row.revisionId,
            },
          ],
        });
        if (result.error) {
          setStatus((s) => ({
            ...s,
            [row.rowKey]: { state: "error", message: result.error },
          }));
          toast({ message: result.error, tone: "error" });
          return;
        }
        applyOutcomes(result.rows ?? []);
      });
    },
    [shown, projectId, personId, month, reason, toast, applyOutcomes],
  );

  /** Validates and normalises what was typed, before it is worth a round trip. */
  const readCell = (col: GridColumn, raw: string) => {
    if (col.key === "hours") {
      const r = parseHours(raw);
      return r.ok ? { value: formatHours(r.value) } : { error: r.error };
    }
    if (col.key === "date") {
      const r = parseGridDate(raw);
      return r.ok ? { value: r.value } : { error: r.error };
    }
    const text = raw.trim();
    if (!text) return { error: "Say what you did, even briefly." };
    return { value: text };
  };

  const commitEdit = (dr: number, dc: number) => {
    if (!editing) return;
    const { cell, value } = editing;
    const col = columns[cell.c];
    const row = shown[cell.r];
    const read = readCell(col, value);

    setEditing(null);
    if ("error" in read && read.error) {
      setStatus((s) => ({
        ...s,
        [row.rowKey]: { state: "error", message: read.error },
      }));
      toast({ message: read.error, tone: "error" });
      focusCell(cell);
      return;
    }

    const field =
      col.key === "hours" ? "hours" : col.key === "date" ? "workDate" : "notes";
    commitRow(cell.r, { [field]: read.value } as Partial<EditableRow>);
    move(cell, dr, dc);
  };

  /** The rows as the paste planner needs to see them. */
  const pasteTargets = useMemo(
    () =>
      shown.map((r) => ({
        rowKey: r.rowKey,
        id: r.id,
        workDate: r.workDate,
        hours: r.hours,
        notes: r.notes,
        editable: isRowEditable(r),
        isDraft: r.isDraft,
      })),
    [shown],
  );

  const onCopy = (e: React.ClipboardEvent) => {
    if (editing) return; // the input owns its own text
    e.preventDefault();
    // Always the sheet's six columns, whatever is on screen: the point of a
    // copy here is that it pastes back into the project's sheet — or into
    // Excel and then back into this grid — and both expect that shape.
    const cells = shown.slice(rect.r0, rect.r1 + 1).map((row) =>
      SHEET_COLUMN_ORDER.map((key) => {
        switch (key) {
          case "date":
            return row.workDate;
          case "hours":
            return row.hours;
          case "notes":
            return row.notes;
          case "id":
            return row.isDraft ? "" : row.id;
          default:
            return "";
        }
      }),
    );
    e.clipboardData.setData("text/plain", toTsv(cells));
    toast({
      message: `Copied ${cells.length} row${cells.length === 1 ? "" : "s"}. Notes are flattened onto one line.`,
    });
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (editing || monthLocked) return;
    // The paste event carries the clipboard with no permission prompt, which
    // `navigator.clipboard.readText()` does not — and which Firefox does not
    // grant web content at all.
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();

    const block = parseTsv(text);
    const next = planPaste({
      block,
      anchor: { r: rect.r0, c: rect.c0 },
      rows: pasteTargets,
      columns,
      month,
      canCreate,
    });

    // A single cell is a keystroke, not a document change: apply it and move on.
    if (block.length === 1 && (block[0]?.length ?? 0) === 1) {
      void applyPlan(next);
      return;
    }
    setPasteReason("");
    setPlan(next);
  };

  const applyPlan = useCallback(
    async (p: PastePlan, why?: string) => {
      const rowsToSend = [
        ...p.updates.map((u) => {
          const target = shown[u.rowIndex];
          return {
            op: "update" as const,
            rowKey: u.rowKey,
            workLogId: u.workLogId,
            expectedRevisionId: target?.revisionId ?? null,
            workDate: u.changes.workDate ?? u.before.workDate,
            hours: Number(u.changes.hours ?? u.before.hours),
            internalNotes: u.changes.notes ?? u.before.notes,
          };
        }),
        ...p.creates.map((c) => ({
          op: "create" as const,
          rowKey: `paste-${crypto.randomUUID()}`,
          workDate: c.workDate,
          hours: Number(c.hours),
          internalNotes: c.notes,
          ...(personId ? { userId: personId } : {}),
        })),
      ];
      if (rowsToSend.length === 0) {
        setPlan(null);
        return;
      }

      setApplying(true);
      const chosen = (why ?? reason).trim();
      const result = await saveWorkLogGrid({
        projectId,
        personId,
        month,
        ...(chosen ? { reason: chosen } : {}),
        rows: rowsToSend,
      });
      setApplying(false);
      setPlan(null);

      if (result.error) {
        toast({ message: result.error, tone: "error" });
        return;
      }
      // A paste rewrites many rows at once, so the grid is reloaded from the
      // server rather than patched in place: reconstructing the order and the
      // ids of a mixed batch by hand is exactly the kind of bookkeeping that
      // ends up disagreeing with the database.
      toast({
        message: result.message ?? "Saved.",
        tone: result.ok ? "ok" : "error",
      });
      router.refresh();
    },
    [shown, projectId, personId, month, reason, toast, router],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLTableSectionElement>) => {
    const action = keyToAction(e, editing !== null);
    if (action.kind === "none") return;

    const target = editing?.cell ?? active;
    const row = shown[target.r];
    const col = columns[target.c];

    switch (action.kind) {
      case "move":
        e.preventDefault();
        move(target, action.dr, action.dc);
        return;
      case "extend": {
        e.preventDefault();
        setActive(clamp({ r: target.r + action.dr, c: target.c + action.dc }));
        return;
      }
      case "selectAll":
        e.preventDefault();
        setAnchor({ r: 0, c: 0 });
        setActive({ r: shown.length - 1, c: columns.length - 1 });
        return;
      case "copy":
        // Handled by the copy event, which is where the clipboard lives.
        return;
      case "moveEdge": {
        e.preventDefault();
        const to =
          action.axis === "grid"
            ? action.to === "first"
              ? { r: 0, c: 0 }
              : { r: shown.length - 1, c: columns.length - 1 }
            : {
                r: target.r,
                c: action.to === "first" ? 0 : columns.length - 1,
              };
        setActive(to);
        focusCell(to);
        return;
      }
      case "edit": {
        e.preventDefault();
        if (!isCellEditable(row, col)) {
          const why = row.lock ? LOCK_REASONS[row.lock] : "That cell is not editable.";
          toast({ message: why, tone: "error" });
          return;
        }
        setEditing({
          cell: target,
          value: action.seed ?? cellText(row, col),
        });
        return;
      }
      case "commit":
        e.preventDefault();
        commitEdit(action.dr, action.dc);
        return;
      case "cancel":
        e.preventDefault();
        setEditing(null);
        focusCell(target);
        return;
      case "remove":
        e.preventDefault();
        if (!isCellEditable(row, col)) return;
        removeRow(target.r);
        return;
      case "exit":
        e.preventDefault();
        tableRef.current?.focus();
        return;
    }
  };

  return (
    <>
      <GridTotalsStrip
        totals={totals}
        running={timer ? runningHours(timer) : null}
      />

      {monthLocked && (
        <p className="mb-4 rounded-[10px] border border-border bg-surface-2 px-4 py-3 text-xs font-bold text-fg-muted">
          This month has been invoiced. Its entries are a record of what was
          charged and can no longer be changed.
        </p>
      )}

      {/* Folded away by default. It is needed only when you touch somebody
          else's row, which is rare — and given a full-width input above the
          grid it outweighed the thing it annotates. It opens itself the moment
          the grid contains a row that is not yours, so the case that needs it
          never has to go looking. */}
      {!monthLocked && (
        <details
          open={showReason}
          className="group mb-3"
          onToggle={(e) => setShowReason(e.currentTarget.open)}
        >
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-2xs font-black uppercase tracking-[.1em] text-fg-label hover:text-fg">
            <span className="transition-transform group-open:rotate-90">›</span>
            Why these changes
            {reason.trim() && (
              <span className="font-bold normal-case tracking-normal text-fg-muted">
                — set
              </span>
            )}
          </summary>
          <input
            id="grid-reason"
            aria-label="Why these changes"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Needed only when you change somebody else's entry"
            className="field field-sm mt-2 w-full"
          />
        </details>
      )}

      {plan && (
        <PasteReview
          plan={plan}
          needsReason={pasteNeedsReason(plan, shown)}
          reason={pasteReason}
          onReason={setPasteReason}
          onApply={() => void applyPlan(plan, pasteReason)}
          onCancel={() => setPlan(null)}
          applying={applying}
        />
      )}

      <div className="w-full overflow-x-auto rounded-[14px] border border-border">
        <table
          ref={tableRef}
          tabIndex={-1}
          role="grid"
          aria-label={`Work log, ${rows.length} entries`}
          aria-rowcount={shown.length + 1}
          aria-colcount={columns.length + 1}
          className="w-full border-collapse text-xs"
          style={{ minWidth: columns.reduce((w, c) => w + c.width, 0) + 34 }}
        >
          <thead>
            <tr aria-rowindex={1}>
              <th
                role="columnheader"
                aria-colindex={1}
                scope="col"
                className="w-[34px] border-b border-border bg-surface-2"
              >
                <span className="sr-only">Status</span>
              </th>
              {columns.map((c, i) => (
                <th
                  key={c.key}
                  role="columnheader"
                  aria-colindex={i + 2}
                  scope="col"
                  style={{ width: c.width }}
                  className={`h-[34px] whitespace-nowrap border-b border-border bg-surface-2 px-3 text-2xs font-black uppercase tracking-[.1em] text-fg-label
                    ${c.align === "right" ? "text-right" : "text-left"}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>

          <tbody onKeyDown={onKeyDown} onCopy={onCopy} onPaste={onPaste}>
            {timer && (
              <GridTimerRow
                session={timer}
                columns={columns}
                rowIndex={shown.length}
                note={timerNote}
                onNote={setTimerNote}
              />
            )}
            {shown.map((row, r) => {
              const st = status[row.rowKey];
              return (
                <tr
                  key={row.rowKey}
                  role="row"
                  aria-rowindex={r + 2}
                  data-pending={st?.state === "saving" || undefined}
                  className={`border-b border-border last:border-b-0 hover:bg-surface-hover
                    ${st?.state === "saving" ? "opacity-60" : ""}
                    ${row.removed ? "line-through opacity-50" : ""}`}
                >
                  <td
                    role="gridcell"
                    aria-colindex={1}
                    className="border-r border-border text-center align-middle"
                  >
                    <StatusDot row={row} status={st} />
                  </td>
                  {columns.map((col, c) => (
                    <Cell
                      key={col.key}
                      row={row}
                      col={col}
                      r={r}
                      c={c}
                      isActive={active.r === r && active.c === c}
                      selected={
                        hasRange &&
                        r >= rect.r0 &&
                        r <= rect.r1 &&
                        c >= rect.c0 &&
                        c <= rect.c1
                      }
                      editing={
                        editing && editing.cell.r === r && editing.cell.c === c
                          ? editing.value
                          : null
                      }
                      onFocus={() => setActive({ r, c })}
                      onChange={(v) =>
                        setEditing((e) => (e ? { ...e, value: v } : e))
                      }
                      onBlurCommit={() => commitEdit(0, 0)}
                      onStartEdit={() => {
                        setActive({ r, c });
                        if (isCellEditable(row, col)) {
                          setEditing({
                            cell: { r, c },
                            value: cellText(row, col),
                          });
                        }
                      }}
                    />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Polite, so it waits for a pause rather than cutting across typing. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <p className="mt-2 text-2xs text-fg-subtle">
        Arrows move · Enter or type to edit · Tab moves right · Esc leaves the
        grid · Delete removes an entry. Changes save as you leave each cell.
      </p>

      {/* One node per reason, referenced by every cell that carries it, rather
          than a description repeated across several hundred cells. */}
      <div hidden>
        {(Object.keys(LOCK_IDS) as RowLock[]).map((k) => (
          <span key={k} id={LOCK_IDS[k]}>
            {LOCK_REASONS[k]}
          </span>
        ))}
      </div>
    </>
  );
}

function StatusDot({
  row,
  status,
}: {
  row: EditableRow;
  status?: RowStatus;
}) {
  // Each state differs in SHAPE as well as colour. A row of six-pixel dots
  // distinguished only by hue tells a colour-blind reader nothing, and this is
  // the only feedback there is — the grid has no Save button to report back.
  if (status?.state === "saving") {
    return <Dot className="animate-pulse bg-fg-subtle" label="Saving" />;
  }
  if (status?.state === "error") {
    return (
      <span className="inline-flex text-danger" title={status.message ?? "Failed"}>
        <AlertIcon className="h-3.5 w-3.5" />
        <span className="sr-only">{status.message ?? "Failed"}</span>
      </span>
    );
  }
  if (status?.state === "saved") {
    return (
      <span className="inline-flex text-ok" title="Saved">
        <CheckIcon className="h-3.5 w-3.5" />
        <span className="sr-only">Saved</span>
      </span>
    );
  }
  if (row.lock) {
    return (
      <span
        className="inline-flex text-fg-muted"
        title={LOCK_REASONS[row.lock]}
      >
        <LockIcon className="h-3.5 w-3.5" />
        <span className="sr-only">{LOCK_REASONS[row.lock]}</span>
      </span>
    );
  }
  if (row.fromTimer) {
    return (
      <span className="inline-flex text-fg-muted" title="Recorded by the timer">
        <TimerIcon className="h-3.5 w-3.5" />
        <span className="sr-only">Recorded by the timer</span>
      </span>
    );
  }
  return null;
}

function Dot({ className, label }: { className: string; label: string }) {
  return (
    <span title={label}>
      <span
        aria-hidden
        className={`inline-block h-1.5 w-1.5 rounded-full ${className}`}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function Cell({
  row,
  col,
  r,
  c,
  isActive,
  selected,
  editing,
  onFocus,
  onChange,
  onBlurCommit,
  onStartEdit,
}: {
  row: EditableRow;
  col: GridColumn;
  r: number;
  c: number;
  isActive: boolean;
  selected: boolean;
  editing: string | null;
  onFocus: () => void;
  onChange: (v: string) => void;
  onBlurCommit: () => void;
  onStartEdit: () => void;
}) {
  const editable = isCellEditable(row, col);

  return (
    <td
      role="gridcell"
      aria-colindex={c + 2}
      aria-readonly={editable ? undefined : true}
      aria-describedby={!editable && row.lock ? LOCK_IDS[row.lock] : undefined}
      data-r={r}
      data-c={c}
      data-selected={selected || undefined}
      // Roving tabindex: exactly one cell is in the tab order, so focus is real
      // focus — which is what makes the app's own focus ring and the browser's
      // scroll-into-view work without reimplementing either.
      tabIndex={isActive ? 0 : -1}
      onFocus={onFocus}
      onDoubleClick={onStartEdit}
      className={`h-[32px] border-r border-border px-0 align-middle last:border-r-0 outline-offset-[-2px]
        ${col.align === "right" ? "text-right tabular-nums" : "text-left"}
        ${editable ? "text-fg" : "text-fg-muted"}
        ${!editable && col.key !== "label" && col.key !== "link" ? "bg-surface-2" : ""}
        ${col.key === "label" || col.key === "link" ? "bg-surface-2/40" : ""}
        ${selected ? "bg-brand-soft" : ""}`}
    >
      {editing !== null ? (
        <input
          autoFocus
          value={editing}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlurCommit}
          className="h-[30px] w-full border-0 bg-brand-soft px-3 text-xs text-fg outline-none"
        />
      ) : (
        <span
          className={`block truncate px-3 ${
            col.key === "id" ? "font-mono text-2xs text-fg-subtle" : ""
          } ${row.isDraft && !row[draftField(col)] ? "text-fg-subtle" : ""}`}
        >
          {cellText(row, col)}
        </span>
      )}
    </td>
  );
}

/**
 * Whether a paste needs a written reason: it does the moment it would change a
 * row belonging to somebody else, which is the case the reason exists for.
 */
function pasteNeedsReason(plan: PastePlan, rows: EditableRow[]): boolean {
  const touched = new Set(plan.updates.map((u) => u.rowKey));
  return rows.some((r) => touched.has(r.rowKey) && !r.isMine);
}

/** The running timer's hours, for the strip. Shown apart from the total: time
 *  that has not been logged has not been logged. */
function runningHours(timer: GridTimerSession): string {
  return secondsToHours(elapsedSeconds(timer)).toFixed(2);
}

/** Which value a column shows, for deciding whether a draft cell is still blank. */
function draftField(col: GridColumn): "workDate" | "hours" | "notes" {
  return col.key === "hours" ? "hours" : col.key === "date" ? "workDate" : "notes";
}

function isRowEditable(row: EditableRow): boolean {
  if (row.removed) return false;
  return row.isDraft ? true : row.editable;
}

function isCellEditable(row: EditableRow, col: GridColumn): boolean {
  if (!col.editable) return false;
  if (row.removed) return false;
  return row.isDraft ? true : row.editable;
}

function cellText(row: EditableRow, col: GridColumn): string {
  switch (col.key) {
    case "date":
      if (row.isDraft && !row.workDate) return "";
      return row.workDate;
    case "label":
      // The team's column: a heading on the sheet with nothing beneath it.
      return "";
    case "person":
      return row.personName;
    case "hours":
      return row.hours;
    case "notes":
      if (row.isDraft && !row.notes) return "Type here to add an entry";
      return row.notes;
    case "link":
      return "";
    case "id":
      return row.isDraft ? "" : row.id;
    default:
      return "";
  }
}

function toEditable(r: GridRow): EditableRow {
  return {
    rowKey: r.id,
    id: r.id,
    revisionId: r.revisionId,
    workDate: r.workDate,
    hours: r.hours,
    notes: r.notes,
    personName: r.personName,
    isMine: r.isMine,
    fromTimer: r.fromTimer,
    editable: r.editable,
    lock: r.lock,
    isDraft: false,
    removed: false,
  };
}

function blankRow(personId: string | null, viewerName: string): EditableRow {
  return {
    rowKey: `draft-${crypto.randomUUID()}`,
    id: "",
    revisionId: null,
    workDate: "",
    hours: "",
    notes: "",
    personName: viewerName,
    isMine: true,
    fromTimer: false,
    editable: true,
    lock: null,
    isDraft: true,
    removed: false,
  };
}
