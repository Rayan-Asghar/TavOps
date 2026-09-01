import type { ReactNode } from "react";
import { logoutAction } from "@/server/auth-actions";
import { can, type GlobalRole } from "@/lib/rbac";
import { Sidebar, type NavEntry } from "./sidebar";


import { fmtDayLabel } from "@/lib/format";
export function AppShell({
  children,
  userName,
  userRole,
  inboxCount,
  title,
  actions,
}: {
  children: ReactNode;
  userName: string;
  userRole: string;
  inboxCount: number;
  title: string;
  actions?: ReactNode;
}) {
  const role = userRole as GlobalRole;

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
  }

  if (can(role, "proposal.create") || can(role, "feasibility.answer")) {
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
  if (can(role, "audit.view")) {
    management.push({ href: "/audit", label: "Audit log", icon: "review" });
  }
  // Teams no longer drive blocker routing, so there is nothing they change from
  // day to day. The tables and the page remain; the nav slot does not.

  return (
    <div className="min-h-screen md:grid md:grid-cols-[248px_minmax(0,1fr)]">
      <Sidebar
        main={main}
        management={management}
        userName={userName}
        userRole={userRole}
        signOut={
          <form action={logoutAction}>
            <button
              type="submit"
              className="w-full rounded-lg py-2 text-left text-xs font-medium text-nav-fg-subtle transition-colors hover:text-white"
            >
              Sign out
            </button>
          </form>
        }
      />

      <div className="min-w-0">
        <header
          className="sticky top-0 z-30 flex h-[78px] items-center justify-between gap-5
                     border-b border-border bg-bg/90 pl-[72px] pr-5 backdrop-blur-md md:px-7"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0">
              <p className="eyebrow hidden sm:block">{fmtDayLabel()}</p>
              <h1 className="m-0 truncate text-2xl leading-tight tracking-[-.035em]">
                {title}
              </h1>
            </div>
          </div>
          {actions && (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          )}
        </header>

        <main className="p-5 md:p-7">{children}</main>
      </div>
    </div>
  );
}

/** Large heading block that opens a page, matching the reference's section rule. */
export function SectionIntro({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-7 mt-3.5 flex flex-col items-start justify-between gap-5 border-b border-fg pb-6 pt-6 sm:flex-row sm:items-end">
      <div className="min-w-0">
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="display m-0 text-[clamp(30px,4vw,52px)]">{title}</h2>
      </div>
      {description && (
        <p className="m-0 max-w-[440px] text-xs text-fg-muted">
          {description}
        </p>
      )}
      {actions}
    </div>
  );
}
