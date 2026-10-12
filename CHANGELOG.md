# Changelog

All notable changes to this template are recorded here. As
[`GOVERNANCE.md`](./GOVERNANCE.md) describes, entries should be written in plain language for
whoever consumes the system — what changed and what a consumer needs to do — not a paste of
commit messages. This project follows [Semantic Versioning](https://semver.org/): breaking
token/component changes bump the major, additive changes the minor, fixes the patch.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.0.0-rc.3] - 2026-10-12

Fixes from the first existing-repository trial, run as far as it goes: an audit and remediation
plan for an existing web game, then milestone 1 of that plan, carried out. Every template
finding the trial raised is fixed here: F1-F9 from the audit and plan, and P1-P4 from execution.
The largest changes are a thirteenth audit area, core flows (does each flow the product promises
work end to end?), and the Node floor rising to `^22.22.2 || ^24.15.0`. Before 1.0.0 the release
bar (CONTRIBUTING.md §8, step 5) still asks for a rerun of the steps these fixes changed, on a
fresh trial of each kind.

### Changed

- **Dependabot holds back ESLint 10 and TypeScript 7** until what blocks them ships, with the
  reason beside each entry in `.github/dependabot.yml`. ESLint 10: `eslint-plugin-jsx-a11y`, which
  enforces the accessibility bar in lint, accepts ESLint up to 9 in its latest release. TypeScript
  7: it has no JavaScript compiler API, which the scorecard and `check:env` read tsconfig through,
  and `typescript-eslint` supports TypeScript below 6.1. A fork inherits the holds; remove each
  when its blocker is gone.
- **The Node floor rises to `^22.22.2 || ^24.15.0 || >=26.0.0`** (was `^22.12.0 || ^24.0.0 ||
  >=26.0.0`), with jsdom 30.1.2 (was 29.1.1) and lint-staged 17.6.0 (was 16.4.0). jsdom 30
  declares that range, and lint-staged 17 needs Node 22.22.1 and Git 2.32 or later. The CI floor job
  runs 22.22.2. A project built from the template takes the new `engines` with the release; a
  machine on an older 22 or 24 needs a newer patch release of that line. `@tanstack/react-table` is
  9.2.6 (was 9.2.4), a patch.
- **Workflows install the pinned npm with that npm itself** (`npx -y npm@<pin> install -g
  npm@<pin>`), not `npm install -g npm@<pin>`. npm 10.9.7, which Node 22.22.2 bundles, fails
  replacing itself with npm 11 ("Cannot find module 'promise-retry'"), so the floor job broke on
  the new floor. A project whose own workflows install npm that way on Node 22 should make the same
  change.

- **The existing-project audit gains a thirteenth area, core flows.** For each flow the README,
  spec, or definition of complete promises, the auditor lists it, exercises it end to end (in the
  configurations the docs offer, not only the default), and names the test that proves it. A
  broken flow is a blocker. The twelve areas grade how the code is built, so a product could pass
  every gate and every area with a flow nobody can finish; an existing-repository trial found
  exactly that and had to file it under accessibility. The audit skeleton gets the section and a
  flow table, and a standard's `audit-area` accepts 1-13. Areas 1-12 keep their numbers, so earlier
  audits and finding IDs still line up. A project picks up the prompt and skeleton on its next
  re-apply.
- **The run log records the first Phase 3 run** (an existing-repository trial executing milestone
  1 of its plan), with four template findings it raised. Nothing to do in a project.

- **A CI workflow skeleton for Node projects**, `.github/workflows/ci.yml` beside the ruleset
  skeleton: no token permissions, actions pinned by commit, Node from `.nvmrc`, one step per gate,
  and an optional end-to-end job. Its job names are the ruleset's required checks. A test holds its
  pins (and the hub skeleton's) to the commits this template's own workflows use, so a Dependabot
  bump here can't leave projects an older pin. The existing-repository trial's Phase 3 had to copy
  this repository's workflow by hand. A project gets it staged under `prompts/skeletons/` on its
  next re-apply.
- **The remediation plan asks which findings each fix widens.** A fix that makes another defect
  more frequent or reachable (unblocking a path that runs into it) moves that finding into the
  same milestone, and the item says so (a new "Widens" field). In the trial, letting AI-first
  games play made a turn-counter bug fire on every rotation; the plan had it a milestone later.
- **The env-validation skeleton has an optional case.** An optional integration (an error
  reporter's DSN, an analytics key) is off when unset and fails only on a placeholder or
  malformed value. Marked required, as the skeleton implied, it fails every build until the
  account exists; the trial's plan wrote exactly that criterion and had to change it.

### Fixed

- **`node.strict-types` failed a TypeScript 6 project that is strict.** TypeScript 6 turned
  `strict` on by default, and the check only read an explicit `"strict": true`, so a project
  leaving it unset was reported as "strict is off". The check now reads the project's TypeScript
  version (installed, else the lowest major its declared range allows): unset passes from 6 on,
  fails below 6, and fails, saying why, when the version can't be read. An existing-repository
  trial found it; a project whose scorecard failed this standard for that reason passes on its next
  run.
- **The scorecard named standards a repository couldn't read.** `process:apply` delivers a pack's
  standards only with `--pack`, but the scorecard scores every pack it detects. For a repository
  that took the process, the scorecard now names the packs it scored without their standards, and
  the `--pack` flags that deliver them.
- **The existing-project prompt's scorecard step skipped what depends on visibility, and left out
  repository settings.** The command now passes `--visibility` from the run's inputs, and the
  prompt runs `check:settings` for the settings standards, recording what it can't read as skipped.
  The audit skeleton's baseline table gains rows for settings, the environment checks, and the
  agent-instruction check. Projects get both on their next re-apply.
- **`/complete` stopped to ask for the definition of complete** even when the README answers it. It
  now derives it from the README, product docs, or spec, states it as an assumption, and asks only
  when the repository gives nothing to derive it from.
- **A re-apply after a history break parked plain files instead of merge proposals.** When a
  target's manifest records a commit this template's history doesn't hold, which is every target
  applied before this repository's own history begins, `process:apply` couldn't read the version
  it last offered, so a file both sides had changed was parked as the plain new version. It now
  finds that version by its recorded hash among every version of the file here, and parks a
  three-way merge proposal wherever the offered version survived. The warning that the recorded
  commit isn't here now also names "a repository this template was copied from without its
  history". For a target applied before this repository existed, that's the case: expect the
  warning once, review the re-apply's diff, and the next re-apply records a commit from here.
- **The existing-project prompt didn't say which commit the scorecard scores.** The delivery is
  committed before the run, so scoring the working repository scored the delivery: its own
  standards (`core.process-delivered`, and `core.instructions-resolve` over the delivered skills)
  passed because of it. The prompt now records the commit before the delivery as the audited one,
  scores the same clean clone the gates ran in, and says to note it when the delivery commit is
  scored instead.
- **`/complete` named one audit folder where the prompt lets the repository's convention win.** The
  skill now says what the prompt says: `docs/audits/YYYY-MM-<slug>/`, or a dated folder wherever
  the repository already keeps its plans and audits.
- **`core.agent-rules` said "no agent rules found anywhere"** after looking only where agents read
  by default. It now says "no agent rules in any file an agent reads by default". The prompt's
  §12 tells the auditor to look for rules kept in ordinary docs (a handoff file, prompt packets),
  check them by hand, and plan to merge them into AGENTS.md.
- **Docs that had gone stale.** The README's skills list now names `plan-change` and
  `template-update`, its `npm run check` row names knip and the bundle budget, and it says
  `v1.0.0-rc.2` is the first release tagged here. The AGENTS skeleton's hook guidance says the
  template's hook runs `scripts/setup.sh`, which installs the `.nvmrc` Node, rather than "whatever
  Node the container has". The Table story says DataTable pairs it with TanStack Table, and the
  Command story points at Combobox instead of a follow-up round. ADR 0015 gets a follow-up noting
  that `fleet:update` opens the pull requests. A project's copy of the AGENTS skeleton changes on
  its next re-apply; nothing else to do.
- **`check:upgrade-path` failed a CI re-run on a repository's first release commit.** With every
  `v*` tag on `HEAD` there's no earlier release to upgrade from, which is the same situation as no
  tag at all, so it now passes with "HEAD is the first release". A shallow clone, and tags that
  exist with none behind or on `HEAD`, still exit 2. Nothing to do in a project.

## [1.0.0-rc.2] - 2026-10-12

The first release published from this repository. `v1.0.0-rc.1` was never tagged here, so a
project starts from this release; the rc.1 entry below is kept for its history.

Fixes from the first trial of the candidate: the process alone, applied to an empty private
repository and run through `/bootstrap`, then run again on the fixed process. And the start of a
standards system: a catalog of standards with stable IDs, a check that scores any repository
against it and its GitHub settings, a report across all of them, and the process delivering the
standards to each repository and telling it when it has drifted.

### Added

- **`writing.vocabulary-registered`: the prose check reads the project's vocabulary.** A writing
  repository's prose check, run on pull requests, has to read an accept list (the names and terms
  it uses, with spelling on, so an unregistered one fails) and a reject list (retired names, wrong
  casings, banned spellings). The reject list is required. Both dictionaries pass common names:
  cspell 10.3.6 and Vale 3.24.0 pass *Denise* and *Vicky* unregistered. So a character renamed
  away from Denise comes back without a sound unless Denise is rejected.
  - **The files a run checks:** its path arguments, or every file under its directory when `xargs`
    or `find -exec` feeds it. For cspell, quoted globs from its root (the action's `files`),
    skipping dot folders unless `--dot`, less `--exclude` and `!globs` at any depth, or with no
    argument the config's `files`. For Vale, a quoted glob lints nothing, because Vale doesn't
    expand it. An unquoted glob is the shell's, so the run is `skipped`. Each file must get both
    lists or neither: a reject list that reaches only `docs/` fails, naming the files that lack it.
  - **cspell:** the probe reads the settings each Markdown file gets, merged as cspell merges
    them. It takes the root config (`--config`, else the nearest from the run's root,
    `package.json`'s `cspell` key first) and the nearest config above the file, unless
    `--no-config-search` is given. It applies every config's own settings first, then the
    `overrides` that cover the file, then the `languageSettings` for Markdown. Globs (braces and
    classes included) are relative to each config's glob root. It reads `words` and `flagWords`
    and enabled dictionary files, `!` entries included. It fails what lets an unknown or flagged
    word through: `--report` or `unknownWords` below all; an `ignoreRegExpList` entry that hides a
    capitalized word, whether a regex, a bare string, a named pattern or `Everything`;
    `ignoreWords` that holds a flagged word; a `minWordLength` above 4; a missing dictionary; a
    phrase in `flagWords`, which cspell ignores; a lowercase flag that also flags a registered
    word; and `enabled: false` or `ignorePaths` leaving no Markdown checked.
  - **Vale:** the probe reads each `Vocab` in Vale 3's `config/vocabularies/`, with a hint when
    it's in Vale 2's place. It applies `.vale.ini` to each Markdown file as Vale 3.24.0 does:
    `[*]` first, then the sections that match the file's path from where Vale runs (`*` crosses
    `/`), with a repeated section merged into its first place. The last `BasedOnStyles` wins, a
    rule's own setting outlasts it, and a setting other than `YES`, `NO`, `UNSET` or a lowercase
    level turns the rule off. `MinAlertLevel` and the run's fail level both count. The accept half
    needs `Vale.Spelling` on, and the reject half the `Avoid` rule. It fails a list no rule reads,
    a `--filter` that names one of the rules, a `--glob` that leaves out the Markdown, and a
    rejected phrase that holds an accepted term (Vale never reports it), a regex entry's match
    included. Any other `--filter` is `skipped`, as is a directory, path or glob it can't follow.
  - **The repository's own checker:** its lists are named in `conformance.json`'s new
    `vocabulary` field. Each must exist, have an entry, and be named by the checker CI runs, or by
    a code file it names. Without the field, the result is `skipped`.
  - A run with no list of its own isn't a fault. One example is Vale running another style beside
    a cspell that holds both lists: the standard asks only that the runs between them hold both.
  - markdownlint and textlint alone fail. markdownlint's proper-names rule passes any name it
    doesn't list, and textlint's prh rules aren't counted yet.
  - Each rule was run against cspell 10.3.6 or Vale 3.24.0 before it was written down, with two
    exceptions. Vale's docs say `Vale.<Name>.Terms = NO` turns a section vocabulary's rule off;
    3.24.0 ignores it, but the probe counts it as off. And vale-action's `glob`, `min_alert_level`
    and `files` inputs are read as the flags they pass on, without the action being run. 72 tests,
    with planted defects.

- **`llms.txt` at the Pages site's root**, for an agent looking for a component: the registry's
  name, a summary of what an item is and how to install one, and a link with a one-line note to
  every item, in the llmstxt.org format (an H1, a blockquote, H2 sections of links).
  `npm run registry:build` writes it to `public/llms.txt` beside the registry it indexes, so it's
  rebuilt, checked for drift, and guarded the same way; Storybook's build copies it to the site.
- **A link's anchor is checked too**: an inline relative link with `#section` in any Markdown or MDX
  file has to name a heading (by GitHub's slug) or an `id` in the page it points to, so renaming a
  heading can't silently break the links into it. Reference-style links aren't read. Relative link
  paths were already checked; TanStack's `verify-links` checks paths only.
- **`npm run check:bundle`: a size budget for what the app build ships**, in the gate after
  `npm run build`. `bundle-budget.json` names globs under `dist/` with a gzipped limit and the
  reason for each (JS 90 kB against 79.0 kB today, CSS 20 kB against 17.5 kB);
  `scripts/check-bundle-size.mjs` sums each glob and fails over budget, or when a glob matched
  nothing. It needs no dependency: size-limit 14 requires Node 22.19, above this template's 22.12
  floor. A new standard, `vite-spa.bundle-budget`, asks every Vite app for a size check on pull
  requests where it can fail (this script, size-limit, bundlesize, or bundlewatch).
- **`npm run check:unused`: knip, in the gate**, after lint. It fails on a file nothing imports,
  an export nothing uses, and a dependency nothing loads; `knip.json` names what it can't infer
  (the components' exports are their public API; the hook script; the two parsers
  `check-conformance` loads at runtime) and leaves out generated outputs. Its first run found
  five script exports nothing imported, now unexported. A new standard, `node.unused-code`, asks
  every Node repository to run knip on pull requests where it can fail. knip 6.39.0, the newest
  release past the seven-day wait.
- **A standards catalog, scored by `npm run check:conformance`**
  ([ADR 0015](docs/adr/0015-standards-catalog-and-conformance.md)). `standards/` holds the
  deterministic half of the existing-project audit, one file per standard, each with a stable ID
  (`node.strict-types`), a severity, its audit area, and whether a probe or a person checks it.
  `core` applies to every repository; the first stack packs are `node`, `vite-spa`, `supabase`, and
  `python`, applied where their markers are found or where a repository declares them, at a path if
  the project lives below the root. `npm run check:conformance -- --root <repo>` scores any
  repository from a template checkout, with nothing installed in it: pass, fail, n/a, skipped (an
  input is missing, and it says which), or error (a probe couldn't run; exit 2, never a pass). A CI
  command counts only where its failure fails the run.
  - **Adopting it:** a repository keeps `docs/standards/conformance.json`. `--write-baseline` records
    today's failures so only new ones fail the run, and afterwards only shrinks the baseline;
    waivers need a reason, an owner, and an expiry within 90 days, like the dependency audit's. A
    waiver or baseline entry whose standard passes again fails the run until it's removed.
  - **Every repository at once:** `npm run fleet:report -- --fleet <file>` scores each repository in
    a fleet file (local paths or git URLs, shape in `standards/fleet.example.json`) and writes one
    markdown table, with the failing standards ranked by how many repositories they fail in. Keep
    the real fleet file in a private repository of your own.
  - **This repository adopts its own standards, and meets them.** The first run failed
    `node.ci-runs-gate` (CI never ran the app's `build` script); that's fixed below, and the
    recorded baseline is empty.
  - **`existing-project.md`'s baseline now runs it,** and the audit skeleton's baseline table has a
    row for it: a failing standard is a finding, cited by its ID. A repository that received the
    process gets the prompt change on its next re-apply.
  - **Five more packs:** `expo` (every `eas update` names `--environment`, a runtime version
    policy, `check-env` at the app's path, `expo-doctor` in CI), `tauri` (a CSP without
    `unsafe-eval`, narrowly scoped capabilities, the updater's private key out of the repository,
    clippy, fmt, and tests in CI, and `cargo deny` or `cargo audit`), `godot` (headless tests in
    CI, one engine version), `static-site` (security headers, the files the site serves actually
    deployed, an HTML or link check in CI), and `writing` (prose checks in CI). Each probe was
    shown failing on a planted defect, and each pack was run against the maintainer's repository
    of its kind.
  - **GitHub settings, scored over the API:** `npm run check:settings -- --repo <owner/name>`
    checks the five `core.settings-*` standards, which live in a repository's settings rather
    than its files: a read-only default workflow token, Dependabot alerts and security updates, a
    default branch that requires a status check, and, for a public repository, private
    vulnerability reporting and secret scanning with push protection. It needs a token that can
    read the repository's admin settings, and reads a 404 as "off" only after confirming the
    token has admin access; a private repository on GitHub Free, which can't enforce branch
    protection, is `n/a` for it. `check:conformance` lists these standards and never scores them.
  - **The fleet report** adds a column for process drift (how many files a `process:apply` re-run
    would change) and, with `--settings`, one for settings. `templates/hub/` is the skeleton of a
    private repository that runs it weekly, with a GitHub App's token, and keeps the report in a
    pinned issue.
- **`process:apply` delivers the standards, proposes merges, and reports drift**
  ([ADR 0016](docs/adr/0016-apply-delivers-standards-proposes-merges-checks-drift.md)). The
  `core` standards land in `prompts/standards/`, with a README written for the target;
  `--pack <name>` adds a pack's and the manifest remembers it, `--drop-pack` stops. A file both the
  target and the template changed now gets a merge proposal beside it (`<name>.template`, both
  sides combined, any conflict marked) when the version last delivered is still in the template's
  history, instead of only the new version. `--check` writes nothing and exits 1 when a re-apply
  would change something, for a CI job or the fleet report. It warns when the target's
  `.gitignore` would keep a delivered file out of git (`.claude/` is a common one). A target picks
  all of this up on its next re-apply.
- **`verify`, a skill and prompt for the checks before each commit:** the repository's fast
  checks (lint, typecheck, the tests a change touches, generated files rebuilt), on the tree being
  committed. Claude Code 2.1.286 and later run a project skill named `verify` before each commit,
  except for changes only to docs or tests; it takes the place of the bundled `/verify`, which
  builds and drives the app (`/run` still launches it). `process:apply` delivers it, except to a
  target that already has a `verify` skill of its own (the bundled `/verify` records its run
  recipe at `.claude/skills/verify/SKILL.md`): there ours is held back, both copies, and the
  report says how to take it.
- **`harvest`, for turning a check proven in one repository into a standard** every repository is
  held to: prove it failing in its source, generalize it, write the standard, its probe, and a
  planted-defect test, and measure which repositories it fails. It works on the catalog, so it
  stays in the template; `process:apply` doesn't deliver it.
- **`discovery`, a skill for finding what to verify before the next piece of work**, and its
  template, `prompts/discovery.md`. With nothing given, it runs Stage 0: a read-only survey of
  the repo for the open questions the upcoming work rests on, grouped by when to run them, and
  it stops at that list. Given the candidate you pick, it drafts a filled-in Stage 1 prompt for
  you to review and run in a fresh session; it doesn't run it. It's a day-to-day prompt, so its
  runs aren't logged in `prompts/run-log.md`. `process:apply` delivers the prompt and the skill
  on the next re-apply; a fork or a "Use this template" repository gets them by merging the
  release.
- **`plan-change`, for agreeing on a change before building it**, and its prompt,
  `prompts/plan-change.md`. It sizes the change first and stops when it's small enough not to
  need a plan; otherwise it reads `docs/product.md`, AGENTS.md, and the accepted ADRs, and writes
  a plan in the shape of the new `docs/change-plan.md` skeleton: why, the behavior in user terms,
  what's out of scope, where it meets the repository's rules, the design, risks and rollback, the
  tasks in order, and when it's done. The new `docs/product.md` skeleton (mission, users,
  non-goals, constraints) is what plans are measured against; `new-project.md` asks for it in
  Phase 2. `process:apply` delivers the prompt, the skill, and both skeletons on the next
  re-apply.
- **Template updates reach every repository as a pull request.**
  - **`template-update`, a skill and prompt for taking a release**
    (`prompts/template-update.md`): it finds where the repository is (the manifest's
    `templateCommit`, or `package.json`'s `templateVersion`), reads the CHANGELOG from there to
    the release, re-applies or merges the release tag, works through each parked
    `<name>.template` file, and does what the release's entries ask of a repository like this one.
  - **`npm run fleet:update -- --fleet <file>`** proposes this template's process to every
    repository in a fleet file: it clones each, runs `process:apply` with the packs the
    repository already takes, and, with `--apply`, pushes a `template/process-<commit>` branch and
    opens one pull request where anything changed. Without `--apply` it's a dry run. Nothing from a
    repository runs (no hooks, no package scripts). A re-run doesn't push again: it opens the pull
    request for a branch an earlier run pushed but couldn't propose, and leaves one already
    proposed alone (one that was declined says so, and stays closed). A repository with an
    earlier update still open waits for it to be merged or closed (both would rewrite the
    manifest); a dry run with a token says so too, or says it couldn't check. A fleet `ref` that's a tag is refused before
    anything is pushed, since a pull request needs a branch. What `process:apply` warns about (a
    `.gitignore` that covers delivered files, a target last applied from a newer template) goes
    into the pull request, and ignored delivered files are committed so the manifest matches the
    branch. `templates/hub/` gains a **Fleet update** workflow that runs it by hand.
  - **`npm run check:upgrade-path`** proves a repository that took the last release's process can
    take this commit's: it applies the previous `v*` tag's process to an empty repository, then
    this commit's over it, and fails when anything is parked or left over or `--check` isn't
    current afterwards. A release counts before its candidates (`v1.0.0` over `v1.0.0-rc.1`).
    CI runs it on every pull request. It applies no packs, since an older release may not take
    `--pack`.
- **Supply-chain standards, and the template meets them**
  ([ADR 0017](docs/adr/0017-actions-pinned-by-commit.md)). Every action in the template's
  workflows and the hub's is pinned by its full commit SHA, with the release in a comment;
  checkouts don't keep the job's token; Dependabot waits seven days before proposing a release;
  and CI runs zizmor and actionlint (with shellcheck) over the workflows on every pull request.
  The hub workflows' app token now reaches only the repositories `fleet.json` names. Four new
  standards, each shown failing on a planted defect:
  - `core.workflows-audited`: a pull request workflow runs zizmor where a finding can fail it;
  - `core.dependency-cooldown`: every Dependabot entry waits three days or more (no shorter
    semver override, no `exclude: ["*"]`), or Renovate waits that long for every package, with no
    scoped rule shortening it;
  - `core.audit-waivers`: every waived advisory, in any register (`osv-scanner.toml`, the npm
    gate's `audit-waivers.json`, `deny.toml`, `.cargo/audit.toml`, or an `--ignore` flag in CI),
    has a reason and an expiry within 90 days;
  - `python.audit-gate`: the Python dependencies are audited on pull requests and on a schedule.

  The dependency-policy skeleton gains a section for a repository with more than one ecosystem:
  OSV-Scanner over every lockfile, `osv-scanner.toml` as the one register, and the stricter bar
  that implies, since OSV-Scanner fails on any advisory whatever its severity. A repository taking
  `core.workflows-audited` will likely fail it first on actions pinned by tag; the fix is
  mechanical.
- **Skill evals** (`evals/`, run by `claude plugin eval`): whether each skill a model can start
  fires on the phrasing someone would use, and no skill fires on a request that needs none; and two
  cases on what a prompt makes an agent do (`plan-change` declines to plan a typo fix,
  `review-change` finds a tenancy hole). `.claude-plugin/plugin.json` loads the skills as a plugin
  for them. They call a model, so they run by hand or monthly (the **Skill evals** workflow, with an
  `ANTHROPIC_API_KEY` secret), not per pull request; `evals/README.md` has the commands and costs.
  `npm run test` keeps the suite whole: a skill a model can start fails it until it has a routing
  case. Template only; `process:apply` doesn't deliver them.
- **Every agent with hooks runs the generated-file guard, and cloud agents set up the same way**
  ([ADR 0018](docs/adr/0018-a-guard-and-a-setup-for-every-agent.md)). `scripts/guard-generated.mjs`
  now reads Codex's, Copilot's, Gemini CLI's, and Antigravity's payloads as well as Claude Code's
  (Cursor and Copilot CLI already ran Claude Code's), including the files a Codex `apply_patch`
  touches, and each agent's config registers it for that agent's file tools: `.codex/hooks.json`,
  `.github/hooks/guard-generated.json`, `.gemini/settings.json`, and `.agents/hooks.json`. Codex
  asks you to trust the hook (`/hooks`) before it runs. `scripts/setup.sh` is the one setup: the
  Node `.nvmrc` pins (installed with mise or nvm when the running one differs; it stops when
  neither is there), then `npm ci`. Claude Code on the web's SessionStart hook runs it and puts
  that Node on the session's PATH, which cloud sessions lacked (they ran Node 22 against a pin of
  24); Cursor's `.cursor/environment.json` runs it; AGENTS.md says to make it a Codex cloud
  environment's setup script; and `copilot-setup-steps.yml` sets up the Copilot cloud agent the
  way CI does. Each config's command is tested as registered, on its agent's documented payload;
  none was run inside the agents themselves.

### Changed

- **Breaking: `DataTable` runs on TanStack Table v9** (`@tanstack/react-table` 9.2.4, was
  8.21.3, the last v8 release; [the agreed plan](docs/changes/2026-10-08-tanstack-table-v9.md)).
  Sorting, search, pagination, and the empty state behave as they did: `data-table.test.tsx`
  holds them, written and passing on v8 first, and every story passes axe in jsdom and in
  Chromium, light and dark. Two things change. `'auto'` picks a column's sort from its first ten
  rows, where v8 looked from the eleventh on. So a sortable text column of ten rows or fewer,
  which v8 always sorted case-sensitively (`Cherry, Item 10, Item 2, apple, banana`), now sorts
  digits in numeric order and letters regardless of case
  (`apple, banana, Cherry, Item 2, Item 10`), and a longer column whose first ten rows differ
  from the rest can get a different sort than it did. And turning `paginated` off after mount
  now shows every row; v8 kept showing the page.
  **To migrate:**
  - Type column definitions with the features the table registers, which `data-table.tsx` now
    exports: `ColumnDef<Row>[]` becomes `ColumnDef<DataTableFeatures, Row>[]` (import
    `DataTableFeatures` from `@/components/ui/data-table`, `ColumnDef` from
    `@tanstack/react-table` as before), and `createColumnHelper<Row>()` becomes
    `createColumnHelper<DataTableFeatures, Row>()`. `DataTableProps` and `DataTable` lose their
    second type parameter (`TValue`), and `columns` is typed as v9's `useTable` takes it: an
    inline column's value is `unknown` until it's named (`getValue<number>()`), as on v8, and a
    column helper's list goes through `helper.columns([...])`, which v8 lacked (it took an
    unwrapped list only when its columns shared one value type). A row type has to be an object
    or an array (v9's `RowData`).
  - A column's `sortingFn` is now `sortFn`, and the only names it takes are `'auto'` and the
    sorts the table registers: `'text'`, `'alphanumeric'`, and `'datetime'`. Pass any other as
    the function, imported from `@tanstack/react-table` (`sortFn_basic`,
    `sortFn_textCaseSensitive`, `sortFn_alphanumericCaseSensitive`). `'auto'` picks one of the
    three, or `sortFn_basic`.
  - v9 needs React 18 or later (v8 took 16.8) and Node 20 or later, and ships ES modules only.

  The always-unset `data-state="selected"` on rows is gone:
  selection was never enabled, and v9 has no `getIsSelected` without its selection feature. The
  registry item now names `@tanstack/react-table@^9`, so `shadcn add data-table` installs the
  v9 component; a project that added the v8 item keeps it until it re-adds, and v9's deprecated
  `useLegacyTable` (`@tanstack/react-table/legacy`) is its bridge if it needs time. v9 brings
  `@tanstack/store` and `@tanstack/react-store` with it.
- **Two operating rules from TanStack Router's agent instructions**, in AGENTS.md and the shared
  operating rules (`new-project.md` and the AGENTS skeleton): a failed install is reported, never
  forced through (no force flags, no deleted or hand-edited lockfile, no loosened install
  settings), which matters now that npm refuses young releases and git dependencies; and a
  dependency's bug is fixed upstream, with a local workaround only when the person you work for
  says so, naming the upstream issue. `prompts/investigate.md` takes two more: the reproduction
  drives the public interface, not the internals the fix will touch, and a fix handles only
  states real usage can reach. A target gets them on its next re-apply. The decision-guide
  workflow moved from AGENTS.md to `docs/proposals/README.md`, to keep AGENTS.md under its size
  limit.
- **`review-change` starts on a pasted diff**, and `prompts/review.md` takes one as its target. The
  new routing eval found the skill never fired for "take a hard, critical look at this change before
  I merge it" with the diff in the message (0 of 3 runs); with the description naming reviews, a
  critical look, and a pasted diff, it fired 3 of 3. The prompt now says to state the diff it was
  given, and which findings a diff without its repository leaves statically reviewed. A target
  gets both on its next re-apply.
- **`npm run check` builds the app** (`npm run build`: `tsc -b && vite build`), between lint and the
  Storybook build. CI ran the gate without it, so a change that type-checked but broke Vite's
  production build of `src/` passed; the new `node.ci-runs-gate` standard caught it. The gate takes
  about twenty seconds longer. A project built from the template gets the same line on its next
  update; one that removed the app keeps its own `check`.
- **Every dependency is current within its range**, the grouped update Dependabot would make
  (it has never run on this repository): 57 direct dependencies, with each `package.json`
  floor raised to the version tested, and their transitive updates. The ones that need a major
  are listed under "not taken" below. One update makes the browser tier stricter: **axe-core 4.14
  runs `label-content-name-mismatch` by default** (WCAG 2.5.3, Label in Name; it was
  experimental, so off, through 4.12). A project that takes this update and renders a control
  whose `aria-label` leaves out its visible text will fail `npm run test:browser` until the name
  includes that text; the two such cases here are under Fixed.
- **Not taken, each a separate upgrade:** ESLint 10 (`eslint-plugin-jsx-a11y` 6.10.2 supports
  ESLint only up to 9) and TypeScript 7 (`typescript-eslint` supports below 6.1).
  `@tanstack/react-table` 9 was taken separately, below, since it breaks `DataTable`'s types.
- **jest-axe is 11** (was 10), so the jsdom tier's axe check (`npm run test`) runs axe-core
  4.12.1 instead of 4.10.2. jest-axe 11 changes nothing else: its code is the same apart from
  formatting, and it needs Node 18 or later. Every story passes under the newer rules. The
  browser tier already ran axe-core 4.14 through Storybook's a11y addon.
- **Vitest is 5** (was 4), with `@vitest/browser-playwright` 5, for both test tiers. Vitest 5's
  `Assertion` no longer extends the global `jest.Matchers` that `@types/jest-axe` types
  `toHaveNoViolations` on, so `vitest.setup.ts`, which registers the matcher, now declares it on
  Vitest's own `Matchers` too. A project built from the template that registers other
  Jest-style matchers needs the same declaration for each. Nothing else in Vitest 5's breaking
  changes touches these tests: the suites pass with the same counts, and a planted violation
  still fails both tiers. Installing it with npm 10 needs the old `vitest` and `@vitest/*`
  lockfile entries removed first, or npm can't move vitest and its pinned peers together.
- **TypeScript is 6.0.3** (was 5.9.3), still pinned exactly. TypeScript 6 makes `baseUrl` a
  deprecation error, so `tsconfig.app.json` drops it; `paths` resolves from the file that
  declares it, so `@/*` still maps to `src/`. TypeScript 6's new defaults (`types: []`, `strict`,
  `module: esnext`) change nothing here: every tsconfig already sets what it relies on, and a type
  error planted in each project still fails `npm run typecheck`. A project built from the
  template with `baseUrl` in its own tsconfig needs the same removal, and if it relied on
  `@types/*` packages being included automatically, it now lists them under `types`. TypeScript
  7 stays out of reach until `typescript-eslint` supports it.
- **npm is pinned at 10.9.9** (was 10.9.7): `packageManager`, which every CI job installs. The
  dependency policy says what to do when the pinned npm writes a lockfile its own `npm ci`
  rejects, which 10.9.7 and 10.9.9 both do on this tree after an `npm update`.
- **CI uses `actions/checkout` and `actions/setup-node` v7.** v7's breaking changes are a
  checkout block for `pull_request_target` and `workflow_run` (no workflow here uses either) and
  an internal move to ESM; both still run on Node 24.
- **`vite.config.ts`, `vitest.config.ts`, and `vitest.browser.config.ts` use
  `import.meta.dirname`** instead of `__dirname`. Vite 8.3 warns that `__dirname` doesn't exist
  under its native config loader, which a future major makes the default; with
  `--configLoader native` the old configs failed (`ReferenceError: __dirname is not defined in ES
  module scope`). The build and both test tiers now pass under either loader. A project that
  copied these configs needs the same one-word change.
- **The prompts ask for the repository's visibility and GitHub plan**, and say what to do when
  they rule something out. On GitHub Free, a private repository can't make CI a required check
  and has no private vulnerability reporting. Phase 2.5 of `new-project.md` and milestone 1 of
  `existing-project.md` now keep CI running on every pull request, make "merge only when CI is
  green" an operating rule, and record the missing enforcement as a settings item instead of
  claiming it; the dev-plan, remediation-plan, and release-runbook skeletons accept that record
  where they asked for a required check. The `SECURITY.md` skeleton names another reporting
  channel for a private repo, and no response time unless someone will keep it.
- **Phase 0 defines issue activity** (issues open now, and those opened in the last 90 days with
  how many are still open), gives it a column in the verification table, and names a git-only
  way to get the last commit and versions when a sandbox can't reach GitHub's pages or API.
  Each fact records the channel it came from. The stale check names "your auth library": Auth.js's
  own README now points new projects to Better Auth.
- **Phase 2 ends with a buildable empty shell**, and features, the deploy pipeline, and the
  release runbook belong to milestone 1. The instruction check runs once Phase 3 has written
  what the instructions link to.
- **`docs/env-validation.md` is a guide to build the env module from**, not a file to keep; the
  prompt and `/bootstrap` now agree.
- **`process:apply`'s report** names the manifest it wrote. Its next steps start by excluding
  `prompts/`, `.agents/skills/`, and `.claude/skills/` from any formatter, a pre-commit one
  included (a reformat makes every delivered file look edited, and re-applies then park the
  template's updates instead of applying them), then commit the delivery unmodified, manifest
  included, before any prompt run. After a re-apply it says to commit the update on its own.
- **A gap a run finds in a delivered prompt or skill goes back to the template.** `/bootstrap`,
  `/complete`, and `prompts/README.md` say to report it upstream and leave the copy unedited, so
  re-applies keep updating it. Both skills add the run-log row when the run starts.
- **The synced-block markers are HTML comments** (`<!-- definition-of-done:start -->`), because
  Prettier rewrites the `[//]: # (...)` form. Only the template's own test reads them; a project
  has nothing to do.
- **Skeletons point at the template's working assets** that `process:apply` doesn't deliver: the
  npm audit gate, its workflow and tests, with what to adapt (dependency policy), and the Claude
  Code SessionStart hook (AGENTS.md). The AGENTS skeleton's Workflows section now asks where the
  skills come from, and the CLAUDE skeleton defers to it.
- **Where the checks need an install:** `prompts/README.md` says `process:apply` and the
  placeholder checker need none, and that in a checkout used only for the process,
  `npm ci --ignore-scripts` installs what `check:instructions` and `check:env` need without
  setting up the template's git hooks. Both
  project prompts name the Node placeholder checker beside the grep one-liner, since only it
  catches a half-deleted guidance comment.

- **From the second run:**
  - `/bootstrap` copies the ADR template and index, which operating rule 7 names (now by its
    full path, `docs/adr/0000-template.md`, so the instruction check verifies it).
  - Repository visibility and plan never block a run: both project prompts (and the skills)
    read them from the host, and assume private on GitHub Free, the case the fallbacks cover,
    for whatever can't be read. `/complete` adapts merged rules to the repo's real paths.
  - The CONTRIBUTING skeleton has a merge-gate line, so a plan that can't enforce CI says so.
  - Phase 2 says what its files hold before milestone 1: an env module with no real variable
    yet, and only paths and deploy targets that exist.
  - Phase 0 says what issue activity is for (a warning, not a staleness rule), and to record
    it as "not available (git only)" rather than scrape pages for it.
  - Phase 2.5 keeps the ruleset file on a plan that can't enforce it, marked inactive, and
    points at the template's test that holds its check names equal to the CI job names.
    `/bootstrap`'s artifact list includes it.
  - A private repository's SECURITY.md is readable only by collaborators, so the product also
    says where to report a problem.
  - The dev-plan skeleton's milestone 1 scope carries the same "where the plan allows" as its
    exit criteria. The AGENTS skeleton says the template's SessionStart hook ignores `.nvmrc`,
    and what to add (and the `set -eu` pitfall with nvm) when a repo pins a Node major the
    container lacks. The `.env.example` skeleton no longer points at the env-validation guide.
  - `templates/README.md` lists the SECURITY, CODEOWNERS, and ruleset skeletons, and no longer
    says to keep the env-validation guide.

- **Audits and plans cite standards by ID** (`2.1 node.strict-types`): `existing-project.md`'s
  baseline and the audit skeleton's finding line, and `new-project.md`'s milestone 1 exit, which
  now includes a clean scorecard, with any exception recorded as a waiver.
- **The project prompts, investigate, review, and pre-PR ask for what the run taught**, kept
  where `prompts/README.md` ("Keeping a lesson") says: a check first, then a comment, then the
  lessons-learned file, and upstream to the template as a proposed standard when the check would
  hold elsewhere.
- **timothymiller/t4-app leaves the reference lists:** no commits since April 2024.

### Fixed

- **`check:upgrade-path` failed every repository that had never released.** It exits 2 when no
  release tag is behind `HEAD`, which a new template before its first release, and a project made
  with GitHub's "Use this template" (which copies no tags), can never satisfy, so CI was red from
  the first commit. A full clone with no `v*` tag at all now passes with "No release yet". A
  shallow clone with no tags, and a repository whose tags exist but none is behind `HEAD`, still
  exit 2. Nothing to do in a project; the next CI run picks it up.
- **`writing.prose-checks-in-ci` passed a run that checks nothing.** A workflow whose only prose
  step was `vale sync` or `cspell --version` passed, because the check matched the tool's name. A
  version, help, or init flag alone no longer counts. Neither do the subcommands that don't lint:
  `vale sync`, `ls-*`, and `test`, and cspell's `trace`, `suggestions`, `init`, `link`, and
  `dictionaries`. The failure names the run. (`cspell check` still counts: it exits 1 on an
  unknown word, run with cspell 10.3.6.) The `writing` pack also detects the other config names
  the tools read: Vale's `_vale.ini`, `vale.ini`, `.vale`, and `_vale`; cspell's JSONC and YAML
  files, `cSpell.json`, `.cspell.config.*`, and its `.config/` and `.vscode/` places, as cspell
  10.3.6 searches them; and `.textlintrc`. cspell settings kept only in `package.json` aren't
  detected, so declare the pack.
- **The `tauri` pack read only `tauri.conf.json`.** Tauri 2 also takes `tauri.conf.json5` and
  `Tauri.toml` (whose keys may be kebab-case), and capability files in JSON5 or TOML; the probes
  now read all three, and a file that doesn't parse is a failure that says so, not a pass. The
  Rust gates (`clippy`, `fmt`, tests, `cargo deny`, `cargo audit`) count only where they reach the
  app's crate: from its directory, with `--manifest-path` to it (relative to where the command
  runs, or from the checkout's root through the workspace variable), or from a workspace root
  the way Cargo reaches members: `fmt` every member unless pointed at one, `audit` the shared lock
  file, `clippy` and `test` the default members (or `--workspace`, `-p`), `deny` every member of a
  virtual workspace (or `--workspace`), and the cargo-deny action as its command would.
- **The probes follow a `cd` the way the shell would.** They read each CI command from the
  directory it runs in, and used to take a `cd` they couldn't read (any with a substitution in it)
  as no move at all, so a gate a script ran somewhere else counted where it was called. Now a `cd`
  to the script's own directory (`$(dirname "$0")`, `${BASH_SOURCE[0]}`), to the root
  (`$(git rev-parse --show-toplevel)`, or the workspace variable however it's quoted), to `$(pwd)`
  or `$(cd <dir> && pwd)`, to a variable set to one of those, or `cd -` is followed, through
  `--`, `-P`, and redirections; any other leaves the directory unknown. The gates checked where
  they run (Node, Expo, Godot, and Tauri) count nothing run there, at the root too, and that
  includes a `working-directory` written as an expression, except a called workflow's
  `${{ inputs.<name> }}` with a plain value. `npm --prefix "$GITHUB_WORKSPACE/web"` is read from
  the checkout's root.
- **The guard's command runs in PowerShell too:** `node "$(git rev-parse --show-toplevel)/…"`, whose
  `$(...)` expands in double quotes in bash and in PowerShell, replaces the bash-only
  `${CLAUDE_PROJECT_DIR:-…}` form that Copilot CLI on Windows couldn't start (see the next entry).
  Copilot's own hook runs from the repository root with nothing to expand. Statically reviewed
  against PowerShell's documented expansion; not run in PowerShell here, and a repository path
  with non-ASCII characters still breaks the expanded form there (ADR 0018).
- **The guard guards the checkout it lives in:** in a git worktree it used to compare paths
  against `CLAUDE_PROJECT_DIR`, the main checkout, and let every edit in the worktree through.
  It also follows a link to a generated file that doesn't exist yet.
- **The generated-file guard needed `CLAUDE_PROJECT_DIR`.** Copilot CLI reads
  `.claude/settings.json` hooks and takes a hook that exits non-zero as a refusal; nothing says it
  sets that variable, so the guard's command couldn't start and every edit could be refused. The
  command now falls back to the git top level, and the guard to its own repository rather than the
  session's working directory, which may be a subdirectory. Checked by running the registered
  command without the variable; not checked in Copilot itself. On Windows, Copilot's docs say it
  runs the command in PowerShell, where neither the old command nor the new one works; that's
  unfixed.
- **`check:env` missed Google AI Studio's leak path.** A `vite.config.*` that loads every variable
  with `loadEnv(mode, '.', '')` and copies one into the bundle through `define`
  (`'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)`) passed, even with a client
  read of the key planted. It's now a `define-env` finding: a `define` that copies a variable with
  no client prefix (build metadata like `NODE_ENV` and `*_SHA` aside), or a secret-named one, or a
  whole env object, written in place or given by name (`define: values`). A project whose config
  does this fails `check:env` until the variable moves to server code.
- **`check:instructions` reported three kinds of path that aren't missing files**, found by running
  it on the maintainer's repositories: a directory `.gitignore` lists with a trailing slash, named
  without one (`src/test/fixtures`); a placeholder part in repeated capitals (`session-NN/`,
  `YYYY-MM-DD.md`); and a code reference whose "extension" has an underscore
  (`tools/md_edit.wrap_block`). None is reported now; a real missing path still is.
- **A registry install could pull a dependency major a component doesn't compile against.**
  Each item named its npm dependencies bare (`@tanstack/react-table`), and the shadcn CLI
  installs a bare name at npm's latest release: 9.2.6 for `@tanstack/react-table`, which
  `data-table` doesn't compile against. `npm run registry:build` now names each dependency with
  the major `package.json` declares (`@tanstack/react-table@^8`, `^0.7` below 1.0), and fails,
  writing nothing, for a range with no major to take (`latest`, `workspace:*`). Only the major,
  so an in-range dependency update leaves the registry as it is. The CLI installs a named major
  even when the project already declares the package, so adding a component moves that project
  onto the template's major. A fork that changes a dependency's major runs
  `npm run registry:build`; `check:generated` fails until it does.
- **A calendar day button's name contains the day it shows** (WCAG 2.5.3, Label in Name).
  react-day-picker names it with the full date, which in English writes the day as an ordinal
  ("Sunday, July 26th, 2026"), so the shown "26" wasn't a word of it. `Calendar` now leads with
  the shown number when the label lacks it ("26, Sunday, July 26th, 2026"), and keeps a label
  that already has it, such as a translated one from `locale`, as it is. A test that finds a day
  button by its old name needs the new one.
- **The dropdown menu's User menu story** names its avatar button "DC, account menu for Dana
  Cohen", starting with the initials it shows, for the same reason. It's the usage example: a
  trigger that shows text needs that text in its name.
- **`check:instructions` and `check:env` read through a symlink that leads out of the repo.** An
  `AGENTS.md` linked to a file elsewhere was linted, and paths from that file reached the report.
  Both checks now leave such a symlink out; one that stays inside the repo (`CLAUDE.md` to
  `AGENTS.md`) is read as before.
- **`check:instructions` and `check:env` without the template's dependencies** crashed with a
  module-resolution stack trace. Both now say how to install them and exit 2.
- **The tests for that failed where `NODE_PATH` names a global package folder**, as it does on
  Claude Code on the web: `check-env`'s "without the template installed" test found the global
  `typescript` and never saw the install message. Both install tests (`check-env`'s and
  `process:apply`'s, which passed only because `yaml` isn't global there) now run the script, and
  their positive controls, without `NODE_PATH`. Nothing to do in a project.
- **Both checks counted skeletons as the repo's own files.** A path an AGENTS.md names, such as
  `docs/adr/0000-template.md`, passed the instruction check when only a skeleton copy existed
  (staged by `process:apply`, or in a fork's `templates/project/`), and `check:env` counted a
  skeleton `.env.example`. Both now leave out every directory marked by an
  `AGENTS.skeleton.md`, wherever it sits, and say which they left out. A repo's own
  `prompts/skeletons/` code, with no marker, is still checked.
- **An advisory without a GHSA id couldn't be waived.** The audit gate reports it as
  `npm-<number>` but accepted only GHSA ids in the register; it now takes both. The
  dependency-policy skeleton no longer promises CVE ids, and says what to state about the gate
  it copies.
- **The gate's test, which targets are told to copy, failed a stricter tsconfig.** It now
  typechecks under `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`, and
  `tsconfig.assets.json` holds it there.
- **The AGENTS skeleton's own wording failed the instruction check in a target:** it named
  `npm run check:instructions`, a script only the template has. It now gives the
  `node <template checkout>/scripts/check-instructions.mjs` form, which passes.

### Security

- **Nothing restored from the Actions cache into a job that publishes or holds a secret**, and a new
  standard, `core.workflow-caches`, holds every repository to it. The Pages workflow's build job,
  whose output the site and the component registry ship, restored an npm cache another run could
  have written; it now installs from the registry. The evals job (the API key), the audit job (a
  token that can write issues), and the Copilot setup job (the agent works there with push access)
  turn off the npm cache setup-node v5 and later restore on their own whenever the root
  `package.json` names npm, which a missing `cache:` line doesn't stop. The hub's two jobs (the
  app's private key) turn it off too, though the hub has no root `package.json` today. zizmor 1.30.1
  flagged neither, at any persona. The check reads the setup actions that cache by default
  (setup-node, setup-go, setup-gradle, setup-bun, setup-uv) as well as an explicit `cache:` or
  `actions/cache`. It's the route TanStack's 84 compromised releases took on 2026-05-11: a
  `pull_request_target` workflow saved a poisoned pnpm store to the cache, and the release workflow
  restored it.
- **npm waits a week before it takes a release, and refuses a dependency's git and URL
  dependencies** ([ADR 0019](docs/adr/0019-npm-install-guards.md)). `.npmrc` sets
  `min-release-age=7`, so `npm install` and `npm update` choose only versions published at least
  seven days ago (`npm ci` still installs the lockfile as it is), and `allow-git=root` and
  `allow-remote=root`, so a git or tarball-URL dependency is allowed only where `package.json`
  itself names one; TanStack's payload arrived as a git `optionalDependencies` entry. These need
  npm 11.15, so `packageManager` now pins npm 11.19.0 (was 10.9.9), the npm the `.nvmrc` Node
  ships; the lockfile is unchanged, and the audit gate reads npm 11's report as it did npm 10's.
  `package.json`'s `allowScripts` records the two install scripts in the tree: esbuild's runs,
  fsevents' (macOS only, a rebuild of a binary its tarball already ships) doesn't. npm 11 still
  runs an unlisted one, with a warning. A new standard, `node.install-guards`, holds every Node
  repository to the same, read at the workspace root for a workspace, or to pnpm's
  `minimumReleaseAge` and `blockExoticSubdeps`; the dependency-policy skeleton gains an "Install
  guards" section. To take an urgent fix younger than the wait:
  `npm install <pkg>@<version> --min-release-age=0`, on purpose.
- **Every workflow grants nothing by default** (`permissions: {}` at the top), and each job names
  the scopes it uses, so a job added later starts without a token that can do anything. A
  repository test holds the template's workflows and the hub skeleton's to it.
- **`process:apply` refuses a manifest whose paths leave the target.** It writes and deletes by the
  manifest's keys, which weren't checked: a hand-edited `prompts/.apply-manifest.json` with a
  `../` key could make a re-apply delete a file outside the target, and a pack name with `../`
  could make it copy one there. A key must now sit under a delivery path with no `.` or `..`
  segment, and a pack must be a name; nothing is written or removed through a symlink that leads
  out of the target (a delivery directory, the file itself, or its parked `.template`), which the
  report and `--check` name; a manifest reached through one is refused outright; and the recorded
  template commit reaches git only as a hash, never as an option (`--output=...`). A pack the manifest records that this template doesn't ship
  (applied from a newer template) is left as it is instead of crashing the apply.
- **`source-map-js` is 1.2.2** (was 1.2.1), clearing the high advisory GHSA-68fv-2mgg-jv7q
  (event-loop denial of service through indexed source-map section offsets), which the audit
  gate blocked every pull request on. It's dev tooling only, reached through
  `@tailwindcss/vite`, jsdom's `css-tree`, and `storybook-design-token`'s `postcss`; the update
  is in range and changes only the lockfile. A project built from the template gets the same
  fix from `npm audit fix`.
- **`postcss-selector-parser` is 7.1.6 under `@tailwindcss/typography`** (was 6.0.10), through
  an `overrides` entry in `package.json`, clearing the moderate advisory GHSA-rj75-hqrm-r3gf
  (CPU exhaustion parsing a flat selector). The plugin pins 6.0.10 exactly, so no in-range update
  reaches the fix, and `npm audit fix --force` would downgrade the plugin to 0.5.4. Version 7's
  one breaking change (insertions during `each`/`walk`) is in code the plugin doesn't call, and
  the Storybook build's CSS is byte-identical with either version. Drop the override when the
  plugin's own range admits 7.1.6. `npm audit` now reports nothing. The dependency policy has
  this route as its step 2.

## [1.0.0-rc.1] - 2026-09-24

The first versioned release, as a candidate. It's everything below: the process (prompts,
skills, skeletons, and the checks that hold them to their word) and the interface (tokens,
components, and brand guidance), each gated in CI. 1.0.0 follows once the candidate has been
tried on a new repository and on an existing one; what those trials change lands in a later
candidate first.

### Added

- **A path for taking template updates** (`docs/system/updating-from-the-template.mdx`, in
  Storybook as System → Updating from the Template). A fork, a clone, or a repository made with
  "Use this template" merges a release tag, fetched under `template/` so it can't collide with
  the project's own tags; a "Use this template" repository connects its history to the
  template's once first. A repository that received only the process re-runs `process:apply`.
  Run end to end on scratch repositories, deleted and binary files included. `npm run init` now
  records the template version a project started from as `package.json`'s `templateVersion` and
  restarts the project's own `version` at 0.1.0, on its first run only. Releases are tagged
  `v<version>`; `CONTRIBUTING.md` has the steps.
- **Storybook and the component registry publish to GitHub Pages** (`.github/workflows/pages.yml`)
  on every push to `main`, once Settings → Pages → Source is "GitHub Actions"; until then each
  run says so and deploys nothing. Before deploying, it refuses a registry built for a different
  address and checks the generated files are current; after, it checks the live site is this
  run's deployment and serves a registry item byte for byte as built. `package.json` now
  carries this repo's Pages URL as `homepage`, read everywhere through one contract
  (`scripts/homepage.mjs`) that refuses a query, fragment, or page name: npm's usual
  `…/repo#readme` would have resolved every dependency URL outside the repo's path.
- **Repository settings as files.** `SECURITY.md` says where to report a vulnerability privately
  and what's in scope. `.github/rulesets/main.json` is an importable ruleset that makes every CI
  job a required check on `main`, and a test keeps its list equal to the CI jobs. New skeletons
  for targets: `SECURITY.md`, `.github/CODEOWNERS`, and `.github/rulesets/main.json`, named by
  both project prompts. The README's new "Repository settings" section lists the one-time
  switches a file can't flip.
- **Every story runs in real Chromium, with `axe` as a gate** (`npm run test:browser`, its own CI
  job; [ADR 0012](docs/adr/0012-stories-in-a-real-browser.md)). Every story renders twice, in
  the light theme and the dark, so color contrast is measured as rendered in both, and WCAG 2.2
  target size (SC 2.5.8) is checked on every story; axe ships that rule off, so it's turned on
  explicitly. The jsdom run couldn't see either. Stories' play tests run there too.
  - **What it found, now fixed:** `ScrollArea` scrolled but couldn't take focus, so a keyboard
    user couldn't scroll a list with nothing focusable in it. Two `Resizable` stories had the
    same problem, and the disabled `Slider` story dimmed its label to 3.4:1.
  - **Guarding the gate:** a canary story fails the run if the stories render without the
    design system's CSS or in the wrong theme. The first run did exactly that (no Tailwind), and
    passed checks it shouldn't have.
  - **Exceptions are counted:** an exception to one rule lives on the story, beside its reason,
    and both runs read it. The jsdom test fails on any exception missing from its reviewed list,
    and on any story that turns `target-size` off.
  - **Chromium:** `npx playwright install chromium` once. In a sandbox that ships its own, set
    `PLAYWRIGHT_CHROMIUM_EXECUTABLE`; on Claude Code on the web the session hook does it.
- **`check-contrast` measures a focus `outline-<role>`** as it measures a focus `ring-<role>`.

- **Every coding agent can run the workflows and read the rules**
  ([ADR 0011](docs/adr/0011-agent-portable-workflows.md)). Before this, only Claude Code could.
  - **Workflows:** `bootstrap`, `complete`, `root-cause`, `review-change`, and `pre-pr` are
    Agent Skills in `.agents/skills/`, the path Codex, Antigravity, Gemini CLI, Cursor, and
    Copilot read. `npm run skills:build` generates Claude Code's copy in `.claude/skills/`,
    which replaces `.claude/commands/`. Invoke one as `/complete` in Claude Code or
    Antigravity, `$complete` in Codex, or by name elsewhere.
  - **Rules:** this repo's own rules move from `CLAUDE.md` to `AGENTS.md`. `CLAUDE.md` imports
    it, and `.gemini/settings.json` points Gemini CLI at it. `AGENTS.md` now says which of the
    two uses you're in (a new repo, or an existing one being brought to production grade)
    and maps each situation to its skill.
  - **Hooks (Claude Code):** an Edit or Write to a generated file is refused with the source to
    edit instead. On Claude Code on the web, `npm ci` runs at session start when `node_modules`
    is missing or older than the lockfile.
  - **Explicit workflows:** `bootstrap` and `complete` rewrite a repo, so they run only when
    asked for by name. Their descriptions say so to every agent, and Claude Code's copy sets
    `disable-model-invocation`.
  - **Targets:**
    - `process:apply` delivers the skills to both paths. A re-run removes the
      `.claude/commands/` an earlier run delivered, or reports them if you edited them.
    - A skill that would silently replace a command of your own with the same name is held
      back, and reported, until you retire the command.
    - The AGENTS skeleton gains a Workflows section and a setup line for cloud agents.
  - **Dependency:** `yaml` (already in the tree) is now a direct dev dependency, so skills'
    frontmatter is read as real YAML. `process:apply` still runs without `node_modules`.
  - **`check:instructions`:** validates skills against the Agent Skills spec, strictly in the
    shared `.agents/skills/`. It also flags an `AGENTS.md` over 24,000 bytes (Antigravity's
    limit), a repo that uses Gemini CLI without pointing it at `AGENTS.md`, and a skill whose
    `.agents/` and `.claude/` copies differ in description or instructions. The existing-project audit checks all three, plus
    rules kept in a form only one agent reads.
- **Colors can be authored in `oklch()`** (and `hsl()`, 4- or 8-digit hex, and `transparent`),
  so a palette copied from Tailwind v4 goes in as it is
  ([ADR 0010](docs/adr/0010-token-pipeline-colors-and-native-shapes.md)).
  - **Contrast:** the gate measures each color as the sRGB color it renders as. It lists any
    it gamut-mapped from outside sRGB (with the CSS Color 4 algorithm) so you can leave those a
    margin.
  - **Other platforms:** the CSS keeps colors as written. An `oklch()` color reaches JS, iOS,
    and Android as the same sRGB hex the gate measured; every other format converts as it
    always has.
  - **Checked** against Tailwind's published values for red-500, blue-600, green-500 (outside
    sRGB), and neutral-500.
  - **Why it matters:** before this, an `oklch()` token made the gate throw. Worse, Style
    Dictionary's own color transforms read it as invalid and shipped **black** to iOS and
    Android, with no error.
  - **The build now fails on a color nothing can read, before touching any generated file.**
    Style Dictionary had reported a throwing transform as a warning, kept the raw value, and
    exited 0. And because the config clears its output first, an error mid-build had deleted
    the web's CSS tokens.
- **`platforms/js/tokens-native.ts`** (and `.json`): React Native shapes for the core tokens
  whose web form it can't use:
  - `Easing.bezier` control points for each easing;
  - iOS shadow props plus an Android `elevation` and a `boxShadow` string for each elevation;
  - font families as arrays;
  - line heights and letter spacing in points, per font size.

  It's derived from the authored values, so a px or rem letter spacing is read as one. A web
  value with no React Native form, such as a `steps()` easing, is left out and listed under
  `unsupported` rather than failing the build. The existing JS output's header now says which
  of its values React Native can use directly.
- **Brand & Content → Claims & Sourcing**, and a content-guide skeleton with a claims register
  (`templates/project/docs/content-guide.md`). Numbers, comparisons, guarantees, "secure",
  "compliant", testimonials, and AI capability claims each need a source, an owner, and a review
  date. The existing-project audit now looks for claims nothing backs.
- **A release runbook and a postmortem skeleton.** `docs/release-runbook.md` (a milestone 1
  deliverable) covers five things:
  - every environment, and the file in the repo that holds its build config;
  - the settings that live only in a dashboard;
  - the release steps;
  - "verify the shipped artifact": the deployed version, the changed page itself, an induced
    error reaching the reporter through the CSP, no secrets in the bundle, and scheduled jobs
    that produced output, not just a success status;
  - a rehearsed rollback.

  `docs/postmortem.md` records impact, timeline, why detection was late, the root cause, and
  action items that each name the check that will catch it next time. Every line comes from a
  sibling repo's incident: a fix checked against the wrong page, Sentry captures blocked by a
  CSP, a cron job reporting success while ingesting nothing, and five weeks of mobile builds
  that shipped `${VAR}` literally.
- **`npm run check:env`** (`-- --root <repo>`) finds four problems:
  - secrets behind a client-exposed prefix, in env files anywhere in the tree (gitignored ones
    included), `eas.json`, and every form of read in source;
  - env reads a bundler handles differently from `.NAME`: `import.meta.env` used as a whole
    embeds every `VITE_` variable at that spot, and `process.env` indexed, aliased, or passed
    whole comes out undefined in an Expo or Next.js client (build config and tests excluded);
  - leftover placeholder values;
  - `${VAR}` in `eas.json`, which EAS passes through literally. `eas.json` is read with the
    JSON5 allowances eas-cli makes.

  It parses source rather than grepping it, and self-tests its detectors before checking
  anything. Replayed against a sibling Expo app's `eas.json` from before its incident,
  it flags all three broken values. `docs/env-validation.md` gains the matching client-bundler
  section.
- **CI must be a required status check**, not just a workflow. This is now part of new-project
  Phase 2.5 and milestone 1's exit criteria, alongside build settings kept as code. None of the
  sibling repos had branch protection, and red PRs merged. The definition of done's smoke test
  is now against what shipped, not the config that produced it.
- **AGENTS.md is the one rules file; CLAUDE.md imports it** ([ADR 0007](docs/adr/0007-agents-md-with-claude-import.md)).
  The rules skeleton is now `AGENTS.skeleton.md`, which every coding agent reads.
  `CLAUDE.skeleton.md` is `@AGENTS.md` plus Claude-Code-only notes. Claude Code skips `AGENTS.md`
  whenever a `CLAUDE.md` exists, so a repo with both files and no import gives each agent a
  different rulebook, which is what one sibling repo does today. `process:apply` and the
  new lint both flag that state. `process:apply` also gives the prompts' merge advice for a
  target's existing rules (never a personal `CLAUDE.local.md`).
- **`npm run check:instructions`** lints agent instruction files, here or in a target
  (`-- --root <path>`): CLAUDE.md, AGENTS.md, nested ones, and Cursor, Copilot, Gemini, Cline,
  Windsurf, and `.agent/` rules. It reports links, `@` imports, code-span paths, and `npm run`
  scripts that no longer resolve (scripts against the nearest `package.json`), an `AGENTS.md`
  that Claude Code can't see, and characters a reviewer can't see but a model reads: control,
  bidi, zero-width, variation-selector, and Unicode tag characters. On the sibling repos it
  reports nothing false in three of them. In a fourth it found two
  missing workflows, stale paths, and eight control characters left where a `\b` and a `\r` in
  the text were decoded. It fails when there was nothing to examine. It runs on this repo in
  `npm run test`, and the audit skeleton and `/complete` point at it.
- **Prompts and slash commands for day-to-day work**, where most defects actually enter:
  - `prompts/investigate.md` (`/root-cause`): reproduce the *reported* case, confirm a
    known-good baseline before bisecting, test hypotheses one at a time, fix the root cause,
    and enumerate the sibling occurrences;
  - `prompts/review.md` (`/review-change`): an adversarial review that confirms its diff range
    first, cites `file:line` with a failure scenario for every finding, hunts the failures that
    pass their own tests, and re-reviews the fix round;
  - `prompts/pre-pr.md` (`/pre-pr`): merge the base, run the full gate, prove new checks fail,
    self-review, sweep the docs, and draft a description with rollback and unknowns.

  Each sibling repo had built its own version of these (one's `.agent/workflows`, another's
  investigate/review/ship skills, a third's review-every-PR rule). `process:apply`
  delivers all three. Every command now says when to use it and what arguments it takes. A
  test keeps command names clear of Claude Code's commands, aliases, and bundled skills, and of
  gstack's skills (a personal skill outranks a project command), from a sourced, dated list in
  `scripts/__tests__/reserved-command-names.json`. That's why they're `/root-cause` and
  `/review-change`, not `/investigate` and `/review`.
- **The process docs are checked, not just written** (`scripts/__tests__/process-docs.test.ts`):
  the definition of done must be word-for-word identical in `CONTRIBUTING.md` and the
  CONTRIBUTING skeleton, every slash command needs a description and may only name prompts that
  exist, every `npm run <script>` in the docs must exist in `package.json`, each prompt may only
  cite phases it defines, and relative links must resolve both here and in a target after
  `process:apply`. Each check was shown to fail on a planted defect.
- **An exact placeholder check** (`scripts/check-placeholders.mjs`, plus a grep one-liner in
  each prompt for targets without Node). The old advice, `grep -rn "\[.*\]" docs/`, matched
  every markdown link and reported 15 hits on this repo's own finished docs. Every skeleton
  placeholder now opens and closes on one line and starts uppercase, and every skeleton comment
  starts `<!-- GUIDANCE`, so the check skips links, checkboxes, `Optional[Settings]`, and a
  merged-in markdownlint marker. The script also catches a stray `-->` left by a half-deleted
  comment. Tests hold every bracketed placeholder in every skeleton to that shape, and prove the
  script and the grep (run as `LC_ALL=C`) agree line for line. The ADR template uses
  placeholders and guidance comments too, is exempt by name as the one file meant to stay
  unfinished, and is test-checked identical between `docs/adr/` and the skeletons.
- **Dependency audit gate** (`npm run check:audit`, `.github/workflows/audit.yml`): high and
  critical advisories block, in every dependency class (even under `NODE_ENV=production`),
  unless covered by a waiver in `docs/security/audit-waivers.json` for that advisory in that
  package, with a reason, an owner, and an expiry at most 90 days out. Expired waivers cover
  nothing, stale ones fail, and so does an audit that couldn't run or whose report doesn't
  reconcile with npm's totals. The workflow runs on every PR, on pushes to `main`, and weekly
  (a failing scheduled run opens an issue), because advisories land against code that has
  already merged. For "blocks" to hold, make its check required on `main`. Decision recorded in
  `docs/adr/0005-dependency-audit-gate.md`.
  Policy in `docs/security/dependency-policy.md`; a stack-agnostic skeleton for target projects
  in `templates/project/docs/dependency-policy.md`, and the new-project and existing-project
  prompts now ask for it.
- **Repo hygiene test** (`scripts/__tests__/repo-hygiene.test.ts`): no raw control characters
  in tracked text files (git's own text/binary classification decides which are text), and no
  tracked file over 1 MB without an allowlisted reason; stale allowlist entries fail.
- **Build prompts** under `prompts/` — a new-project bootstrap prompt and an existing-project
  audit-and-completion prompt, both stack-agnostic, both requiring architectural references to
  be verified as current before anything is borrowed from them. `prompts/README.md` explains how
  to run one; `prompts/run-log.md` is where each run gets recorded.
- **Artifact skeletons** under `templates/project/` — a ready, placeholder-marked shape for
  every file the prompts require in a target repo: CLAUDE.md, CONTRIBUTING.md (with the
  definition of done), `.env.example`, the reference-verification table, the stack ADR, the
  dev plan, the twelve-area audit, the remediation plan, and the typed-env pattern.
- **`npm run process:apply`** (`scripts/apply-process.mjs`) — copies the prompts and skeletons
  into any target repo without ever overwriting an existing file (conflicts are parked
  alongside as `<name>.template` for hand merging; `--list` previews). The copy-not-dependency
  distribution model is recorded in `docs/adr/0002-process-distribution.md`.
- **Slash commands** in `.claude/commands/` — `/bootstrap` and `/complete` run the two prompts
  inside a Claude Code session, collecting the project inputs as arguments and using the
  skeletons automatically.
- **Architecture Decision Records** under `docs/adr/` — a template (`0000-template.md`), the
  conventions for when and how to write one, and `0001-interface-foundation.md` recording why
  this repo owns its interface layer as source with tokens as the single source of truth.
- **Definition of done** in `CONTRIBUTING.md` — the production bar a feature has to clear
  (validation at trust boundaries, surfaced failures, server-side authz, tests including an edge
  case, observability, accessibility, current docs, staging smoke test).
- **Engineering guardrails** in `CLAUDE.md` covering any code in any stack, alongside the
  existing design-system rules: minimal diffs, no embedded secrets, honest
  statically-reviewed/executed/fully-validated reporting, and a stop-and-report rule after three
  failed approaches.
- Multi-platform token outputs under `platforms/`: typed JS/TS + JSON, iOS Swift, and Android
  XML, all generated from the same `tokens/**/*.json` source by `npm run tokens:build`.
- `scripts/init.mjs` (`npm run init`) to rebrand a fresh fork in one pass.
- `CLAUDE.md` and `docs/system/consuming-in-an-existing-project.mdx` for agent and
  existing-project usability.
- Runtime `ThemeProvider` + `useTheme` (`src/components/theme-provider.tsx`) and a
  `ThemeToggle` example for live light/dark switching.
- Test harness (Vitest + Testing Library) with component and accessibility smoke tests.
- CI workflow, `.nvmrc` + `engines` pinning, `.editorconfig`, and issue/PR templates.
- **Accessibility enforcement**, so the WCAG AA bar is checked, not just documented:
  - `eslint-plugin-jsx-a11y` in the lint config — a11y mistakes fail `npm run lint`.
  - `scripts/check-contrast.mjs` (`npm run check-contrast`, wired into `npm run check`) —
    recomputes WCAG contrast for every semantic text pairing from the tokens, in both themes,
    and fails below AA. Keeps the bar honest after a palette swap.
  - `axe` accessibility assertions run against every Storybook story via portable stories.
- **shadcn-compatible registry** (`registry.json` + `public/r/*.json`, built by
  `npm run registry:build`) so components can be installed into an existing project with
  `npx shadcn add <url>/r/<name>.json`, dependencies resolved automatically.
- `.github/dependabot.yml` for grouped weekly dependency updates, and a husky + lint-staged
  pre-commit hook that lints staged files.
- `docs/proposals/` and a `CLAUDE.md` workflow for producing a self-contained, stakeholder-facing
  **decision guide** (real swatches, embedded fonts, light/dark, recommendation + alternatives +
  default) from the "options menu" Foundations/Brand docs — the visual surface for signing off on
  the color strategy, typeface, and other open decisions. Generated guides are gitignored.

### Security

- Cleared every open `npm audit` advisory (19 advisories across 9 packages, 11 of them high)
  in the dev toolchain (`vitest`, `brace-expansion`, `fast-uri`, `js-yaml`, `nanoid`, `postcss`,
  `qs`, `undici`) with in-range updates. `npm audit fix` under the pinned npm 10.9.7 crashes on this tree (an arborist
  `edgesOut` error), so the lockfile was updated with npm 11 and then verified by a clean
  `npm ci` under npm 10.9.7.
- CI workflow now runs with least-privilege `permissions: contents: read`.
- `prepare` is now `husky || true`, so a production install (`npm ci --omit=dev`, a Docker build)
  no longer fails with `husky: not found` when devDependencies are absent.

### Fixed

- **The component registry installed nothing of its own.** Its served items listed each file's
  path but not its content, and the shadcn CLI skips a file without content, in silence. And
  they named their dependencies by bare name (`"button"`), which the CLI resolves against
  shadcn's own registry. Shown with `shadcn add` against a local copy: the command succeeded,
  wrote no `alert-dialog.tsx`, and installed shadcn's stock `button.tsx` and `utils.ts`. Each
  item now inlines its source, and names dependencies by their URLs under `homepage`; the same
  command installs this repo's three files, byte for byte. If you installed from a copy of the
  registry before, re-install: what you got was shadcn's components.
- **`npm run init` without `--homepage`** used to leave the template's own homepage in place, so
  a fork's registry would have installed the template's components. It now removes that one
  (the registry uses the example.com placeholder until `--homepage` is set) and keeps any other
  homepage the fork set. Its next steps now include replacing `SECURITY.md`.
- **`check-placeholders`** reads extensionless files (`CODEOWNERS`) when given a directory, and
  exits 2 when it examined nothing instead of certifying zero files clean.
- **Process-doc contradictions.** `prompts/existing-project.md` cited "the Phase 4 definition of
  done", but that prompt only has Phases 0–3. The audit skeleton labeled findings
  verified/provisional while the prompts use statically reviewed/executed/fully validated.
  `CONTRIBUTING.md` told contributors to "run all four" commands, which left out tests and the
  contrast check, rather than `npm run check`; so did its Storybook copy. The definition of done
  existed as three drifting copies, and the new-project prompt's copy dropped keyboard
  operability. Now the same list sits between markers in `CONTRIBUTING.md`, the CONTRIBUTING
  skeleton, and new-project Phase 4, so a prompt pasted on its own still carries all of it. A
  test keeps the three word-for-word identical and fails on an unmarked copy anywhere else.
- **Status colors used as text now meet WCAG AA in both themes.** The contrast gate only
  measured each role on its own fill, so it passed while dark-theme form errors and destructive
  menu items rendered `text-destructive` at 2.9–3.4:1, the light-theme warning alert's text sat
  at 1.7:1, and muted text on a highlighted menu item was 4.39:1. What changed:
  - Dark theme: `destructive`, `success`, and `info` now use the light `300` step with
    `neutral-950` text — the same pattern `primary` and `warning` already used. Destructive
    buttons and badges in dark mode are now a light red with dark text. Recorded in
    `docs/adr/0003-dark-status-roles.md`.
  - `Alert` status variants render their text in `foreground` (description in
    `muted-foreground`); the status color moves to the tint, the border, and the icon (the
    warning icon follows the text color). If you relied on colored alert text, restore it only
    with a pairing that clears 4.5:1 on the tint.
  - `palette.neutral.600` moved from `#6a6b61` to `#68695f` so `muted-foreground` clears 4.5:1
    on `bg-accent` highlights. If your fork replaced the neutral ramp, `npm run check-contrast`
    now tells you whether yours does.
- **Focus rings are drawn at full opacity** (`focus-visible:ring-ring`, was `ring-ring/50`).
  The gate measured the solid token while every component drew it at 50%, which is 1.82:1
  against the light page — under SC 1.4.11's 3:1, and the only focus indicator on borderless
  buttons. If you copied the focus pattern into your own components, drop the `/50` there too.
  Recorded in `docs/adr/0004-solid-focus-ring.md`.
- `ThemeProvider` no longer assumes `window.localStorage` is present and functional. Storage
  throws in Safari private mode, is absent in sandboxed iframes, and can be shadowed by a
  non-functional global on newer JS runtimes — any of which previously crashed the whole tree on
  first render. Persistence now degrades to a no-op; the theme still applies for the session.
- Accessibility issues the new `axe` story checks surfaced in the system's own components:
  `Progress` and the range `Slider` now expose accessible names (the Slider gained a
  `thumbLabels` prop for per-thumb labels), and `Command`'s decorative separator is
  `aria-hidden` so it's no longer an invalid `listbox` child.
- **Component tests no longer fail at random after rendering `InputOTP`.** input-otp sets timers
  that call `setState` up to 50 ms after each change and never cancels them. A test file that
  ended inside that window failed the whole run with "window is not defined" after every test
  had passed. `vitest.setup.ts` now waits them out before jsdom is torn down.

### Changed

- **`ScrollArea` is a tab stop only when it has to be:** when its content scrolls and nothing
  inside can take focus. It then shows an inset focus outline (an outset ring was clipped by its
  own container). `aria-label` and `aria-labelledby` now land on the scrolling viewport, which
  becomes a named region, instead of the outer wrapper; if you query the wrapper by its label,
  query the region instead.
- **`npm run init` finishes the rebrand, and is tested.** A rebranded fork used to keep
  `@acme/design-system` in `package-lock.json`, a registry named `acme-design-system` at
  `https://example.com`, and lowercase `acme` identifiers in docs and stories. Its CLAUDE.md
  also went on calling the client's brand "a placeholder … not meant to be kept". What changed:
  - **Lockfile:** it renames the package in `package-lock.json`.
  - **Identifiers:** lowercase `acme` is replaced with the slug.
  - **Registry:** it's regenerated. Its name now comes from `package.json`, and it points at
    the `homepage` set with the new `--homepage`.
  - **What's never rewritten:** `CHANGELOG.md`, and lines marked `<!-- init:keep -->` (used on
    the lines describing the placeholder itself).
  - **Validation:** it rejects a malformed or unquoted argument, a name that would break code
    (quotes, braces, `$`), and an identity containing "acme", before writing anything.
  - **Apostrophes:** one in the name ("Macy's") is written as `’`.
  - **Symlinks and submodules:** skipped, instead of followed or crashing the run.
  - **The test:** it rebrands a copy of the working tree. It fails on any `acme` left, and it
    type-checks and drift-checks a fork named `O'Reilly & Sons, Inc.`.
- **The em-dash rule is a stated decision, and it matches the docs.** The rule said "no
  spaces", but its own "do" example, and all 101 em dashes across the brand pages, were spaced.
  It now says this system spaces them (AP), and notes that Chicago, Microsoft, and Google close
  them up. It's the first rule to revisit for your editorial style.

- **The accessibility bar is WCAG 2.2 AA** (was 2.1), everywhere it's stated: the definition of
  done (feature-level and per-component), the PR template, CLAUDE.md, and the docs
  ([ADR 0009](docs/adr/0009-wcag-2-2-aa.md)). 2.2 adds six A/AA criteria, and axe in jsdom can
  see none of them. **Foundations → Accessibility** now says how each is held, and where the
  library falls short:
  - `Resizable` has no single-pointer alternative to dragging.
  - Toasts sit above modals and can cover a focused control.
  - Target size was measured in Chromium over all 138 built stories, and again with each
    story's first overlay opened: 543 measurements, none failing. Controls under 24px that
    pass only by spacing are listed, because app layout decides for them.

  CLAUDE.md now says plainly that a green gate isn't 2.2 conformance. Three components change
  to meet it:
  - **`Toaster` shows a close button by default**, the single-pointer alternative to swiping a
    toast away (SC 2.5.7). Pass `closeButton={false}` to opt out.
  - **`InputOTP` strips spaces and hyphens from a pasted code**, so `123-456` from an email
    fills a digits-only field instead of being rejected (SC 3.3.8). Pass your own
    `pasteTransformer` to change it.
  - **`SidebarMenuAction` and `SidebarGroupAction` are 24px** (were 20px). They sit on top of
    another target, where the spacing exception can't apply (SC 2.5.8).
- **Node 24 is the pinned runtime, and CI tests the oldest supported one too**
  ([ADR 0008](docs/adr/0008-supported-node-versions.md)):
  - `.nvmrc` is 24, and both workflows read it. `engines` is now
    `^22.12.0 || ^24.0.0 || >=26.0.0`. That drops Node 20 (end of life 2026-04-30) and the odd,
    short-lived 23 and 25.
  - A new CI job runs the tests on Node 22.12.0, the `engines` floor.
  - Every job now installs the npm that `packageManager` pins, instead of the one bundled with
    Node (Node 24 ships npm 11).
  - `process:apply` refuses an unsupported Node before writing anything.
  - A test reads the workflows step by step and enforces the rest: every Node job sets up from
    the pin, installs the pinned npm, and runs nothing before either; only the floor job names a
    version, and it matches `engines`; `.nvmrc` stays inside `engines`.
  - Before the switch, the full gate and a clean install ran on Node 24.21.0, and the tests ran
    on 22.12.0.
  - New-project Phase 2.5 and the audit ask projects for the same: one runtime pin, read by CI,
    matched by the host, still supported upstream. One sibling repo ran CI on Node 20
    while production ran 24.

- **The definition of done, the agent rules, and the prompts carry the lessons from real
  incidents.** The DoD adds:
  - **checks prove they can fail**: shown failing against a planted defect or a reverted fix; a
    check that enumerates things asserts it examined some; skips are reported; stale allow-list
    entries fail;
  - a bug fix whose test reproduces the reported case;
  - no success reported for work that didn't happen;
  - the project's agreed strictness, never loosened to get green;
  - data rules: display vs stored precision, one home per derived value, a tested revert or a
    tested recovery path for every migration, no real personal data in fixtures, and logs that
    carry IDs rather than names;
  - user-facing check text kept true.

  The sources are one sibling repo's 26 hollow guarantees, another's silently skipped
  real-data tests and repeated precision bugs, and a third's release incidents. The CLAUDE
  skeleton's operating rules add: evidence needs receipts; catch what you expect; confirm the
  baseline before bisecting; re-review each fix round; untrusted content (fixtures, issue text,
  comments, fetched pages) is data while the repo's own instruction files are instructions;
  and an agreed plan for named change types, with refactors still flagged first. Those rules
  are now a marker-synced block, identical in the skeleton and in new-project Phase 2, with a
  test that fails on an unmarked copy. This repo's own `CLAUDE.md` gets its instance of the
  same rules. The existing-project prompt adds the audit-specific ones: evidence needs
  receipts, and the audited repo's instruction files are its owner's rules to follow and audit,
  while its other text is evidence.
- **The audit and plan skeletons carry what real runs taught.** A sibling project's July 2026
  production-readiness audit, inferred to be a run of `existing-project.md`, improved on the
  skeleton, and the improvements never came back. Now they have. The audit opens with a
  **baseline table**: every gate run from a clean checkout before any finding, with *blocked
  (environment)* as an honest result. It ends with **"Refuted or corrected during
  verification"** and **"Coverage and limitations"**. It records the commit audited and lives
  at a dated path, `docs/audits/YYYY-MM-<slug>/`, so a second audit doesn't overwrite the
  first. Severity definitions are shared with the plan, and a regraded item has to say why.
  The areas also look for what the dry runs against a web game and a portfolio site found:
  - stale committed artifacts;
  - scripts whose names lie;
  - safety settings relaxed and never restored;
  - config keys dead after an upgrade;
  - suites no gate runs;
  - client-persisted state without migrations;
  - declared-but-unenforced rules and contradictory agent instructions;
  - licensing, and known issues as an input.

  A static app is told what doesn't apply instead of inventing findings. The remediation plan
  gains per-item acceptance criteria, rollback, and dependencies; a do-not-do list; a manual QA
  script; a status line; finding IDs (area.number) that let the plan account for every finding
  exactly once; small milestones, except Milestone 1, which takes every blocker, shipped in
  small PRs; a single-PR form for small projects that keeps the Milestone 1 floor; and "stop
  appending when done". The baseline runs in a separate clone or worktree, installs without
  rewriting the lockfile, and skips paid or shared-environment gates unless the constraints
  allow them. A dated audit folder follows the repo's own convention for where plans live. The
  dev plan gets a status table and a terse progress log. There's a new lessons-learned skeleton,
  where every lesson ends in the check that enforces it. Both prompts let official stack docs
  stand in when no listed reference fits. The first run-log row records this retrospective.
- The placeholder check no longer treats a mid-line `]:` as a link definition. `— [REFUTED /
  CORRECTED]:` is a placeholder; only `[label]: url` at the start of a line is a definition.
- **`npm run process:apply` no longer writes to live paths in the target.** Skeletons are
  staged under `prompts/skeletons/`, and the prompt run copies what it needs to the real paths.
  In an existing repo that means no parallel `docs/adr/` next to the one it already has, no
  second "0001", no placeholder `.env.example`, and no unfilled `CLAUDE.md` that the next
  agent session loads. Re-runs are driven by `prompts/.apply-manifest.json`: a file the template
  didn't change is left alone however much the target edited it, a file the target never
  touched is updated in place, and only a file both sides changed gets a `.template` beside it.
  Deleted files stay deleted, and the run log is never touched. The prompts, commands, and
  README now describe one "skeletons directory" that's correct in both the template and a
  target; before, they linked to paths and a `CONTRIBUTING.md` anchor that don't exist in a
  target. The script also notices existing agent instruction files (`AGENTS.md`,
  `.cursor/rules`, …) so the run merges into them. Recorded in
  `docs/adr/0006-staged-skeletons-and-apply-manifest.md`, which refines ADR 0002. If a target
  applied the old layout, its live files are untouched and the next run stages the skeletons
  beside them, and flags any live file that still looks like an unfilled skeleton. A `.template`
  is offered once per template change, not on every run. Files the template drops are removed
  from the target if untouched. The CLAUDE.md skeleton is now `templates/project/CLAUDE.skeleton.md`,
  so no agent loads an unfilled copy as live instructions, in this repo or in a target.
- **CI now fails when committed generated files are stale.** `npm run check` rebuilds tokens
  before using them, so a PR that edited `tokens/**/*.json` without committing the regenerated
  `platforms/`, `src/styles/tokens/`, or registry files used to pass — while every consumer of
  the committed copies got old values. The new `npm run check:generated` step regenerates on
  CI's clean checkout and fails on any difference, including new or orphaned files. To make
  orphans visible, `npm run tokens:build` now empties `src/styles/tokens/` and `platforms/`
  before building (both are generated-only), so an output renamed or dropped from the config
  is deleted rather than left behind; it also runs from its own directory regardless of cwd.
- **Lint is stricter.** `npm run lint` fails on any warning (`--max-warnings=0`; a warning that
  can't fail the build only ever accumulates), ignores agent worktrees under `.claude/`, and
  now applies ESLint's recommended rules to the Node tooling (`scripts/` and root-level
  configs), which previously got zero rules. The pre-commit hook covers `.js`/`.mjs` too and
  skips files ESLint ignores (the regenerated `platforms/js/*.ts` you now commit). CI jobs time
  out after 20 minutes.
- **The story accessibility test proves its own coverage.** It now fails if any stories file
  under `src/` isn't loaded (in every extension `.storybook/main.ts` renders), if a stories file
  composes no stories, or if an `EXCLUDED` entry names a story that no longer exists. Its glob
  widened to all of `src/` and every story extension.
- `npm run check-contrast` now measures what the components actually render, not only what the
  token names imply: every role used as text on another surface (declared in
  `TEXT_ON_SURFACE`, with translucent tints composited), focus rings at the opacity the
  components draw them, and the status alert icons at 3:1. It scans `src/components/`
  (stories included) and fails when a text, icon, or focus-ring color class is used at an
  opacity no pairing measures, or when one class list sets both an element's text and its own
  background and that exact combination isn't measured. Text whose background comes from an
  ancestor is covered per role only — see Foundations → Accessibility. Its behavior is covered
  by tests under `scripts/__tests__/`, which run as a separate Node project in `npm run test`.
- The package is now `@acme/design-system` (component registry: `acme-design-system`), and the
  written half is referred to throughout as brand and content **guidance/guidelines** rather than
  by its former name. `npm run init` renames the package to `@<slug>/design-system` accordingly.
- `README.md` now covers both halves of the repo — the process assets and the interface
  foundation — and routes readers to the prompt that matches their situation.
- Licensed under MIT.
