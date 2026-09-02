# HANDOFF

> Overwrite this file — never append. Max 100 lines. No pasted code, file:line only.
> Previous handoffs in `.claude/handoff-history/`.

## Goal

A clean, strictly internal, Postgres-centred operations system:
Web App → PostgreSQL (single source of truth) → reporting and one-way mirrors.
Full history in PROGRESS.md; the five-phase refactor that preceded this is at
`.claude/handoff-history/2026-09-01_session-close.md`.

## Current State

**Project work-log sheets are built, committed and green.** 216 unit + 47
fixture tests, build clean. Six commits: `2a6f75e` → `a155744`.

- **One sheet per project.** Every entry on a project goes to its sheet,
  whoever logged it. Who did the work lives on the work log, the activity feed
  and `/reports` — the sheet records what and how long, and has no Developer
  column, matching the team's own tracker.
- **The team's layout, not a generic one.** Title banner, a summary strip whose
  totals are live formulas, header on **row 8**, columns
  `Date | <project> | Hours | Notes — Work Done | Link (if any) | Work Log ID`.
  Tavren fills date, hours, notes and the hidden id; the label, link and totals
  are the team's and are never written to.
- **A tab per month**, created on demand with its banner. An entry routes to the
  tab for its own work date, so a September correction to August work lands in
  August.
- **Rows are addressed by the work log's uuid** in hidden column F, not by row
  number — a person sorting or inserting rows cannot cause a wrong-row write.
  A delete blanks its row rather than removing it, because removing one shifts
  every row beneath it.
- **Connecting** validates the header row, adopts a sheet missing only the id
  column, backfills existing entries, renames the file to
  `Tavren — <project> — <client>`, and refuses the template's own link.
- `pnpm sheets:template <url>` lays out a blank sheet you own as the template.
  `TAVREN_SHEET_TEMPLATE_ID` is set; the Copy button works.

**Nothing is connected.** `sheet_connections` is empty — migrations `0015`/`0016`
cleared the earlier keyings, which were never live. The first real allotment is
the last unproven step end to end.

## Next Steps

1. **Attach a sheet to one project** — Sheet tab → Copy the template → name it →
   share with the service account → paste the link. This exercises the rename,
   the backfill and the first live write in one go.
2. **Phase 0 — hosting and a scheduler. Still the only thing blocking every
   automation**, and now the sheets sync too. `after()` drains after each
   response, which covers the normal case but is not durable. Schedule
   `/api/cron/sync` (2–5 min), `/api/cron/sweeps` (hourly),
   `/api/cron/digest` (daily) with `CRON_SECRET`. Vercel Hobby is out.
3. **Set `DIGEST_WEBHOOK_URLS`** or the digest builds and goes nowhere.
4. **Delete the nine seed accounts** sharing `tavren123`.
5. `.claude/settings.json` has uncommitted permission allowances from this
   session — commit or discard.

## What Failed / Dead Ends

- **The service account cannot create Drive files.** `spreadsheets.create`
  returns 403. This is why the app offers Google's `/copy` link instead of a
  "create it for me" button, and why the template is laid out in a sheet a
  person already owns.
- **The Drive API is not enabled** on Cloud project `authentic-root-471504-q1`.
  So `readOtherEditors` always fails and the "who else can edit this sheet"
  warning has never once fired. Deliberately non-fatal, which is why nobody
  noticed. Enabling it is free, needs no billing and no OAuth verification.
- **Renaming a spreadsheet does NOT need Drive.** `updateSpreadsheetProperties`
  is the Sheets API and the title is the Drive filename. Verified live.
- **`pkill`/`pgrep -f "next dev"` kills the agent's own shell.** Use a bracket
  class: `pgrep -af "nex[t] dev"`.
- **Browser harness: never use a global `input[name=…]` lookup** — the project
  page's rail has its own log-work form. Anchor on a field only the target form
  has, then `.closest('form')`.
- **`requestSubmit()` silently no-ops on constraint violations.** Call
  `form.checkValidity()` first or a blocked submit looks like a broken action.
- **The git index is shared with concurrent sessions.** `git add` then
  `git commit` swept another session's staged work into a commit once. Use
  `git commit --only <paths>`.
- **Deleting `.next` breaks `pnpm typecheck`** (`LayoutProps` is generated
  there). Run `pnpm build` once to regenerate.

## Open Questions / Blockers

- **Hosting decision** — blocks step 2, which blocks everything automatic.
- **Discord/Slack webhook URL** for the digest.
- The template must be shared "Anyone with the link → Viewer" or the Copy button
  fails for colleagues. Unverifiable from here without the Drive API.
