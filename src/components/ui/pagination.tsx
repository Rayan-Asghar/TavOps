import Link from "next/link";
import { listHref, type PageInfo, type RawParams } from "@/lib/list-params";

/**
 * Prev / next and a position line.
 *
 * Every list in this app used to be a hard cap with no way past it — the audit
 * page said "newest hundred" and entry 101 was unreachable by any means.
 */
export function Pagination({
  info,
  pathname,
  params,
  unit = "rows",
}: {
  info: PageInfo;
  pathname: string;
  params: RawParams;
  unit?: string;
}) {
  if (info.total === 0) return null;

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3"
    >
      <p className="m-0 text-2xs text-fg-muted">
        {info.from}–{info.to} of {info.total} {unit}
      </p>

      <div className="flex items-center gap-2">
        {info.hasPrev ? (
          <Link
            href={listHref(pathname, params, { page: info.page - 1 })}
            className="btn-secondary btn-sm"
            rel="prev"
          >
            ← Previous
          </Link>
        ) : (
          <span className="btn-secondary btn-sm opacity-40" aria-hidden>
            ← Previous
          </span>
        )}

        <span className="text-2xs font-bold text-fg-muted">
          {info.page} / {info.pages}
        </span>

        {info.hasNext ? (
          <Link
            href={listHref(pathname, params, { page: info.page + 1 })}
            className="btn-secondary btn-sm"
            rel="next"
          >
            Next →
          </Link>
        ) : (
          <span className="btn-secondary btn-sm opacity-40" aria-hidden>
            Next →
          </span>
        )}
      </div>
    </nav>
  );
}
