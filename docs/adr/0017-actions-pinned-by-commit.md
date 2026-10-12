# 0017. Workflows pin every action by commit, and CI audits them with zizmor and actionlint

- **Status:** Accepted
- **Date:** 2026-10-07
- **Deciders:** template maintainers (taken on the maintainer's go-ahead to build the deferred
  items; the research record left it as their call)
- **Applies to:** `.github/workflows/`, `templates/hub/.github/workflows/`, and every repository
  held to `core.workflows-audited`

## Context

The template pinned actions by tag (`actions/checkout@v7`), and its research record held back
zizmor and actionlint until someone decided whether to change that. Measured on 2026-10-07:

- **A tag is mutable.** Whoever can push to an action's repository can move `v7` to other code,
  and every workflow that names `v7` runs it on its next run, with that workflow's token. Only a
  full commit SHA can't move. GitHub's hardening guide says the same.
- **zizmor 1.30.1 fails every workflow here as it stands.** Since 1.20.0 its default
  `unpinned-uses` policy requires a hash pin for every action, `actions/*` included (a High
  finding, exit 14). On this repository before this change (commit `eee03f7`, run offline) it
  reported 20 High findings for tag pins, 9 Low for checkouts that persist the job's token in
  `.git/config`, 2 Medium for Dependabot without a cooldown, 2 High for the hub skeleton's app
  tokens granted every repository in the installation, and 5 Low for npm installed by exact
  version (the pinned npm; kept, each with an inline ignore and its reason).
- **The cost of SHA pins is upkeep, and it's automated.** Dependabot's `github-actions` updates
  rewrite a SHA pin and its `# vX.Y.Z` comment together; zizmor's online audits confirm each pin
  is a real commit of the action it names and that the comment matches it.

## Decision

- **Every action is pinned by its full commit SHA, with the release in a comment**
  (`actions/checkout@3d3c42e… # v7.0.1`), GitHub's own actions included: zizmor's default
  policy, with no configuration to loosen it.
- **Checkouts don't persist credentials** (`persist-credentials: false`); nothing here pushes
  through the checkout's remote.
- **Dependabot waits seven days** before taking a new release (`cooldown: default-days: 7`), for
  npm and for actions. Security updates aren't delayed.
- **The hub's app token reaches only the repositories `fleet.json` names**, and the template, by
  a step that lists them before the token is minted.
- **CI audits the workflows on every pull request**, in the main job: zizmor (pinned to 1.30.1,
  online, with the job's token) and actionlint 1.7.12 (downloaded, checksum verified, with
  shellcheck on every `run:` script), over this repository's workflows and the hub skeleton's.
  A finding fails the job. A deliberate exception is an inline `# zizmor: ignore[<audit>]` or
  `# shellcheck disable=<code>` with its reason on the same line.
- **`core.workflows-audited`** holds every repository to the same: a pull request workflow runs
  zizmor and can fail on it.

## Alternatives considered

### Alternative: let GitHub-owned actions keep their tags

A zizmor policy of `actions/*: ref-pin` keeps `@v7` and still hash-pins third parties. It's
less churn, and GitHub moving one of its own tags maliciously is unlikely. It lost because the
risk isn't only malice by the owner (a compromised account or token moves a tag just as well),
because it means configuring a linter to accept what its authors now flag by default, and
because the template is a pattern other repositories copy: the rule people copy should be the one
that holds for every action they add.

### Alternative: the zizmor action, with code-scanning upload

`zizmorcore/zizmor-action` uploads SARIF to code scanning. With that on, it doesn't fail the job
(blocking needs a ruleset), and code scanning needs a public repository or Advanced Security; with
it off, it's a third-party action to pin and keep current for what one `pipx run` does.

## Consequences

- Each Dependabot `github-actions` update is a one-line SHA change per action; reviewing it means
  reading the release, as with any dependency.
- Until Dependabot runs here (it hasn't yet), the pins only move by hand.
- A repository taking `core.workflows-audited` will likely fail it first on tag pins; the fix is
  mechanical (resolve each tag to its commit, keep the tag in a comment), and zizmor marks the
  findings it can fix itself.
