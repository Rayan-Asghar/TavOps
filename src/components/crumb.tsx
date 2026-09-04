"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

/**
 * The header's breadcrumb, derived from the route.
 *
 * It used to be a `title` prop every page passed to `AppShell`. That is what
 * forced the shell to live inside each page, which is what made the sidebar
 * remount on every navigation — a page cannot persist across a route change, and
 * a layout cannot receive props from its children.
 *
 * So the crumb reads the pathname instead. Static routes come from the map;
 * `/projects/[id]` gets a parent crumb and lets the page own the name, which it
 * already displays far more prominently than a 12px header line ever did.
 */

const LABEL: Record<string, string> = {
  "/": "Needs attention",
  "/log": "Log work",
  "/timesheet": "Timesheet",
  "/projects": "Projects",
  "/projects/new": "New project",
  "/reports": "Reports",
  "/review": "Review queue",
  "/sales": "Pipeline",
  "/audit": "Audit log",
  "/admin/users": "People",
  "/admin/teams": "Teams",
  "/admin/sheets": "Work log sheets",
};

export function Crumb() {
  const pathname = usePathname() ?? "/";

  const exact = LABEL[pathname];
  // Only /projects/[id] is deeper than its own map entry.
  const isProjectDetail =
    !exact && pathname.startsWith("/projects/") && pathname !== "/projects/new";

  const parent = isProjectDetail
    ? { href: "/projects", label: "Projects" }
    : null;
  const title = exact ?? (isProjectDetail ? "Project" : "TavrenOPS");

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="m-0 flex min-w-0 list-none items-center gap-1.5 p-0 text-2xs font-bold">
        {parent && (
          <>
            <li className="shrink-0">
              <Link
                href={parent.href}
                className="text-fg-muted transition-[color] duration-150 ease-out-quad hover:text-fg"
              >
                {parent.label}
              </Link>
            </li>
            <li aria-hidden className="shrink-0 text-fg-subtle">
              /
            </li>
          </>
        )}
        <li aria-current="page" className="min-w-0 truncate text-fg">
          {title}
        </li>
      </ol>
    </nav>
  );
}
