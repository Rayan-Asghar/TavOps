import type { ReactNode } from "react";

/**
 * Empty states. Ten near-identical variants existed across the pages, none of
 * them quite matching. The wording stays per-page — it should say what would
 * put something here — but the frame is shared.
 */

/** Stands alone on a page and draws its own panel. */
export function EmptyState({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`panel p-12 text-center text-sm text-fg-muted ${className}`}>
      {children}
    </div>
  );
}

/** Sits inside a panel that already has a header. */
export function EmptyRow({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 px-5 py-10 text-center text-xs text-fg-muted">
      {children}
    </p>
  );
}

/** Sits inside a table body, spanning every column. */
export function EmptyCell({
  colSpan,
  children,
}: {
  colSpan: number;
  children: ReactNode;
}) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="px-5 py-10 text-center text-xs text-fg-muted"
      >
        {children}
      </td>
    </tr>
  );
}
