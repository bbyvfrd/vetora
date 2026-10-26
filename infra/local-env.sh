#!/usr/bin/env bash
# The local environment of one checkout, so the main checkout and every worktree under .claude/worktrees run side by
# side (AGENTS.md, "Worktrees"; the sources are docs/research/2026-10-26-worktrees-for-parallel-sessions.md).
#
# Each checkout holds a slot: 0 is the main checkout, a linked worktree takes the lowest free number from 1. The slot
# fixes every port (API 3000+n, web 5173+n, Postgres 5432+n, S3 8333+n) and the Compose project (vetora, then
# vetora-s<n>), so two checkouts never share a port or a database cluster (the API's tests reset vetora_test and
# create cluster wide roles). The slot lives in the checkout's own .env, which git ignores, so it stays for the life
# of the worktree and goes with it. compose.yaml and apps/clinic-web/vite.config.ts read that .env; the API reads
# apps/api/.env, written here from .env.example with the slot's ports; .claude/launch.json tells the Claude app's
# browser preview where the two servers listen.
#
# Usage: infra/local-env.sh <command> [options]      (pnpm local:setup | local:status | local:destroy | local:gc)
#   setup [--up] [--force] [--quiet] [--no-install]
#                   write .env, apps/api/.env and .claude/launch.json for this checkout, install dependencies when
#                   the lockfile is newer than node_modules; --up also starts this checkout's Postgres and S3;
#                   --force rewrites an apps/api/.env that already exists
#   status          the slot, its ports and Compose project, and whether its containers run
#   destroy         stop this checkout's containers and delete their volumes (its databases go with them)
#   gc              the sweep: a worktree whose branch landed on main (commits of its own, merged or its tip a merged
#                   pull request's head), with nothing uncommitted and no live session holding it, goes with its branch
#                   and Compose project (prototype/* branches stay); locks whose session is gone are released; Compose
#                   projects whose worktree is gone are removed; stale worktree records are pruned
#   session-start   Claude Code's SessionStart hook (.claude/settings.json): setup, --up inside a worktree when
#                   Docker runs, the sweep, then one or two lines of context on stdout for the agent
#   session-end     Claude Code's SessionEnd hook: the sweep, silently
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
MAX_SLOT=9
UP=0
FORCE=0
QUIET=0
INSTALL=1

die() { echo "local-env: $*" >&2; exit 1; }
note() { [ "$QUIET" = 1 ] || echo "$*"; }
usage() { sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

git_root() { git -C "$ROOT" "$@"; }

# True in a linked worktree: its .git is a file pointing into the main checkout's .git/worktrees/<name>.
is_linked_worktree() {
  local gitdir common
  gitdir=$(cd "$(git_root rev-parse --git-dir)" && pwd -P)
  common=$(cd "$(git_root rev-parse --git-common-dir)" && pwd -P)
  [ "$gitdir" != "$common" ]
}

# env_value <file> <NAME>: the value of NAME= in a dotenv file, or nothing.
env_value() {
  if [ -f "$1" ]; then sed -n "s/^$2=//p" "$1" | tail -1; fi
}

# The slots the other checkouts hold: VETORA_SLOT from the .env of every worktree git knows about.
used_slots() {
  git_root worktree list --porcelain | sed -n 's/^worktree //p' | while IFS= read -r path; do
    [ "$path" = "$ROOT" ] && continue
    env_value "$path/.env" VETORA_SLOT
  done
}

port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1; }

# set_ports <slot>: the globals every command uses.
set_ports() {
  SLOT=$1
  API_PORT=$((3000 + SLOT))
  WEB_PORT=$((5173 + SLOT))
  PG_PORT=$((5432 + SLOT))
  S3_PORT=$((8333 + SLOT))
  if [ "$SLOT" = 0 ]; then PROJECT=vetora; else PROJECT="vetora-s$SLOT"; fi
}

# The slot of this checkout: the one its .env records, else 0 in the main checkout, else the lowest number no other
# worktree holds and whose four ports nothing listens on.
choose_slot() {
  local current used n p busy
  current=$(env_value "$ROOT/.env" VETORA_SLOT)
  if [ -n "$current" ]; then set_ports "$current"; return; fi
  if ! is_linked_worktree; then set_ports 0; return; fi
  used=$(used_slots)
  n=1
  while [ "$n" -le "$MAX_SLOT" ]; do
    if ! printf '%s\n' "$used" | grep -qx "$n"; then
      set_ports "$n"
      busy=""
      for p in "$API_PORT" "$WEB_PORT" "$PG_PORT" "$S3_PORT"; do
        if port_busy "$p"; then busy="$busy $p"; fi
      done
      if [ -z "$busy" ]; then return; fi
      note "slot $n skipped: something else listens on$busy"
    fi
    n=$((n + 1))
  done
  die "no free slot (1 to $MAX_SLOT are taken): pnpm local:gc, or remove a worktree you are done with"
}

write_root_env() {
  cat > "$ROOT/.env" <<ENV
# Written by pnpm local:setup (infra/local-env.sh) for this checkout; git ignores it. Compose and Vite read it.
# Slot $SLOT: 0 is the main checkout, a worktree gets the lowest free number; every port is the default plus the slot.
VETORA_SLOT=$SLOT
COMPOSE_PROJECT_NAME=$PROJECT
VETORA_POSTGRES_PORT=$PG_PORT
VETORA_S3_PORT=$S3_PORT
VETORA_API_PORT=$API_PORT
VETORA_WEB_PORT=$WEB_PORT
ENV
}

# apps/api/.env from .env.example with the slot's ports; an existing file is kept (and checked) unless --force.
write_api_env() {
  local file="$ROOT/apps/api/.env" example="$ROOT/apps/api/.env.example" current
  if [ -f "$file" ] && [ "$FORCE" != 1 ]; then
    current=$(env_value "$file" PORT)
    if [ "${current:-3000}" != "$API_PORT" ]; then
      echo "local-env: apps/api/.env says PORT=${current:-3000} but this checkout is slot $SLOT (API $API_PORT); pnpm local:setup --force rewrites it" >&2
    fi
    # A variable the example gained since the file was written (BETTER_AUTH_SECRET with feature 5) stops the API at
    # startup; name it here first.
    local key
    for key in $(sed -n 's/^\([A-Z_][A-Z0-9_]*\)=.*/\1/p' "$example"); do
      if ! grep -q "^$key=" "$file"; then
        echo "local-env: apps/api/.env lacks $key, which .env.example has; pnpm local:setup --force rewrites it" >&2
      fi
    done
    return
  fi
  sed -e "s/^PORT=.*/PORT=$API_PORT/" \
    -e "s#^PUBLIC_ORIGIN=.*#PUBLIC_ORIGIN=http://localhost:$WEB_PORT#" \
    -e "s/localhost:5432/localhost:$PG_PORT/g" "$example" > "$file"
}

# .claude/launch.json: the Claude app starts the dev servers from it and opens its browser on these ports.
write_launch_json() {
  mkdir -p "$ROOT/.claude"
  cat > "$ROOT/.claude/launch.json" <<JSON
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "api",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["--filter", "@vetora/api", "dev"],
      "port": $API_PORT
    },
    {
      "name": "web",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["--filter", "@vetora/clinic-web", "dev"],
      "port": $WEB_PORT
    }
  ]
}
JSON
}

node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
node_ok() { command -v node >/dev/null 2>&1 && [ "$(node_major)" -ge 24 ] 2>/dev/null; }

# Node 24 (.nvmrc): a hook or a fresh shell may start with another version first on PATH, or none.
ensure_node() {
  if node_ok; then return; fi
  local dir
  for dir in "$HOME"/.nvm/versions/node/v24*/bin; do
    if [ -x "$dir/node" ]; then
      export PATH="$dir:$PATH"
      if node_ok; then return; fi
    fi
  done
  die "Node 24 is needed (.nvmrc) and none was found on PATH or under ~/.nvm"
}

install_deps() {
  [ "$INSTALL" = 1 ] || return 0
  if [ -f "$ROOT/node_modules/.modules.yaml" ] && [ ! "$ROOT/pnpm-lock.yaml" -nt "$ROOT/node_modules/.modules.yaml" ]; then
    return 0
  fi
  ensure_node
  command -v pnpm >/dev/null 2>&1 || die "pnpm is needed: corepack enable, or npm i -g pnpm"
  note "installing dependencies: pnpm install --frozen-lockfile"
  if [ "$QUIET" = 1 ]; then
    pnpm -C "$ROOT" install --frozen-lockfile --reporter=silent
  else
    pnpm -C "$ROOT" install --frozen-lockfile
  fi
}

compose() { docker compose --project-directory "$ROOT" -f "$ROOT/compose.yaml" "$@"; }
docker_ok() { docker info >/dev/null 2>&1; }
running_services() { compose ps --status running --format '{{.Service}}' 2>/dev/null | tr '\n' ' ' | sed 's/ $//'; }

print_status() {
  local kind="main checkout" running
  if is_linked_worktree; then kind="worktree"; fi
  echo "slot $SLOT ($kind): API http://localhost:$API_PORT, web http://localhost:$WEB_PORT, Postgres localhost:$PG_PORT, S3 localhost:$S3_PORT, Compose project $PROJECT"
  if docker_ok; then
    running=$(running_services)
    echo "containers running: ${running:-none} (pnpm local:up starts them, pnpm local:destroy removes them with their data)"
  else
    echo "Docker is not running"
  fi
}

cmd_setup() {
  choose_slot
  write_root_env
  write_api_env
  write_launch_json
  install_deps
  if [ "$UP" = 1 ]; then
    if docker_ok; then
      if [ "$QUIET" = 1 ]; then compose up -d --wait >/dev/null; else compose up -d --wait; fi
    else
      note "Docker is not running: start it, then pnpm local:up"
    fi
  fi
  print_status
}

cmd_status() {
  if [ -z "$(env_value "$ROOT/.env" VETORA_SLOT)" ]; then
    choose_slot
    echo "not set up yet: pnpm local:setup would take slot $SLOT"
  else
    choose_slot
  fi
  print_status
}

cmd_destroy() {
  [ -f "$ROOT/.env" ] || die "no .env in this checkout, so nothing of it runs"
  docker_ok || die "Docker is not running"
  compose down -v --remove-orphans
}

project_of() { env_value "$1/.env" COMPOSE_PROJECT_NAME; }
compose_down_project() { docker compose -p "$1" down -v --remove-orphans >/dev/null 2>&1 || true; }
lock_pid() { printf '%s' "$1" | sed -n 's/.*pid \([0-9][0-9]*\).*/\1/p'; }

# has_own_commits <branch>: its reflog records a commit made on it (a commit, an amend, a merge commit, a cherry-pick
# or a revert). Being created, fast-forwarded to main or reset makes none: such a branch holds no work of its own.
# grep reads to the end (no -q), so pipefail never sees git stopped by a closed pipe.
has_own_commits() {
  git_root reflog show --format=%gs "refs/heads/$1" -- 2>/dev/null |
    grep -E '^(commit|cherry-pick|revert)( \([a-z]+\))?: |: Merge made by ' >/dev/null
}

# branch_landed <branch>: it has commits of its own, and is merged into main or its tip is the head of a merged pull
# request (a squash merge leaves no ancestor). A branch with none has nothing to land, though it is an ancestor of
# main from the moment it is cut: the worktree of a session that has not committed yet. A merged pull request under
# the branch's name with another head landed something else: the name reused, or commits made after the merge.
branch_landed() {
  local tip n
  has_own_commits "$1" || return 1
  if git_root merge-base --is-ancestor "refs/heads/$1" main 2>/dev/null; then return 0; fi
  if command -v gh >/dev/null 2>&1; then
    tip=$(git_root rev-parse "refs/heads/$1")
    n=$(cd "$ROOT" && gh pr list --head "$1" --state merged --json headRefOid \
      --jq "map(select(.headRefOid == \"$tip\")) | length" 2>/dev/null) || n=0
    if [ "${n:-0}" -gt 0 ]; then return 0; fi
  fi
  return 1
}

# sweep_one <path> <branch> <is_locked> <lock_reason>: one worktree of the list; prints only what it did or left.
sweep_one() {
  local path=$1 branch=$2 is_locked=$3 reason=$4 real pid project
  [ -d "$path" ] || return 0
  real=$(cd "$path" && pwd -P)
  [ "$real" = "$MAIN_PATH" ] && return 0
  [ -z "$branch" ] && return 0
  case $branch in prototype/*) return 0 ;; esac
  if [ "$is_locked" = 1 ]; then
    pid=$(lock_pid "$reason")
    if [ -n "$pid" ] && ! ps -p "$pid" >/dev/null 2>&1; then
      git_root worktree unlock "$path" 2>/dev/null && echo "unlocked $path: the session that held it (process $pid) is gone"
    else
      return 0
    fi
  fi
  branch_landed "$branch" || return 0
  if [ -n "$(git -C "$path" status --porcelain 2>/dev/null)" ]; then
    echo "$branch has landed on main, but $path has uncommitted changes: left in place"
    return 0
  fi
  if [ "$real" = "$ROOT" ]; then
    echo "$branch has landed on main, but this checkout runs the sweep: pnpm local:gc from the main folder removes it"
    return 0
  fi
  project=$(project_of "$path")
  if [ -n "$project" ] && docker_ok; then compose_down_project "$project"; fi
  if git_root worktree remove "$path" 2>/dev/null; then
    git_root branch -D "$branch" >/dev/null 2>&1 || true
    echo "removed $path with its branch $branch${project:+ and Compose project $project}: its work has landed on main"
  else
    echo "$branch has landed on main, but git refused to remove $path: git worktree remove --force '$path'"
  fi
}

# Every worktree git lists, one block of porcelain each (the first block is the main checkout).
sweep_landed_worktrees() {
  local line path="" branch="" is_locked=0 reason=""
  MAIN_PATH=$(cd "$(git_root worktree list --porcelain | sed -n '1s/^worktree //p')" && pwd -P)
  git_root worktree list --porcelain | {
    while IFS= read -r line || [ -n "$line" ]; do
      case $line in
        "worktree "*) path=${line#worktree } ;;
        "branch refs/heads/"*) branch=${line#branch refs/heads/} ;;
        locked*) is_locked=1; reason=${line#locked}; reason=${reason# } ;;
        "") sweep_one "$path" "$branch" "$is_locked" "$reason"; path=""; branch=""; is_locked=0; reason="" ;;
      esac
    done
    if [ -n "$path" ]; then sweep_one "$path" "$branch" "$is_locked" "$reason"; fi
    true
  }
}

cmd_gc() {
  local used own name n
  git_root worktree prune
  sweep_landed_worktrees
  used=$(used_slots)
  own=$(env_value "$ROOT/.env" VETORA_SLOT)
  if docker_ok; then
    for name in $(docker compose ls -a -q | grep '^vetora-s[0-9][0-9]*$' || true); do
      n=${name#vetora-s}
      if [ "$n" = "${own:-}" ] || printf '%s\n' "$used" | grep -qx "$n"; then continue; fi
      compose_down_project "$name"
      echo "removed Compose project $name: no worktree holds slot $n"
    done
  else
    echo "Docker is not running: Compose projects not checked"
  fi
}

cmd_session_end() {
  [ -t 0 ] || cat >/dev/null
  cmd_gc >/dev/null 2>&1 || true
}

# The checkout a hook is about: the `cwd` field of the JSON on stdin. In a worktree session started from the Claude app
# the hook command runs in the main checkout (project settings are read from there), and only that field names the
# worktree, so a request for another checkout is handed to that checkout's own copy of this script.
hook_cwd() {
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$1" | jq -r '.cwd // empty' 2>/dev/null || true
  else
    printf '%s' "$1" | sed -n 's/.*"cwd" *: *"\([^"]*\)".*/\1/p'
  fi
}

cmd_session_start() {
  local input="" target=""
  if [ ! -t 0 ]; then input=$(cat); fi
  target=$(hook_cwd "$input")
  if [ -n "$target" ] && [ -d "$target" ]; then
    target=$(git -C "$target" rev-parse --show-toplevel 2>/dev/null || true)
  fi
  if [ -n "$target" ] && [ "$(cd "$target" && pwd -P)" != "$ROOT" ]; then
    if [ -x "$target/infra/local-env.sh" ]; then
      exec "$target/infra/local-env.sh" session-start </dev/null
    fi
    echo "vetora local environment: $target predates infra/local-env.sh (its branch was cut before the worktree rules landed), so nothing was set up. Rebase it onto main, then run pnpm local:setup --up there. Rules: AGENTS.md, Worktrees."
    exit 0
  fi
  QUIET=1
  choose_slot
  write_root_env
  write_api_env
  write_launch_json
  install_deps
  local running="" started=""
  if docker_ok; then
    if is_linked_worktree; then compose up -d --wait >/dev/null 2>&1 && started=", started now" || true; fi
    running=$(running_services)
  fi
  echo "vetora local environment, slot $SLOT: API http://localhost:$API_PORT, web http://localhost:$WEB_PORT, Postgres localhost:$PG_PORT, Compose project $PROJECT (running: ${running:-none}$started; pnpm local:up starts it). .env, apps/api/.env and .claude/launch.json match this slot and dependencies are installed. Rules: AGENTS.md, Worktrees."
  local swept
  swept=$(cmd_gc 2>/dev/null | grep -v '^Docker is not running' || true)
  if [ -n "$swept" ]; then echo "Worktree sweep: $swept"; fi
}

CMD=${1:-}
if [ $# -gt 0 ]; then shift; fi
for arg in "$@"; do
  case $arg in
    --up) UP=1 ;;
    --force) FORCE=1 ;;
    --quiet) QUIET=1 ;;
    --no-install) INSTALL=0 ;;
    *) die "unknown option $arg" ;;
  esac
done
case $CMD in
  setup) cmd_setup ;;
  status) cmd_status ;;
  destroy) cmd_destroy ;;
  gc) cmd_gc ;;
  session-start) cmd_session_start ;;
  session-end) cmd_session_end ;;
  *) usage; exit 1 ;;
esac
