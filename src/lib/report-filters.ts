/**
 * The reconciliation strip's drill-down parameters.
 *
 * Pure and shared, so `/reports` and `/api/reports/timesheet` read a URL the
 * same way. That shared-ness is the whole point: the export link sits next to
 * the strip, and a CSV that narrowed differently from the screen it was
 * downloaded from would be worse than no CSV.
 */

export type ReportFilters = {
  /** Undefined means "both", which is not the same as false. */
  billable?: boolean;
  /** Only entries with no fresh, rated cost. */
  uncostedOnly: boolean;
};

export function parseReportFilters(
  billable: string | null | undefined,
  costed: string | null | undefined,
): ReportFilters {
  return {
    // Anything unrecognised falls back to "both" rather than erroring: a
    // hand-edited URL should show a report, not a stack trace — the same rule
    // `parseRange` and `parseListParams` already follow.
    billable:
      billable === "yes" ? true : billable === "no" ? false : undefined,
    uncostedOnly: costed === "no",
  };
}

/** Renders them back, for links that must keep the current drill-down. */
export function reportFilterParams(f: ReportFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.billable === true) out.billable = "yes";
  if (f.billable === false) out.billable = "no";
  if (f.uncostedOnly) out.costed = "no";
  return out;
}
