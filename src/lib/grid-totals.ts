/**
 * The three numbers above the grid.
 *
 * Deliberately the same three the sheet's banner computes with formulas
 * (`bannerRows` in `sheet-template.ts`): total hours, distinct days logged, and
 * the entry count. Pure, so the server can render the strip for the first paint
 * and the client can recompute it as cells change without the two disagreeing.
 */

export type TotalledRow = {
  /** `YYYY-MM-DD`. */
  workDate: string;
  /** The exact numeric, as a string — never a float. */
  hours: string;
};

export type GridTotals = {
  /** Fixed to 2dp, matching `TEXT(SUM(C9:C),"0.00")`. */
  totalHours: string;
  daysLogged: number;
  entries: number;
};

export function gridTotals(rows: readonly TotalledRow[]): GridTotals {
  // Summed in hundredths so a column of 0.05s does not drift the way repeated
  // float addition does; `numeric(5,2)` has no fractional cents to lose.
  const hundredths = rows.reduce(
    (sum, r) => sum + Math.round(Number(r.hours) * 100),
    0,
  );
  const days = new Set(rows.map((r) => r.workDate));

  return {
    totalHours: (hundredths / 100).toFixed(2),
    daysLogged: days.size,
    entries: rows.length,
  };
}
