@AGENTS.md

## Claude Code

Everything above is shared with every other agent. What's specific to Claude Code:

- **Skills:** `/bootstrap`, `/complete`, `/discovery`, `/plan-change`, `/root-cause`,
  `/review-change`, `/pre-pr`, `/verify` (which Claude Code runs before each commit),
  `/template-update`, and `/harvest`. They live in `.claude/skills/`, generated from `.agents/skills/` by
  `npm run skills:build`: edit the `.agents/` source, never the copy.
- **Hooks** (`.claude/settings.json`): an Edit or Write to a generated file is refused with the
  source to edit instead (`scripts/guard-generated.mjs`, the same guard every other agent's hooks
  run; ADR 0018), and on Claude Code on the web a SessionStart hook runs `scripts/setup.sh` (the
  Node `.nvmrc` pins, put on the session's PATH, then `npm ci` when `node_modules` is missing or
  older than the lockfile) and, when the environment ships its own Chromium, points
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE` at it for `npm run test:browser`
  (`.claude/hooks/session-start.sh`). A shell command can still write a generated file; CI's
  `npm run check:generated` catches that.
