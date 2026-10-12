# 0016. process:apply delivers the standards, proposes merges, and checks drift

- **Status:** Accepted
- **Date:** 2026-10-07
- **Deciders:** template maintainers
- **Applies to:** `scripts/apply-process.mjs`, `templates/standards/README.md`, and every target
  that receives the process. Revisits the three-way-merge alternative
  [ADR 0006](./0006-staged-skeletons-and-apply-manifest.md) rejected, under the condition it set
  for revisiting; the rest of ADR 0006 stands.

## Context

[ADR 0015](./0015-standards-catalog-and-conformance.md) left three things for `process:apply`,
measured against the maintainer's repositories on 2026-10-07:

- **A target couldn't read the standards it's held to.** The catalog lives in the template, so
  an agent working in a target sees a scorecard's IDs and not what they require.
- **Nothing said a target had fallen behind.** No target had an apply manifest yet, and once they
  do, the only way to learn one is stale is to re-apply and read the report.
- **A parked `.template` asks a person to merge two whole files by eye.** ADR 0006 rejected an
  automatic three-way merge because the previous template version's content wasn't available,
  and because a silent merge of prose can read well and contradict itself. The first reason no
  longer holds: the manifest records `templateCommit`, so the version last offered is
  `git show <commit>:<path>` in any full template checkout. The second still does.
- **Delivered files can vanish.** Two repositories ignore `.claude/` in `.gitignore`, so skills
  delivered there would never be committed, and nothing said so.

## Decision

- **Standards travel with the process.** Every apply delivers `standards/core/` and a
  target-facing README under `prompts/standards/`; `--pack <name>` adds a pack's standards, and
  the manifest remembers it (`packs`) until `--drop-pack` removes it. The repository's own record,
  `docs/standards/conformance.json`, is never written: declaring packs there replaces detection,
  which is the repository's call.
- **Parked updates become merge proposals where the base is known.** When both sides changed a
  text file, the apply reads the version last offered from the recorded commit, checks it hashes
  to what the manifest says was offered, and parks `git merge-file --diff3` of the target's copy,
  that version, and the new one, with conflicts marked. It's still parked as `.template`, never
  written over the target's file: a person reads it before it's live. Without the base (an archive
  checkout, a commit no longer in history, a template that was dirty when it applied, a binary
  file), the plain new version is parked, as before.
- **`--check` reports drift and writes nothing:** exit 1 when a re-apply would change a file,
  when a parked `.template` is still beside its file, or when a delivered file holds a conflict
  marker; exit 0 when current; exit 1, saying so, when the process was never delivered.
- **A delivered path the target's git ignores is named** in the report, with the exception to add.

## Alternatives considered

### Alternative: write merged files in place when the merge is clean

A clean `git merge-file` result is usually right, and writing it would save a step. It lost
because "clean" means the edits didn't touch the same lines, not that the merged prose agrees with
itself: a template that rewords a rule and a target that added an exception to the old wording
merge cleanly into two rules that contradict each other. ADR 0006's concern holds, so a person
still moves the proposal over the file.

### Alternative: deliver standards by detection, the way the conformance check finds packs

`process:apply` could deliver whatever packs `check:conformance` would score. It lost because it
couples delivery to the catalog's YAML parsing (the apply runs without the template's
dependencies installed), and because a repository whose packs live below the root has to declare
them anyway. An explicit `--pack`, remembered, is one rule.

### Alternative: write the packs into the repository's conformance config

`--pack supabase` could add `"packs": ["supabase"]` to `docs/standards/conformance.json`. It lost
because a declared list replaces detection: declaring one pack would silently stop scoring the
others the repository was detected for. The config stays the repository's own file.

## Consequences

- **Easier:**
  - An agent in a target can read what each standard ID requires.
  - Taking a template update means reading one merged file per conflict, not two.
  - A fleet, or one repository's CI, can ask whether the process is current.
- **Harder:**
  - Every target gets `prompts/standards/` on its next apply: 17 more files to commit (core's 16
    and the README), plus each pack it names.
  - A proposal can look finished and still be wrong; the next-steps text says to read it.
  - Merge proposals need git and a template checkout with its history. A shallow clone that lacks
    the recorded commit falls back to parking the plain version, which the report doesn't
    distinguish from a binary file.
- **Revisit:**
  - If proposals routinely merge cleanly and are accepted unread, reconsider writing clean merges
    in place for the prompts only.
  - If targets want packs scored and delivered from one declaration, a `packs` field the apply
    reads from the config, without writing it, would join the two.

## Verification

`scripts/__tests__/apply-process.test.ts`:

- "process:apply: standards": core always, a pack on request, remembered, dropped.
- "process:apply: merge proposals": a clean merge, a marked conflict, the plain version without
  history, and the plain version when the recorded commit doesn't hold what was offered.
- "process:apply: --check": not delivered, current, behind, a parked leftover, a conflict marker.
- "process:apply: gitignored deliveries": the warning, and an exception clearing it.

Each was shown failing with its code removed or changed: no proposal, an unverified base,
conflict markers unseen, packs forgotten, the warning silenced.
