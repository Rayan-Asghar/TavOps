-- What ran, when, and how it went.
--
-- Hand-written, following 0018 and 0019, and checked against the live database
-- before applying: no job_runs table and no job_run_* types existed.
--
-- This table is what lets the app schedule itself. The browser heartbeat says
-- only "somebody is here"; the server decides what is due by reading this, so
-- five open laptops produce one run an hour rather than five. The cron routes
-- write here too, so a host that has BOTH real cron and open browsers does not
-- do the work twice -- whichever arrives first records the run and the other
-- finds nothing due.
--
-- One row per job, keyed by name, updated in place. This is not a run history:
-- the audit log records what changed in the business, and a growing table of
-- "the sweep ran and found nothing" would be noise nobody reads. What matters
-- operationally is only ever the LAST run -- is it recent, and did it work.

CREATE TYPE "job_run_status" AS ENUM ('running', 'ok', 'error');--> statement-breakpoint

-- Which clock triggered it. Diagnostic rather than load-bearing, and it answers
-- the question somebody will ask first: is this host scheduling itself, or is
-- something outside actually calling the cron endpoints?
CREATE TYPE "job_run_source" AS ENUM ('heartbeat', 'cron');--> statement-breakpoint

CREATE TABLE "job_runs" (
    "job"          varchar(40) PRIMARY KEY NOT NULL,
    -- Set when the run is CLAIMED, not when it finishes. The claim is what
    -- makes the job not-due for everyone else, and it has to take effect before
    -- the work starts or two callers both start.
    "last_run_at"  timestamp with time zone NOT NULL,
    "last_status"  "job_run_status" NOT NULL,
    "last_error"   text,
    "last_source"  "job_run_source" NOT NULL,
    "last_ms"      integer,
    -- A row stuck at 'running' with a stale last_run_at is a crashed run, and
    -- this is what makes that visible rather than merely absent.
    "runs"         integer DEFAULT 0 NOT NULL,
    "updated_at"   timestamp with time zone DEFAULT now() NOT NULL
);
