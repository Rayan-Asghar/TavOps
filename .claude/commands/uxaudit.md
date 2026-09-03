---
description: Full UI/UX audit of Tavren Internal OS against DESIGN-STANDARD.md
argument-hint: [base-url] [email] [password]
allowed-tools: Read, Grep, Glob, Bash, Write, Task, mcp__playwright__*
---

# UX Audit — Tavren Internal OS

You are auditing this app against `docs/DESIGN-STANDARD.md`. That document is the rubric. **Read it in full before doing anything else.** Do not substitute your own general UX opinions where the standard states a rule — cite the rule number.

Target: `$1` (default `http://localhost:3000`)
Credentials: `$2` / `$3`

**You are auditing, not fixing. Change no application code.** Everything you write goes in `ux-audit/`.

---

## Phase 0 — Load the standard

1. Read `docs/DESIGN-STANDARD.md` completely.
2. Build an internal checklist from Part 4 (rules 1–47), Part 5 (motion), and the Part 6 rubric rows (A1–E4).
3. Note every `[FAIL IF]` condition — those are binary, not judgment calls.

## Phase 1 — Map the system

Read the code, don't guess:

1. Find the router config and every route definition. Find the sidebar/nav component and list what it exposes.
2. Find the Tailwind config, the shadcn `components.json`, and the CSS file holding the theme variables. Record: the actual `--radius`, the full token set, whether the app is on Tailwind v3 or v4, whether tokens are HSL or OKLCH, and which of the §3.5 pitfalls apply.
3. Grep for the real state of the codebase against these specific checks:
   - `tabular-nums` / `font-variant-numeric` — how many places, and does that cover every numeric column?
   - `outline: none` / `outline-none` without a `focus-visible` replacement
   - `prefers-reduced-motion` — present at all?
   - `transition-` / `animate-` on properties other than transform/opacity
   - hardcoded hex/rgb colors outside the token file
   - hardcoded px spacing values off the 4px scale
   - `localStorage` / persisted UI preferences (density, saved views, last filter)
   - modal vs sheet usage — which components wrap data entry
4. Write `ux-audit/00-inventory.md`:
   - every route, its nav label, its parent, and whether it has an active nav state
   - **orphan routes** — reachable only by URL, or leaving nav with nothing selected (rule 5)
   - top-level nav item count vs the 3–7 band (rule 10)
   - the token/config findings from step 2
   - the grep results from step 3, with file:line references

## Phase 2 — Capture

Using Playwright against `$1`, logged in as `$2`:

1. **Screens.** Full-page screenshot of every route at 1440×900 into `ux-audit/screens/`, named `NN-route-name.png`. Also capture: dark mode if it exists, one table with ≥20 rows, one table with 0 rows, and one form mid-validation-error.
2. **States.** For each of the five sections capture the empty state, loading state (throttle the network), and error state where reachable. Save to `ux-audit/states/`.
3. **Flows.** Walk each flow end to end, screenshotting every step into `ux-audit/flows/`, and log a step-by-step trace:
   - **F1 Log work** — from landing to a saved entry
   - **F2 Timesheet** — enter a week of hours
   - **F3 Needs Attention** — clear one item, and try to clear five
   - **F4 Reports** — filter to one client for last month and export
   For each flow record: **clicks, keystrokes, fields touched, page loads, and every moment you had to search the screen for the next control.**
4. **Keyboard pass.** Tab through each screen from the top. Record: whether focus is ever invisible, whether focus order matches visual order, whether any control is unreachable, whether Escape closes overlays and returns focus to the trigger, and whether ⌘K exists.
5. **Measurements.** With `page.evaluate`, extract real computed values — don't eyeball them:
   - table row heights and cell padding
   - the set of distinct font sizes and weights used across the app
   - the set of distinct spacing values in use (flag any off the 4px scale)
   - computed contrast ratios for body text, muted text, borders, and badges against their actual backgrounds — check each against 4.5:1 / 3:1 (§3.3)
   - focus ring width, offset, and its contrast against adjacent color
   - hit-target box sizes for all icon buttons inside table rows
   - every CSS transition/animation duration and easing in use
   Save raw output to `ux-audit/measurements.json`.

## Phase 3 — Evaluate

**Open and actually look at every screenshot.** A rule you can only check visually must be checked visually.

Run three parallel review passes with subagents, each given the standard and the captured evidence:

- **Pass 1 — IA & navigation** against Part 4 §4.1–4.2 (rules 1–15)
- **Pass 2 — Visual system** against Part 3 (§3.1–3.7) plus rubric B1–B5
- **Pass 3 — Flows & feedback** against §4.3–4.6 (rules 16–47) plus the flow traces

Then a fourth pass yourself: **Motion**, against Part 5. This one needs code reading as well as screenshots — check what is animated, at what duration and easing, on which properties, and cross-reference against the frequency rule (§5.2). The single most likely defect: animation applied to interactions the team performs 100+ times a day.

For every finding produce:

```
[RULE ID] Severity · Screen/File · What is wrong · Evidence (screenshot or file:line or measured value) · What the standard requires
```

**Severity:** Critical (blocks or corrupts daily work) · High (daily friction) · Medium (noticeable) · Low (polish).

**Verification step — do this before writing the report.** Re-check every Critical and High finding against the actual evidence. Delete any finding you can't point to a screenshot, a file:line, or a measured number for. A finding you cannot prove is noise, and this report is worthless if the owner has to re-verify it.

## Phase 4 — Report

Write `ux-audit/AUDIT.md`:

1. **Scorecard** — the Part 6 rubric table, each row scored 0–4 with a one-line justification. Total /92.
2. **The five things making this hard to navigate** — the owner's actual complaint, answered directly. Each with the screen, the evidence, the rule it breaks, and why it costs time daily.
3. **Findings by area** — IA/Nav · Visual system · Flows · Feedback · Motion. Grouped, severity-tagged, evidence-linked.
4. **Proposed information architecture** — the nav as it should be, with the reasoning for every move, and what happens to each current route.
5. **Fix plan in three waves:**
   - **Wave 1 — high impact / low effort.** Token fixes, tabular-nums, focus rings, contrast, removing animation from high-frequency interactions, empty states. Each item: files to change, the specific change, rough effort.
   - **Wave 2 — structural.** Nav restructure, ⌘K, keyboard model, timesheet grid, side-panel entry, reconciliation strip in Reports.
   - **Wave 3 — polish.** Motion moments, density control, saved views, sparklines.
   Every item cites the rule ID it satisfies.
6. **Explicitly out of scope** — anything you checked that was already correct. Say so; the owner should know what not to touch.

Write `ux-audit/QUICK-WINS.md` separately: Wave 1 only, as a checklist a developer can work straight through, with exact file paths and code snippets using this project's actual tokens and components.

---

## Rules for this audit

- **Be blunt.** The owner already dislikes the UI. Your job is to name exactly why, with evidence — not to reassure. Praise only where something genuinely meets rubric level 4.
- **Never say "consider adding."** Say what is wrong, what the standard requires, and where the change goes.
- **No generic UX filler.** "Improve visual hierarchy" is not a finding. "Page headings and card titles are both 16px/600, so `screens/03-projects.png` has no level distinction — §3.1 requires page 28/36/400 and card 14/18/600" is a finding.
- **Cite the rule.** Every finding maps to a numbered rule, a `[FAIL IF]`, or a rubric row. If it maps to nothing in the standard, either it doesn't matter or the standard has a gap — say which.
- **Measure, don't estimate.** Contrast ratios, durations, row heights and target sizes come from `page.evaluate`, never from looking.
- **Change no application code.**
