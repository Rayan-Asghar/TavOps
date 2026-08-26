import Link from "next/link";
import type { ReactNode } from "react";
import { logoutAction } from "@/server/auth-actions";

export function AppShell({
  children,
  userName,
  userRole,
  inboxCount,
}: {
  children: ReactNode;
  userName: string;
  userRole: string;
  inboxCount: number;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded bg-brand text-sm font-semibold text-white">
              T
            </span>
            <span className="text-sm font-semibold text-fg">TavrenOPS</span>
          </Link>

          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/"
              className="rounded px-3 py-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
            >
              Inbox
              {inboxCount > 0 && (
                <span className="ml-1.5 rounded-full bg-brand px-1.5 py-0.5 text-xs font-semibold text-white">
                  {inboxCount}
                </span>
              )}
            </Link>
            <Link
              href="/projects"
              className="rounded px-3 py-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg"
            >
              Projects
            </Link>
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="text-right leading-tight">
              <div className="text-sm font-medium text-fg">{userName}</div>
              <div className="text-xs text-fg-muted">
                {userRole.replace("_", " ")}
              </div>
            </div>
            <form action={logoutAction}>
              <button type="submit" className="btn-ghost text-xs">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
