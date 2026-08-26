import type { ReactNode } from "react";
import { logoutAction } from "@/server/auth-actions";
import { can, type GlobalRole } from "@/lib/rbac";
import { Sidebar, type NavEntry } from "./sidebar";

function todayLabel(): string {
  const now = new Date();
  const day = now
    .toLocaleDateString("en-US", { weekday: "long" })
    .toUpperCase();
  const rest = now
    .toLocaleDateString("en-US", { month: "short", day: "2-digit" })
    .toUpperCase();
  return `${day} · ${rest}`;
}

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

  if (can(role, "review.approve")) {
    main.push({ href: "/review", label: "Review", icon: "review" });
  }

  if (can(role, "proposal.create") || can(role, "feasibility.answer")) {
    main.push({ href: "/sales", label: "Sales", icon: "sales" });
  }

  // Only surface what is actually built. A nav full of dead links reads as a
  // broken product rather than a roadmap.
  const management: NavEntry[] = can(role, "user.manage")
    ? [{ href: "/admin/users", label: "People", icon: "people" }]
    : [];

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
              className="w-full rounded-lg py-2 text-left text-[11px] font-medium text-[#777] transition-colors hover:text-white"
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
              <p className="eyebrow hidden sm:block">{todayLabel()}</p>
              <h1 className="m-0 truncate text-[20px] leading-tight tracking-[-.035em]">
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
        <p className="m-0 max-w-[440px] text-[12px] text-fg-muted">
          {description}
        </p>
      )}
      {actions}
    </div>
  );
}
