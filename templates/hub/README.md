# Fleet hub

A private repository of your own that scores every repository you have against this template's
standards once a week, and keeps the result in one pinned issue: conformance, process drift, and
GitHub settings, with each failure named. After a template release, it also proposes the new
process to every repository, one pull request each. It's a skeleton: copy this directory's contents into a
new private repository (`fleet`, say), not into a project.

It lives outside the template because `fleet.json` names every repository you own, private ones
included.

## What's here

| File | What it is |
| --- | --- |
| `fleet.json` | The repositories to score: the shape of `standards/fleet.example.json`, by URL |
| `.github/workflows/fleet-report.yml` | The weekly run: clone each repository, score it, post the report |
| `.github/workflows/fleet-update.yml` | Run by hand: a dry run of the process update for every repository, or, ticked, one pull request each |

## Setting it up

1. **Create the hub repository** (private) and copy this directory's contents into it. Edit
   `fleet.json`: one entry per repository, by `https://github.com/<owner>/<name>.git` URL, with its
   `visibility` and, where detection misses one, its `packs`.
2. **Create a GitHub App** (Settings -> Developer settings -> GitHub Apps -> New), with no webhook
   and these repository permissions: Metadata (read), Administration (read: what the settings
   check reads; leave it out and those standards are `skipped`), and Contents. Contents is read for
   the report alone; for the update workflow, make it read and write and add Pull requests (read
   and write). Each workflow asks its token for only what it uses. Generate a private key.
3. **Install the app** on your account, for all repositories or each one in `fleet.json` plus the
   template. Either way, each run asks for a token scoped to the repositories `fleet.json` names
   under this account, and the template when it's here too; one under another account isn't
   reached, and a run whose list comes out empty fails rather than ask for every repository. A
   repository in `fleet.json` the app isn't installed on (or that was renamed or deleted) fails
   the token step, and with it the run: install the app there, or take it out of `fleet.json`.
4. **In the hub repository's settings** (Secrets and variables -> Actions):
   - secret `FLEET_APP_PRIVATE_KEY`: the app's private key;
   - variable `FLEET_APP_CLIENT_ID`: the app's client ID;
   - variable `TEMPLATE_REPOSITORY`: the template, `<owner>/<name>`;
   - variable `TEMPLATE_REF`: the release tag to score with (`v1.0.0`), so a template change
     can't move every repository's results without a decision;
   - variable `FLEET_ISSUE`: the number of an issue you create for the report and pin
     (`gh issue pin <number>`).
5. **Run it once** from the Actions tab (Run workflow), and read the issue.

## Proposing a template release

When the template ships a release, set `TEMPLATE_REF` to its tag and run **Fleet update** from the
Actions tab, first as it is (a dry run: the run's summary lists what each repository would get),
then with **apply** ticked. Each repository whose process a re-apply would change gets a branch,
`template/process-<commit>`, and a pull request. A file both sides changed is committed as the
apply parks it (`<name>.template`), and the pull request says to merge it before merging; in that
repository, the `template-update` skill walks through it. A repository already current, or with
a branch for this commit, is left alone, so a second run opens nothing new. Nothing from the
repositories runs on the hub: the clones have no hooks, and the commit skips them.

## Reading it

- The table has a row per repository: the packs scored, counts by status, how many files a
  `process:apply` re-run would change ("current" when none), its settings, and the result.
- "Failing standards" ranks the standards that fail in the most repositories: the ones worth a
  template-wide fix first.
- A repository that fails a standard doesn't fail the job; the report is how you hear about it.
  The job fails only when a repository couldn't be checked (a clone that failed, an invalid
  config, a probe error), because then the report is incomplete.

## Costs and limits

- Each run clones every repository shallowly, so it takes a minute or two for ten repositories.
  A private repository on GitHub Free gets 2,000 Actions minutes a month.
- The settings check makes about six API calls per repository, well inside the app's hourly limit.
- The issue body holds 65,536 characters; a longer report is cut there, and the whole one is in
  the run's summary.
