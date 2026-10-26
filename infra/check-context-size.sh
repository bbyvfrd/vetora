#!/usr/bin/env bash
# The context files' size budget (the 2026-10-26 retro): every AGENTS.md stays at 12 KiB or less, since an agent
# carries the root one on every turn and a workspace's whenever it works there. Reference that outgrows it moves into
# a doc the file points at (apps/api/docs/, docs/agents/), the way apps/api/docs/database.md and auth.md did.
# Run by pnpm lint (and so by CI) and by the pre-commit hook.
set -euo pipefail

BUDGET=12288
cd "$(git rev-parse --show-toplevel)"

status=0
while IFS= read -r file; do
  [ -f "$file" ] || continue
  size=$(wc -c <"$file" | tr -d ' ')
  if [ "$size" -gt "$BUDGET" ]; then
    echo "$file is $size bytes, over the $BUDGET byte budget of a context file: move reference into a doc it points at" >&2
    status=1
  fi
done < <(git ls-files -- 'AGENTS.md' '*/AGENTS.md' ':(exclude).agents/**')
exit "$status"
