import { log } from "@/lib/logger";
import { poolMax } from "@/db";

/**
 * Keeps one background failure from taking every in-flight page down with it.
 *
 * Node has terminated the process on an unhandled rejection since v15. On a
 * long-lived server that is defensible: the process restarts and one request
 * fails. On a serverless host it is not, because ONE INSTANCE SERVES MANY
 * CONCURRENT REQUESTS, and Next streams its responses — the shell and
 * `loading.tsx` go out first, the page body follows when its data resolves. Kill
 * the process in between and every one of those responses is truncated mid
 * stream. The browser is left holding a skeleton with no error, no status code
 * and nothing to retry, so the page simply never finishes loading.
 *
 * That is not hypothetical: it is how the Vercel deployment presented. A drain
 * deadlocked against a one-connection pool, Postgres cancelled the statement,
 * the rejection reached the top, and the platform logged
 * `Node.js process exited with exit status: 128` — while 54 of 96 page requests
 * recorded `responseStatusCode: 0`. Every route looked broken; the cause was in
 * none of them.
 *
 * The deadlock is fixed (see `src/server/sync-worker.ts`). This is the backstop,
 * for the same reason the finance RLS policy is a backstop: the next escaped
 * rejection should cost one log line, not the whole surface. `after()` callbacks
 * are exactly where such a rejection comes from — the response is already sent,
 * so there is no request left to fail.
 *
 * Deliberately NOT catching `uncaughtException`. A synchronous throw with no
 * handler has left the process in an unknown state and continuing is the more
 * dangerous choice; a rejected promise has not.
 */
export function register() {
  // Runs once per process, but a module can be evaluated more than once in
  // development, and duplicate listeners would log the same failure twice.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const flag = "__tavrenRejectionGuard";
  const g = globalThis as unknown as Record<string, boolean>;
  if (g[flag]) return;
  g[flag] = true;

  process.on("unhandledRejection", (err) => {
    log.error("process.unhandledRejection", { err });
  });

  /* The effective pool size, once per cold start. It is set by an environment
     variable whose value is not readable back out of the host, and getting it
     wrong is not visible in any behaviour until the thing it breaks breaks —
     a pool of one deadlocks the sync worker, a pool of ten exhausts the
     pooler. One log line at boot makes the deployed value checkable. */
  log.info("process.started", {
    poolMax,
    runtime: process.env.NEXT_RUNTIME,
  });
}
