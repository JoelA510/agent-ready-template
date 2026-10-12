# Architecture Decision Records

An ADR records one consequential decision: what was decided, what forces pushed on it, what was
rejected, and what it costs. It exists because the reasoning behind a choice evaporates far
faster than the choice itself — a year later the code shows *what* was built, git shows *when*,
and nothing shows *why* the obvious-looking alternative was wrong.

## When to write one

Write an ADR when a decision is expensive to reverse or non-obvious to a competent newcomer:

- The stack, or any component of it (framework, ORM, auth, hosting, package manager).
- A boundary: what belongs in which package/app/layer, and what may not import what.
- A data-model choice with migration cost — identifier types, tenancy model, soft deletes.
- Anything where a reviewer would reasonably ask "why not X?" and the answer takes a paragraph.
- A decision that was *considered and declined*. Rejected migrations are worth as much as
  accepted ones; without a record, the same proposal returns every six months.

Don't write one for a choice a reader can reconstruct from the code in under a minute.

## How

1. Copy [`0000-template.md`](./0000-template.md) to `NNNN-short-slug.md`, taking the next free
   number. Numbers are never reused, and files are never deleted.
2. Fill it in. Be specific about the alternatives — an ADR whose "rejected" section is a
   strawman is worse than none, because it launders a preference as an analysis.
3. Open it in the same pull request as the change it justifies, so review covers both.
4. Superseding a decision means writing a *new* ADR that references the old one and flipping the
   old one's status to `Superseded by NNNN`. Never edit a decided ADR's substance — the record
   of what was believed at the time is the value.

## Index

| # | Decision | Status |
| --- | --- | --- |
| [0001](./0001-interface-foundation.md) | Interface foundation: React 19, Tailwind v4, Radix, tokens as source of truth | Accepted |
| [0002](./0002-process-distribution.md) | Distribute the process by copying files, not by dependency or service | Accepted (refined by 0006, 0011) |
| [0003](./0003-dark-status-roles.md) | Dark-theme status roles are light fills with dark text | Accepted |
| [0004](./0004-solid-focus-ring.md) | Focus rings are drawn at full opacity | Accepted |
| [0005](./0005-dependency-audit-gate.md) | Gate dependencies on high/critical advisories, with an enforced waiver register | Accepted |
| [0006](./0006-staged-skeletons-and-apply-manifest.md) | Stage skeletons under prompts/skeletons and track applies with a manifest | Accepted (refined by 0011; three-way merge revisited by 0016) |
| [0007](./0007-agents-md-with-claude-import.md) | AGENTS.md holds the agent rules; CLAUDE.md imports it | Accepted (extended by 0011) |
| [0008](./0008-supported-node-versions.md) | Pin the active Node LTS, support the maintained lines, and test the floor | Accepted |
| [0009](./0009-wcag-2-2-aa.md) | WCAG 2.2 AA is the accessibility bar, with each new criterion's coverage stated | Accepted (extended by 0012) |
| [0010](./0010-token-pipeline-colors-and-native-shapes.md) | One color grammar, React Native shapes from authored values, and no partial builds | Accepted |
| [0011](./0011-agent-portable-workflows.md) | Workflows are Agent Skills, and this repo's rules live in AGENTS.md | Accepted |
| [0012](./0012-stories-in-a-real-browser.md) | Every story runs in a real browser, with axe as a gate | Accepted |
| [0013](./0013-registry-on-pages.md) | The component registry is published with Storybook, and its items link by URL | Accepted |
| [0014](./0014-tagged-releases-and-template-version.md) | Projects take template updates from tagged releases | Accepted |
| [0015](./0015-standards-catalog-and-conformance.md) | Standards are a catalog with stable IDs, grouped in packs, and scored by a conformance check | Accepted |
| [0016](./0016-apply-delivers-standards-proposes-merges-checks-drift.md) | process:apply delivers the standards, proposes merges, and checks drift | Accepted |
| [0017](./0017-actions-pinned-by-commit.md) | Workflows pin every action by commit, and CI audits them with zizmor and actionlint | Accepted |
| [0018](./0018-a-guard-and-a-setup-for-every-agent.md) | Every agent with hooks runs the generated-file guard, and every cloud agent sets up the same way | Accepted |
| [0019](./0019-npm-install-guards.md) | Pin npm 11, and make npm wait for releases to age and refuse a dependency's git dependencies | Accepted |
