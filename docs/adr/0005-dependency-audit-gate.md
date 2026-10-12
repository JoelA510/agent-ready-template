# 0005. Gate dependencies on high/critical advisories, with an enforced waiver register

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** template maintainers
- **Applies to:** `scripts/check-audit.mjs`, `.github/workflows/audit.yml`,
  `docs/security/audit-waivers.json`, and the dependency-policy skeleton handed to target projects

## Context

When this was written, `npm audit` reported 19 advisories across 9 packages in the template's
tree, 11 of them high, all in dev tooling, and nothing was tracking them. Dependabot is
configured, but on this repository every one of its jobs sat queued until it was cancelled, so no
update PR ever arrived. A sibling project shows the shape this takes over time: a
waiver register existed, and seven advisories accumulated anyway, none of them in it, because
nothing compared the two. Another ran its audit with `continue-on-error`, so the
step could never fail.

## Decision

We will fail CI on any high or critical advisory, in every dependency class, that isn't covered
by a waiver naming the advisory, the package, a reason, an owner, and an expiry at most 90 days
out. The register is enforced as strictly as the advisories: an expired waiver covers nothing, a
waiver for an advisory no longer reported in that package fails, and a report the gate can't
read or reconcile with npm's totals fails. The gate runs per PR, on push to `main`, and weekly.

## Alternatives considered

### Alternative: block on runtime dependencies only (`--omit=dev`)

This is the most common setting, and it would have passed this tree with zero findings. It lost
because the dev tree is what runs in CI with repository credentials and on contributors'
machines, and in a template the dev tree is most of the tree. Supply-chain attacks target exactly
that surface.

### Alternative: a severity threshold with an ignore list (`audit-ci`-style allowlist)

This is simpler to adopt. It lost because an allowlist entry has no owner, no reason, and no
expiry, so it's a permanent suppression. That's the first sibling's failure mode with a different
file format. It would also add a dependency to audit dependencies.

### Alternative: rely on Dependabot security updates

That's free, and it opens fix PRs. It lost as the *only* mechanism because it can stop without
telling anyone. It did on this repository, for two months. It's complementary, not a gate.

## Consequences

- **Easier:** advisories surface on the PR that introduces them, or within a week of
  publication, with the reason for any accepted risk written down next to an expiry.
- **Harder:** a newly published high advisory with no fix turns every PR red until someone writes
  a waiver. That's the intended pressure, but it lands on whoever opens the next PR. Registry
  outages also turn the audit job red ("couldn't check" is not "clean").
- **Depends on settings the repo can't enforce from code:** the audit job must be a required
  status check for "blocks" to be true, and GitHub disables scheduled workflows in public repos
  after 60 days of inactivity. Both are documented in `docs/security/dependency-policy.md`.
- **Revisit if:** npm's audit report format changes (the gate fails loudly rather than drifting),
  or the project adopts a different package manager, in which case port the waiver rules and not
  the script.

## Verification

- `npm run check:audit` exits 0 on a clean tree.
- `scripts/__tests__/check-audit.test.ts` proves each failure mode against canned reports:
  unwaived high or critical, per-package coverage, expired, stale, over-90-day, and invalid
  waivers, unreadable or unreconcilable reports, npm unavailable, and `omit=dev` in the
  environment.
- On the pre-fix lockfile the gate reports 19 advisories (11 high) and fails, even with
  `NODE_ENV=production npm_config_omit=dev` set.
