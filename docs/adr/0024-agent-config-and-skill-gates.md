# 0024. Check agent configuration and skill content on pull requests

- **Status:** Accepted
- **Date:** 2026-11-23
- **Applies to:** The template's own pull requests, pushes to main and manual CI runs

## Context

A syntactically valid agent configuration can grant shell access far beyond a task's needs.
A skill can pass the repository's instruction and routing checks while introducing unsafe
instructions. Either failure matters on a clean checkout, including one whose author has
no scanner or local agent runtime installed.

## Decision

Use AgentShield for agent configuration and its offline package-indicator scan. Use
SkillEvaluator Tier 1 for static checks on the canonical source skills. Give each scanner
one job for the repository and one for controlled fixtures. Both jobs run on every pull
request to main. Separate jobs expose whether the candidate failed or the detector stopped
recognizing the defect. Each negative control must identify the intended finding on the
intended file, alongside a passing clean control. Tool failures block qualification.

Give scanner jobs a read-only repository token and discard checkout credentials. Pin
Actions by commit and container images by digest. Keep the scanners outside the template's
npm dependency tree. Qualify the job names on GitHub before adding them to the live ruleset.
Stage 3 governs delivery to other repositories.

## Alternatives considered

Running the checks only on developers' machines would leave cloud-authored changes without a
verdict. Filtering workflows by changed path could leave required jobs pending on unrelated PRs
and miss changes to the scanner configuration. The current number of skills permits a full scan.

## Consequences and verification

The checks add CI time and depend on the availability of the pinned upstream artifacts. For
a pin update, exercise a clean control, each independent defect, and each fixture after removing
its defect. A report that examined nothing or an unavailable scanner requires investigation.
Roll back a broken integration by reverting to its last qualified pin and rerunning these
checks. Keep the repository's npm audit, workflow lint and skill routing tests in force.

The integration's coverage and the procedure for handling upstream findings are recorded in
[the dependency policy](../security/dependency-policy.md).
