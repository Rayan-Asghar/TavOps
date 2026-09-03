# Wave 1 — Quick wins

High impact, low effort. Work straight through. Every item cites the rule it satisfies and
uses this project's actual tokens. Gate after each: `pnpm verify && pnpm build`.

> The 273 tests cannot catch any of this — both vitest configs are `environment: "node"`
> with no DOM libraries and no test asserts on a class name. Green proves the logic is
> untouched; it proves nothing visual. Re-run `/uxaudit` to score the delta.

---

## 1 · Fix the text contrast ramp — §3.3 `[FAIL IF]` · Critical

`src/app/globals.css`. Computed against the *worst* surface each token sits on, so these
pass everywhere rather than only on white.

```css
/* light */
--color-fg-muted:  #6b6b6b;  /* was #727272 — failed 4.41 on bg, 4.07 on surface-2 */
--color-fg-subtle: #6b6b6b;  /* was #9a9a9a — failed 2.38-2.81 everywhere */
/* dark */
--color-fg-muted:  #919191;  /* was #9b9b98 — passed, tightened for one ramp */
--color-fg-subtle: #919191;  /* was #6f6f6d — failed 2.84-3.77 everywhere */
```

| | on `bg` | on `surface` | on `surface-2` | on `surface-3` |
|---|:--:|:--:|:--:|:--:|
| `#6b6b6b` light | 4.88 | 5.33 | 4.51 | — |
| `#919191` dark | 6.03 | 5.52 | 5.04 | 4.54 |

**This collapses `fg-muted` and `fg-subtle` into one value**, which is the honest fix:
`fg-subtle` currently carries real content (person names, project codes, timestamps, the
grid's keyboard hint line) and §3.3 forbids sub-4.5:1 text for anything but decoration.

If you want to keep a fourth, quieter step, it must be **decorative only** — never real
content — and its floor is 3:1: `#878787` light / `#737373` dark. Audit every call site
before choosing this; there are ~40.

## 2 · `tabular-nums` on every number — §3.1 `[FAIL IF]` · Critical

Currently **2 numeric nodes out of 95**. Add the utility, then apply it.

```css
@utility tabular { font-variant-numeric: tabular-nums lining-nums; }
```

Apply to: `MetricCard`'s value (`badges.tsx:128`), every `text-right` cell in
`reports/page.tsx`, `grid-totals-strip.tsx:33`, the grid's hours column, `timer-chip.tsx:64`
and `task-timer.tsx:63` (both already have `tabular-nums` on the clock — keep it), and the
count pills in `grid-month-tabs.tsx` / `project-tabs.tsx`.

## 3 · Demote the mono family — §2.6 · High

*"Tabular figures in the UI sans — not a monospace family. Mono only for IDs/codes."*

Replace `font-mono` with `tabular` on every **number** in `reports/page.tsx` (hours,
capacity, utilisation, budget). **Keep** `font-mono` on project codes (`BL-002`), work-log
UUIDs and job codes — that is what it is for.

## 4 · Stop the focus ring animating — §5.2 `[FAIL IF]` · High

Tailwind v4's `transition-colors` includes `outline-color`, so every button and nav link
fades its focus ring in from `currentColor` over 150ms. Measured: nav link reports
`rgb(154,154,154)` at focus, `rgb(251,0,68)` 400ms later.

In `src/app/globals.css`, replace `transition-colors` in the seven `.btn-*` classes with an
explicit list, and do the same at `sidebar.tsx:51`:

```css
transition-property: color, background-color, border-color;
transition-duration: 150ms;
transition-timing-function: var(--ease-out-quad);
```

## 5 · Switch the easing to ease-out — §5.3 · Medium

All 218 measured transitions use `cubic-bezier(0.4, 0, 0.2, 1)` — an ease-in-out. §5.3:
ease-out for anything user-initiated; *"ease-in — avoid entirely for UI."*

```css
@theme {
  --ease-out-quad:  cubic-bezier(0.25, 0.46, 0.45, 0.94);
  --ease-out-cubic: cubic-bezier(0.215, 0.61, 0.355, 1);
}
```

## 6 · Hit targets in table rows — §3.6 · High

30 targets sit under the 24px AA floor. Worst offenders, measured:

| target | size | file |
|---|---|---|
| `×` remove member | 16 × 16.8 | `admin/teams` |
| `Open job ↗` | 67 × 16.8 | `sales/page.tsx:169` |
| `+ Add member` | 93 × 16.8 | `team-manager.tsx` |
| `Correct` / `Remove` | — | `work-log-actions.tsx:61,68` |

Tavren's own standard is **32px minimum in rows**. Give these `.btn-ghost btn-xs`
(`min-h-[30px]`) at minimum, or a new `btn-row` at 32px. Several are hand-rolled text
buttons that bypass `.btn-*` entirely — fold them in while you are there.

## 7 · Typed empty states — D1 `[FAIL IF]` · High

`src/components/ui/empty-state.tsx` accepts only `children`, so no page *can* add a CTA.
Give it `variant` (`blank-slate` | `no-results` | `cleared`), `title`, `icon`, `action`.

Three that are owed today (§2.2): Needs Attention `cleared` (a designed completion moment
with the day's totals — §5.8 calls this the one place elaborate motion is earned), Reports
`no-results` (*"No entries match {client: Acme}"* — quote the query in curly quotes),
Projects `blank-slate`. Max one primary CTA; Title Case titles, sentence-case descriptions.

## 8 · Toasts with an action must not auto-dismiss — r45 `[FAIL IF]` · High

`src/components/ui/toast.tsx:113-118` sets 5s, or **10s when the toast offers Undo**. Invert
it: when `undo` is present, no timer at all.

Leave the unconditional empty live region exactly as it is — the comment at `toast.tsx:37`
is right, and a region that appears with its content is not reliably announced.

## 9 · `loading.tsx` per route — r42/43 · High

Zero exist across 14 blocking async pages. Priority: `/reports` (three heavy aggregates in
one `Promise.all`), `/timesheet`, `/projects/[id]`, `/`.

⚠ `AppShell` is async and awaits `cookies()`, `getActor()` and `activeSessionFor()`, so a
`loading.tsx` **cannot render `<AppShell>`** — hand-write a static shell (sidebar
silhouette + header bar) and skeleton the content. Skeletons must match real row heights
(32px grid, 34–38px tables), and r42 says nothing under 1s should show one at all.

## 10 · Sticky table headers — C4/C5 · Medium

All four measured tables report `thPosition: static`. `/reports` renders 60 timesheet rows
with the column names scrolled off. Add `sticky top-0 z-10 bg-surface-2` to `Th` in
`ui/data-table.tsx:46` and to the grid header at `work-log-grid.tsx:672`.

⚠ The grid's header is `h-[34px]` and its keyboard model depends on that geometry — change
`position` only, never the height.

## 11 · Back onto the type scale — §3.1 · Medium

`sheet-panel.tsx` bypasses it 14 times (`text-[9px]` ×1, `[10px]` ×5, `[11px]` ×6,
`[12px]` ×2); `admin/sheets/page.tsx` 5 more; `task-timer.tsx:63` uses `text-[30px]`.
Map onto `text-2xs`/`text-xs`/`text-sm`, and give the timer a real scale step.

Ten sizes are in use (9/11/12/13/14/16/18/20/43/44px) where four adjacent pairs sit under
the 25% floor. Collapsing 43 **and** 44 to one step is free.

## 12 · Row heights — B2 · Medium

`/reports` renders three tables at **52.1px, 37.8px and 33.8px** on one page. §1.1 puts the
data zone at 32–40px. Pick one (36px) and apply it to all three.

---

## Deliberately not in Wave 1

- **Elevation.** Already compliant — borders carry structure, the only two shadows are on
  floating layers. Do not add depth.
- **`prefers-reduced-motion`.** Present and comprehensive.
- **Form errors.** Adjacent, `role="alert"`, `aria-describedby`, good copy.
- **Dark mode architecture.** Token-swap only, cookie-driven, SSR-correct. Preserve it
  through the shadcn migration.
- **⌘K, keyboard model, snooze, recent/pinned, reconciliation strip** — Wave 2. They are
  structural, not quick.
