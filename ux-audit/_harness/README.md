# Audit harness

Re-run to score the delta after each wave. Requires the dev server on :3000 and
`@playwright/test` (already a devDependency).

```bash
node ux-audit/_harness/capture.mjs ux-audit   # 24 screenshots + measurements.json
node ux-audit/_harness/keyboard.mjs           # tab order, focus visibility, cmd-K
node ux-audit/_harness/focus-ring.mjs         # proves whether the ring animates in
```

`capture.mjs` measures per route: font sizes, weights, radii, transitions, computed
contrast for every text node against its effective background, table row metrics,
hit-target sizes, and `tabular-nums` coverage.

Captures run against `next dev`, so the Next.js dev indicator appears bottom-left in
every screenshot and adds one phantom tab stop. Run against `pnpm build && pnpm start`
for clean captures.
