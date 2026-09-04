import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { logoutAction } from "@/server/auth-actions";
import { can, type GlobalRole } from "@/lib/rbac";
import { Sidebar, type NavEntry } from "@/components/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { TimerChip } from "@/components/timer-chip";
import { ToastProvider } from "@/components/ui/toast";
import {
  CommandPalette,
  type PaletteDestination,
} from "@/components/command-palette";
import { Crumb } from "@/components/crumb";
import { getActor } from "@/lib/auth";
import { unresolvedCount } from "@/server/notifications";
import { activeSessionFor } from "@/server/timer";
import { recentProjectsFor } from "@/server/recent";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import { fmtDayLabel } from "@/lib/format";

/**
 * The application shell — a LAYOUT, not a component each page renders.
 *
 * It used to be the latter, in all thirteen pages. That works, but a page cannot
 * survive a route change, so every navigation tore the sidebar out of the DOM
 * and rebuilt it. Invisible until `loading.tsx` arrived and began painting a
 * sidebar silhouette during the wait — at which point every click flashed the
 * whole left rail.
 *
 * A layout persists across navigations within its segment, so the sidebar,
 * header, timer and command palette now mount once. Only the page content is
 * replaced, which is also what makes the loading skeleton read as "this part is
 * loading" rather than "the app is reloading".
 *
 * The cost of the move was the `title` prop: a layout cannot take props from its
 * children. `Crumb` derives it from the pathname instead.
 *
 * The auth check lives here too, so it happens once per navigation rather than
 * being repeated at the top of every page.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const [me] = await db
    .select({ name: users.name, globalRole: users.globalRole })
    .from(users)
    .where(eq(users.id, actor.id))
    .limit(1);

  const userName = me?.name ?? "Unknown";
  const role = (me?.globalRole ?? "developer") as GlobalRole;
  const userRole = role;
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  const [inboxCount, timer, recents] = await Promise.all([
    unresolvedCount(actor.id),
    activeSessionFor(actor.id),
    recentProjectsFor(actor, 5),
  ]);

  const main: NavEntry[] = [
    {
      href: "/",
      label: "Needs Attention",
      icon: "inbox",
      count: inboxCount,
      danger: inboxCount > 0,
    },
    { href: "/projects", label: "Projects", icon: "projects" },
  ];

  // Second slot, above Projects in importance if not position: every other
  // signal in this system is downstream of hours actually being entered.
  if (can(role, "worklog.create")) {
    main.splice(1, 0, { href: "/log", label: "Log work", icon: "log" });
    // The same hours, laid out like the project's sheet. /log is for one entry
    // at a time; this is for a month at a time.
    main.splice(2, 0, { href: "/timesheet", label: "Timesheet", icon: "log" });
  }

  if (can(role, "proposal.create")) {
    main.push({ href: "/sales", label: "Sales", icon: "sales" });
  }

  // Everyone gets Reports. A developer sees their own hours against their own
  // capacity, which is the question they ask about themselves; the page narrows
  // its content by capability rather than being withheld.
  main.push({ href: "/reports", label: "Reports", icon: "projects" });

  // Review is deliberately NOT a top-level destination. Every item in the queue
  // already arrives as a `task_needs_review` inbox item, and those link
  // straight to /review — so the queue is one click from where people already
  // look, without holding a permanent slot that reads as unfinished work even
  // when it is empty. A standing nav entry for an empty queue is noise.

  // Only surface what is actually built. A nav full of dead links reads as a
  // broken product rather than a roadmap.
  const management: NavEntry[] = [];
  if (can(role, "user.manage")) {
    management.push({ href: "/admin/users", label: "People", icon: "people" });
  }
  if (can(role, "sheet.configure")) {
    management.push({ href: "/admin/sheets", label: "Work log sheets", icon: "projects" });
  }
  if (can(role, "audit.view")) {
    management.push({ href: "/audit", label: "Audit log", icon: "review" });
  }
  // Teams no longer drive blocker routing, so there is nothing they change from
  // day to day. The tables and the page remain; the nav slot does not.

  /* r13: the palette is a shortcut, never the only path — so its destinations are
     derived from the nav that is already on screen rather than listed separately,
     which also means a role can never be offered something the sidebar withholds.
     /review is the one addition: it is deliberately not a nav slot (see above),
     which makes it exactly the kind of place a palette is for. */
  const destinations: PaletteDestination[] = [...main, ...management].map((e) => ({
    href: e.href,
    label: e.label,
  }));
  // The same capability /review itself gates on, so the palette can never offer
  // a destination that would 404 on arrival.
  if (can(role, "review.approve")) {
    destinations.push({ href: "/review", label: "Review queue" });
  }

  const actions: PaletteDestination[] = [];
  if (can(role, "project.create")) {
    actions.push({ href: "/projects/new", label: "New project" });
  }

  return (
    <ToastProvider>
    <div className="min-h-screen md:grid md:grid-cols-[248px_minmax(0,1fr)]">
      <Sidebar
        main={main}
        management={management}
        userName={userName}
        userRole={userRole}
        themeToggle={<ThemeToggle current={theme} />}
        signOut={
          <form action={logoutAction}>
            <button
              type="submit"
              className="w-full rounded-lg py-2 text-left text-xs font-medium text-nav-fg-subtle transition-[color,background-color,border-color] duration-150 ease-out-quad hover:text-white"
            >
              Sign out
            </button>
          </form>
        }
      />

      <div className="min-w-0">
        <header
          className="sticky top-0 z-30 flex h-[56px] items-center justify-between gap-4
                     border-b border-border bg-bg/90 pl-[72px] pr-5 backdrop-blur-md md:px-7"
        >
          <Crumb />

          <div className="flex shrink-0 items-center gap-3">
            <CommandPalette
              destinations={destinations}
              actions={actions}
              recents={recents.map((r) => ({
                id: r.id,
                code: r.code,
                name: r.name,
                health: r.health,
              }))}
            />
            {timer && (
              <TimerChip
                projectId={timer.projectId}
                taskTitle={timer.taskTitle}
                status={timer.status as "running" | "paused"}
                accumulatedSeconds={timer.accumulatedSeconds}
                resumedAt={timer.resumedAt ? timer.resumedAt.toISOString() : null}
              />
            )}
            <p className="eyebrow m-0 hidden lg:block">{fmtDayLabel()}</p>
          </div>
        </header>

        <main className="p-5 md:p-7">{children}</main>
      </div>
    </div>
    </ToastProvider>
  );
}
