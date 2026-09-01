"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Route-level error boundary.
 *
 * Without this a thrown ForbiddenError or a dropped database connection renders
 * Next's default crash screen, which tells an operations user nothing and gives
 * them nowhere to go. `error.digest` is the handle that matches this screen to
 * the server log line, since Server Component errors deliberately do not send
 * their message to the browser.
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // Client-side errors never reach the server logger, so this is the only
    // record of them; the browser console is where they can still be read.
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center bg-bg px-4 py-10">
      <div className="panel w-full max-w-[440px] p-8">
        <p className="eyebrow text-danger">SOMETHING BROKE</p>
        <h1 className="display mb-3 mt-2 text-3xl">This page did not load</h1>
        <p className="mb-6 text-xs text-fg-muted">
          The error has been logged. Trying again is usually worth it — if it
          keeps happening, send an admin the reference below.
        </p>

        {error.digest && (
          <p className="mb-6 font-mono text-xs text-fg-subtle">
            Reference: {error.digest}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button type="button" onClick={() => retry()} className="btn-primary">
            Try again
          </button>
          <Link href="/" className="btn-secondary">
            Back to inbox
          </Link>
        </div>
      </div>
    </main>
  );
}
