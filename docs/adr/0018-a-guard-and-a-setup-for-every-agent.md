# 0018. Every agent with hooks runs the generated-file guard, and every cloud agent sets up the same way

- **Status:** Accepted
- **Date:** 2026-10-07
- **Deciders:** template maintainers (taken on the maintainer's go-ahead to build the deferred
  items; ADR 0011 left hooks for other agents until their contracts were verified)
- **Applies to:** `scripts/guard-generated.mjs`, `scripts/setup.sh`, and the agent configuration
  that calls them: `.claude/settings.json`, `.codex/hooks.json`, `.github/hooks/`,
  `.gemini/settings.json`, `.agents/hooks.json`, `.cursor/environment.json`, and
  `.github/workflows/copilot-setup-steps.yml`

## Context

ADR 0011 gave Claude Code a PreToolUse hook that refuses an edit to a generated file, and left
every other agent to learn golden rule 1 from CI, because only Claude Code's hook contract had
been verified. On 2026-10-07 each of the others was read from its own documentation:

| Agent | Where | Event and file tools | How it blocks | Without our help |
| --- | --- | --- | --- | --- |
| Claude Code | `.claude/settings.json` | `PreToolUse`: `Edit`, `Write`, `MultiEdit`, `NotebookEdit` | exit 2, stderr to the agent | sets `CLAUDE_PROJECT_DIR` |
| Cursor | reads `.claude/settings.json` too, by default, and runs every matching hook | maps Claude's `Edit` and `Write` to its `Write` | exit 2 | sets `CLAUDE_PROJECT_DIR`; a crash fails open |
| Copilot CLI | reads `.claude/settings.json` and `.github/hooks/*.json`, and runs both | `edit`, `create` | exit 2 | any other non-zero exit fails closed; on Windows it runs `powershell` |
| Copilot cloud agent | `.github/hooks/*.json` only | `edit`, `create` | exit 2 | Linux, in `/workspace` |
| Codex | `.codex/hooks.json` | `PreToolUse`: `apply_patch`, the patch text in `tool_input.command` | exit 2 | no project variable; each hook trusted in `/hooks` first |
| Gemini CLI | `.gemini/settings.json` | `BeforeTool`: `write_file`, `replace`; timeout in milliseconds | exit 2 | sets `CLAUDE_PROJECT_DIR`; fingerprints project hooks |
| Antigravity | `.agents/hooks.json` | `PreToolUse`: `write_to_file`, `replace_file_content`, `multi_replace_file_content`, path in `args.TargetFile` | a JSON `{"decision":"deny"}` on stdout; exit codes undocumented | no `cwd` in the payload, only `workspacePaths` |

Two more facts shaped this. The guard's command used bash's `${VAR:-default}`, which PowerShell
can't run; Copilot CLI runs hooks in PowerShell on Windows and takes a hook that can't start as a
refusal, so it could refuse every edit there (recorded as unfixed in the CHANGELOG). And cloud sessions started on Node 22 while `.nvmrc` pins 24: nothing put the
pinned Node in front of them.

## Decision

- **One guard, every agent.** `scripts/guard-generated.mjs` reads any of these payloads (the tool
  input under each agent's name for it, the path under each one's key, and the files a Codex
  `apply_patch` touches, read as Codex reads it: a header line trimmed, so an indented one counts,
  except inside an Update hunk, where an indented line is context) and
  refuses with exit 2 and a reason on stderr; with `--agent antigravity`
  it prints Antigravity's JSON decision instead. Each agent's config names its own file tools.
  Cursor and Copilot CLI already run Claude Code's hook, so Cursor gets no file of its own, and
  Copilot CLI running the guard twice (once from each file) is accepted: two identical refusals.
- **Commands that need no project variable.** Copilot's own config sets `cwd: "."` (the
  repository root) and runs `node scripts/guard-generated.mjs`: nothing for bash or PowerShell to
  expand. Every other config runs `node "$(git rev-parse --show-toplevel)/scripts/guard-generated.mjs"`,
  which finds the checkout from wherever the agent is working; `$(...)` inside double quotes
  expands in bash and in PowerShell, which matters because Copilot CLI also runs Claude Code's
  hook, in PowerShell on Windows. The guard compares paths against the checkout it lives in, so
  in a git worktree it guards the worktree (`CLAUDE_PROJECT_DIR` would name the main checkout).
- **One setup, `scripts/setup.sh`:** `.nvmrc` stays the one Node pin. When the running Node isn't
  it, the script installs it with mise or nvm, whichever is there, and runs `npm ci` with it; with
  neither, it stops rather than install under the wrong Node. Claude Code's SessionStart hook runs
  it and puts that Node on the session's PATH; Cursor's `.cursor/environment.json` runs it;
  AGENTS.md tells Codex cloud environments to. The Copilot cloud agent's
  `copilot-setup-steps.yml` installs the way CI does, with setup-node.
- **The configs are written by hand and tested,** not generated: each is a few lines, and
  `scripts/__tests__/agent-hooks.test.ts` runs each registered command, from a subdirectory (Copilot's
  from its configured root), on
  that agent's payload for a generated file and for a source file.

## Alternatives considered

### Alternative: generate every config from one source

`scripts/generated.mjs` could own the five files and the drift gate keep them in step. It lost on
size: one command and one matcher each, against a build step, a generated-file entry, and a guard
refusing edits to the configs themselves. The test is what keeps them in step.

### Alternative: a `mise.toml` as the pin

mise reads `.nvmrc` only with `idiomatic_version_file_enable_tools` set, and whether a project
`mise.toml` can set it is undocumented. A `mise.toml` naming Node would be a second pin to drift
from `.nvmrc`, which CI and `node.runtime-pinned` read. `setup.sh` passes `.nvmrc`'s version to
`mise install` instead, and works with nvm where mise isn't installed: this container had nvm and
not mise, and couldn't download mise's release.

## Consequences

- Verified: every config's command, run as registered on a payload shaped as its agent documents
  it (executed, in the tests). `setup.sh` installed Node 24 with this container's nvm, from Node
  22, and the env file put it on PATH (executed). Not verified: any of it inside Codex, Cursor,
  Copilot, Gemini CLI, or Antigravity themselves; the PowerShell form; Cursor's and Copilot's
  argument names for a file path, which their docs don't give (the guard reads `file_path` and
  `path`); and Antigravity's working directory, which the command assumes is inside the
  repository.
- Codex asks to trust each project hook (`/hooks`) before it runs, and again when the hook
  changes; Gemini CLI warns when a project hook's fingerprint changes; Cursor and Antigravity run
  project hooks only in a trusted workspace. Until then, CI is the only guard there.
- A write through a shell command still bypasses every hook; `npm run check:generated` in CI
  remains the gate every agent shares.
- The `git rev-parse` form can't start where the agent's working directory is outside any git
  repository, or in another repository nested in this one. Claude Code, Codex, Cursor, and Gemini
  CLI report that and let the edit through; Copilot CLI refuses it. And PowerShell decodes git's
  output with the console's code page, so on Windows a repository path with non-ASCII characters
  breaks the copy Copilot CLI runs from `.claude/settings.json` (it then refuses every edit);
  Copilot's own config, with no expansion, isn't affected.
- Gemini CLI stopped serving personal accounts on 2026-06-18 (Antigravity CLI replaces it); its
  hook stays for API-key and Code Assist users.
