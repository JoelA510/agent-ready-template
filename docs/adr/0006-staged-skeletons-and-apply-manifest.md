# 0006. Stage skeletons under prompts/skeletons and track applies with a manifest

- **Status:** Accepted — the delivered workflows are Agent Skills, not `.claude/commands/`, per
  [0011](./0011-agent-portable-workflows.md); a parked update is a three-way merge proposal where
  the base is known, per [0016](./0016-apply-delivers-standards-proposes-merges-checks-drift.md)
- **Date:** 2026-09-24
- **Deciders:** template maintainers
- **Applies to:** `scripts/apply-process.mjs`, the prompts' and commands' references to skeletons,
  and every target repo that receives the process. Refines [0002](./0002-process-distribution.md):
  distribution is still by copying files; this changes where they land and how re-runs behave.

## Context

ADR 0002 copied every skeleton to its live path in the target. Running `process:apply` against
copies of two real sibling projects (a portfolio site and a web game) showed what that costs:

- **Parallel homes.** The web game already had ADRs in `dev-documentation/decisions/` and
  plans in `dev-documentation/`. The apply added `docs/adr/` (including a second "0001"),
  `docs/dev-plan.md`, `docs/audit.md`, and a `.env.example` with `DATABASE_URL` placeholders for
  an app that has no environment variables. That contradicts the existing-project prompt's own
  rule that the codebase's conventions win.
- **A live, unfilled CLAUDE.md.** In a target without one, the placeholder skeleton landed at the
  root and was loaded by the next agent session. It told the agent not to relitigate an empty
  stack ADR.
- **Re-runs parked a `.template` beside every file the target had legitimately edited**: a
  filled-in audit, a run-log row, a prompt edited after a run, which the process itself tells
  people to do. The script couldn't tell "the target filled this in" from "the template
  changed". ADR 0002 anticipated hand-merging real updates, not this noise.
- **Broken references.** The copied prompts, commands, and README pointed at
  `templates/project/`, `../templates/`, `npm run process:apply`, and
  `CONTRIBUTING.md#7-definition-of-done`, none of which exist in a target. ADR 0002's
  verification claim that the copied files "reference nothing outside the target repo" was
  false.

## Decision

We will stage every skeleton under `prompts/skeletons/` in the target and never write to a live
path. Agent-instruction skeletons carry a `.skeleton.md` name (`CLAUDE.skeleton.md`), because
agents load any `CLAUDE.md`/`AGENTS.md` in a directory they read, staged or not. The prompt run copies the skeletons it needs to their real paths and fills them in. It
merges into the target's own equivalents where they exist, including other agents' instruction
files. `process:apply` writes `prompts/.apply-manifest.json`, recording for each file the hash
of the template version last delivered *or offered*, plus the template commit. Hashes ignore
line endings, a BOM, and trailing whitespace. On a re-run:

| Situation | What happens |
| --- | --- |
| Template unchanged since delivered/offered | Nothing, however much the target edited the file |
| Template changed, target copy untouched | Updated in place |
| Both changed | The new version is parked as `.template` **once** and recorded as offered; after the merge, re-runs are quiet until the template changes again |
| Target file now equals the template | Recorded, so the next template change updates in place |
| Target deleted the file | Left deleted |
| Template dropped the file | Removed if the target's copy is untouched; reported on every run if edited |
| `prompts/run-log.md` | Delivered fresh (the template's own rows stripped), never touched once it exists |
| A pre-existing target file at a delivered path | Parked, saying it can't tell an old delivery from an edit |

Prompts and commands are delivered from explicit lists. A test fails if a file in `prompts/` or
`.claude/commands/` is in neither the delivered list nor the template-only list, so a
maintainer-only command can't ship to every target by accident.

The prompts and commands name one **skeletons directory**: `prompts/skeletons/` in a target,
`templates/project/` in the template repo. Every reference is written to be true in both.

## Alternatives considered

### Alternative: `--mode new|existing`, placing skeletons live only for new projects

This keeps a new project's files where they'll end up. It lost because a new-project apply still
drops an unfilled CLAUDE.md that goes live before `/bootstrap` fills it, and because two layouts
double the paths every prompt has to describe. Staging costs a new project one copy step the
bootstrap run performs anyway.

### Alternative: three-way merge on re-apply

This would merge template changes into target-edited files automatically. It lost because it
needs the previous template version's content, not just its hash, and because an automatic
merge of prose instructions can produce a coherent-looking but contradictory prompt. That's
worse than a visible `.template` a human reads.

### Alternative: rewrite references during the copy

This would keep template-repo paths in the source and substitute target paths as files are
copied. It lost because the delivered file would differ from the source, so a diff between the
template and a target stops meaning anything, and one reference missed by the substitution
silently ships.

## Consequences

- **Easier:** applying to an existing repo touches only `prompts/` and `.claude/commands/`.
  Re-running to pick up template improvements is quiet and safe. The manifest says which template
  commit a target's process came from.
- **Harder:** agents must copy skeletons out before filling them. The prompts say so in their
  first paragraph. Targets that applied the old layout get the new one staged beside their
  existing live files on the next run, and nothing is removed.
- **Revisit if:** targets routinely diverge so far that parked `.template` files pile up. That's
  the three-way-merge case, with content history kept in the manifest.

## Verification

`scripts/__tests__/apply-process.test.ts` exercises each row of the table above, plus: nothing
at live paths, detection of existing agent instructions, `--list` writing nothing, and refusal
of an unreadable manifest or a target inside the template.
