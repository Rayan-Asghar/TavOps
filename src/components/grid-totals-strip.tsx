import type { GridTotals } from "@/lib/grid-totals";

/**
 * The summary strip above the grid.
 *
 * Deliberately the same four cells the sheet's banner carries, in the same
 * order, so the two read as one artefact: month, total hours, days logged,
 * entries. On the sheet those are live formulas; here they are computed from
 * the same rows the grid is showing.
 */
export function GridTotalsStrip({
  totals,
  running,
}: {
  totals: GridTotals;
  /** A timer still going, in hours, shown apart so it is not mistaken for logged work. */
  running?: string | null;
}) {
  // No "Month" cell: the eyebrow above and the active tab beside it already
  // name the month, and a third statement of the same fact is noise.
  const cells: { label: string; value: string }[] = [
    { label: "Total hours", value: `${totals.totalHours} hrs` },
    { label: "Days logged", value: String(totals.daysLogged) },
    { label: "Entries", value: String(totals.entries) },
  ];

  return (
    <div className="mb-5 overflow-hidden rounded-[14px] border border-border">
      <div className="grid grid-cols-3 gap-px bg-border">
        {cells.map((c) => (
          <div key={c.label} className="bg-surface px-4 py-3">
            <p className="label m-0">{c.label}</p>
            <p className="tabular m-0 text-base font-black text-fg">{c.value}</p>
          </div>
        ))}
      </div>
      {running && (
        <p className="m-0 border-t border-border bg-surface-2 px-4 py-2 text-2xs font-bold text-fg-muted">
          + {running} hrs still running — not counted above until the timer is
          finished.
        </p>
      )}
    </div>
  );
}
