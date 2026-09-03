# HANDOFF

> Overwrite this file — never append. Max 100 lines. No pasted code, file:line only.
> Previous handoffs in `.claude/handoff-history/`.

## Goal

A strictly internal, Postgres-centred operations system: Web App → PostgreSQL
(single source of truth) → reporting and one-way mirrors. History in PROGRESS.md.

## Branch topology — read this first

- `main` — 19 commits ahead of `origin/main`. **Nothing is pushed.**
- `timesheet-grid` — the grid work, committed by a concurrent session as 5 commits.
- `redesign` ← **you are here**, branched off `timesheet-grid`. 17 commits.

The tree is clean and `pnpm verify && pnpm build` is green. **Build needs
`NODE_OPTIONS=--max-old-space-size=4096`** since Radix landed, or it dies with 137.

⚠️ **Up to six Claude sessions have run against this repo at once.** The index is
shared. Commit with `git commit --only -F <msgfile> -- <explicit paths>`, never
`git add -A` — a PreToolUse hook denies bulk staging for exactly this reason.

## Current State

**The UI is being rebuilt against a rubric, not against taste.**
`docs/DESIGN-STANDARD.md` (47 rules, a motion spec, a 24-row scorecard /92) is the
authority; `.claude/commands/uxaudit.md` is `/uxaudit`, which scores the app against
it and writes `ux-audit/`.

**Baseline 35/92; Wave 1 and most of Wave 2 put it near 60.** Re-run `/uxaudit` for a
real number — that estimate was scored by the session that did the work.

Measured before/after in `ux-audit/AUDIT.md`; the harness in `ux-audit/_harness/`
re-runs it. Headlines: contrast failures 285 → 0, font sizes 10 → 5, weights 6 → 4,
`loading.tsx` 0 → 11, queue exits 1 → 3.

Shipped: the contrast ramps (both themes, measured against the *worst* surface each
token lands on, not white); brand `#fb0044` → `#e8003f`; tabular figures with mono
demoted to IDs; ease-out everywhere; typed empty states (blank-slate / no-results /
cleared); toasts with an action no longer self-dismiss; 11 loading files with real
row heights and a 300ms delay; sticky table headers; shadcn Dialog/Sheet/Command/
Tooltip behind a token bridge; ⌘K with `G`-then-letter jumps; recent projects on the
dashboard and in the palette; **snooze-with-wake** on the queue (migration `0018`);
`J`/`K`/`E`/`S`/`Enter` triage; log-work drafts that survive navigation; the type
scale down to the prescribed ladder.

## Next Steps

1. **Re-run `/uxaudit`** for an honest score before doing more.
2. **Wave 2 remainder** — `C5` Reports needs the Stripe reconciliation strip with
   drill-down and a stated date basis (**blocked**: no `billable` column, see below);
   `C1` still wants 2–3 named streams so zero is reachable per-stream, and bulk
   select; `C4` Projects wants a density control; `B2` still has three row heights
   on one page (53 / 37 / 33px) where §1.1 asks for 32–40.
3. **`0016` and `0017` have no drizzle snapshots.** `0018`'s snapshot repairs the
   base, so `db:generate` works now — but check any generated migration against the
   database before applying it, because that is how a migration that re-dropped
   already-dropped columns got produced.
4. **Everything below is still true and still blocking**: attach a sheet to one
   project (unproven end to end); Phase 0 hosting + scheduler for `/api/cron/*`
   with `CRON_SECRET`; set `DIGEST_WEBHOOK_URLS`; delete the nine seed accounts
   sharing `tavren123`.

## What Failed / Dead Ends

- **`overflow-x-auto` forces `overflow-y:auto`**, making that wrapper the sticky
  containing block — so a header stuck to the viewport silently does nothing. The
  container has to become the vertical scroller. The **grid** therefore has no
  sticky header: the fix would move geometry its roving-tabindex model depends on.
- **Do not test `loading.tsx` by blocking the RSC request.** The loading UI is
  delivered *in* that stream, so blocking it suppresses the thing under test.
  Throttle instead.
- **Findings get deleted when they fail verification.** Four so far were artifacts,
  not defects: `color-mix`/oklab backgrounds parse as near-black, `sr-only` text is
  1x1 rather than 0x0 so a naive visibility check counts it, and the Next.js dev
  indicator appears in every dev-server screenshot.
- **shadcn's Button and Sonner were rejected.** Button opts out of the global focus
  outline for a `ring` box-shadow, is 24–36px against the 44px standard, and ships
  `dark:` variants. Sonner needs `next-themes`, which this app deliberately avoids.
- **A base Tailwind utility loses to a responsive one** (`max-w-[640px]` vs
  `sm:max-w-lg`), and **`setState` in an effect is a lint error** — client-only
  values go through `useSyncExternalStore` with a server snapshot.
- **A `RefObject` effect cannot see a conditionally-mounted form.** The draft hook
  restored nothing until it became a callback ref: `/log` mounts its form only when
  a row expands, so the effect ran once against `null` and never fired again.
- The grid, CDP, `pkill -f` bracketing and Drive API notes in
  `.claude/handoff-history/2026-09-03_sheets-pre-grid.md` all still apply.

## Open Questions / Blockers

- **Hosting decision** — blocks the scheduler, which blocks every automation.
- **Discord/Slack webhook URL** for the digest.
- **No `billable` column exists**, and `userRates` is unread and RLS-guarded. The
  reconciliation strip's "Billable · Unbilled" cannot be built until that is a
  product decision.
- **Column E (Link) is read-only** in the grid; adding a `link` column would make
  the sync write column E, which the UI currently promises it never does.
