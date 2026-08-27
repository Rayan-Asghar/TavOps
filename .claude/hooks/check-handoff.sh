#!/bin/bash
# Blocks the end of a turn if uncommitted changes are newer than HANDOFF.md.
input=$(cat)
[ "$(jq -r '.stop_hook_active // false' <<<"$input")" = "true" ] && exit 0

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0; }

newest=0
while IFS= read -r f; do
  case "$f" in ""|HANDOFF.md|PROGRESS.md|.claude/*) continue ;; esac
  t=$(mtime "$f"); [ "$t" -gt "$newest" ] && newest=$t
done < <(git status --porcelain | cut -c4- | sed 's/.* -> //')

[ "$newest" -gt "$(mtime HANDOFF.md)" ] || exit 0

jq -n '{decision: "block",
        reason: "Code changed this turn but HANDOFF.md was not updated. Overwrite HANDOFF.md (what was done, current state, files touched, exact next action) and update PROGRESS.md where facts changed, then finish."}'
