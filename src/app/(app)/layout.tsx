import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { logoutAction } from "@/server/auth-actions";
import { can } from "@/lib/rbac";
import { Sidebar, type NavEntry, type NavGroup } from "@/components/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { TimerChip } from "@/components/timer-chip";
import { Heartbeat } from "@/components/heartbeat";
import { inAppSchedulerEnabled } from "@/server/scheduler";
import { ToastProvider } from "@/components/ui/toast";
import {
  CommandPalette,
  type PaletteDestination,
} from "@/components/command-palette";
import { Crumb } from "@/components/crumb";
import { requirePageActor } from "@/lib/authz";
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
  // The layout and the page it wraps share ONE query for this, because
  // `loadPageActor` is wrapped in React's `cache()` — deduplicated per render
  // pass, not across requests, which for per-user authorisation data would mean
  // one person's role answering another person's request.
  const actor = await requirePageActor();

  const userName = actor.name;
  const role = actor.globalRole;
  const userRole = role;
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  const [inboxCount, timer, recents] = await Promise.all([
    unresolvedCount(actor.id),
    activeSessionFor(actor.id),
    recentProjectsFor(actor, 5),
  ]);

  /**
   * The rail, grouped by what you are doing.
   *
   * Every destination has a home, which is what fixes r5: /review and
   * /admin/teams were reachable but in no group, so standing on either left the
   * rail with nothing selected and no answer to "where am I".
   *
   * /review is conditional on the capability the page itself gates on, so it is
   * never offered to someone who would get a 404. Teams sits under Management
   * rather than Delivery because it is reference data now, not a daily surface.
   */
  const today: NavEntry[] = [
    {
      href: "/",
      label: "Needs attention",
      icon: "inbox",
      count: inboxCount,
      danger: inboxCount > 0,
    },
  ];
  if (can(role, "worklog.create")) {
    today.push({ href: "/log", label: "Log work", icon: "log" });
    // The same hours a month at a time, laid out like the project's sheet.
    today.push({ href: "/timesheet", label: "Timesheet", icon: "log" });
  }

  const delivery: NavEntry[] = [
    { href: "/projects", label: "Projects", icon: "projects" },
    // Tasks were reachable only inside the project that owned them.
    { href: "/tasks", label: "Tasks", icon: "review" },
    // Scoped like Projects — you see the clients whose work you are on — so it
    // needs no capability of its own.
    { href: "/clients", label: "Clients", icon: "people" },
  ];
  if (can(role, "review.approve")) {
    delivery.push({ href: "/review", label: "Review queue", icon: "review" });
  }

  const insight: NavEntry[] = [
    // Everyone gets Reports. A developer sees their own hours against their own
    // capacity, which is the question they ask about themselves; the page
    // narrows its content by capability rather than being withheld.
    { href: "/reports", label: "Reports", icon: "projects" },
  ];
  if (can(role, "proposal.create")) {
    insight.push({ href: "/sales", label: "Sales", icon: "sales" });
  }

  // Only surface what is actually built. A nav full of dead links reads as a
  // broken product rather than a roadmap.
  const management: NavEntry[] = [];
  if (can(role, "user.manage")) {
    management.push({ href: "/admin/users", label: "People", icon: "people" });
    management.push({ href: "/admin/teams", label: "Teams", icon: "people" });
  }
  if (can(role, "sheet.configure")) {
    management.push({
      href: "/admin/sheets",
      label: "Work log sheets",
      icon: "projects",
    });
  }
  if (can(role, "audit.view")) {
    management.push({ href: "/audit", label: "Audit log", icon: "review" });
  }

  const groups: NavGroup[] = [
    { label: "TODAY", entries: today },
    { label: "DELIVERY", entries: delivery },
    { label: "INSIGHT", entries: insight },
    { label: "MANAGEMENT", entries: management },
  ];
  const allEntries = groups.flatMap((g) => g.entries);

  /* r13: the palette is a shortcut, never the only path — so its destinations are
     derived from the nav that is already on screen rather than listed separately,
     which also means a role can never be offered something the sidebar withholds.
     /review is the one addition: it is deliberately not a nav slot (see above),
     which makes it exactly the kind of place a palette is for. */
  const destinations: PaletteDestination[] = allEntries.map((e) => ({
    href: e.href,
    label: e.label,
  }));

  const actions: PaletteDestination[] = [];
  if (can(role, "project.create")) {
    actions.push({ href: "/projects/new", label: "New project" });
  }

  return (
    <ToastProvider>
    <div className="min-h-screen md:grid md:grid-cols-[248px_minmax(0,1fr)]">
      <Sidebar
        groups={groups}
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

        {/* Mounted here, beside TimerChip, because this layout persists across
            navigations: moving between pages neither restarts its interval nor
            fires an extra beat. Renders nothing. The flag is read on the server
            so a host with real cron never even makes the request. */}
        <Heartbeat enabled={inAppSchedulerEnabled()} />

        <main className="p-5 md:p-7">{children}</main>
      </div>
    </div>
    </ToastProvider>
  );
}
