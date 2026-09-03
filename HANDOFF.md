# HANDOFF

> Overwrite this file — never append. Max 100 lines. No pasted code, file:line only.
> Previous handoffs in `.claude/handoff-history/`.

## Goal

A strictly internal, Postgres-centred operations system: Web App → PostgreSQL
(single source of truth) → reporting and one-way mirrors. History in PROGRESS.md.

## ⚠️ Everything below is UNCOMMITTED

34 files, all of one session's work. **Commit before doing anything else**, with
`git commit --only <paths>` — the index is shared with concurrent sessions and
`git add` has swept another session's work into a commit before.
`.claude/settings.json` carries older permission allowances; handle separately.
## Current State

**An in-app spreadsheet over work logs, at `/timesheet`. Built, driven in a real
browser, green.** 273 unit + 100 fixture tests, lint and build clean.

One project × one month, with a person filter — the same slice as a tab of that
project's sheet, so blocks round-trip between the two. Keyboard editing,
copy/paste, a live timer row, CSV export. **No Save button**: every cell commits
when you leave it. Rationale:
`~/.claude/plans/ok-so-discussed-the-modular-token.md`.

**Four live bugs were fixed underneath it**, none introduced by this work:

- `nextVersion` had no row lock — concurrent corrections collided on
  `worklog_revisions_version_unique`. Now `FOR UPDATE OF work_logs`; the `OF`
  matters, or the lock covers the joined project row and serialises every edit
  on it. `tests/db/work-log-actions.test.ts` fails without it.
- `loadForCorrection` read on a *different connection* than the write, so the
  invoiced and already-removed checks were check-then-act. Now inside the tx.
- `adjustTimer` had no status guard: it resurrected a completed session, and
  finishing it again wrote a **second** work log, orphaning the first.
- Nothing stopped a person having two open timers. **Migration `0017`** adds the
  partial unique index and closes duplicates first. It runs on deploy.
Full reasoning for all four is in PROGRESS.md.

The shared write path is `server/work-log-writes.ts`, used by both the
single-row actions and the batch save. The batch is one transaction with a
SAVEPOINT per row, so a rejected row takes its revision, audit row and sheet job
with it while the rest commits.

Accessibility and design passes followed. Grid: emoji as structural icons (now
`LockIcon`/`TimerIcon`); focus scrolling behind the 56px sticky header
(`scroll-padding-top`, WCAG 2.2 AA); save status by colour alone; no live region
for autosave; icons at 2.38:1 on `surface-2`. `prefers-reduced-motion` was
absent app-wide. **`MetricCard`'s negative `change` used `brand` at 4.05:1 /
4.30:1 — under the 4.5:1 floor; now `danger`, which also fixes `/sales`.** On an
accent card both tokens invert together and collapse to 2.4-3.2:1, so there it
uses the card's own foreground. The accent moved off "Your projects" (scope, not
a metric) onto "Waiting on you" — what `/reports`, `/review` and `/sales`
already do: accent the page's headline number.

**Sheets are unchanged**; grid edits flow out through the same outbox. **Nothing
is connected yet** — `sheet_connections` is empty.

## Next Steps

1. **Commit this work** (see the warning above).
2. **Attach a sheet to one project** — the last unproven step end to end. Sheet
   tab → Copy the template → name it → share with the service account → paste
   the link.
3. **Phase 0 — hosting and a scheduler. Still the only thing blocking every
   automation**, and the grid makes the sheet mirror busier. Schedule
   `/api/cron/sync` (2–5 min), `/api/cron/sweeps` (hourly), `/api/cron/digest`
   (daily) with `CRON_SECRET`. Vercel Hobby is out.
4. **Set `DIGEST_WEBHOOK_URLS`** or the digest builds and goes nowhere.
5. **Delete the nine seed accounts** sharing `tavren123`.
6. Grid: no `Ctrl+Z` undo; range selection is keyboard-only, no mouse drag.

## What Failed / Dead Ends

- **The grid's columns and the sheet's are NOT the same shape.** The sheet has
  six and no Person column; the grid renders Person third, so a six-wide block
  pasted positionally puts hours into the notes cell. `planPaste` reads a
  six-wide block anchored at column A in the sheet's order instead.
- **A React state updater must not call another setState.** StrictMode invokes
  updaters twice, so `setRows` inside a `setDraft` updater appended every new row
  twice and doubled the hours in the totals.
- **`pkill -f` matches the agent's own shell for ANY pattern** — the command line
  containing the pattern is itself a match. Bracket every one:
  `nex[t] dev`, `remote-debugging-port=922[2]`.
- **Driving the app over CDP** (no Playwright; Node 24's built-in WebSocket
  speaks to `google-chrome --headless`): never send `text` on `keyDown` *and* a
  `char` event, or characters type twice. The keystroke that OPENS a cell editor
  needs `keyDown` alone.
- **The service account cannot create Drive files** (`spreadsheets.create` → 403);
  the **Drive API is not enabled**, so `readOtherEditors` has never fired.
- **Never use a global `input[name=…]` lookup** in a browser harness — the
  project page's rail has its own log-work form. `requestSubmit()` also silently
  no-ops on constraint violations; call `form.checkValidity()` first.
- **Both `danger` and `fill-strong` invert between themes**, so a status colour
  on an accent surface collapses to ~2.4-3.2:1 in *both*. Use the surface's own
  foreground there and carry emphasis with weight.

## Open Questions / Blockers

- **Hosting decision** — blocks step 3, which blocks everything automatic.
- **Discord/Slack webhook URL** for the digest.
- **Column E (Link) is read-only** in the grid; there is no `link` column on a
  work log. Adding one is a product decision — it would make the sync write
  column E, which the UI currently promises it never does.
