# 0011. Workflows are Agent Skills, and this repo's rules live in AGENTS.md

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** template maintainers
- **Applies to:** `.agents/skills/`, the generated `.claude/skills/`, this repo's `AGENTS.md` and
  `CLAUDE.md`, `.gemini/settings.json`, `.claude/settings.json` and its hooks,
  `process:apply`'s delivery, and `check:instructions`. It replaces the `.claude/commands/`
  delivery that ADRs 0002 and 0006 describe, and ends the exception ADR 0007 made for this
  repo's own `CLAUDE.md`.

## Context

The template assumes AI-driven development, by more than one agent. Before this decision:

- **Only Claude Code could run the workflows.** They were Claude Code slash commands
  (`.claude/commands/*.md`), with `$ARGUMENTS` in their text. Every other agent had to be
  told to open a prompt file.
- **Only Claude Code read this repo's rules.** They were in `CLAUDE.md`, and there was no
  `AGENTS.md`. Codex, Antigravity, Cursor, and Copilot started here with nothing.
- **Golden rule 1 (never hand-edit generated files) was enforced only after the fact.** CI's
  drift gate failed the PR; nothing stopped the edit.
- **A cloud session started without `node_modules`,** so the gate couldn't run until the agent
  worked out the install.

Checked against each vendor's current documentation (2026-09-24):

- `.agents/skills/<name>/SKILL.md` is the project skills path that Codex, Antigravity, Gemini
  CLI, Cursor, and Copilot share. Claude Code reads only `.claude/skills/`.
- Claude Code has merged commands into skills. A skill of the same name wins, and arguments
  are appended when a skill has no `$ARGUMENTS`.
- `AGENTS.md` is read natively by Codex, Antigravity, Cursor, and Copilot. Claude Code reads
  it through a `CLAUDE.md` import (ADR 0007). Gemini CLI reads it only when
  `.gemini/settings.json` names it in `context.fileName`.
- Antigravity reads at most 24,000 bytes of a rules file, and Codex 32 KiB. Antigravity's
  workflows stop working on 2026-10-19 in favor of skills (corrected on 2026-10-07 from
  Antigravity's migration guide; this said 2026-11-01).

## Decision

- **Workflows are Agent Skills.** Each lives once, in `.agents/skills/<name>/SKILL.md`,
  written to the specification: `name` and `description` only, and any tool-specific setting
  under `metadata`. The text says "what was given with the request" instead of `$ARGUMENTS`.
- **Claude Code gets a generated copy.** `npm run skills:build` writes `.claude/skills/`,
  promoting `metadata.argument-hint` to Claude Code's field. The copy is a generated output:
  the drift gate checks it, and the guard hook refuses edits to it. `.claude/commands/` is
  gone.
- **This repo's rules move to `AGENTS.md`,** under 24,000 bytes, which the lint enforces.
  `CLAUDE.md` is the `@AGENTS.md` import plus Claude Code's own notes: the pattern ADR 0007
  prescribed for targets.
- **`.gemini/settings.json` points Gemini CLI at `AGENTS.md`.** New-project Phase 2.1 gives
  targets the same line.
- **Claude Code hooks enforce what they can:**
  - a PreToolUse hook refuses an Edit or Write to a generated path and names the source and
    build to use instead;
  - on Claude Code on the web, a SessionStart hook runs `npm ci` when `node_modules` is
    missing or older than the lockfile.

  Other agents keep the CI gates, and `AGENTS.md` tells them how to set up.
- **`process:apply` delivers the skills live,** to both skill paths. A target's `.claude/commands/`
  from an earlier run is removed if untouched and reported if edited, by the existing rule for
  files the template dropped.
- **`check:instructions` covers the new surface:**
  - skill directories, validated against the specification;
  - an `AGENTS.md` over 24,000 bytes;
  - a repo that uses Gemini without pointing it at `AGENTS.md`.

  Skill directories aren't counted as a target's own rules.

## Alternatives considered

### Alternative: keep slash commands and add a per-tool copy for each agent

Codex custom prompts, Antigravity workflows, Cursor commands, Copilot prompt files. It lost
because each is a different format that drifts separately. Codex's and Antigravity's are
deprecated in favor of skills, and Cursor's command documentation now redirects to skills.
One standard read from one path by five agents beats five formats.

### Alternative: symlink `.claude/skills` to `.agents/skills`

No generated copy, no drift gate. Claude Code follows symlinked skill folders. It lost for the
reason ADR 0007 rejected a symlinked CLAUDE.md: a Windows checkout without `core.symlinks` turns
the link into a one-line text file, and Claude Code then sees no skills at all.

### Alternative: a hook for every agent

Deterministic enforcement everywhere. It lost because hook support, formats, and events differ
by agent, and only Claude Code's were verified for this decision. The CI gates are the
enforcement every agent shares; a hook is an earlier, friendlier copy of one where it's
available.

## Consequences

- **Easier:**
  - Any of the six agents can run the workflows by name.
  - A target gets them from one `process:apply`.
  - An agent that edits a generated file in Claude Code is corrected before CI has to fail.
- **Harder:**
  - A skill edit needs `npm run skills:build`, like a token edit.
  - In a target, where there's no build, the two copies are kept identical by hand, and the
    skeleton says so.
  - `AGENTS.md` has a byte budget. (Since ADR 0020, the budget is the strictest limit among the
    agents a project selects in `.agents/platforms.json`; 24,000 bytes only without a selection.)
- **Revisit** when Claude Code reads `.agents/skills/`: then the generated copy goes. Also
  revisit when another agent's repository hooks are verified: the guard can be wired up there
  too. (Done for every agent with hooks: ADR 0018.)
