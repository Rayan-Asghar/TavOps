import { NextResponse } from "next/server";
import { after } from "next/server";
import { getActor } from "@/lib/auth";
import { log, newRequestId } from "@/lib/logger";
import { inAppSchedulerEnabled, runDueJobs } from "@/server/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * "Somebody is here."
 *
 * That is the entire payload — there isn't one. The browser does not name a
 * job, does not send a timestamp, and does not decide that anything is due.
 * The server reads `job_runs` and makes that call itself, so five open laptops
 * produce one run an hour and a tampered client achieves nothing beyond making
 * the server look at a table.
 *
 * Session-authenticated, deliberately NOT a call into /api/cron/*: those take a
 * bearer CRON_SECRET, and a secret a browser can hold is not a secret. This is
 * a separate door with a separate key, and the key is the session the user
 * already has.
 *
 * The work runs in `after()` so the response returns immediately — the same
 * reasoning as `scheduleDrain()`: the caller is a fire-and-forget beacon with
 * nothing to do with the result, and a heartbeat that blocked for the length of
 * a sweep would stack up behind itself.
 */
export async function POST() {
  const actor = await getActor();
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!inAppSchedulerEnabled()) {
    // A host with real cron. Told plainly so a client can stop asking.
    return NextResponse.json({ ok: true, scheduling: false }, { status: 200 });
  }

  const requestId = newRequestId();
  after(async () => {
    try {
      const outcome = await runDueJobs("heartbeat");
      // Only worth a line when something actually happened; otherwise this
      // logs once per person per five minutes, all day, saying nothing.
      if (outcome.ran.length || outcome.failed.length) {
        log.info("heartbeat.ran", { requestId, ...outcome });
      }
    } catch (err) {
      log.error("heartbeat.failed", { requestId, err });
    }
  });

  return NextResponse.json({ ok: true, scheduling: true }, { status: 202 });
}
