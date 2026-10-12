#!/bin/bash
# One setup for people and agents: the Node version .nvmrc pins, then exactly the dependencies
# package-lock.json pins. The agents' environment hooks run it: Claude Code on the web's
# SessionStart hook, Cursor's .cursor/environment.json, and the setup script of a Codex cloud
# environment (Copilot's copilot-setup-steps.yml installs the way CI does). A person can run it
# after cloning.
#
# Node: .nvmrc stays the one pin, which CI reads too. When the running node isn't the version it
# names (a major, or a full version), this installs that version with mise or nvm, whichever is
# installed, and runs the install with it first on PATH. With neither, it stops and says how to
# get one: an install under the wrong Node is the failure this exists to prevent. It never changes
# the global npm; when npm isn't the version package.json's packageManager pins, it says so.
#
# Dependencies: `npm ci` when node_modules is missing or older than package-lock.json, otherwise
# nothing. npm ci installs exactly what the lockfile pins and never rewrites it.
#
# --env-file <file>: also write the Node directory onto PATH in that file (once, quoted for the
# shell that sources it), so the session that follows runs the same Node. The SessionStart hook
# passes CLAUDE_ENV_FILE.
#
# Run from the repository root: bash scripts/setup.sh [--env-file <file>]
# Exit 0 when Node and the dependencies are in place, 1 when they couldn't be. One line on stdout
# says what it did; the tools' own output goes to stderr.
set -euo pipefail

env_file=
while [ $# -gt 0 ]; do
  case "$1" in
    --env-file)
      env_file="${2:?--env-file needs a path}"
      shift 2
      ;;
    *)
      echo "setup.sh: unknown argument $1; usage: bash scripts/setup.sh [--env-file <file>]" >&2
      exit 1
      ;;
  esac
done

# --- Node --------------------------------------------------------------------------------------

node_version() { node -p 'process.versions.node' 2>/dev/null || echo none; }
# "24" matches 24.x.y, "24.11" matches 24.11.x, "24.11.0" only itself.
matches() { [ "$1" = "$2" ] || [[ "$1" == "$2".* ]]; }

node_dir=
if [ -f .nvmrc ]; then
  want=$(tr -d ' \t\r\nv' < .nvmrc)
  if ! [[ "$want" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]]; then
    echo "setup.sh: .nvmrc says \"$want\", which isn't a version number; using node $(node_version) as it is." >&2
  elif ! matches "$(node_version)" "$want"; then
    have=$(node_version)
    if command -v mise > /dev/null; then
      if ! mise install "node@$want" >&2 || ! where=$(mise where "node@$want"); then
        echo "setup.sh: mise couldn't install Node $want." >&2
        exit 1
      fi
      node_dir="$where/bin"
    else
      # NVM_DIR names the one nvm when it's set; otherwise nvm's own default and the places
      # container images put it.
      nvm_sh=
      if [ -n "${NVM_DIR:-}" ]; then dirs=("$NVM_DIR"); else dirs=("$HOME/.nvm" /opt/nvm /usr/local/nvm); fi
      for dir in "${dirs[@]}"; do
        if [ -s "$dir/nvm.sh" ]; then
          nvm_sh="$dir/nvm.sh"
          break
        fi
      done
      if [ -z "$nvm_sh" ]; then
        echo "setup.sh: node is $have and .nvmrc pins $want, and neither mise nor nvm is installed to get it." >&2
        echo "Install one (https://mise.jdx.dev or https://github.com/nvm-sh/nvm), or Node $want itself, and run this again." >&2
        exit 1
      fi
      # nvm.sh isn't written for `set -eu`, and without --no-use, loading it tries the .nvmrc
      # version, which isn't installed yet, and returns 3.
      set +eu
      # shellcheck disable=SC1090 # whichever nvm.sh was found above
      . "$nvm_sh" --no-use
      nvm install "$want" >&2
      status=$?
      node_bin=$(nvm which "$want" 2>/dev/null)
      set -eu
      if [ "$status" -ne 0 ] || [ -z "$node_bin" ]; then
        echo "setup.sh: nvm ($nvm_sh) couldn't install Node $want (exit $status)." >&2
        exit 1
      fi
      node_dir=$(dirname "$node_bin")
    fi
    export PATH="$node_dir:$PATH"
    if ! matches "$(node_version)" "$want"; then
      echo "setup.sh: installed Node $want, but node in $node_dir is $(node_version)." >&2
      exit 1
    fi
    echo "setup.sh: node was $have; using $(node_version) from $node_dir, as .nvmrc pins." >&2
  fi
fi

if [ -n "$env_file" ] && [ -n "$node_dir" ]; then
  # shellcheck disable=SC2016 # "$PATH" is for the shell that sources the file, not this one
  line=$(printf 'export PATH=%q:"$PATH"' "$node_dir")
  if [ ! -f "$env_file" ] || ! grep -qxF -- "$line" "$env_file"; then
    printf '%s\n' "$line" >> "$env_file"
  fi
fi

if [ -f package.json ]; then
  pinned=$(node -p "(require('./package.json').packageManager || '').replace(/^npm@/, '')" 2>/dev/null || true)
  if [[ "$pinned" =~ ^[0-9] ]] && [ "$(npm --version 2>/dev/null || echo none)" != "$pinned" ]; then
    echo "setup.sh: npm is $(npm --version 2>/dev/null || echo missing) and package.json pins $pinned; CI installs it with npx -y npm@$pinned install -g npm@$pinned." >&2
  fi
fi

# --- Dependencies ------------------------------------------------------------------------------

if ! command -v npm > /dev/null; then
  echo "setup.sh: there's no npm on PATH (node is $(node_version)); install Node, which brings it, and run this again." >&2
  exit 1
fi

if [ -f node_modules/.package-lock.json ] && [ ! package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "Dependencies already match package-lock.json (node $(node_version))."
  exit 0
fi

npm ci --no-audit --no-fund >&2
echo "Installed dependencies with npm ci (node $(node_version)); npm run check is ready to run."
