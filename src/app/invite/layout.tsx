import type { ReactNode } from "react";

/**
 * The invite route has no application shell, for the same reason `/login` does
 * not: the person reading it cannot sign in yet, so a sidebar full of
 * destinations they cannot reach would be worse than no chrome at all.
 */
export default function InviteLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
