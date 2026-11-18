# 0022. One shared core, a cloud target that is the clean clone, and an opt-in local power pack

- **Status:** Accepted
- **Date:** 2026-11-17
- **Deciders:** the template maintainer (agreed with docs/changes/2026-11-17-dual-target-agents.md)
- **Applies to:** what may be committed for agents (`AGENTS.md`, `CLAUDE.md`, `.claude/`,
  `.codex/`, the skills, the checks), `packs/local-power/`, `scripts/agent-target.mjs`, and the
  MCP skeletons under `templates/project/`. It does not change what the standards measure.

## Context

Agents work on this repository in two kinds of place. A cloud session (Claude Code on the web,
Codex cloud) starts from a fresh clone in a vendor's container and has what is committed. A
person's machine can have far more: upstream workflow skills (gstack, ECC), a memory server
(MemPalace, gbrain), skill evaluation (NVIDIA SkillEvaluator), containers, an authorization
service (NVIDIA Nomos). A research report recommended consuming those upstreams live and keeping
only cloud-safe pieces in the template, and extracting the process half into a second repository.

Verification on 2026-11-17, recorded in the change plan with each source, changed the picture:

- A single-repository cloud session on Claude Code on the web loads the project's `.mcp.json`
  without an approval prompt, and installs no plugin and no user-level skill or MCP server. A
  session over several repositories, or a thread in a Project, loads only `CLAUDE.md`.
- Codex doesn't read `.mcp.json`. A Codex profile is a file in the user's `~/.codex/` (since
  0.134), can't be committed, and is outranked by a project's own `.codex/config.toml`.
- Codex cloud documents no signal a script could detect it by. Claude Code documents one,
  `CLAUDE_CODE_REMOTE`.
- gstack's team mode commits a hook that refuses every skill call where its user-level install
  is missing, which is every clean container.
- The process half already has a way to reach other repositories (`process:apply`, ADRs 0002,
  0006, 0016), and the conformance engine isn't self-contained: it finds `standards/` beside
  itself and loads four packages from the template's install.
- The maintainer's machine is Windows, where several of the upstream tools run only under WSL2.

Left alone, the cloud's limits would hold back what a local session may use, or a local setup
would leak into commits and break every cloud session.

## Decision

We will keep one repository with three layers. The **shared core** is everything committed, and
it needs only Node, git, and the lockfile's packages: nothing in it may require a daemon, an MCP
server, or anything installed for one user. The **cloud target** is that clean clone as it stands
and has no directory of its own. The **local power target** is `packs/local-power/`, opt-in per
machine, activated through files git ignores (`CLAUDE.local.md`, `.claude/settings.local.json`,
`.local-power/`) and a Codex profile outside the repository. The pack may read the shared core;
nothing in the shared core may import or run the pack. A session learns where it is from
`npm run agent:target`, which prints `cloud`, `local-power`, or `core`, probes only what a local
state file lists, and never fails. The committed Claude Code settings only deny; rules that ask
live in the pack, where a person is there to answer. We will not extract a second repository
until one of the triggers under Consequences is met.

## Alternatives considered

### Alternative: extract the process half into an `agent-tooling` repository now

The report's recommendation. It would give the standards, the conformance engine, and the gates
their own release cadence and stop a React starter from housing them. It lost because nothing
consumes them that way yet: there is no second consumer, `process:apply` already delivers the
process to any repository on disk, and the engine would need its catalog path, four dependencies,
and its tests split out first. A solo maintainer would pay release, CI, and version-sync cost
three times for no present user.

### Alternative: keep everything to what a cloud session can run

Simplest to reason about: one target. It lost because it gives up, on every local session, the
tools that only a real machine can run (a container-based skill benchmark, a local memory store,
upstream skills installed for the user), for the sake of sessions that would never have used them.

### Alternative: a `packs/cloud/` directory beside the local pack

Symmetry. It lost because the cloud target is defined by what is absent: the directory would hold
nothing but a pointer to files that already live where each agent reads them
(`.claude/settings.json`, the SessionStart hook, `scripts/setup.sh`).

### Alternative: commit the ask-first rules, a shared `.mcp.json`, or a required-install hook

One configuration for every session. Each breaks the cloud target in a different way. How a
cloud session answers an `ask` rule isn't documented, so a committed one may stall a session
nobody is watching. A committed `.mcp.json` runs in every cloud session without a prompt. A hook
that requires a user-level install refuses work in every clean container. Flutter's agent-plugins
repository, the packaging reference checked for this, dropped its own shared `.mcp.json` in
September 2026 for per-harness configuration.

### Alternative: detect Codex cloud too

It would let the probe name four places. There is no documented signal, and guessing from
container details would be wrong silently when the image changes. Treating an undetected clean
clone as `core` gives it exactly the cloud behavior without detecting it.

## Consequences

- A cloud session or a colleague's clone behaves the same whatever any one machine has installed,
  and a local session may use everything on its machine.
- The committed files can't mention a local tool as something to call. A rule that needs one
  goes in the pack's templates, or waits until the tool has a shared-core form.
- The dependency direction is one more thing to hold. A test does it: nothing outside `packs/`
  imports or runs what is inside, and no per-machine file is committed.
- Claude Code permission rules and Codex rules match a command as written. They put a prompt in
  the usual place; they aren't a boundary around a program, and the docs for both say so.
- The Codex profile, the pack's templates, and the state file are copied by hand until the
  pack's bootstrap exists (stage 4 of the plan).
- Where each part would go if the repository is split, so the split stays mechanical:

  | Destination | What moves |
  | --- | --- |
  | A process repository | `.agents/`, `.claude/skills/`, `.claude-plugin/`, `prompts/`, `standards/`, `templates/`, `evals/`, `docs/standards/`, `docs/security/`, the process scripts and their tests (`agent-platforms`, `agent-target`, `apply-process`, `build-skills`, the `check-*` gates other than contrast, bundle size, and Pages, `fleet-*`, `repo-files`, `runtime`, `skills`, `template-dependency`, `setup.sh`), the audit and evals workflows, and the `yaml`, `smol-toml`, `json5`, and `typescript` dependencies they load |
  | Stays with the interface | `src/`, `tokens/`, `platforms/`, `presets/`, `public/`, `.storybook/`, the registry, the Vite, Vitest, and TypeScript configs, `docs/brand/`, `docs/foundations/`, `docs/proposals/`, and the scripts `build-registry`, `check-bundle-size`, `check-contrast`, `check-pages-homepage`, `color`, `homepage`, `native-tokens`, `init` |
  | Needed by both | `generated.mjs`, `guard-generated.mjs`, `check-generated.mjs`, each agent's hook config, `ci.yml`, `AGENTS.md`, `CLAUDE.md`, `package.json`, `knip.json`, the repo-hygiene tests |
  | A local runtime repository | `packs/local-power/` |

- Revisit, and extract the process half, when any of these holds: a repository that isn't a fork
  needs the process on a release cadence the template can't give it; a process-half dependency
  blocks an interface-half upgrade for more than a quarter (Dependabot already holds TypeScript
  below 7 because two process scripts use its compiler API: the first instance to watch); or
  someone outside asks for the engine without the React starter.
- Extract the pack when a second machine or person uses it, when its tests need Docker in CI, or
  when pin bumps for it outnumber every other kind of pull request for a month.

## Verification

- `npm run agent:target` prints `core` in a clean checkout, and `cloud` with
  `CLAUDE_CODE_REMOTE=true`. `scripts/__tests__/agent-target.test.ts` holds the three answers,
  the refusals for a state file it doesn't trust, and the exit code.
- `scripts/__tests__/repo-hygiene.test.ts`, "agent targets": no committed `.mcp.json`,
  `CLAUDE.local.md`, `.claude/settings.local.json`, or required-install hook; the per-machine
  files are ignored; nothing outside `packs/` imports or runs it; the committed Claude Code
  settings only deny; the pack's templates parse and allow nothing broad; the two MCP skeletons
  name one remote server and one token variable; the Codex rules only prompt or forbid. Each was
  shown failing on a planted defect.
- `codex execpolicy check --rules .codex/rules/blast-radius.rules -- git push --force` reports
  `prompt` (run on Codex CLI 0.125.0-alpha.3, 2026-11-17).
- `npm run check:instructions` holds the paths and scripts `AGENTS.md` names, and its size.
