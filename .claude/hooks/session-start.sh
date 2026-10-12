#!/bin/bash
# Claude Code on the web starts from a fresh clone, so set up before the session begins: without
# the pinned Node and the dependencies, the gate (npm run check) can't run. Local sessions skip
# this.
#
# The setup is scripts/setup.sh, which every agent's environment shares: the Node .nvmrc pins
# (installed with mise or nvm when the container's is another version, and put on the session's
# PATH through its env file), then `npm ci` when node_modules is missing or older than the
# lockfile. Idempotent: on a resumed or cached container it does nothing new, and each line it
# adds to the env file is written once. Tool output goes to stderr: a SessionStart hook's stdout
# is added to the agent's context.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi
cd "${CLAUDE_PROJECT_DIR:?}"

# Browser tests (npm run test:browser) launch Playwright's Chromium. When the environment ships
# its own under $PLAYWRIGHT_BROWSERS_PATH (and may not allow downloading another), point
# Playwright at it for the session. The env file is sourced by a shell, so the path is quoted
# for one (%q), whatever characters it holds.
chromium="${PLAYWRIGHT_BROWSERS_PATH:-}/chromium"
if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -z "${PLAYWRIGHT_CHROMIUM_EXECUTABLE:-}" ] &&
  [ -n "${PLAYWRIGHT_BROWSERS_PATH:-}" ] && [ -f "$chromium" ] && [ -x "$chromium" ]; then
  line=$(printf 'export PLAYWRIGHT_CHROMIUM_EXECUTABLE=%q' "$chromium")
  if [ ! -f "$CLAUDE_ENV_FILE" ] || ! grep -qxF -- "$line" "$CLAUDE_ENV_FILE"; then
    printf '%s\n' "$line" >> "$CLAUDE_ENV_FILE"
  fi
fi

# The setup script beside this hook's own checkout, run on the project.
setup="$(dirname "${BASH_SOURCE[0]}")/../../scripts/setup.sh"
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  exec bash "$setup" --env-file "$CLAUDE_ENV_FILE"
fi
exec bash "$setup"
