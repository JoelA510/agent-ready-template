# 0002. Distribute the process by copying files, not by dependency or service

- **Status:** Accepted — layout and re-run behavior refined by [0006](./0006-staged-skeletons-and-apply-manifest.md);
  the workflows ship as Agent Skills instead of `.claude/commands/` per [0011](./0011-agent-portable-workflows.md)
- **Date:** 2026-07-26
- **Deciders:** template maintainers
- **Applies to:** `prompts/`, `templates/project/`, `scripts/apply-process.mjs`, `.claude/commands/`

## Context

The process half of this repo — the build prompts, the artifact skeletons, the definition of
done — has to reach projects that will never be forks of this repo. An existing codebase with
its own history can't adopt a template by forking it, and the prompts are explicit that the
target's conventions outrank this repo's. So the process needs a delivery mechanism, and the
mechanism shapes everything downstream: whether targets can diverge, whether updates
propagate, and what a project depends on at 2 a.m. when someone is trying to run an audit.

The options that exist in the wild: a versioned package the target installs, a service or
remote reference the prompts are fetched from at run time, a git submodule, or plain file
copying. Each has known failure modes, and the deciding pressure here is that a process
artifact is only trustworthy if the people using it can read, edit, and own it — a prompt
you can't annotate after a bad run is a prompt that stops improving.

## Decision

We will distribute the process by copying plain files into the target repo:
`npm run process:apply -- --target <path>` copies the prompts (including a fresh run log)
and every skeleton from `templates/project/` to its documented path. The copy is one-way and
one-time by default; the target owns its copies from that moment, edits them freely, and logs
its runs locally. The script never overwrites an existing file — a conflict parks the
skeleton alongside as `<name>.template` for hand merging. Within this repo and its forks, the
same prompts are additionally wired to slash commands in `.claude/commands/`, which are
themselves just committed files.

## Alternatives considered

### Alternative: a versioned npm package (`@x/process`) the target installs

Would give targets semver updates and a single source of truth. Rejected because it inverts
ownership: the moment the prompts live in `node_modules`, editing them after a bad run means
forking the package or filing an issue — friction exactly where the feedback loop needs to be
frictionless. The prompts' own maintenance model ("edit the prompt when a run exposes a gap")
requires the file to be the target's to edit.

### Alternative: fetch prompts from this repo at run time

Always current, nothing to copy. Rejected because it makes every audit depend on the network
and on this repo's continued existence and stability — and because "always current" is wrong
for a mid-flight project: a prompt that changes between milestone 2 and milestone 3 silently
changes the standard the project is being held to. Runs need a pinned, local prompt.

### Alternative: git submodule

Pins a version and keeps a link to upstream. Rejected on operational grounds: submodules add
a second checkout step every contributor and CI pipeline must know about, and the link they
preserve is to a repo the target's team may have no relationship with. The run log's
"references verified as of" discipline already covers the freshness question the submodule
would solve.

## Consequences

Easier: targets are self-sufficient (no network, no dependency, nothing to install), free to
diverge, and safe from upstream churn mid-project. The skeletons stay greppable, diffable,
and reviewable in the target's own PRs.

Harder: improvements here don't propagate — a target that wants a newer prompt re-runs the
apply script and hand-merges the parked `.template` files. That cost is accepted and
deliberate: divergence between a target's process and this repo's is information (their runs
taught them something), not drift to be stamped out.

Locked in: the skeletons must stay valid as standalone files — no build step, no imports, no
assumption that this repo's tooling exists in the target.

Revisit if: enough targets exist that hand-merging updates becomes a recurring, complained-
about cost — that's the signal to add a three-way-merge or versioned-manifest layer on top of
the copy model, not to abandon it.

## Verification

- `npm run process:apply -- --target <scratch-dir> --list` prints the manifest; running it
  twice against the same target reports everything "already up to date" (idempotence).
- Creating a conflicting file in the target and re-running produces `<name>.template`
  alongside it, leaving the original byte-identical.
- The copied files reference nothing outside the target repo (no imports, no relative links
  back to this repo).
