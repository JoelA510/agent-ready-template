# Templates

Skeletons for every file the prompts in [`prompts/`](../prompts/) instruct an agent (or a
human) to produce in a target project. The prompts say *what* each artifact must contain;
these files are the *shape* — copy one, fill in the bracketed placeholders, delete the
guidance comments, and the phase's output obligation is met.

Everything under `templates/project/` maps onto a target repo root. In a target that received
the process through `process:apply`, the same files are staged under `prompts/skeletons/`
(nothing lands at a live path); the prompt run copies each one it needs to the path below:

| Skeleton | Prompt phase that demands it | Instantiated in the target as |
| --- | --- | --- |
| `project/AGENTS.skeleton.md` | New-project Phase 2.1 — agent operating rules, the one file every agent reads | `AGENTS.md` (or merged into the repo's existing rules file) |
| `project/CLAUDE.skeleton.md` | New-project Phase 2.1 — the `@AGENTS.md` import, plus Claude-Code-only notes | `CLAUDE.md` |
| `project/CONTRIBUTING.md` | New-project Phase 2.2 + Phase 4 — contribution rules and definition of done | `CONTRIBUTING.md` |
| `project/.env.example` | New-project Phase 2.6 — env validation | `.env.example` |
| `project/SECURITY.md` | New-project Phase 2.5 / existing-project audit — where to report a vulnerability privately | `SECURITY.md` |
| `project/.github/CODEOWNERS` | New-project Phase 2.5, once more than one person merges | `.github/CODEOWNERS` |
| `project/.github/rulesets/main.json` | New-project Phase 2.5 — CI as a required check, imported in the repo's settings. Kept, filled in and marked inactive in CONTRIBUTING.md, where the plan can't enforce it (GitHub Free, private repository). Its required checks are the CI job names: hold them equal with a test (`scripts/__tests__/repo-hygiene.test.ts` has one), or rename both together | `.github/rulesets/main.json` |
| `project/docs/reference-verification.md` | Phase 0 of both prompts — the verification record | `docs/reference-verification.md` (new project); in the dated audit folder (existing project) |
| `project/docs/adr/` | New-project Phase 2.3 — decision records (the template, copied unchanged; the index; the stack ADR skeleton) | `docs/adr/` |
| `project/docs/dependency-policy.md` | New-project Phase 2.5 / existing-project audit §8 — the dependency audit gate and waiver register | `docs/dependency-policy.md` |
| `project/docs/env-validation.md` | New-project Phase 2.6 — the typed env module pattern, and what client bundlers ship | Not kept: the env module is built from it |
| `project/docs/release-runbook.md` | New-project milestone 1 (Phase 3) / existing-project audit §7 — environments, release, verifying the shipped artifact, rollback | `docs/release-runbook.md` |
| `project/docs/content-guide.md` | Optional, for a product with user-facing copy / existing-project audit §12 — voice, terminology, and the claims register | `docs/content-guide.md` |
| `project/docs/postmortem.md` | The release runbook and `investigate.md` — one per incident | `docs/postmortems/YYYY-MM-DD-<slug>.md` |
| `project/docs/product.md` | New-project Phase 2 — mission, users, non-goals, constraints: what every change is planned against | `docs/product.md` |
| `project/docs/change-plan.md` | `plan-change.md` — one plan for a change large enough to agree before it's built | `docs/changes/YYYY-MM-DD-<slug>.md` |
| `project/docs/dev-plan.md` | New-project Phase 3 — phased development plan | `docs/dev-plan.md` |
| `project/docs/audit.md` | Existing-project Phase 1 — baseline, the twelve-area audit, refuted findings, coverage limits | `docs/audits/YYYY-MM-<slug>/audit.md` |
| `project/docs/lessons-learned.md` | Both project prompts and `investigate.md` — durable lessons, each ending in the check that enforces it | `docs/lessons-learned.md` (or the file the repo already keeps) |
| `project/docs/remediation-plan.md` | Existing-project Phase 2 — ordered remediation (milestones, or the single-PR form) | `docs/audits/YYYY-MM-<slug>/remediation-plan.md` |

Two ways to get them into a target:

1. **Scripted:** `npm run process:apply -- --target ../my-app` stages every skeleton under
   `<target>/prompts/skeletons/` alongside the prompts and commands, and records a manifest so a
   later re-run updates only what the target hasn't edited. See
   [`prompts/README.md`](../prompts/README.md#applying-this-to-a-project-that-isnt-a-fork).
2. **By hand:** copy the file to the path in the table above.

Conventions inside the skeletons:

- `[BRACKETED]` placeholders must be replaced — a committed artifact still containing one is
  unfinished by definition. Every placeholder opens and closes on one line, starts with an
  uppercase letter, isn't preceded by a word character (`Optional[Settings]` is code), and
  isn't followed by `(`, `[`, or `:` (links, reference links, link definitions). A test holds
  every skeleton to that shape, which is what makes the check exact.
- Guidance comments all start `<!-- GUIDANCE`. Delete them as sections are completed; a finished
  artifact contains none. Other HTML comments aren't guidance and aren't flagged: a markdownlint
  marker in a file you merged into, and the synced-block markers (`<!-- operating-rules:start -->`
  and its `:end`, the same for `definition-of-done`), which keep a copied block findable. Keep
  those.
- The check, which must print nothing for a finished artifact:

  ```bash
  LC_ALL=C grep -nE '[^]A-Za-z0-9_]\[[A-Z][^]]*\]([^([]|$)|^\[[A-Z][^]]*\]([^(:[]|$)|<!-- GUIDANCE' <files>
  ```

  In the template repo, `node scripts/check-placeholders.mjs <files or dirs>` does the same and
  also catches a stray `-->` left by a half-deleted comment. The ADR template
  (`0000-template.md`) is unfinished by design; leave it out. Known limit: a Keep-a-Changelog
  heading like `## [Unreleased]` looks exactly like a placeholder.
- Agent-instruction skeletons are named `*.skeleton.md` (`AGENTS.skeleton.md`,
  `CLAUDE.skeleton.md`), because Claude Code and other agents load any file named
  `CLAUDE.md`/`AGENTS.md` in a directory they read as live instructions — an unfilled one would
  steer the very session that's filling it in.
- The skeletons are deliberately stack-agnostic. Where a stack-specific example is useful
  (the env module), it's given as an illustration to adapt, not a file to paste.

## Beside the project skeletons

Two directories here aren't copied into a project's own files:

- **`standards/README.md`** is the README `process:apply` delivers as
  `<target>/prompts/standards/README.md`, beside the standards the target is held to: how to read
  them, score the repository, and adopt them with a baseline or waivers. The catalog itself is
  [`standards/`](../standards/README.md).
- **`hub/`** is the skeleton of a private repository of your own that scores every repository you
  have once a week (conformance, process drift, and GitHub settings) and keeps the report in a
  pinned issue. Copy its contents into a new repository, not into a project; its
  [README](./hub/README.md) has the setup.
