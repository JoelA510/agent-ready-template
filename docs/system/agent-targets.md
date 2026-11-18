# Agent targets

Where an agent session can run, and what each place has. [AGENTS.md](../../AGENTS.md) holds the
rule ("Where you are running"); this page is the detail behind it, read when a task could use a
tool that isn't in the repository. The decision and what was rejected are in
[ADR 0022](../adr/0022-shared-core-and-two-agent-targets.md); the research, with every source and
the date it was read, is in
[the change plan](../changes/2026-11-17-dual-target-agents.md).

## Three layers

| Layer | What it is | Where it lives |
| --- | --- | --- |
| **Shared core** | Everything committed: the instructions, the skills, the checks, CI. It needs Node, git, and the packages `package-lock.json` pins. Nothing in it needs a daemon, an MCP server, or anything installed for one user. | The repository |
| **Cloud target** | A clean clone in a vendor's container (Claude Code on the web, Codex cloud). It is the shared core as it stands, plus the setup that makes the gate runnable there. It has no directory of its own. | `.claude/settings.json`, `.claude/hooks/session-start.sh`, `scripts/setup.sh` |
| **Local power target** | One person's machine with more installed: upstream workflow skills, a memory server, skill evaluation, containers. Opt-in, per machine, and never loaded from a clean clone. | `packs/local-power/`, and what it writes outside the repository |

The dependency runs one way: the local power pack reads the shared core, and nothing in the shared
core reads the pack. A test holds that (`scripts/__tests__/repo-hygiene.test.ts`).

## Telling them apart

`npm run agent:target` prints one word, then one line for each optional tool:

| It prints | When | What the session uses |
| --- | --- | --- |
| `cloud` | `CLAUDE_CODE_REMOTE` is `true`, which Claude Code sets in a cloud session and never locally | The shared core. A remote MCP server too, if the project configured one. |
| `local-power` | The checkout has `.local-power/state.json`, which the pack writes | The shared core, plus each listed tool that answers right now |
| `core` | Neither | The shared core |

Codex cloud prints `core`: OpenAI documents no variable that identifies it. That is by design
rather than a gap. A fresh clone has no state file, so it gets the same baseline a detected cloud
session does.

The probe looks a command up on `PATH` without running it, and connects to a port or a URL on
loopback only, giving each 500 ms. A tool that doesn't answer is `down`; the session takes the
shared-core path for that task and says so once. It always exits 0. The state file's shape is in
the header of `scripts/agent-target.mjs`.

## What each environment supports

Read 2026-11-17 from each project's own repository and documentation; nothing below was installed
or run for this page. "Local" assumes Linux, macOS, or WSL2: on native Windows, gstack promises
four skills, gbrain ships no binary, Nomos doesn't deploy, and SkillEvaluator is untested.

| Tool | How it runs | Claude Code local | Claude Code cloud | Codex local | Codex cloud | GitHub Actions |
| --- | --- | --- | --- | --- | --- | --- |
| Shared core (instructions, skills, checks) | Node and git; the lints need `npm ci` | Yes | Yes | Yes | Yes | Yes |
| gstack | A clone under the user's home, Bun, its own setup script | Yes | No | Partly: an experimental host | No | No |
| ECC | A native plugin, installed by `ecc-universal` | Yes | No: a cloud session installs no plugins | Yes, for the user only | No | No |
| AgentShield | A pinned action; or its CLI through `npx` | Yes | Partly: not tried | Yes | Partly: needs the network | Yes |
| MemPalace or gbrain over stdio | A command on `PATH`, registered at local scope | Yes | No | Yes | No | No |
| Either memory server over HTTP | A URL and a bearer token, in the project's MCP config | Yes | Yes, in a single-repository session | Yes | Partly: connectors only | No |
| SkillEvaluator Tier 1 | `pipx run`, Python 3.12 or later; it downloads its scanners | Yes | Partly: its offline checks | Yes | Partly | Yes |
| SkillEvaluator Tier 2 | Embeddings: an OpenAI key or a local Ollama | Yes | No | Yes | No | Advisory |
| SkillEvaluator Tier 3 | Docker, Harbor, and provider keys | Yes | No | Yes | No | By hand |
| Nomos | Its own Compose stack; MCP over HTTP; Linux | Partly: its review tools | No | Partly | No | No |

Three facts the table rests on:

- **A cloud session gets what is committed, and little else.** Claude Code on the web loads the
  project's `.mcp.json` in a single-repository session, without asking, and no user-level MCP
  server, skill, or plugin. A session over several repositories, or a thread in a Project, loads
  only `CLAUDE.md`. So nothing here depends on a hook or a skill alone: CI is where a rule is
  enforced.
- **Codex doesn't read `.mcp.json`.** Its MCP servers are `[mcp_servers.<name>]` tables in
  `~/.codex/config.toml`, or in a trusted project's `.codex/config.toml`. A Codex profile is the
  file `~/.codex/<name>.config.toml` (since 0.134; a `[profiles.<name>]` table is rejected), so
  it can't live in a repository, and the project's own config outranks it.
- **Claude Code's cloud container is not bare.** It ships Docker, PostgreSQL, Redis, uv, and Bun,
  none of them started. Keeping the cloud target to the shared core is a choice, for sessions that
  start the same way every time, and not something the platform forces.

## In a cloud session

`bash scripts/setup.sh` runs first: Claude Code on the web's SessionStart hook runs it, and so
does `.cursor/environment.json`; in Codex cloud, make it the environment's setup script. Browser
tests need `npx playwright install chromium`, or the container's own Chromium in
`PLAYWRIGHT_CHROMIUM_EXECUTABLE`, which the hook sets when it finds one.

Memory is off unless the project wires a remote server: the skeletons for that are
`templates/project/mcp.skeleton.json` (Claude Code) and
`templates/project/codex-config.skeleton.toml` (Codex). This repository commits no `.mcp.json`,
because a cloud session would load it without a prompt.

## On a machine with the local power pack

[`packs/local-power/README.md`](../../packs/local-power/README.md) says what the pack holds and
how to switch it on. Until its bootstrap exists it is three templates copied by hand: a
`CLAUDE.local.md`, a `.claude/settings.local.json`, and a Codex profile. All three stay out of
git, so a clone never carries them.

What needs a person's answer differs by target. A cloud session works inside a disposable
container, behind a GitHub proxy that refuses a branch deletion or a tag push, so the committed
`.claude/settings.json` only denies what AGENTS.md already rules out (a forced install). A local
session can reach the whole machine, so the pack's `settings.local.json` makes Claude Code ask
before the commands that are hard to undo there.
