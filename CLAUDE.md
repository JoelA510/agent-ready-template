@AGENTS.md

## Claude Code

Everything above is shared with every other agent. What's specific to Claude Code:

- **Skills:** `/bootstrap`, `/complete`, `/discovery`, `/plan-change`, `/root-cause`,
  `/review-change`, `/pre-pr`, `/verify` (run before each commit), `/template-update`, and
  `/harvest`, in `.claude/skills/`, generated from `.agents/skills/` by `npm run skills:build`:
  edit the `.agents/` source, never the copy.
- **Hooks** (`.claude/settings.json`): an Edit or Write to a generated file is refused, naming the
  source (`scripts/guard-generated.mjs`, ADR 0018); a shell write still gets past it, and CI's
  `npm run check:generated` catches that. On Claude Code on the web, the SessionStart hook
  (`.claude/hooks/session-start.sh`) runs `scripts/setup.sh` and points
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE` at the environment's own Chromium when it ships one.
