# Dependency policy

This page covers how this repo decides whether a known-vulnerable dependency can ship. The gate
that enforces it is `npm run check:audit` (`scripts/check-audit.mjs`). The reasoning behind it is
in [ADR 0005](../adr/0005-dependency-audit-gate.md).

## The bar

- **High and critical advisories block**, in runtime, dev, optional, and peer dependencies. The
  build and test tooling runs in CI with repository credentials and on every contributor's
  machine, so an exploitable dev dependency isn't "just tooling". The gate passes `--include`
  for every dependency class. Otherwise `NODE_ENV=production` or an `omit` setting would silently
  shrink what npm reports.
- **Moderate and low advisories are reported, not blocked.** They appear in the gate's output
  and in the **job summary of every audit run**. Clearing them is part of routine dependency
  maintenance: Dependabot's weekly batch if it's running, otherwise an `npm audit fix` PR at
  least monthly. Nothing automatic guarantees that happens, so treat a growing moderate list on
  the summary page as a maintenance debt signal.
- **The audit has to run, and has to be read correctly.** The gate fails, rather than passes, in
  three cases:
  - `npm audit` produced no report (offline, registry outage);
  - a high or critical entry doesn't trace to an advisory it parsed;
  - its counts don't match npm's own totals, because a changed report format could otherwise
    read as "clean".

## Fixing an advisory

1. `npm audit fix`. It stays within your semver ranges, so review the lockfile diff like any
   other change and run `npm run check`. It chooses only releases at least seven days old (the
   install guards, below): when the fix is younger and can't wait, run
   `npm audit fix --min-release-age=0` once the person you work for approves it, and say so in
   the pull request. (npm 10.9, pinned before ADR 0019, failed on this tree
   twice: an arborist `edgesOut` crash, and a lockfile its own `npm ci` rejected. npm 11 has
   neither.)
2. If a dependency pins the vulnerable version exactly, so no in-range update reaches the fix,
   and the fixed version works for it, add an `overrides` entry scoped to that dependency in
   `package.json`. Show the fixed version works: diff what the dependency produces (a build's
   output), or run its tests. Say what the override is for in the CHANGELOG entry that adds it,
   and drop it once the dependency's own range admits the fix (`npm view <dependency>
   dependencies`).
3. If the fix needs a major bump of a direct dependency, make that a normal upgrade PR, with an
   ADR if it's a consequential one.
4. If no fixed version exists yet, or the fix is blocked, add a waiver (below). Don't loosen the
   bar.

## Install guards

When npm chooses a version (`npm install`, `npm update`, `npm audit fix`), it takes only releases
published at least seven days ago, and it refuses a git or tarball-URL dependency that a dependency
brings in. `.npmrc` sets all three (`min-release-age=7`, `allow-git=root`, `allow-remote=root`),
which needs the npm 11 that `packageManager` pins; `npm ci` installs the lockfile as it is either
way. `package.json`'s `allowScripts` records each install script's review (`true` runs it, `false`
stops it). npm 11 still runs one it doesn't name, with a warning: when it warns, read the script,
then add the package. Why: [ADR 0019](../adr/0019-npm-install-guards.md).

## Waivers

A waiver is a time-boxed decision to live with **one advisory in one package**. It lives in
[`audit-waivers.json`](./audit-waivers.json):

```json
{
  "waivers": [
    {
      "advisory": "GHSA-xxxx-xxxx-xxxx",
      "package": "brace-expansion",
      "reason": "Only reachable through a build-time glob over our own source tree; no user input reaches it.",
      "owner": "design-systems working group",
      "expires": "2026-11-30"
    }
  ]
}
```

`advisory` is the id the gate prints for it: its GHSA id, or `npm-<number>` for an advisory the
audit reports without one.

The gate holds the register to the same standard as the advisories:

- **Every field is required.** The `reason` has to say why the risk is acceptable *here*: which
  code path reaches it, and why an attacker can't. "Low risk" isn't a reason.
- **One advisory, one package.** If an advisory turns up in a second package, that path needs
  its own decision and its own waiver.
- **At most 90 days out.** A waiver further out than that is rejected. A waiver with no real
  expiry is a permanent suppression nobody revisits. Renew it with a fresh reason if it's still
  needed.
- **Expired waivers cover nothing and fail.** The advisory is reported as unwaived again, and the
  owner either fixes it or renews the waiver.
- **Stale waivers fail.** When the audit stops reporting an advisory in that package, the waiver
  has to be deleted. Otherwise it would quietly pre-approve the advisory if it ever came back.

## When it runs, and what makes it bind

- **On every pull request and push to `main`**, as its own workflow
  (`.github/workflows/audit.yml`). It needs only the lockfile, not an install.
- **Weekly, on a schedule, against `main`.** Advisories are published against code that has
  already merged, and a repo with no open PRs would otherwise never find out. When a scheduled
  run fails it opens an issue, "Dependency audit is failing on main", once, rather than relying
  on the Actions email, which only reaches whoever last edited the cron line.
- **Make it a required check.** "Blocks" is only true if branch protection (or a ruleset) on
  `main` requires the **npm audit (high and critical block)** status check. A red run on an
  unprotected branch is advisory. The same goes for CI's **Build, lint, typecheck, test**.
- **Know the schedule's limits.** GitHub disables scheduled workflows in public repositories
  after 60 days without repository activity, which is exactly the quiet repo the schedule is for.
  Re-enable it from the Actions tab when you see the banner. Don't rely on Dependabot as the
  backstop: if its jobs aren't running (check **Settings → Advanced Security** and the Actions
  runner settings its jobs use), no update PR ever arrives and nothing tells you.
- **Locally:** run `npm run check:audit` whenever you touch `package.json` or the lockfile.
