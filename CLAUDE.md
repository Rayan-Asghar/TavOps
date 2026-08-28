@AGENTS.md

## Session Continuity Protocol

- At session start: read HANDOFF.md, summarize it back in 3-5 lines
  (goal / state / next step), and ask me "continue or new direction?"
  before touching any code.
- When I say "wrap up", "handoff", or "end session": archive the old
  HANDOFF.md to .claude/handoff-history/, rewrite HANDOFF.md with
  current state, append an entry to PROGRESS.md, then stop working.
- Log every failed approach in HANDOFF.md immediately when it fails,
  not at wrap-up.
- HANDOFF.md over 100 lines = rewrite it keeping only what the next
  session needs to act.
- Never scan the whole repo to rediscover state. HANDOFF.md +
  PROGRESS.md + CLAUDE.md are the source of truth for project state.
