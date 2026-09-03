# Inventory

## Routes

| Route | Nav label | Parent | Active nav? |
|---|---|---|---|
| `/` | Needs Attention | — | ✓ |
| `/log` | Log work | — | ✓ |
| `/timesheet` | Timesheet | — | ✓ (plus a month tab also marked `aria-current="page"`) |
| `/projects` | Projects | — | ✓ |
| `/projects/[id]` | — | Projects | ✓ via prefix match; has a breadcrumb |
| `/projects/new` | — | Projects | ✓ via prefix match |
| `/reports` | Reports | — | ✓ |
| `/sales` | Sales | — | ✓ (shown only with `proposal.create`) |
| `/review` | — | — | **✗ ORPHAN** |
| `/audit` | Audit log | Management | ✓ |
| `/admin/users` | People | Management | ✓ |
| `/admin/sheets` | Work log sheets | Management | ✓ |
| `/admin/teams` | — | — | **✗ ORPHAN** |
| `/login` | — | — | n/a (no shell) |

**Orphan routes (r5 `[FAIL IF]`):** `/review` and `/admin/teams` render with zero
`aria-current` nav items. `/review` is deliberate — the code at `app-shell.tsx:66-70`
argues a standing nav slot for an empty queue reads as unfinished work, and inbox items
deep-link to it. That reasoning is sound but it still fails r5: the fix is a breadcrumb or
a conditional nav entry, not nothing. `/admin/teams` says in its own callout that it does
nothing, and is unreachable except from a button on `/admin/users`.

**Top-level count (r10, M3 3–7):** 6 main destinations — Needs Attention, Log work,
Timesheet, Projects, Sales, Reports — plus a separate `MANAGEMENT` group of 3. **Passes.**

## Stack and tokens

| | |
|---|---|
| Tailwind | **v4** (CSS-first `@theme`, no `tailwind.config.js`) |
| shadcn/ui | **absent** — no `components.json`, no Radix, no cmdk, no Sonner, no TanStack |
| Theme file | `src/app/globals.css` (356 lines) — the entire design system |
| Colour format | **hex**, not OKLCH (§3.5 expects OKLCH) |
| Dark mode | `[data-theme]` attribute + `tavren_theme` cookie, **not** a `.dark` class |
| `--radius` | **does not exist**; 5 literal radii in use |
| Component layer | 12 CSS classes; **zero React primitives** |

§3.5 pitfalls that apply: no OKLCH, no `--radius` derivation, no `data-slot`, no
`-foreground` token pairing. The `.dark`-vs-`[data-theme]` gap is the one to plan around —
the cookie approach is SSR-correct and flash-free and is worth keeping.

## Grep results

| Check | Result |
|---|---|
| `tabular-nums` coverage | **2 of 95** numeric nodes (measured) |
| `outline-none` without replacement | 4 sites, all covered by the global `:focus-visible` at `globals.css:104` — **not a defect** |
| `prefers-reduced-motion` | present, `globals.css` — comprehensive |
| Transitions on non-transform/opacity | colour-only; **no layout animation anywhere** — compliant |
| Hardcoded hex outside the token file | `global-error.tsx:26,27,40,48,57,68` (6) — renders outside the CSS bundle, so defensible |
| Arbitrary `text-[Npx]` | **21 sites** — `sheet-panel.tsx` ×14, `admin/sheets/page.tsx` ×5, `task-timer.tsx:63`, one more |
| `localStorage` / persisted UI prefs | **none** — no density control, no saved views, no last-filter memory (A3, C4, r37) |
| Modal / sheet / dialog | **none** — no `role="dialog"`, no `aria-modal`. Data entry is inline, which satisfies r31 |

## Coverage gaps in this audit

Stated plainly rather than implied:

- **Flow traces F1–F4 were not walked.** C1/C2/C3/C5 are scored from code reading and
  screenshots, not from timed click/keystroke traces. `flows/` is empty.
- **`states/` is empty.** Empty states were observed in the route screenshots
  (`screens/01-needs-attention.*.png` shows the cleared queue) rather than captured
  separately; loading and error states were not throttled or forced.
- **Seeded data is thin** — 3 projects, 8 tasks, 24 work logs, 34 notifications. The
  ">=20 rows" table requirement was met only by notifications and work logs. Density
  findings are argued from computed row metrics.
- Captures are from `next dev`, so the Next.js dev indicator appears bottom-left in every
  screenshot and adds one phantom tab stop to `keyboard.json`.
