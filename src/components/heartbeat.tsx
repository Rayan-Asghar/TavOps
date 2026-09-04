"use client";

import { useEffect } from "react";

/** Roughly five minutes: often enough for an hourly job to start on time. */
const INTERVAL_MS = 5 * 60_000;

/**
 * Tells the server somebody is here, so it can run whatever is due.
 *
 * Renders nothing and holds no state — deliberately. This component's only
 * effect is a fetch, and there is nothing to show the user about it: a failed
 * heartbeat means the next one tries again five minutes later, which is not
 * news. Keeping it stateless also keeps it clear of the repo's rule that a
 * `setState` in an effect is a lint error.
 *
 * Mounted once in the app layout, which persists across navigations, so moving
 * between pages neither restarts the interval nor fires an extra beat.
 *
 * `document.hidden` is checked at each tick rather than at mount: a laptop left
 * on an inactive tab all night should not keep asking, and browsers throttle
 * timers in background tabs anyway, so the beat that does fire is unreliable
 * timing rather than a useful clock.
 */
export function Heartbeat({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;

    const beat = () => {
      if (document.hidden) return;
      // Fire and forget: keepalive so a beat in flight survives a navigation,
      // and the failure path is deliberately empty. Nothing here is worth
      // interrupting somebody's work over.
      void fetch("/api/heartbeat", {
        method: "POST",
        keepalive: true,
      }).catch(() => {});
    };

    beat();
    const id = setInterval(beat, INTERVAL_MS);

    // A machine that has been asleep comes back with a stale clock and a job
    // long overdue; beating on wake means it starts now rather than up to five
    // minutes later.
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [enabled]);

  return null;
}
