
## Moved out of HANDOFF.md on 2026-09-08 (line cap)

Still true, still costly, just no longer the first thing a session needs. Each
is also enforced or explained at the call site in code.

- **`drizzle-kit migrate` applies in TIMESTAMP order against the single newest
  applied row**, so anything older is skipped in silence; a hand-written
  migration is invisible until it is in `_journal.json`; and `generate` models
  neither RLS nor CHECK constraints.
- **An RLS-forced table cannot be filtered from an ungated query** — `NOT EXISTS`
  matches EVERYTHING, and so does `inArray(id, [])`. Never fold `work_log_costs`
  into `work_logs`, and never reset the finance GUC in a `finally`.
- One-liners, each of which cost an hour once: a correlated subquery must not
  interpolate `${table.column}` (drizzle renders it unqualified, returns 0, no
  error) · every export of a `"use server"` module is a callable endpoint and
  all must be async · `test.env` does not reach `globalSetup` · never `::float`
  on a money aggregate, hours are fine.
