"use client";

import { useLinkStatus } from "next/link";

/**
 * Inline "this navigation is happening" mark.
 *
 * Every page here is dynamic and server rendered, so clicking a tab or a nav
 * item did nothing visible until the server came back with the whole page.
 * On a slow query that is indistinguishable from a dead link.
 *
 * Must be rendered inside the <Link> whose status it reports.
 */
export function LinkPending({ className = "" }: { className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;

  return (
    <span
      aria-hidden
      className={`inline-block h-3 w-3 shrink-0 animate-spin rounded-full
                  border-[1.5px] border-current border-t-transparent opacity-60 ${className}`}
    />
  );
}
