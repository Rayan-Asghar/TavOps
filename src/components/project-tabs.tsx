"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export type TabKey = "overview" | "tasks" | "team" | "activity";

export type TabDef = { key: TabKey; label: string; count?: number };

/**
 * Tabs live in the URL rather than component state so a link to a specific tab
 * is shareable and survives a refresh — and so the content stays server
 * rendered, which is what keeps the permission checks on the server.
 */
export function ProjectTabs({
  tabs,
  active,
}: {
  tabs: TabDef[];
  active: TabKey;
}) {
  const pathname = usePathname();
  const params = useSearchParams();

  const hrefFor = (key: TabKey) => {
    const next = new URLSearchParams(params.toString());
    if (key === "overview") next.delete("tab");
    else next.set("tab", key);
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  return (
    <div className="mb-5 border-b border-border">
      <nav
        aria-label="Project sections"
        className="-mb-px flex gap-1 overflow-x-auto"
      >
        {tabs.map((t) => {
          const isActive = t.key === active;
          return (
            <Link
              key={t.key}
              href={hrefFor(t.key)}
              scroll={false}
              aria-current={isActive ? "page" : undefined}
              className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-[12px] font-bold transition-colors
                ${
                  isActive
                    ? "border-brand text-fg"
                    : "border-transparent text-fg-muted hover:text-fg"
                }`}
            >
              {t.label}
              {typeof t.count === "number" && t.count > 0 && (
                <span
                  className={`grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[9px] font-black
                    ${isActive ? "bg-brand text-white" : "bg-surface-2 text-fg-muted"}`}
                >
                  {t.count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
