import Link from "next/link";
import { listHref, type RawParams } from "@/lib/list-params";
import type { GridMonth } from "@/server/grid-queries";
import { LinkPending } from "./ui";

/**
 * The month tabs above the grid — the same months the project's sheet has tabs
 * for, labelled identically.
 *
 * A server component, unlike `ProjectTabs`: that one is a client component only
 * because it reads `usePathname`/`useSearchParams` to build hrefs, and this page
 * already has `searchParams` on the server. Same visual language, no JavaScript.
 */
export function GridMonthTabs({
  months,
  active,
  params,
}: {
  months: GridMonth[];
  active: string;
  params: RawParams;
}) {
  // The month being viewed always gets a tab, even with nothing logged in it —
  // otherwise the first entry of a month has nowhere to be typed.
  const shown = months.some((m) => m.month === active)
    ? months
    : [
        {
          month: active,
          label: monthLabel(active),
          totalHours: "0.00",
          entries: 0,
        },
        ...months,
      ].sort((a, b) => b.month.localeCompare(a.month));

  return (
    <div className="mb-5 border-b border-border">
      <nav aria-label="Months" className="-mb-px flex gap-1 overflow-x-auto">
        {shown.map((m) => {
          const isActive = m.month === active;
          return (
            <Link
              key={m.month}
              href={listHref("/timesheet", params, { month: m.month })}
              scroll={false}
              aria-current={isActive ? "page" : undefined}
              className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-xs font-bold transition-[color,background-color,border-color] duration-150 ease-out-quad
                ${
                  isActive
                    ? "border-brand text-fg"
                    : "border-transparent text-fg-muted hover:text-fg"
                }`}
            >
              {m.label}
              <LinkPending />
              {m.entries > 0 && (
                <span
                  className={`grid tabular h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-2xs font-bold
                    ${isActive ? "bg-brand text-white" : "bg-surface-2 text-fg-muted"}`}
                >
                  {m.entries}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

const FULL_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return `${FULL_MONTHS[Number(m) - 1]} ${y}`;
}
