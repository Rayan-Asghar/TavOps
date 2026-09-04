import { describe, expect, it } from "vitest";
import { SCHEDULE, dueJobs, isDue, type JobDefinition } from "./job-schedule";

const at = (iso: string) => new Date(iso);
const hourly: JobDefinition = {
  name: "sweeps",
  kind: "interval",
  everyMs: 3_600_000,
};
const daily: JobDefinition = { name: "digest", kind: "daily", atHourUtc: 13 };

describe("interval jobs", () => {
  it("is due when it has never run", () => {
    expect(isDue(hourly, null, at("2026-09-04T09:00:00Z"))).toBe(true);
  });

  it("is not due before the interval has elapsed", () => {
    expect(
      isDue(hourly, at("2026-09-04T09:00:00Z"), at("2026-09-04T09:59:00Z")),
    ).toBe(false);
  });

  it("is due exactly on the interval, not a tick later", () => {
    // On a 5-minute heartbeat, "strictly greater" would cost five minutes an
    // hour for no reason.
    expect(
      isDue(hourly, at("2026-09-04T09:00:00Z"), at("2026-09-04T10:00:00Z")),
    ).toBe(true);
  });

  it("is due once, not repeatedly, after a long gap", () => {
    // A machine off all weekend comes back and runs once. Nothing accumulates:
    // there is no backlog to work through, only a current state to recompute.
    const now = at("2026-09-07T09:00:00Z");
    expect(isDue(hourly, at("2026-09-04T09:00:00Z"), now)).toBe(true);
  });

  it("is not due again immediately after running", () => {
    const now = at("2026-09-04T10:00:00Z");
    expect(isDue(hourly, now, now)).toBe(false);
  });
});

describe("daily jobs", () => {
  it("is not due before its hour, even having never run", () => {
    // Otherwise the first person to open the app at 03:00 sends the digest.
    expect(isDue(daily, null, at("2026-09-04T03:00:00Z"))).toBe(false);
  });

  it("is due at its hour when it has never run", () => {
    expect(isDue(daily, null, at("2026-09-04T13:00:00Z"))).toBe(true);
  });

  it("is due after its hour, later the same day", () => {
    expect(isDue(daily, null, at("2026-09-04T18:30:00Z"))).toBe(true);
  });

  it("is not due twice in one UTC day", () => {
    expect(
      isDue(daily, at("2026-09-04T13:05:00Z"), at("2026-09-04T20:00:00Z")),
    ).toBe(false);
  });

  it("is due again the next day, past the hour", () => {
    expect(
      isDue(daily, at("2026-09-04T13:05:00Z"), at("2026-09-05T13:01:00Z")),
    ).toBe(true);
  });

  it("does not make up a missed day", () => {
    // Two days off produces one digest, about today. A digest about Tuesday
    // delivered on Thursday is noise dressed as a report.
    const now = at("2026-09-07T14:00:00Z");
    expect(isDue(daily, at("2026-09-04T13:00:00Z"), now)).toBe(true);
    // and having run, it is done for the day
    expect(isDue(daily, at("2026-09-07T14:00:01Z"), now)).toBe(false);
  });

  it("uses the UTC day, not the local one", () => {
    // 23:30 UTC on the 4th is already the 5th in PKT. The job must not fire
    // twice because two clocks disagree about which day it is.
    expect(
      isDue(daily, at("2026-09-04T13:00:00Z"), at("2026-09-04T23:30:00Z")),
    ).toBe(false);
  });

  it("crosses a month boundary", () => {
    expect(
      isDue(daily, at("2026-09-30T13:00:00Z"), at("2026-10-01T13:00:00Z")),
    ).toBe(true);
  });
});

describe("dueJobs", () => {
  it("returns nothing when everything has just run", () => {
    const now = at("2026-09-04T13:30:00Z");
    expect(
      dueJobs({ sweeps: now, sync: now, digest: now }, now),
    ).toEqual([]);
  });

  it("returns every job on a cold start past the digest hour", () => {
    expect(dueJobs({}, at("2026-09-04T13:30:00Z"))).toEqual([
      "sweeps",
      "sync",
      "digest",
    ]);
  });

  it("holds the digest back on a cold start before its hour", () => {
    expect(dueJobs({}, at("2026-09-04T06:00:00Z"))).toEqual(["sweeps", "sync"]);
  });

  it("returns sync alone a few minutes after a full run", () => {
    const ran = at("2026-09-04T13:30:00Z");
    expect(dueJobs({ sweeps: ran, sync: ran, digest: ran }, at("2026-09-04T13:34:00Z")))
      .toEqual(["sync"]);
  });

  it("keeps a fixed order so a run is reproducible", () => {
    expect(dueJobs({}, at("2026-09-04T13:30:00Z"))).toEqual([
      "sweeps",
      "sync",
      "digest",
    ]);
  });
});

describe("the configured cadences", () => {
  it("drains the sheet queue far more often than it sweeps", () => {
    // sync is a backstop for jobs stranded by a crash or deploy; scheduleDrain
    // is the main path. Sweeps recompute state and cost more.
    const sync = SCHEDULE.sync;
    const sweeps = SCHEDULE.sweeps;
    if (sync.kind !== "interval" || sweeps.kind !== "interval") {
      throw new Error("both are intervals");
    }
    expect(sync.everyMs).toBeLessThan(sweeps.everyMs);
  });

  it("sends the digest at the start of the shift", () => {
    // 13:00 UTC is 18:00 PKT, which is what the cron route documents.
    expect(SCHEDULE.digest).toMatchObject({ kind: "daily", atHourUtc: 13 });
  });
});
