# Tavren Internal OS — Design Standard & Audit Rubric

**Purpose.** This is the reference an auditor (human or Claude) judges the app against. It is not generic UX advice — every rule is either sourced to a design system / research body, or explicitly marked `[convention]` where no primary source states a number.

**Stack:** React + Tailwind CSS v4 + shadcn/ui
**Users:** 2-person internal delivery-ops team, daily, all day
**Sections:** Needs Attention · Log work · Timesheet · Projects · Reports

**How to read the tags:**
- `[spec]` — stated by a standards body or first-party design system doc
- `[research]` — from usability research (NN/g, Baymard)
- `[convention]` — industry-common, no primary source; adopt or reject deliberately
- `[FAIL IF …]` — the checkable audit condition

---

# Part 1 — Design direction

## 1.1 The core decision: zoned density

The target feel is **calm and spacious like Notion, metrics-forward like Vercel/Stripe**. These conflict. Resolve it by *zoning*, not averaging.

| Zone | What it covers | Density |
|---|---|---|
| **Chrome** | Sidebar, header, page titles, empty states, settings, onboarding | Notion-calm — 24–32px page padding, 48px section rhythm, generous line-height |
| **Data** | Queue rows, timesheet grid, report tables, project lists | Vercel-dense — 32–40px row height, 12px cell padding, 13–14px type |
| **Focus** | Log-work form, entry sheet, detail panel | Between the two — single column, 16px field gaps, breathing room but no wandering |

One spacing scale. Two densities. `[convention]`

**[FAIL IF]** the same padding value is used inside a table cell and around a page section — that means no zoning decision was made.

## 1.2 What "calm" means here, precisely

Calm is not empty. Calm is achieved by removing *chrome*, not by removing *data*:

- One type family for everything (plus tabular figures for numbers)
- Borders instead of shadows for structure
- Accent color used exactly once per screen
- No card nested inside a card
- No decorative icons
- Gray by default; color only when it carries state

## 1.3 Where Notion's approach must be rejected

Notion reveals controls on hover and uses ~64px section padding with 1.5 line-height — roughly 12 rows on screen. `[convention, from third-party token extraction]`

For Tavren:
- **[FAIL IF]** row actions appear on `:hover` only. Use `:hover, :focus-within` — keyboard users must reach every action. `[spec: WCAG 2.1.1]`
- **[FAIL IF]** a queue or timesheet view shows fewer than ~20 rows at 1440×900. An ops queue needs scanning, not reading.
- **[FAIL IF]** table column alignment relies on borders so low-contrast they can't be traced down the column.

---

# Part 2 — Benchmark references

What to actually copy, per section. Each is a real, verifiable pattern from a shipping product.

## 2.1 Linear → Needs Attention

**Contextual single-letter shortcuts, no modifiers.** In Linear the same key works whether an item is open or merely hovered in a list: `A` assign, `S` status, `P` priority, `E` estimate, `C` create, `X` multi-select. Navigation uses `G`-then-letter (`G I` my issues, `G T` triage) rather than OS chords. The mental model is *cursor = selection*, so triage never requires opening a record.

→ **Adopt:** `J`/`K` move, `E` resolve, `S` status, `X` select, `C` log work from the item, `G` + letter for section jumps.
**[FAIL IF]** clearing an item from Needs Attention requires opening a detail view.

**Triage as a queue with four exits.** Linear's Triage items exit by `1` accept, `2` duplicate, `3` decline, `H` snooze — where snooze returns the item at a chosen time **or on new activity**.

→ **Adopt:** Accept · Dismiss (with note) · Merge · Snooze-until. Snooze-with-wake-on-activity is the highest-value single borrow: it lets the queue be honestly empty without losing anything.

**Three-token theming.** Rather than defining variables per theme, Linear *"defined three: base color, accent color, and contrast"* — generated in **LCH**, chosen as *"one of the closest color spaces to the human eye"* and because it handles elevation cleanly across background, foreground, panels, dialogs and modals. They also pulled blue out of the neutral ramp for a "more neutral and timeless appearance."

Their global chrome is an *"inverted L-shape… the global chrome of the application that controls the content in the main view"* — sidebar plus header. Headings use **Inter Display**, everything else regular **Inter**. The redesign was validated with stress tests across **eight areas** (Inbox, Triage, My Issues, Issues List, Project, Cycles, Roadmap, Search) on three axes: environment, appearance across light/dark/custom themes, and hierarchy.

→ **Adopt:** derive the whole palette from 3 inputs in the Tailwind config. This is what kills palette drift.

**⌘K duplicates every property action** ("Assign to…"), so the palette is a *discovery surface for shortcuts* — each row shows its shortcut, which is how the team learns the keyboard model.

## 2.2 Vercel / Geist → the shell, cards, and empty states

**Shadow-as-border.** Geist replaces CSS `border` with `box-shadow: 0 0 0 1px rgba(0,0,0,0.08)`, and uses a **double focus ring** — `0 0 0 2px white, 0 0 0 4px #0072F5` — so focus is visible on any background. Hover is **colour-only**: no transform, no opacity change.

→ **Adopt:** the white-buffer focus ring is a hard requirement for keyboard-first work. Colour-only hover eliminates layout shift on 32px rows.

**Empty states are typed, not generic.** Geist's primary variants are `blank slate` (first run), `informational` (first use with CTAs and docs links), `educational` (contextual onboarding), and `guide` (starter content) — plus `no-results`, `permission`, `tier-denial`, `error`, and **`cleared`** (completed work). Rules: **max one primary CTA**, a second only when there are two legitimate paths ("three CTAs is a smell"); titles in Title Case, descriptions in sentence case adding new information rather than repeating the title; CTA labels are Verb + Noun; quote the user's query in curly quotes; real `<Button>`/`<Link>` elements, never clickable divs; `aria-live="polite"` around the region after async filtering.

→ **Adopt:** Tavren needs at minimum three: Needs Attention `cleared`, Reports `no-results` ("No entries match {client: Acme}"), Projects `blank slate`.
**[FAIL IF]** one empty-state component is reused with swapped copy.

**Token reference** (third-party extraction of vercel.com, `[convention]`): three weights only — 400 body/buttons/labels, 500 code/subheads, 600 display. Body 16px, label/button 14px. 4px spacing base. Component heights 32/40/48px. Radius 6px functional, 12px cards. Header 64px, page margin 24px.

## 2.3 Stripe → Reports

Stripe's Balance report leads with four lines — Starting balance, Balance change from activity, Total payouts, Ending balance — and **each line's number is the sum of a named section of the detail table beneath it.** Stripe also documents that each report uses a *different date field* to decide what falls in range, and says so in the UI.

→ **Adopt:** lead Reports with a 3–4 figure reconciliation strip (Hours logged · Hours corrected · Billable · Unbilled), each **clickable to filter the table to exactly the rows that sum to it**.
→ **Adopt:** state the date basis in the UI. "By entry date" vs "by correction date" will bite a work-log app with correction history exactly as it bites Stripe.

## 2.4 Toggl Track → Log work and Timesheet

**Manual vs timer is one key** (`M` toggles Manual Mode), and field order doesn't matter — time first or description first, both parse.

**The weekly grid is the real win.** Project rows × weekday columns. A cell accepts `5`, `5.5`, `5:30`, `5h30m`, `120m`. **Tab advances across the row.** Enter or blur autosaves — no Save button. "Copy last week" pulls last week's projects forward.

→ **Adopt all of it.** Copy-last-week is the highest-leverage feature for a small agency with stable clients: it turns Friday timesheets from 20 entries into 5 edits.
**[FAIL IF]** the timesheet has a Save button, or rejects `5h30m`, or doesn't Tab across the row.

## 2.5 Superhuman → teaching "you are done"

Three-key triage: `E` done, `H` remind me later, `J` next — a single question per item: *today, another day, or already done?* The inbox counter shows **total items, not unread**, so the number only goes down when you act. Split Inboxes let you hit zero in one stream at a time rather than facing an undifferentiated pile.

→ **Adopt:** count total, never "new." Split Needs Attention into 2–3 named streams (e.g. *Uncorrected logs*, *Unbilled*, *Client waiting*) so zero is reachable per-stream. Give the cleared state a designed moment with the day's totals — not a shrug icon.

## 2.6 Conflict resolution table

| Conflict | Resolution |
|---|---|
| Notion airiness vs. queue density | Zone the app (§1.1). One scale, two densities. |
| Mono numerals vs. single-typeface calm | Tabular figures in the UI sans — **not** a monospace family. Mono only for IDs/codes. |
| Hover-revealed chrome vs. keyboard model | `:hover, :focus-within` — never hover alone. |
| Optimistic UI vs. a work log with correction history | Optimistic is fine for *status*. An amended work-log entry is a billing record: write optimistically, show the new value immediately, but **append a correction row rather than mutating**. Undo is a new entry, not a rollback. |
| "Empty = done" vs. "all data always available" | Needs Attention empties; Reports never does. Snoozed/dismissed items must stay queryable from Reports, or people stop dismissing. |
| Stripe density vs. a 2-person team | Skip saved-view management, permissions UI, account switchers. Keep the reconciliation strip and filter chips. |

---

# Part 3 — Visual system

## 3.1 Type

**Base 14px, not 16px.** IBM Carbon assigns 14px to its "productive" type set — *"product pages with dense information"* — and 16px to the "expressive" set for editorial. Tavren's queue, timesheet, and tables are productive. `[spec]`

Carbon productive ladder (size / line-height / weight):

| Role | Size | LH | Weight |
|---|---|---|---|
| label, helper | 12 | 16 | 400 |
| body-compact (table cells) | 14 | 18 | 400 |
| body (paragraphs) | 14 | 20 | 400 |
| heading-compact (card title) | 14 | 18 | 600 |
| section heading | 20 | 28 | 400 |
| page heading | 28 | 36 | 400 |

**Scale discipline.** Refactoring UI prescribes no ratio — it prescribes that **no two steps sit closer than ~25%** and that you pick from a fixed set. `12 → 14 → 16 → 20 → 24 → 30 → 36` satisfies this. (A "1.25 modular scale" is `[convention]`.)

**Line-height.** ~1.5 is the readability starting point, and line-height is *inversely related* to font size. `[research: Refactoring UI]` Practical: table rows 1.25–1.35 · body prose 1.5 · headings ≥24px 1.15–1.25. Cap prose at **45–75 characters per line**.

**Weight.** 400/500 body, 600/700 emphasis. Nothing below 400 at UI sizes. Carbon's move is the calm one: **emphasize small text with weight, large text with size** — headings are 600 at 14px but drop to 400 at 20px+.

**Numerals — non-negotiable.**

```css
.tabular { font-variant-numeric: tabular-nums lining-nums; }
```

Apply to every numeric column, KPI value, delta, duration, and timestamp. Proportional figures make hour totals visibly ragged down a column. Add `slashed-zero` only for IDs/job codes.
**[FAIL IF]** any column of numbers lacks `tabular-nums`.

## 3.2 Spacing

Tailwind v4 defaults `--spacing: 0.25rem` (4px) and computes utilities as `calc(var(--spacing) * n)`. `[spec]` Use the 4px base but **restrict layout to an 8px-derived subset**, keeping 4px for intra-component nudges only. `[convention]`

```
space-0.5   2px    hairline nudges only
space-1     4px    icon↔label gap, badge padding-y
space-2     8px    table cell padding-y (compact), inline gaps
space-3    12px    table cell padding-x, label↔input
space-4    16px    card padding (compact), field↔field
space-6    24px    card padding (default), page padding (mobile)
space-8    32px    page padding (desktop), card↔card
space-12   48px    section rhythm within a page
space-16   64px    major section break
```

Assignments: page padding 24px mobile / 32px desktop · card padding 24px (16px dense KPI tiles) · form field gap 16px, label→control 8px, control→helper 4px · table cell 12×8 compact, 12×12 default · section rhythm 48px.

**Radius:** set shadcn's `--radius` to **0.5rem (8px)**. Calm apps read tighter than the 0.625rem default. `[convention]`

## 3.3 Color

**Grays: 8–10 shades, chosen up front, never ad hoc.** `[research: Refactoring UI]` Geist's 10-step model with fixed semantic jobs is what to copy `[spec]`:

- **100–300** → component backgrounds (rest / hover / active)
- **400–600** → borders (rest / hover / active)
- **700–800** → high-contrast fills
- **900** → secondary text and icons
- **1000** → primary text and icons

**Surfaces: three only.** `--background` (page) · `--card` (surface) · `--popover` (elevated). shadcn ships exactly these as background/foreground pairs.
**[FAIL IF]** there is a fourth ad-hoc surface color, or a card nested in a card.

**Borders.** One `--border` token for structure, `--input` for controls. Any border that *identifies a control* (input outline, checkbox, toggle track) must hit **3:1 against adjacent color**. `[spec: WCAG 1.4.11]` Purely decorative dividers have **no** ratio requirement — a low-contrast 1px hairline is legal and is the calm choice.

**Semantic roles.** success / warning / danger / info, each with a `-foreground` pair plus a subtle background variant for badges. shadcn ships only `--destructive`; add the rest (§3.5).
**Accent used once per screen** — the primary action, or the selected nav item. Metrics are gray by default and take color only when they carry state (overdue, over-budget).

**Contrast — actual numbers, WCAG 2.2 `[spec]`:**

| Requirement | Ratio | Level |
|---|---|---|
| Normal text | **4.5:1** | AA (1.4.3) |
| Large text (≥18pt, or ≥14pt bold ≈ 24px / 18.5px bold) | **3:1** | AA |
| Normal text | 7:1 | AAA (1.4.6) |
| UI components, states, focus indicators, meaningful graphics | **3:1** | AA (1.4.11) |

Ratios are **not rounded** — 2.999:1 fails. Exempt: incidental text, logotypes, **disabled controls**.
**[FAIL IF]** `--muted-foreground` is used for real table content below 4.5:1. Only decorative and disabled text escapes.

**Dark mode.** Keep token *names* identical, swap values under `.dark` — never rewire which token a component uses. Invert lightness while **reducing chroma** (shadcn's own destructive: `oklch(0.577 0.245 27.325)` light → `oklch(0.704 0.191 22.216)` dark). Avoid pure `#000` backgrounds and pure `#fff` text.

## 3.4 Elevation

**Borders carry structure; shadows carry only genuine z-layering.** Cards, table containers, and panels get `1px solid var(--border)` and **no shadow**. Shadows appear only on things that actually float: dropdowns, popovers, command palette, sheets, dialogs, toasts.

```
--shadow-2xs   hairline / hover lift
--shadow-xs    buttons
--shadow-sm    dropdown, popover
--shadow-md    command palette
--shadow-lg    sheet
--shadow-xl    modal dialog
```

Heavy shadows read as dated because they encode a skeuomorphic depth metaphor, while modern data UIs signal hierarchy through **contrast and spacing**. The largest Tailwind steps use high alpha (0.25 at `2xl`), which visibly muddies a light neutral page.
**In dark mode shadows are near-invisible** — use a lighter surface (`--card` above `--background`) as the elevation cue, not a bigger shadow.

**[FAIL IF]** a static card carries a shadow, or a hover state changes size/shadow on a table row (causes reflow jitter at 32–40px heights).

## 3.5 shadcn/ui + Tailwind v4 mechanics

Every surface token has a `-foreground` partner: the base token controls the surface, the `-foreground` token controls text and icons. Colors are **OKLCH**. Requires `"cssVariables": true` in `components.json`. `[spec]`

Radius derives from one variable:

```css
@theme inline {
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
}
```

Adding a token correctly — define raw in `:root`/`.dark`, then expose in `@theme inline`:

```css
:root { --warning: oklch(0.84 0.16 84); --warning-foreground: oklch(0.28 0.07 46); }
.dark { --warning: oklch(0.41 0.11 46); --warning-foreground: oklch(0.99 0.02 95); }
@theme inline {
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
}
```

Now `bg-warning` / `text-warning-foreground` exist. Do the same for success and info.

**Component mapping:**

| Pattern | Component |
|---|---|
| ⌘K palette | **Command** / `CommandDialog` (wraps `cmdk`) |
| Tables (Needs Attention, Timesheet, Projects) | **DataTable** recipe over **TanStack Table** |
| Toasts | **Sonner** (the old `toast` is deprecated) |
| Detail / log-work without losing context | **Sheet** — for content that complements the main content |
| Blocking confirm / destructive | **Dialog** / AlertDialog |
| Loading | **Skeleton**, matched to real row height |
| Status (overdue, approved, blocked) | **Badge** |
| View switching within a section | **Tabs** |

**Known pitfalls:**
- HSL→OKLCH migration: move `:root`/`.dark` **out of `@layer base`**, drop `hsl()` wrappers inside `@theme inline`
- Chart colors: `"hsl(var(--chart-1))"` → `"var(--chart-1)"` or charts render colorless
- `React.forwardRef` removed in favor of `React.ComponentProps` — old ref-forwarding patches break
- Components carry `data-slot` attributes — style against those, not fragile child selectors
- `tailwindcss-animate` deprecated → `tw-animate-css`
- `default` style deprecated; new projects get `new-york`
- DataTable is a **guide, not a component** — you own and maintain the code

## 3.6 Focus, hover, selection, hit targets

**Focus ring.** Never `outline: none` without a replacement.

- WCAG **1.4.11** (AA): indicator ≥ **3:1** against adjacent background
- WCAG **2.4.13 Focus Appearance** (AAA, 2.2): indicator area ≥ the area of a **2 CSS px perimeter** of the component, and ≥ **3:1 between focused and unfocused states of the same pixels**. Worked example from the spec: a 90×30px button needs ≥ **480px²**

```css
:where(button, a, [role="button"], input, select, [tabindex]):focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
  border-radius: inherit;
}
```

Use `:focus-visible`, not `:focus`. `outline-offset` matters — a flush ring on a bordered input can fail the focused-vs-unfocused 3:1 delta by overlapping the border color.

**Hover ≠ selection.** Hover = `--accent` background. Selection = persistent left border or checkbox state plus tinted row, and **must survive the pointer leaving**.

**Hit targets:**

| Source | Minimum |
|---|---|
| WCAG 2.5.8 Target Size (Minimum), **AA** | **24 × 24 CSS px** `[spec]` |
| WCAG 2.5.5 (Enhanced), AAA | 44 × 44 CSS px `[convention — widely cited, not restated in the Understanding page]` |
| Apple HIG | 44 × 44 pt `[convention — HIG pages are JS-rendered, not directly quotable]` |
| Material 3 / Android | **48 × 48 dp** (≈9mm) `[spec]` |

The 24px AA floor has an exception useful for dense tables: undersized targets pass if a **24px-diameter circle centered on each target doesn't intersect another target's circle**. Also exempt: inline targets constrained by line-height, UA-sized controls, and **data visualizations** (named explicitly).

**Tavren standard:** 32px minimum for icon buttons in table rows · 36–40px standalone buttons · 44px for anything used on a tablet in the field.

## 3.7 Metrics and charts

**KPI card anatomy** `[convention]`: label 12px/400 muted → value 28–32px/400–500 **tabular-nums** → delta row 12–14px with direction glyph → optional sparkline → context line ("vs. prior 30d"). Card padding 16–24px. **Align the value baseline across a KPI row** so numbers scan horizontally.

**Delta.** Show the change *and* its basis: `+12.4% vs. last week`. Never rely on red/green alone — ~**1 in 12 men and 1 in 200 women** have a color vision deficiency, and WCAG 1.4.11 requires 3:1 for meaningful graphics. Pair color with an arrow glyph and a signed number.

**Critical for ops metrics:** decide per-metric whether up is good. Rising "overdue items" is red; rising "throughput" is green. The semantic token is chosen by **meaning, not sign**.

**Sparklines** `[convention]`: no axes, no gridlines, no tooltip-dependent meaning; 1.5–2px stroke; ~24–40px tall in a KPI card. They show shape only — the number beside them carries the value.

**Chart palette.** Carbon ships 14 categorical colors in a fixed sequence *"curated to maximize contrast between neighboring colors,"* with 1–4 color overrides when the series count is known — use the overrides whenever the count is fixed. shadcn gives `--chart-1 … --chart-5`, the right ceiling here.

**Chart accessibility.** Differentiate by **luminance, not just hue**; add a second channel (shape markers, line style, bar pattern); **label directly on the mark** rather than forcing a legend round-trip; test in grayscale. Provide a table fallback or `aria-label` summary for every chart.

---

# Part 4 — Interaction rules

Each phrased as a checkable rule. Tags name the source.

## 4.1 Information architecture

1. Top-level nav items are the *most important sections*, not a sitemap of every route. `[GOV.UK; NN/g IA-vs-Navigation]`
2. Primary nav is **visible, not behind a hamburger**, on desktop — **left side for apps**. **[FAIL IF]** desktop hamburger. `[NN/g Menu Design 1–2]`
3. Vertical left nav is the default for 5+ sections: it scales without redesign, and users *"look at the left half of the screen 80% of the time."* Labels left-aligned, always text, never icon-only. `[NN/g Vertical Nav]`
4. **There is no "3 clicks" rule.** Nielsen found findability rose **600%** when products moved from 3 clicks to 4 with better labelling. Audit the *information scent of each label*, not click count. `[UX Myths, citing UIE + Nielsen]`
5. Every screen shows the user's location — the active nav item is present and unambiguous. **[FAIL IF]** any route leaves nav with nothing selected. That is the orphan-route test. `[NN/g Menu Design 5]`
6. Orphan routes (e.g. correction-history detail) get either a parent nav section or a breadcrumb whose trail is the **hierarchy, not browsing history**, with one canonical parent chosen. `[NN/g Breadcrumbs]`
7. Breadcrumbs are **not** added to sections 1–2 levels deep or linear in structure, and never replace main nav. `[NN/g Breadcrumbs]`
8. Avoid multilevel cascading submenus. One level of grouping plus a section landing page. Submenus are **click-activated, not hover-activated**, signified with a caret. `[NN/g Menu Design 12–14]`
9. Sub-sections within a screen (Log work → corrections; Reports → each report) use **local navigation**, not promotion to global nav. `[NN/g Menu Design 6]`
10. Material 3 caps a navigation rail at **3–7 destinations**. **[FAIL IF]** top-level items exceed 7 without regrouping. `[M3]`

## 4.2 Navigation

11. Search **supplements** nav, never replaces it — search demands recall, is more error-prone than clicking, and site search quality is usually poor. **[FAIL IF]** the answer to "hard to navigate" is "use search." `[NN/g Search Is Not Enough]`
12. **Recent and pinned lists are required, not optional.** Recency and context are two of the three factors that make retrieval easy; NN/g explicitly recommends "Continue where you left off" for interrupted work. **PASS** = the dashboard shows recently-touched projects and work-log entries. `[NN/g Recognition and Recall; Long Waits and Interruptions]`
13. A command palette is an **escape hatch for power users, not the fix for weak nav** — add it once the basic pathway is strong, bind to ⌘K, seed recent-first, move focus in on open and return it on close. **[FAIL IF]** the palette is the only path to any destination. `[UX Patterns for Developers]`
14. Keyboard accelerators must not override standard shortcuts (copy/paste/select-all/print) and must be discoverable via tooltips/inline hints. `[NN/g Accelerators]`
15. Persistent sidebar over collapsible where space allows; if items collapse, important items stay above the fold. `[NN/g Vertical Nav]`

## 4.3 Needs Attention (queue / triage)

16. Each row is scannable by a **human-readable identifier in the first column** — client/project name, never an internal ID. `[NN/g Data Tables]`
17. Priority signals are *indicators*: contextual, conditional, passive, adjacent to what they describe, requiring no action to dismiss. Never express queue priority with notifications or modals. `[NN/g Indicators, Validations, Notifications]`
18. Alerts are rationed. **[FAIL IF]** every item carries an urgency badge — undifferentiated alerting produces alert fatigue. `[NN/g Alert Fatigue]`
19. Bulk actions: checkbox multi-select with **select-all in the column header** (three states: checked / unchecked / indeterminate), a batch-action bar at the top, and **row-level actions disabled while batch mode is active**. Exit via cancel or deselect-all. `[Carbon Data Table; NN/g]`
20. Inline single actions only when there are 1–2 per row; more goes to batch or an overflow menu. `[NN/g Data Tables]`
21. Snooze/defer is reversible **without a confirm step**. Confirmation dialogs are reserved for **rare + severe + irreversible**; everything routine gets **undo**. **[FAIL IF]** a daily action triggers a confirm dialog. `[NN/g Confirmation Dialogs]`
22. The empty queue is a *completion* state, not a blank panel (see rule 40).

## 4.4 Log work (forms and daily entry)

23. Cut visible fields. Baymard measured **18% of users abandoning** because a form was "too long or complicated," with intimidation setting in around **10–15+ fields**; simplification typically cuts visible fields **20–60%**. **PASS** = Log work shows ≤ ~7 fields by default, rest progressively disclosed. `[Baymard]`
24. **Single column.** No multi-column form layouts. `[Baymard]`
25. Labels **above** inputs, with format hints where ambiguity exists. `[Baymard]`
26. Never ask twice: *"if the same date information is required in a separate part of the form or later during a task, then don't make users enter that date twice."* `[NN/g Date-Input]`
27. Date entry accepts free-typed formats (9-3-17, 09/03/17, 09.03.17) without required separators; a picker is offered only for near-term dates or ranges, **never as the only input method**. `[NN/g Date-Input; GOV.UK Dates]`
28. Illogical dates are disabled (end before start, future work dates beyond policy). `[NN/g Date-Input]`
29. Validation fires **after** the user leaves a field, never mid-typing. `[NN/g Form Errors]`
30. Error text sits **next to the field in error**; a top-of-form summary may exist but is never the only indicator. Copy is *"explicit, human-readable, polite, precise, and gives constructive advice."* `[NN/g Form Errors]`
31. Entry is inline or in a **non-modal side panel**, not a modal — modals obscure the rows the user is referencing. Modals are for irreversible-loss warnings and blocking required input. `[NN/g Data Tables; Modal vs Nonmodal]`
32. Interrupted entry survives: draft state is retained and reachable; users can *"skip ahead, loop back… and move fluidly from any step to any other"* without losing progress. **[FAIL IF]** navigating away loses a half-typed entry. `[NN/g Complex Applications 3]`
33. Correction history is **secondary information reachable without leaving the primary screen** (hover / expand / side panel), progressively disclosed — shown *"only when relevant to the task at hand."* **[FAIL IF]** every row renders its revision trail inline. `[NN/g Complex Applications 6–7]`

## 4.5 Reports

34. Filter placement follows scope: left sidebar = global/page-wide, scales to many filters · horizontal bar = medium · inline = affects one chart or table only. `[Pencil & Paper]`
35. Applied filters are shown **redundantly**: state preserved in the control, a count marker "(3)", *and* a summary of active filters above the content. `[Pencil & Paper]`
36. Batch-apply (an "Apply" button) when several criteria are set at once or responses are slow; instant-apply only when results return in **under 1 second**. `[NN/g Applying Filters]`
37. Saved views exist for any filter combination reproduced regularly. `[Pencil & Paper]`
38. **Every metric drills down to the underlying rows.** Supporting detail is available without leaving the screen. `[NN/g Complex Applications 7]`
39. Export to spreadsheet is first-class, not a nice-to-have — it *"reduces time spent converting data."* `[NN/g Complex Applications 5]`

## 4.6 Feedback and system status

40. Empty states do three things: **state system status** ("No records for the selected date range" — distinguishing empty from loading from broken), **teach**, and **give a direct path**. **[FAIL IF]** an apology with no action. `[NN/g Empty States]`
41. Distinguish empty-state *types*: first-use · no-results (offer alternatives, never a dead end) · completion (celebrate). `[Pencil & Paper]`
42. **Loading thresholds** `[NN/g Response Times; Skeleton Screens]`:
    - `<0.1s` no feedback
    - `<1s` **no spinner or skeleton at all**
    - `2–10s` spinner for a single module, **skeleton for a full-screen load**
    - `>10s` percent-done progress bar **plus a cancel option**
43. Skeletons only for container and data components (tables, lists, cards) — never for modals, toasts, dropdowns, or actions; never frame-only skeletons showing just header and footer. `[Carbon Loading; NN/g]`
44. Message channel by type: **inline** near the item for task feedback (persists until resolved) · **toast** for system-generated non-blocking events · **modal** only when the user must be interrupted. `[Carbon Notification pattern]`
45. **Toasts with an action never auto-dismiss**, and critical messages are never timer-dismissed. **[FAIL IF]** an error appears only as a timed toast. `[Carbon]`
46. Undo is **visible in the UI**, not assumed knowledge, and supports multiple successive undos. Optimistic updates are acceptable only where undo or a clear failure-recovery path exists. `[NN/g User Control and Freedom]`
47. Long operations report start time, end time, elapsed time and what changed on completion, and run in the background where possible. `[NN/g Long Waits]`

---

# Part 5 — Motion specification

Animation here is **functional**: it explains state changes and covers latency. Anything decorative is a defect in a tool used all day.

## 5.1 Durations

| Element | Duration |
|---|---|
| Micro-interactions (button press, checkbox, hover) | **100–150ms** |
| Standard UI (tooltip, dropdown, popover, toast) | **150–250ms** |
| Modals, sheets, drawers | **200–300ms** |

**Hard ceiling: 300ms.** *"Your animations should also usually be shorter than 300ms."* Larger elements animate slower than smaller ones. **Exit animations run ~20% faster than entrances.**

## 5.2 The frequency rule — this is the one that matters most here

| Interaction frequency | Treatment |
|---|---|
| **100+ times daily** | **No animation at all** |
| Occasional | Standard 150–250ms |
| Rare / first-time | Can be more elaborate |

**Never animate keyboard-initiated actions.** A repetitive interaction performed hundreds of times a day feels sluggish with any delay attached.

→ For Tavren specifically: **row selection, `J`/`K` movement, cell-to-cell Tab in the timesheet, and queue item resolution get zero animation.** The command palette opening, the detail Sheet sliding in, and the cleared-queue state get animation.
**[FAIL IF]** moving between timesheet cells or queue rows is animated.

## 5.3 Easing

**ease-out for anything user-initiated** — entering, exiting, dropdowns, modals. It starts fast and slows at the end, which reads as responsive.

```css
--ease-out-quad:  cubic-bezier(0.25, 0.46, 0.45, 0.94);
--ease-out-cubic: cubic-bezier(0.215, 0.61, 0.355, 1);
--ease-out-quart: cubic-bezier(0.165, 0.84, 0.44, 1);
--ease-out-expo:  cubic-bezier(0.19, 1, 0.22, 1);
```

**ease-in-out** for elements already on screen that move or morph:

```css
--ease-in-out-cubic: cubic-bezier(0.645, 0.045, 0.355, 1);
--ease-in-out-quart: cubic-bezier(0.77, 0, 0.175, 1);
```

**ease** for hover and color transitions: `transition: background-color 150ms ease;`
**linear** only for constant-speed motion (marquees, tickers, elapsed-time indicators).
**ease-in — avoid entirely for UI.** A slow start delays visual feedback and reads as sluggish.

**Paired elements rule:** *"Elements that animate together must use the same easing and duration."* Modal + overlay, tooltip + arrow, sheet + scrim.

## 5.4 Properties

**Animate only `transform` and `opacity`** — GPU-accelerated, composite-only.
**Never animate** `padding`, `margin`, `height`, `width`, blur filters above 20px, or CSS variables in deep component trees.
Maintain **60fps minimum**. `will-change: transform` when a specific animation is jittery — not as a blanket rule.

## 5.5 Anti-patterns

| Problem | Fix |
|---|---|
| Element appears abruptly | Start from `scale(0.95)` or higher, **never `scale(0)`** |
| Shaky / jittery | Add `will-change: transform` |
| Hover flicker | Animate the child, not the parent |
| Popover scales from the wrong place | Set `transform-origin` to the trigger — Radix/Base UI expose CSS vars that compute this automatically |
| Feels sluggish | Use `ease-out`, not `ease-in` |

## 5.6 Micro-interaction details worth shipping

- **Button press:** `:active { transform: scale(0.97); }` — cheap, makes the whole app feel responsive
- **Tooltip delay, then instant:** delay before the *first* tooltip; on subsequent hovers set `transition-duration: 0ms` via a `data-instant` attribute. This is what separates a polished tooltip system from an annoying one
- **Blur for polish:** ~2px `filter: blur()` during a state transition masks imperfections and smooths the change
- **Springs:** Apple's model, `{ type: "spring", duration: 0.5, bounce: 0.2 }`. **Avoid bounce in most UI** — 0.1–0.3 only for drag-to-dismiss. Springs maintain velocity when interrupted, so they're right for gestures

## 5.7 Interruptibility and accessibility

Users must be able to interrupt an animation smoothly. CSS transitions handle this natively; Framer Motion / Motion requires explicit support.

**Every animated element needs:**

```css
@media (prefers-reduced-motion: reduce) {
  .modal { animation: none; }
}
```

Set `animation: none` / `transition: none` **without `!important`**, and apply it to **all** animations — no exception for opacity or color.

Touch devices:

```css
@media (hover: hover) and (pointer: fine) {
  .element:hover { transform: scale(1.05); }
}
```

**[FAIL IF]** any animation lacks a `prefers-reduced-motion` path.

## 5.8 Where motion earns its place in Tavren

| Moment | Treatment |
|---|---|
| ⌘K palette open | 150ms ease-out, `scale(0.96) → 1` + opacity, origin center-top |
| Detail Sheet slide-in | 250ms ease-out translate; scrim fades on the **same duration and easing** |
| Row removed from queue (resolve/dismiss) | 150ms opacity + height collapse — **and only when triggered by mouse**, never by keyboard |
| Toast (Sonner) | 200ms ease-out slide + fade; no auto-dismiss if it carries an action |
| Queue reaching zero | The one place elaborate motion is earned — a rare, first-time-feeling moment. Spring, 0.5s, bounce 0.2 |
| Metric value change on filter | Cross-fade the number, 150ms. **Do not** count up — that's decoration, and it delays reading |
| Skeleton → content | Fade only, 150ms. No layout shift — the skeleton must match the real row height |
| Timesheet cell Tab, `J`/`K`, row select | **None** |

---

# Part 6 — Audit rubric

Score each area 0–4. Anything below 3 goes in the fix plan.

- **0 Absent** — the pattern doesn't exist
- **1 Broken** — exists but actively harms the task
- **2 Generic** — a default component dropped in, unconsidered
- **3 Solid** — meets the rules in this document
- **4 Considered** — meets the rules and shows a judgment call specific to Tavren's work

| # | Area | What earns a 4 |
|---|---|---|
| A1 | Nav structure & labelling | ≤7 top-level items, task-named, active state always correct, no orphan routes |
| A2 | Wayfinding | Location always evident; breadcrumbs only where hierarchy is ≥3 deep |
| A3 | Recent / pinned | Dashboard surfaces recently-touched projects and entries |
| A4 | Command palette | ⌘K exists, recent-first, shows shortcuts, is not the only path anywhere |
| A5 | Keyboard model | Single-letter contextual shortcuts; every mouse action has a keyboard path |
| B1 | Type system | 14px productive base, fixed scale, tabular-nums on every number column |
| B2 | Spacing & zoning | One scale, two densities, explicitly applied |
| B3 | Color & contrast | 4.5:1 body / 3:1 UI, accent once per screen, dark mode by token swap |
| B4 | Elevation | Borders for structure, shadows only for floating layers |
| B5 | Focus & hit targets | 2px `:focus-visible` ring + offset; 32px row icon buttons |
| C1 | Needs Attention | Four exits, snooze-with-wake, per-stream zero, total count not unread |
| C2 | Log work | ≤7 default fields, single column, side panel not modal, draft survives navigation |
| C3 | Timesheet | Weekly grid, flexible duration parser, Tab-across-row, autosave, copy-last-week |
| C4 | Projects | Human-readable first column, density control, sticky header + first column |
| C5 | Reports | Reconciliation strip, drill-down from every metric, date basis stated, export |
| D1 | Empty states | Three distinct typed variants, each teaching and actionable |
| D2 | Loading | Thresholds respected; skeletons match real row heights |
| D3 | Feedback | Inline vs toast vs modal correctly chosen; undo visible; no timed errors |
| D4 | Errors | Adjacent to field, after blur, constructive copy |
| E1 | Motion — restraint | Nothing animated that's done 100+ times daily |
| E2 | Motion — craft | ease-out, ≤300ms, transform/opacity only, paired elements matched |
| E3 | Motion — a11y | `prefers-reduced-motion` on every animation |
| E4 | Motion — earned moments | Palette, sheet, cleared-queue treated as the places motion pays |

**Scoring:** total /92. Below 55 means structural rework, not polish.

---

# Sources

**Benchmarks**
- [Linear — Method](https://linear.app/method) · [How we redesigned the Linear UI](https://linear.app/blog/how-we-redesigned-the-linear-ui) · [Triage docs](https://linear.app/docs/triage) · [Assigning issues](https://linear.app/docs/assigning-issues)
- [Vercel Geist — Introduction](https://vercel.com/geist/introduction) · [Empty State](https://vercel.com/geist/empty-state) · [Colors](https://vercel.com/geist/colors) · [Font](https://vercel.com/font)
- [Stripe — Select a report](https://docs.stripe.com/reports/select-a-report) · [Matt Ström-Awn — Stripe Merchant Dashboard](https://mattstromawn.com/projects/stripe-dashboard/)
- [Toggl Track — Timesheet view](https://support.toggl.com/en/articles/10760857-adding-time-entries-in-timesheet-view) · [Manual Mode](https://support.toggl.com/en/articles/2527693-manual-mode)
- [Superhuman — Split Inbox](https://blog.superhuman.com/how-to-split-your-inbox-in-superhuman/) · [Inbox Zero in 7 steps](https://blog.superhuman.com/inbox-zero-in-7-steps/)

**Research & guidelines**
- NN/g: [Menu Design](https://www.nngroup.com/articles/menu-design/) · [Vertical Nav](https://www.nngroup.com/articles/vertical-nav/) · [Breadcrumbs](https://www.nngroup.com/articles/breadcrumbs/) · [IA vs Navigation](https://www.nngroup.com/articles/ia-vs-navigation/) · [Recognition and Recall](https://www.nngroup.com/articles/recognition-and-recall/) · [Search Is Not Enough](https://www.nngroup.com/articles/search-not-enough/) · [Complex Applications](https://www.nngroup.com/articles/complex-application-design/) · [Data Tables](https://www.nngroup.com/articles/data-tables/) · [Indicators, Validations, Notifications](https://www.nngroup.com/articles/indicators-validations-notifications/) · [Confirmation Dialogs](https://www.nngroup.com/articles/confirmation-dialog/) · [User Control and Freedom](https://www.nngroup.com/articles/user-control-and-freedom/) · [Modal vs Nonmodal](https://www.nngroup.com/articles/modal-nonmodal-dialog/) · [Form Errors](https://www.nngroup.com/articles/errors-forms-design-guidelines/) · [Date-Input](https://www.nngroup.com/articles/date-input/) · [Applying Filters](https://www.nngroup.com/articles/applying-filters/) · [Empty States](https://www.nngroup.com/articles/empty-state-interface-design/) · [Response Times](https://www.nngroup.com/articles/response-times-3-important-limits/) · [Skeleton Screens](https://www.nngroup.com/articles/skeleton-screens/) · [Long Waits and Interruptions](https://www.nngroup.com/articles/designing-for-waits-and-interruptions/) · [Accelerators](https://www.nngroup.com/articles/ui-accelerators/)
- [Baymard — Form Design](https://baymard.com/learn/form-design)
- [GOV.UK — Navigate a service](https://design-system.service.gov.uk/patterns/navigate-a-service/) · [Dates](https://design-system.service.gov.uk/patterns/dates/)
- [Carbon — Data Table](https://carbondesignsystem.com/components/data-table/usage/) · [Notification pattern](https://carbondesignsystem.com/patterns/notification-pattern/) · [Loading pattern](https://carbondesignsystem.com/patterns/loading-pattern/) · [Type sets](https://carbondesignsystem.com/elements/typography/type-sets/) · [Data-viz color palettes](https://carbondesignsystem.com/data-visualization/color-palettes/)
- [Material 3 — Navigation rail](https://m3.material.io/components/navigation-rail/guidelines) · [Android touch target sizing](https://support.google.com/accessibility/android/answer/7101858)
- [Pencil & Paper — Enterprise data tables](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables) · [Filter UX](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-filtering) · [Empty States](https://www.pencilandpaper.io/articles/empty-states)
- [UX Patterns for Developers — Command Palette](https://uxpatterns.dev/patterns/advanced/command-palette)
- [UX Myths — the 3-click rule](https://uxmyths.com/post/654026581/myth-all-pages-should-be-accessible-in-3-clicks)

**Motion**
- [Emil Kowalski — Great animations](https://emilkowal.ski/ui/great-animations) · [7 practical animation tips](https://emilkowal.ski/ui/7-practical-animation-tips)
- [Vercel Labs — web-animation-design skill](https://github.com/vercel-labs/open-agents/blob/main/.agents/skills/web-animation-design/SKILL.md)

**Implementation**
- [shadcn/ui — Theming](https://ui.shadcn.com/docs/theming) · [Tailwind v4](https://ui.shadcn.com/docs/tailwind-v4) · [Data Table](https://ui.shadcn.com/docs/components/data-table) · [Sheet](https://ui.shadcn.com/docs/components/sheet) · [Command](https://ui.shadcn.com/docs/components/command)
- [Tailwind — Theme](https://tailwindcss.com/docs/theme)
- W3C WCAG 2.2: [Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) · [Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) · [Focus Appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html) · [Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [MDN — font-variant-numeric](https://developer.mozilla.org/en-US/docs/Web/CSS/font-variant-numeric)

**Known gaps — do not fabricate into this standard**
- Shopify Polaris docs now redirect and could not be cited; Atlassian's nav/inline-edit pages are deprecated stubs.
- Refactoring UI has no citable public rule pages — its principles above come from a secondary summary.
- No authoritative source exists for "inbox zero" motivational psychology. Rule 22 rests on the completion-state category, not on research about clearable lists.
- NN/g's menu-design article contains **no** numeric limit on menu item count or depth, despite frequent secondhand claims. The only defensible number is Material 3's 3–7.
