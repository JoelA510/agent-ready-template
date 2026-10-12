#!/bin/bash
# Copies the template's prompts into the empty workspace, so the skill finds the prompt it runs.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
if [ ! -f "$root/prompts/plan-change.md" ]; then
  echo "fixture.sh: no prompts/ under $root; run claude plugin eval from the template's root" >&2
  exit 1
fi
cp -R "$root/prompts" ./prompts
# The README the request names, with its typo.
printf '# Widgets\n\n## Install\n\nRun the installer, and you will recieve the latest build.\n' > README.md
