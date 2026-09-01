/**
 * Search, sort and pagination, read off the URL.
 *
 * Same contract as `report-range.ts`, and for the same reasons: the state lives
 * in the query string so a filtered view is shareable and survives a refresh,
 * and so the list stays server rendered — which is what keeps the access
 * scoping in `lib/access.ts` on the server rather than in a client filter.
 *
 * Nothing here reaches a database. Pure, so it is unit-tested.
 */

export const DEFAULT_PAGE_SIZE = 50;

/** Longest search we will run. Longer is a paste, not a query. */
const MAX_Q = 120;

export type ListParams = {
  /** Free-text search, trimmed and length-capped. Empty means "no filter". */
  q: string;
  /** One of the caller's allowed keys, or null. */
  sort: string | null;
  /** Descending when the key arrived with a leading "-". */
  desc: boolean;
  /** 1-based. */
  page: number;
  pageSize: number;
};

export type RawParams = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/**
 * Reads list state off search params.
 *
 * Unrecognised sort keys fall back rather than erroring — a hand-edited or
 * stale URL should show the list, not a stack trace. The allow-list also means
 * a sort key can never reach a query builder as arbitrary text.
 */
export function parseListParams(
  raw: RawParams,
  opts: {
    sortable?: readonly string[];
    defaultSort?: string;
    defaultDesc?: boolean;
    pageSize?: number;
  } = {},
): ListParams {
  const { sortable = [], defaultSort = null, defaultDesc = false } = opts;
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;

  const q = one(raw.q).trim().slice(0, MAX_Q);

  const rawSort = one(raw.sort);
  const wantsDesc = rawSort.startsWith("-");
  const key = wantsDesc ? rawSort.slice(1) : rawSort;
  const sort = sortable.includes(key) ? key : defaultSort;
  const desc = sortable.includes(key) ? wantsDesc : defaultDesc;

  const parsedPage = Number.parseInt(one(raw.page), 10);
  const page =
    Number.isFinite(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 10_000) : 1;

  return { q, sort, desc, page, pageSize };
}

/** Rows to skip for the current page. */
export function offsetFor(p: ListParams): number {
  return (p.page - 1) * p.pageSize;
}

/**
 * Builds an href with some keys changed and the rest preserved.
 *
 * Changing a filter resets to page 1 unless the caller is setting `page`
 * itself: staying on page 7 of a list that just became two pages long shows an
 * empty table and looks broken.
 */
export function listHref(
  pathname: string,
  current: RawParams,
  patch: Record<string, string | number | null>,
): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    const s = one(v);
    if (s) next.set(k, s);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "") next.delete(k);
    else next.set(k, String(v));
  }
  if (!("page" in patch)) next.delete("page");
  if (next.get("page") === "1") next.delete("page");

  const qs = next.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** The sort value a header link should carry: same key toggles direction. */
export function nextSort(current: ListParams, key: string): string {
  return current.sort === key && !current.desc ? `-${key}` : key;
}

export type PageInfo = {
  page: number;
  pageSize: number;
  total: number;
  pages: number;
  from: number;
  to: number;
  hasPrev: boolean;
  hasNext: boolean;
};

/** Everything a pager needs, including the "1–50 of 213" line. */
export function pageInfo(p: ListParams, total: number): PageInfo {
  const pages = Math.max(1, Math.ceil(total / p.pageSize));
  const page = Math.min(p.page, pages);
  const from = total === 0 ? 0 : (page - 1) * p.pageSize + 1;
  const to = Math.min(total, page * p.pageSize);
  return {
    page,
    pageSize: p.pageSize,
    total,
    pages,
    from,
    to,
    hasPrev: page > 1,
    hasNext: page < pages,
  };
}
