# Local power pack

What one person's machine can add on top of the committed baseline: upstream workflow skills, a
memory server, skill evaluation, containers. It is opt-in and per machine. Nothing here is read
from a clean clone, and nothing outside this directory reads it, so a cloud session and a
colleague without the pack get exactly the repository as committed. The three layers, and what
each environment supports, are in [`docs/system/agent-targets.md`](../../docs/system/agent-targets.md);
the decision is [ADR 0022](../../docs/adr/0022-shared-core-and-two-agent-targets.md).

## What is here now

Three templates, copied by hand. The bootstrap that installs and pins the upstream tools, with a
Compose file for the services some of them need, is a later stage of
[the plan](../../docs/changes/2026-11-17-dual-target-agents.md) (stage 4) and isn't written yet.

| Template | Copy it to | What it does |
| --- | --- | --- |
| `claude/CLAUDE.local.md.tmpl` | `CLAUDE.local.md` at the repository root | Tells Claude Code what this machine has, on top of AGENTS.md |
| `claude/settings.local.json.tmpl` | `.claude/settings.local.json` | Makes Claude Code ask before the commands that are hard to undo on a real machine |
| `codex/local-power.config.toml.tmpl` | `~/.codex/local-power.config.toml` | A Codex profile, started with `codex --profile local-power` |

All three destinations stay out of git (`.gitignore` names the first two; the third is outside the
repository), and a test fails if one is ever committed.

## Switching it on by hand

From the repository root, on Linux, macOS, WSL2, or Git Bash:

```bash
cp packs/local-power/claude/CLAUDE.local.md.tmpl CLAUDE.local.md
cp -n packs/local-power/claude/settings.local.json.tmpl .claude/settings.local.json
cp packs/local-power/codex/local-power.config.toml.tmpl ~/.codex/local-power.config.toml
```

Then:

1. **Fill in `CLAUDE.local.md`.** Replace each bracketed placeholder with what this machine has,
   and confirm none is left: `node scripts/check-placeholders.mjs CLAUDE.local.md` prints nothing.
   This repository's `CLAUDE.md` imports `AGENTS.md`, so a local file only adds to it. In a
   repository with no `CLAUDE.md`, start your copy with a line `@AGENTS.md`: without it Claude
   Code reads the local file and skips the shared rules.
2. **Merge, don't overwrite, the settings.** `cp -n` leaves an existing
   `.claude/settings.local.json` alone; add the template's `ask` entries to yours. On Windows the
   `PowerShell(...)` entries are the ones that apply to the PowerShell tool. A rule matches the
   command as written, so it prompts for the usual form and isn't a boundary around the program.
3. **Start Codex with the profile.** `codex --profile local-power` needs Codex 0.134 or later;
   earlier versions read profiles from a table in `config.toml` and won't see the file.
4. **Optionally tell the probe.** `npm run agent:target` prints `local-power` once
   `.local-power/state.json` exists, and probes each tool it lists. The shape is in the header of
   `scripts/agent-target.mjs`; the smallest valid file is `{ "version": 1, "tools": [] }`.

## Switching it off

Delete `CLAUDE.local.md`, `.local-power/`, the entries you added to
`.claude/settings.local.json`, and `~/.codex/local-power.config.toml`. The checkout then behaves
as the committed baseline at once: nothing else was changed.

## What stays out of this pack

- **Anything a clean clone needs.** If a session can't do its work without it, it belongs in the
  shared core, where a cloud session has it too.
- **A committed `.mcp.json`, plugin list, or team hook.** Claude Code on the web loads a project's
  `.mcp.json` without asking, and a hook that requires a user-level install would refuse every
  skill call in a container that doesn't have it.
- **Secrets.** A token belongs in the environment or a secret store, named by variable.
