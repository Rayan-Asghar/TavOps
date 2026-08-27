@AGENTS.md

# Session tracking
- After any task that changes code, config, migrations, or the plan, before your
  final message, do both:
  1. Overwrite HANDOFF.md (max 30 lines): what this turn did, current state
     (working / broken / mid-task at which step), files touched, and the exact
     next action with its done-condition.
  2. Update PROGRESS.md only where facts changed: feature status, verified
     state, decisions, next steps. Never append; keep it under 120 lines.
- Pure questions and explanations don't need updates.
- Never mark anything done in either file without saying how it was verified.
