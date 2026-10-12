# 0007. AGENTS.md holds the agent rules; CLAUDE.md imports it

- **Status:** Accepted — extended to this repo's own instructions by
  [0011](./0011-agent-portable-workflows.md)
- **Date:** 2026-09-24
- **Deciders:** template maintainers
- **Applies to:** the agent-instruction skeletons in `templates/project/`, new-project Phase 2.1,
  the `/bootstrap` and `/complete` commands, `process:apply`'s advice about a target's existing
  instruction files, and the new `check:instructions` lint. This repo's own `CLAUDE.md` is out
  of scope (see Consequences).

## Context

The template shipped one instruction skeleton, `CLAUDE.skeleton.md`, and told a new project to
write `CLAUDE.md` "or AGENTS.md". The sibling repos show how that goes:

| Repo | Instruction files | What each agent sees |
| --- | --- | --- |
| A (web app) | `CLAUDE.md` (402 lines) | Claude Code: everything. Codex, Cursor, Copilot, Gemini: nothing. |
| B (mobile app) | `AGENTS.md` (649 lines) | Codex and others: everything. Claude Code: only from v2.1.277, and not in sessions where AGENTS.md support is off. |
| C (skill pack) | `AGENTS.md` (49 lines) and `CLAUDE.md` (617 lines), no import | Claude Code reads only `CLAUDE.md`. The two files have different content, so each agent gets a different rulebook. |
| D (desktop app) | `.agent/` (rules, workflows, prompts) | Only the agent that reads `.agent/`. |

Claude Code's documentation (code.claude.com/docs/en/memory, read 2026-09-24) sets the
mechanics:

- By default, Claude reads `AGENTS.md` only when there's no `CLAUDE.md`, `.claude/CLAUDE.md`, or
  `CLAUDE.local.md` in the working directory or above it. If one exists, it reads "your
  `CLAUDE.md` files only".
- Reading `AGENTS.md` directly needs v2.1.277 or later. It's unavailable in some sessions (the
  built-in `agents-md` plugin disabled, the first session after an upgrade, and on older
  versions Bedrock or telemetry-off sessions).
- A `CLAUDE.md` containing `@AGENTS.md` loads it everywhere. The docs recommend this "when your
  project also has a `CLAUDE.md`". A symlink works too, but not on Windows checkouts without
  `core.symlinks`, and Claude's Edit and Write tools refuse to write through it.

The same repos show a second failure: instruction files rot. A path gets renamed and the
instructions keep naming the old one, a script is dropped from `package.json`, an import points
at a deleted file. Each still reads fine, so nobody notices until an agent follows it. Instruction
files are also where hidden text does the most damage: bidi overrides, zero-width characters, and
Unicode tag characters are invisible in review but still read by the model.

## Decision

We will make `AGENTS.md` the one file that holds a project's agent rules, and ship a `CLAUDE.md`
skeleton that is the `@AGENTS.md` import plus an optional Claude-Code-only section:

- `templates/project/AGENTS.skeleton.md` carries what `CLAUDE.skeleton.md` used to: project
  facts, commands, and the operating rules. The synced-block test now holds it and the
  new-project prompt to the same wording.
- `templates/project/CLAUDE.skeleton.md` is `@AGENTS.md` on the first line, then Claude Code
  notes.
- When a target already has rules, `process:apply` gives the prompts' advice. `AGENTS.md` is the
  file to merge into if there is one. Otherwise an existing project merges into the file it
  already uses, and a new project folds that file into a new `AGENTS.md`. It never suggests the
  personal `CLAUDE.local.md`. It also warns when a `CLAUDE.md` hides an `AGENTS.md` from Claude
  Code, using the same check as the lint below.

We will also add `scripts/check-instructions.mjs` (`npm run check:instructions`, `--root <repo>`
for a target). It reports:

- links, `@` imports, and code-span paths that don't resolve;
- `npm|pnpm|yarn|bun run` scripts that aren't in the nearest `package.json`;
- hidden characters;
- the failure this ADR exists for: an `AGENTS.md` that a `CLAUDE.md` hides because nothing
  imports it or links to it. Imports are resolved the way Claude Code resolves them, relative
  to the importing file and outside code blocks.

It exits 2 when it finds no instruction files, because examining nothing isn't a pass. The
heuristics were calibrated on the sibling repos, read-only. Early versions reported 13 findings in
A and C, and every one was a false positive: package names in prose, CSS class
lists, a path given in the context of its parent directory, an ellipsis, single-segment directory
mentions, and gitignored build directories. On this repo they also flagged an ESLint rule name.
The shipped version reports none of those. What it does report, all executed:

- A and B: nothing.
- C: one finding, `hides-agents`, which is true.
- D's `.agent/`: 19 findings, and 17 are real. Two workflows are referenced but don't
  exist, a knowledge doc three workflows point at is missing, and four test and fixture paths are
  gone. Eight control characters sit in a design-rules file, where `\b` and `\r` sequences were
  decoded into a backspace and a carriage return: `border-slate-200` now reads as
  backspace + "order-slate-200". The other 2 are example paths in a PR-prompt template, which
  belong in a fenced block.

Each finding kind, and each case it deliberately skips, is pinned by a test. Each test fails when
the mechanism behind it is disabled or reverted to the first version.

## Alternatives considered

### Alternative: keep CLAUDE.md as the rules file, and point other agents at it

This means an `AGENTS.md` that says "see CLAUDE.md", or a symlink from `AGENTS.md` to `CLAUDE.md`.
It lost because other agents don't follow a prose pointer, and the symlink breaks on Windows
checkouts. `AGENTS.md` is the name the other tools already read; Claude Code is the one tool that
needs an extra step, and the documented step is a one-line import.

### Alternative: rely on Claude Code reading AGENTS.md directly, with no CLAUDE.md

This needs no second file. It lost because it depends on the Claude Code version and session
type, and because one `CLAUDE.local.md` on a contributor's machine silently switches it off for
them. The docs call this out. An import works under every setting.

### Alternative: a symlink `CLAUDE.md -> AGENTS.md`

This needs no second file to maintain. It lost on Windows checkouts, where the link arrives as a
one-line text file, and because it leaves no place for Claude-Code-only notes.

### Alternative: generate each tool's file from one source at build time

This needs a generator, a build step in every target, and a rule never to hand-edit the outputs.
That's heavy machinery for a problem an import already solves.

## Consequences

- **Easier:** Codex, Cursor, Copilot, Gemini, and Claude Code read one rulebook. The
  B-style repo (only `AGENTS.md`) works in every Claude Code session once a `CLAUDE.md`
  with the import is added. The C-style split (two files, no import) gets flagged by
  `process:apply` and the audit instead of going unnoticed.
- **Harder:** a new project has two instruction files instead of one, though one of them is a
  single line plus optional notes. An existing project whose rules live in `CLAUDE.md` isn't
  moved. The existing-project prompt merges into the file the target already uses, as before.
- **This repo:** the template's own `CLAUDE.md` stays as it is. It's this repo's instructions,
  mostly specific to the template (tokens, Storybook, the rebrand workflow), and moving it would
  touch every doc that cites it. The new lint runs against it in `npm run test`.
- **Revisit if:** Claude Code reads `AGENTS.md` alongside `CLAUDE.md` by default, which would
  make the import redundant, or the other agents converge on a different shared file name.
