# Tavren Internal OS — UX Audit

Audited against `docs/DESIGN-STANDARD.md`. Every finding cites a rule ID and points at a
screenshot, a `file:line`, or a measured number.

**Method.** Playwright at 1440×900, logged in as `contact@tavren.io`. 24 full-page
screenshots (12 routes × light/dark) in `screens/`. Computed values — contrast, font
sizes, row heights, hit targets, transition durations — extracted with `page.evaluate`
into `measurements.json`; keyboard traces in `keyboard.json`. Harness in `_harness/`,
re-runnable via `/uxaudit`.

**Coverage.** Routes, tokens, keyboard and measurements were captured in full. **Flow
traces F1-F4 were not walked and loading/error states were not forced** — so C1, C2, C3 and
C5 are scored from code reading and screenshots rather than timed traces. See
`00-inventory.md` for the complete gap list.

**Two caveats on the evidence.** Captures were taken against `next dev`, so the Next.js
dev indicator (a dark circle, bottom-left of the sidebar, overlapping "Sign out") appears
in every screenshot — **that is not a product defect**, and it also adds one phantom tab
stop (`nextjs-portal`) to the keyboard traces. Seeded data is thin (3 projects, 8 tasks,
24 work logs), so density findings are argued from computed row metrics rather than from
long lists.

**Three candidate findings were measured, then deleted for failing verification:** a
1.07:1 contrast reading on the header breadcrumb (`text-fg` actually computes 17.3:1), an
"invisible focus ring" on the `/reports` date inputs (they render a correct 2px crimson
ring), and the sidebar overlap above.

---

## Scorecard — 35 / 92

The standard's own threshold: *"Below 55 means structural rework, not polish."*

| # | Area | Score | One-line justification |
|---|---|:--:|---|
| A1 | Nav structure & labelling | 2 | 6 task-named top-level items (within M3's 3–7), but two orphan routes break r5. |
| A2 | Wayfinding | 2 | Active nav correct where it exists; the header "breadcrumb" is a single self-referential crumb, not a hierarchy. |
| A3 | Recent / pinned | **0** | Absent. r12 calls these required, not optional. |
| A4 | Command palette | **0** | ⌘K measurably does nothing on any route (`keyboard.json`). |
| A5 | Keyboard model | 1 | The timesheet grid has a real, documented model; the rest of the app has none. |
| B1 | Type system | 1 | 14px base is right, but ten sizes, four adjacent pairs under the 25% floor, and `tabular-nums` on 2 of 95 numeric nodes. |
| B2 | Spacing & zoning | 2 | Chrome/data zoning exists, but row heights run 32 / 33.8 / 37.8 / 52.1px — three of them on one page. |
| B3 | Color & contrast | 1 | `fg-subtle` fails on every surface in both themes; five surfaces where §3.3 allows three. |
| B4 | Elevation | 3 | Already compliant — borders carry structure, only 2 shadows app-wide, both on floating layers. |
| B5 | Focus & hit targets | 1 | Correct global ring, but it **animates in** on keyboard nav, and 30 targets sit under the 24px AA floor. |
| C1 | Needs Attention | 1 | One exit (dismiss). No snooze, no streams, no bulk select. Count is correctly total, not unread. |
| C2 | Log work | 2 | Inline not modal (r31 ✓), but drafts do not survive navigation (r32 ✗). |
| C3 | Timesheet | 2 | Autosave, Tab-across-row, export all ✓. No duration parser, no copy-last-week, header not sticky. |
| C4 | Projects | 2 | Human-readable first column ✓; no density control, no sticky header. |
| C5 | Reports | 1 | Export ✓. No reconciliation strip, no drill-down from any metric, date basis unstated, zero charts. |
| D1 | Empty states | 1 | One component with swapped copy — an explicit `[FAIL IF]`. |
| D2 | Loading | 1 | Zero `loading.tsx`, zero `Suspense` across 14 blocking async pages. |
| D3 | Feedback | 2 | Channels chosen well; but a toast carrying Undo auto-dismisses at 10s (r45 `[FAIL IF]`). |
| D4 | Errors | 3 | Adjacent to field, `role="alert"`, `aria-describedby`, constructive copy. Solid. |
| E1 | Motion — restraint | 2 | Broadly restrained, but the focus ring animates on Tab — a 100+/day keyboard action. |
| E2 | Motion — craft | 2 | 150/200ms is in band; easing is `cubic-bezier(.4,0,.2,1)` (ease-in-out) where §5.3 requires ease-out. |
| E3 | Motion — a11y | 3 | `prefers-reduced-motion` present and comprehensive. |
| E4 | Motion — earned moments | **0** | No palette, no sheet, and the cleared queue is a grey sentence. |

---

## The five things making this hard to use

### 1. There is no way to get anywhere except the sidebar — A3 0, A4 0, A5 1
⌘K is dead (`keyboard.json`: `cmdKChangedDom: false` on all five routes tested). There is
no recent list, no pinned list, no single-letter shortcut outside the grid. Every
navigation is a mouse trip to the left rail, and **every page begins with ~12 sidebar tab
stops before the first piece of content** — there is no skip link. r12 makes recent/pinned
required; r13 allows a palette only as an escape hatch *on top of* strong nav, which means
both are owed.

### 2. Numbers do not line up — B1 1
`tabular-nums` appears on **2 numeric nodes out of 95**. `/reports` renders every hours
column in Geist Mono with proportional figures, so totals visibly wander down the column —
and §2.6 says the mono family is the wrong answer anyway ("tabular figures in the UI sans
— **not** a monospace family. Mono only for IDs/codes"). §3.1 makes this a `[FAIL IF]`.

### 3. Grey text that cannot be read — B3 1
Computed, not estimated:

| token | on `bg` | on `surface` | on `surface-2` | needs |
|---|:--:|:--:|:--:|:--:|
| `fg-muted` #727272 | **4.41** | 4.81 | **4.07** | 4.5 |
| `fg-subtle` #9a9a9a | **2.58** | **2.81** | **2.38** | 4.5 |
| `fg-subtle` dark #6f6f6d | **3.77** | **3.46** | **3.16** | 4.5 |

`fg-subtle` fails **everywhere, in both themes**, and it carries real content: person
names, project codes, timestamps, the grid's keyboard hint line. `fg-muted` is the subtler
trap — legal on a white card, illegal on the page background and on `surface-2`, so the
same token is compliant in one place and not in another. §3.3 `[FAIL IF]`.

### 4. The focus ring is the wrong colour at the moment you need it — B5 1, E1 2
Measured (`_harness/focus3.mjs`): focusing a nav link reports `rgb(154,154,154)`, and 400ms
later the same element reports `rgb(251,0,68)`. **The ring fades in from `currentColor`
over 150ms.** Cause: Tailwind v4's `transition-colors` property list includes
`outline-color`, and every `.btn-*` in `globals.css` plus `NavLink` (`sidebar.tsx:51`)
carries it. Inputs are unaffected because `.field` does not.

For a keyboard-first tool this is the worst possible place to spend motion: §5.2 says
*"Never animate keyboard-initiated actions"*, and tabbing is a hundreds-per-day action. On
fast tabbing the ring may never reach its designed colour.

### 5. Nothing tells you the system is working — D2 1, D1 1, E4 0
There is no `loading.tsx` and no `Suspense` anywhere. All 14 pages are blocking async
server components, so clicking a nav item shows a 3px spinner and then, seconds later, a
whole new page. `/reports` runs three heavy aggregates in one `Promise.all` before it
renders anything.

When work *is* finished, the reward is a grey sentence centred in an empty box
(`screens/01-needs-attention.dark.png`). §2.2 requires typed empty states and names
`cleared` explicitly; §5.8 calls the queue reaching zero *"the one place elaborate motion
is earned."*

---

## Findings by area

### IA & navigation
- **r5 `[FAIL IF]` · High ·** `/review` and `/admin/teams` render with **zero**
  `aria-current` nav items (`measurements.json`). Both are reachable only by URL or an
  inbox deep-link.
- **r12 · High ·** No recent or pinned surface anywhere.
- **r13 / A4 · High ·** ⌘K inert on every route tested.
- **Medium ·** No skip-to-content link; first tab stop on every page is the logo
  (`keyboard.json`), then the entire sidebar.
- **Low ·** `aria-current="page"` is used for *tab* selection in `grid-month-tabs.tsx:47`
  and `project-tabs.tsx:47`, so `/timesheet` reports two "current page" elements. A tab is
  not a page; `aria-current="true"` or `role="tab"`/`aria-selected` is correct.

### Visual system
- **§3.1 `[FAIL IF]` · Critical ·** 2 of 95 numeric nodes carry `tabular-nums`.
- **§3.1 · High ·** Ten font sizes in use — 9, 11, 12, 13, 14, 16, 18, 20, 43, 44px.
  11→12→13→14 step by 8–9% and 43→44 by 2.3%, against a ~25% floor. 9px is below the
  codebase's own documented 11px floor (`globals.css:66-69`).
- **§3.1 · Medium ·** Six weights (400/500/600/700/800/900). 600 — the standard's emphasis
  weight — appears 6 times; 900 appears 111 times.
- **§3.3 `[FAIL IF]` · Critical ·** Contrast table above.
- **§3.3 `[FAIL IF]` · High ·** Five surfaces (`bg`, `surface`, `surface-2`, `surface-3`,
  `surface-hover`) where three are allowed.
- **§3.2 · Medium ·** Five radii including `14px`, `7px`, `6px`; no `--radius` token.
- **§2.6 · High ·** Geist Mono used for hours and percentages throughout `/reports`.
- **§3.4 · PASS ·** Borders carry structure; the only two shadows in the codebase are on a
  toast and an action panel. Do not "improve" this.
- **Medium ·** `sheet-panel.tsx` bypasses the type scale 14 times (`text-[9px]` ×1,
  `[10px]` ×5, `[11px]` ×6, `[12px]` ×2); `admin/sheets/page.tsx` 5 more.
- **Low ·** `global-error.tsx:26-69` inlines six hex literals, so the error screen is
  light-mode-only. Defensible (it renders outside the CSS bundle) but worth a comment.

### Flows & feedback
- **r45 `[FAIL IF]` · High ·** `ui/toast.tsx` auto-dismisses at 10s *when the toast carries
  Undo*. Toasts with an action must never auto-dismiss.
- **r42/43 · High ·** No `loading.tsx`, no `Suspense`, no skeletons.
- **D1 `[FAIL IF]` · High ·** `ui/empty-state.tsx` takes only `children` — no `icon`,
  `title` or `action` prop — so no page *can* add a CTA without bypassing it. All 14 call
  sites are one grey sentence.
- **r32 · Medium ·** A half-typed log-work entry is lost on navigation.
- **r16 · Medium ·** `/timesheet` exposes raw UUIDs in a "Work log ID" column
  (`screens/03-timesheet.light.png`), at 2.38:1.
- **§3.6 · High ·** 30 interactive targets under the 24px AA floor; in-row actions measured
  at 15–17px tall ("×" 16×16.8 on `/admin/teams`, "Open job ↗" 67×16.8 on `/sales`,
  "+ Add member" 93×16.8). Tavren's own standard is 32px in rows.
- **C4/C5 · Medium ·** No table has a sticky header (`thPosition: static` on all four
  measured). `/reports` renders 60 timesheet rows with the column names scrolled away.
- **D4 · PASS ·** Error handling is genuinely good — adjacent, `role="alert"`,
  `aria-describedby`, constructive copy.

### Motion
- **§5.2 `[FAIL IF]` · High ·** The focus ring animates on keyboard focus (finding 4).
- **§5.3 · Medium ·** All 218 measured transitions use `cubic-bezier(0.4, 0, 0.2, 1)`, an
  ease-in-out. §5.3 requires ease-out for user-initiated motion and says *"ease-in — avoid
  entirely for UI."*
- **§5.8 / E4 · High ·** None of the three moments where motion is earned exists.
- **§5.1 · PASS ·** 150ms and 200ms are both inside the prescribed bands; nothing exceeds
  the 300ms ceiling.
- **§5.4 · PASS ·** Only colour properties transition; no layout animation anywhere.
- **§5.7 · PASS ·** `prefers-reduced-motion` present and comprehensive.

---

## Explicitly out of scope — already correct, do not touch

- **Elevation (§3.4).** Borders for structure, shadows only on floating layers. Compliant.
- **Motion properties and durations (§5.1, §5.4).** In band; colour-only.
- **`prefers-reduced-motion` (§5.7).**
- **Form error handling (§4.4 r30, D4).**
- **Dark mode architecture (§3.3).** Token-swap only, no `dark:` variants in any component,
  cookie-driven so it is SSR-correct with no flash. Keep this when adopting shadcn.
- **The timesheet's core contract (C3).** No Save button, Tab advances across the row,
  autosave on blur, CSV export, keyboard model documented inline beneath the grid.
- **Accent discipline (§3.3).** Exactly one accent element per screen.
- **Inbox count semantics (§2.5).** Counts total unresolved, not "unread".
