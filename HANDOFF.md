# HANDOFF

> Overwrite this file — never append. Max 100 lines. No pasted code, file:line only.
> Previous handoffs in `.claude/handoff-history/`.

## Goal

A strictly internal, Postgres-centred operations system: Web App → PostgreSQL
(single source of truth) → reporting and one-way mirrors. History in PROGRESS.md.

## Branch topology — read this first

- `main` — 19 commits ahead of `origin/main`. **Nothing is pushed.**
- `timesheet-grid` — the grid work, committed by a concurrent session as 5 commits.
- `redesign` ← **you are here**, branched off `timesheet-grid`. 10 commits.

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

**Baseline was 35/92. Wave 1 plus the palette puts it near 52.** Re-run `/uxaudit`
for a real number rather than trusting that estimate — it was scored by the same
session that did the work.

Measured, before → after (`ux-audit/_harness/`, re-runnable):

| | was | now |
|---|--:|--:|
| Contrast failures | 285 | 0 |
| Numeric nodes with tabular figures | 2 | 73 |
| Transitions on an ease-in-out | 218 | 13 |
| `loading.tsx` across 14 blocking pages | 0 | 11 |

Shipped: the contrast ramps (both themes, measured against the *worst* surface each
token lands on, not white); brand `#fb0044` → `#e8003f`; tabular figures with mono
demoted to IDs; ease-out everywhere; typed empty states (blank-slate / no-results /
cleared); toasts with an action no longer self-dismiss; 11 loading files with real
row heights and a 300ms delay; sticky table headers; shadcn Dialog/Sheet/Command/
Tooltip behind a token bridge; ⌘K with `G`-then-letter jumps; recent projects on the
dashboard and in the palette.

## Next Steps

1. **Re-run `/uxaudit`** for an honest score before doing more.
2. **Wave 2 remainder** — the rows still at 1–2: `C1` Needs Attention needs four
   exits and snooze-with-wake (new column + sweep); `C5` Reports needs the Stripe
   reconciliation strip with drill-down and a stated date basis; `A5` needs
   item-level `J`/`K`/`E`; `C2` log-work drafts must survive navigation.
3. **Parked, and cheapest done together** — ten font sizes with four adjacent pairs
   under the 25% floor, six font weights, five surfaces where §3.3 allows three.
   All three are one pass over the type and surface tokens.
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
- **Three audit findings were measured and then deleted for failing verification** —
  a 1.07:1 contrast reading, an "invisible" focus ring, and an element overlapping
  Sign out. The first two were sampling artifacts (`color-mix`/oklab computed
  backgrounds parse as near-black); the third is the Next.js dev indicator, which
  appears in every dev-server screenshot.
- **shadcn's Button was rejected**: it sets `outline:none` and substitutes a `ring`
  box-shadow, opting out of the global focus outline and colliding with elevation;
  its sizes are 24–36px against the 44px standard; it ships `dark:` variants.
  **Sonner too** — it imports `next-themes`, which this app deliberately does not
  use (theme is a server-read cookie, so there is no flash).
- **A base Tailwind utility loses to a responsive one.** `max-w-[640px]` could not
  override the dialog's `sm:max-w-lg`; it needed the `sm:` prefix.
- **`setState` in an effect is a lint error here** (cascading renders). Client-only
  values go through `useSyncExternalStore` with a server snapshot.
- Everything in `.claude/handoff-history/2026-09-03_sheets-pre-grid.md` about the
  grid, CDP, `pkill -f` bracketing and the Drive API still applies.

## Open Questions / Blockers

- **Hosting decision** — blocks the scheduler, which blocks every automation.
- **Discord/Slack webhook URL** for the digest.
- **No `billable` column exists**, and `userRates` is unread and RLS-guarded. The
  reconciliation strip's "Billable · Unbilled" cannot be built until that is a
  product decision.
- **Column E (Link) is read-only** in the grid; adding a `link` column would make
  the sync write column E, which the UI currently promises it never does.
