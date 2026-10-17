# 0020. Instruction files are wired and sized for the agents a project selects

- **Status:** Accepted
- **Date:** 2026-10-14
- **Deciders:** template maintainers (on the maintainer's request to stop treating one agent's
  limit as every project's)
- **Applies to:** `scripts/agent-platforms.mjs` (the registry), a project's
  `.agents/platforms.json` (the selection), `scripts/check-instructions.mjs`'s `size` and
  `platforms` findings and its notes, `prompts/agent-platforms.md`, the new-project and
  existing-project prompts and the skills that run them, the AGENTS and CLAUDE skeletons,
  `npm run init --platforms`, and what `process:apply` reports. It refines ADR 0011's
  "`AGENTS.md` has a byte budget" without changing which agents the template ships wiring for.

## Context

ADR 0011 held every `AGENTS.md` and `GEMINI.md` to 24,000 bytes, Antigravity's per-file limit,
because the template set out to serve six agents at once and Antigravity's was the strictest
limit documented. Every project inherited that ceiling and the wiring for all six (a CLAUDE.md, a
`.gemini/settings.json`), whichever agents it used. Most projects use one or two, usually Claude
Code or Codex, and Antigravity is the least used of the six.

The limits differ in kind, not only in size. Read from each vendor's documentation on 2026-10-14:

| Agent | Reads AGENTS.md | Hard limit | Guidance |
| --- | --- | --- | --- |
| Claude Code | through a CLAUDE.md import (or directly when there's no CLAUDE.md) | 4 MiB per file, skipped past it | under 200 lines, imports included |
| Codex | natively | 32 KiB for all AGENTS.md files from the root down, combined | none |
| Cursor | natively | none documented | "Keep rules under 500 lines" |
| GitHub Copilot | natively (cloud agent, code review, CLI, Chat in VS Code) | none documented | "about 1,000 lines" per file |
| Gemini CLI | when `context.fileName` names it | none documented | none |
| Antigravity | natively | 24,000 bytes per file, truncated past it | none |

Sources, per row, are in `scripts/agent-platforms.mjs`. For a project that uses only Claude Code
and Codex, the 24,000-byte ceiling was a limit neither agent has, while Claude Code's own advice,
200 lines, went unmentioned. This repository's AGENTS.md sat 75 bytes under the ceiling.

## Decision

We will size and wire instruction files for the agents each project selects. The template keeps a
registry of the agents it knows: for each, the files it reads, how AGENTS.md reaches it, its
documented hard limit and what happens past it (or null), any documented guidance length, its
skills and hooks locations, and the URL and date each fact was read. A project records its agents
in `.agents/platforms.json`, which it owns (`process:apply` never writes it). `check:instructions`
holds each shared file to the smallest hard limit among the selected agents that read it, reports
a guidance length as a note and never a failure, and validates the selection. An agent the
registry doesn't have is researched from its vendor's documentation into the selection's `custom`
list, every fact with its source and date and anything not found left null, never guessed. With no
selection, the check behaves as before (24,000 bytes, every known agent) and says how to record
one. The prompts ask for the selection before they write or judge instruction files, and wire only
what it needs.

## Alternatives considered

### Alternative: keep the strictest limit for everyone

No new file and nothing to choose. It lost because it charges every project for an agent most
don't use, and it measures the wrong thing for the agents they do use: Claude Code's advice is in
lines, counting imports, and nothing checked it.

### Alternative: raise the universal limit to Codex's 32 KiB

One number changed. It lost because it silently drops Antigravity users, who would get a
truncated file with a green check, and it still says nothing about Claude Code's line guidance.

### Alternative: detect the agents from the files present (a CLAUDE.md means Claude Code)

Nothing to record. It lost because the files are what the selection is meant to decide, so the
inference runs backwards: every project built from the template has all six agents' wiring, and an
AGENTS.md alone is read by four agents, so no file says which of them a team runs.

### Alternative: the selection as a field in `package.json`

No new file. It lost because not every target is a Node project, and the agents' own directory,
`.agents/`, already holds what agents share.

## Consequences

- **Easier:** a project using Claude Code and Codex gets Codex's 32 KiB as its byte budget and a
  note when CLAUDE.md with its imports passes 200 lines. A project's wiring files match the agents
  it uses. An unfamiliar agent has a procedure, and its facts carry sources a reviewer can check.
- **Harder:** the registry's facts age. Each carries its `checked` date, and a run that finds an
  agent behaving differently updates the entry from its source. Projects have one more file to
  keep true.
- **Unchanged for existing targets:** with no selection, findings and exit codes are what they
  were; only a note on stderr is new. A malformed selection exits 2, as when nothing could be
  examined: without it no budget is known.
- **Not done here:** `process:apply` still delivers the same skills to the same paths, and the
  per-agent hook configurations stay as ADR 0018 set them; making those follow the selection is a
  separate change.
- **Revisit** when an agent's documented limit changes, or when the hook and skill deliveries
  should follow the selection too.

## Verification

- `npm run check:instructions` in this repository reads `.agents/platforms.json`
  (`claude-code`, `codex`): it passes AGENTS.md against Codex's 32 KiB and prints Claude Code's
  line-guidance note.
- `scripts/__tests__/check-instructions.test.ts` ("the platform selection") runs a 30,000-byte
  AGENTS.md against `codex` (passes), `codex` and `antigravity` (fails), and no selection (fails
  at 24,000), and the selection's own errors; each was run against a planted defect.
- `scripts/__tests__/agent-platforms.test.ts` holds every registry entry to a source and a date,
  and `prompts/agent-platforms.md`'s table to the registry.

## Addendum, 2026-10-17: Codex's limit is combined

The registry recorded that Codex's 32 KiB covers every AGENTS.md from the project root down,
together, but the size check measured each file alone, so a nested AGENTS.md under 32 KiB passed
however much of the budget its ancestors used. A platform's limit now has a scope: `hardScope:
'combined'` on Codex's entry (and allowed on a `custom` one; absent means per file). With such a
platform selected, a nested AGENTS.md is also held to that limit less the bytes of the AGENTS.md
(or AGENTS.override.md, which Codex reads in its place) in each directory above it, and the
finding names those files and what they leave. Only with a selection: a repo that records none is
sized as before. Verification: "Codex's limit, on the AGENTS.md files from the root down combined"
in `scripts/__tests__/check-instructions.test.ts`, each case run with the check reverted.
