import Link from "next/link";
import type { ReactNode } from "react";
import { listHref, type ListParams, type RawParams } from "@/lib/list-params";

/**
 * A GET form, deliberately.
 *
 * The filtered view has to be a URL — shareable, refreshable, and back-button
 * correct — and it has to stay server rendered so the access scoping in
 * `lib/access.ts` keeps deciding what is in the list. Same reasoning as the
 * report range picker, which is the pattern this follows.
 *
 * No JavaScript required: it is a form with a submit button.
 */
export function ListFilters({
  action,
  params,
  placeholder = "Search",
  children,
  active,
  keepSort = true,
}: {
  /** The page's own path. */
  action: string;
  params: RawParams;
  placeholder?: string;
  /** Extra <select>s the page wants alongside the search box. */
  children?: ReactNode;
  active: ListParams;
  /** Pass false when the page renders its own sort control. */
  keepSort?: boolean;
}) {
  const hasFilters =
    active.q !== "" || Object.keys(params).some((k) => k !== "page" && k !== "sort" && params[k]);

  return (
    <form
      method="get"
      action={action}
      className="mb-4 flex flex-wrap items-end gap-3"
    >
      {/* Sorting survives a search; the page number does not. */}
      {keepSort && typeof params.sort === "string" && params.sort && (
        <input type="hidden" name="sort" value={params.sort} />
      )}

      <div className="min-w-[220px] flex-1">
        <label className="label" htmlFor="list-q">
          Search
        </label>
        <input
          id="list-q"
          type="search"
          name="q"
          defaultValue={active.q}
          placeholder={placeholder}
          className="field"
        />
      </div>

      {children}

      <button type="submit" className="btn-primary btn-sm">
        Apply
      </button>

      {hasFilters && (
        <Link
          href={listHref(action, {}, {})}
          className="btn-ghost btn-sm"
        >
          Clear
        </Link>
      )}
    </form>
  );
}

/** A labelled <select> shaped to sit in the filter row. */
export function FilterSelect({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="label" htmlFor={`filter-${name}`}>
        {label}
      </label>
      <select
        id={`filter-${name}`}
        name={name}
        defaultValue={value}
        className="field w-auto min-w-[150px]"
      >
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
