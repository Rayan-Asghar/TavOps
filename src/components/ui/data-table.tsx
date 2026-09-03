import type { ReactNode } from "react";

/**
 * Tables, in one treatment.
 *
 * There were two: the task table used 8px black uppercase headers, the three
 * reports tables used 11px bold sentence case, and only the task table had a
 * row hover. This settles on the uppercase micro-header, which matches
 * `.eyebrow`, `.label` and `.tag`, at the 11px legibility floor. Every header
 * cell gets `scope="col"`, which none of them had.
 */

/** Scroll container plus the table itself. Wide tables scroll inside their own
 *  box rather than pushing the page sideways. */
export function DataTable({
  minWidth,
  maxHeight,
  children,
}: {
  minWidth?: number;
  /** Cap the table's own height so its header can stick. Omit for short tables
   *  that never need it — a scrollbar on a five-row table is noise. */
  maxHeight?: number;
  children: ReactNode;
}) {
  return (
    /* `overflow-x: auto` forces overflow-y to `auto` too, which makes THIS div the
       sticky containing block — so a header stuck to the viewport silently does
       nothing (measured: it slid from 1425px to 551px on scroll). The fix is to
       let the container be the vertical scroller as well, and stick the header to
       the top of it. Without a maxHeight the container never scrolls vertically
       and the header simply behaves as before. */
    <div
      className="w-full overflow-auto"
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table
        className="w-full border-collapse text-xs"
        style={minWidth ? { minWidth } : undefined}
      >
        {children}
      </table>
    </div>
  );
}

export function Th({
  numeric = false,
  srOnly = false,
  children,
}: {
  numeric?: boolean;
  /** For an actions column, which needs a name for screen readers but not on
   *  screen. An unnamed `<th>` is a hole in the table's header row. */
  srOnly?: boolean;
  children: ReactNode;
}) {
  return (
    <th
      scope="col"
      /* Sticks to the top of the scrolling container, not the viewport. Reports
         lists 60 timesheet rows and the column names were gone by row 15; C4/C5
         both ask for a sticky header. `bg-surface` is required — a transparent
         sticky header lets rows scroll through it. */
      className={`sticky top-0 z-10 h-[38px] border-b border-border bg-surface px-4
                  text-2xs font-bold uppercase tracking-[.1em] text-fg-label
                  first:pl-5 last:pr-5 ${numeric ? "text-right" : "text-left"}`}
    >
      {srOnly ? <span className="sr-only">{children}</span> : children}
    </th>
  );
}

export function Td({
  numeric = false,
  mono = false,
  className = "",
  children,
}: {
  numeric?: boolean;
  mono?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <td
      className={`px-4 py-3 align-middle first:pl-5 last:pr-5 ${
        numeric ? "text-right" : ""
      } ${mono ? "font-mono" : ""} ${className}`}
    >
      {children}
    </td>
  );
}

export function TRow({ children }: { children: ReactNode }) {
  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-surface-hover">
      {children}
    </tr>
  );
}
