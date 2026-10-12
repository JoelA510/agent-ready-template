---
id: writing.vocabulary-registered
title: The prose check reads the project's vocabulary, so an unregistered or retired term fails
severity: medium
enforcement: check
audit-area: 12
---

**Requires:** the prose check that runs on pull requests reads two lists the repository keeps: an
accept list of the names and terms it uses, with a spell check on, so a word in neither the list
nor the dictionary fails; and a reject list of retired names, wrong casings, and banned
spellings, each failing wherever it appears.

**Why:** the dictionary already knows the common names. Under cspell 10.3.6, *Denise* and *Vicky*
pass without being registered, and Vale 3.24.0's dictionary passes them and *colour* and *grey*
too. A character renamed from Denise comes back without a sound unless Denise is rejected, and a
cast list kept only in the agent instructions is enforced by whoever remembers it.

**Meeting it:**

- **cspell:** the names in `words` or an enabled dictionary file; retired terms in `flagWords`,
  one word each (cspell ignores a phrase there). A registered `AnneMarie` also passes *Annemarie*
  unless `caseSensitive` is on; an all-lowercase flag catches every casing, the right one too.
- **Vale:** `Vocab = <Name>`, with `accept.txt` and `reject.txt` in
  `<StylesPath>/config/vocabularies/<Name>/` (Vale 3's place), and `BasedOnStyles = Vale` for
  Markdown. A rejected phrase that holds an accepted term (`Auntie Kimmy`, with `Kimmy` accepted)
  is never reported: write that one as a rule with `vocab: false`. With cspell spelling the prose,
  Vale can run with `Vale.Spelling = NO` and keep the reject list.
- **The repository's own checker:** keep both lists as files it reads, and name them in
  `docs/standards/conformance.json`:
  `"vocabulary": { "accept": ["tools/names.txt"], "reject": ["tools/retired.txt"] }`.

**The check:** `n/a` when no prose check runs on pull requests (`writing.prose-checks-in-ci`).
markdownlint or textlint alone fails: markdownlint's proper-names rule fixes the casing of the
names it lists and passes any it doesn't, and textlint's prh rules aren't counted. For each cspell
or Vale run in a `pull_request` workflow, command or action, it works out the Markdown files the
run checks and the settings each gets, as the tool does (cspell 10.3.6, Vale 3.24.0). The files:
the run's path arguments, a directory naming everything under it; files fed in by `xargs` or `find
-exec`, every file under its directory; for cspell, quoted globs from its root, skipping dot
folders unless `--dot` or the glob names one, less `--exclude` and `!glob` at any depth, or with
no argument the config's `files`; for Vale, a quoted glob lints nothing (Vale doesn't expand it),
and the Vale action lints its working directory. An unquoted glob is the shell's to expand, and
the run is `skipped`.

- **cspell:** the root config (`--config`, else the nearest from the run's root, a `package.json`
  with a `cspell` key first) and the nearest config above the file unless `--no-config-search` is
  given, with relative `import`s: every config's own settings first, then every `overrides` entry
  that covers the file, then the `languageSettings` for Markdown. A config's globs are relative to
  its glob root: `globRoot`; the run's directory for a version "0.1" config or a `.vscode/` one
  with no version; else the directory above `.config/` or `.vscode/`; else its own. The
  lists are `words` or an enabled dictionary file, and `flagWords` or a `!` entry. It fails what
  lets an unknown or flagged word through: `--report` or `unknownWords` set to less than all; an
  `ignoreRegExpList` entry (a regex, a bare string, a named pattern, `Everything`) that hides a
  capitalized word; `ignoreWords` that holds a flagged word; a `minWordLength` above 4; a missing
  dictionary file; a flag that's a phrase or flags a registered word in every casing; and
  `enabled: false` or `ignorePaths` leaving no Markdown file checked (one file left out is fine).
- **Vale:** each `Vocab` folder in the config's `StylesPath`, and the config applied to the file:
  `[*]` first, then each section whose glob matches the file's path from where Vale runs (`*`
  crosses `/`, `!` negates a class), in order, a repeated section merged into its first place. The
  last `BasedOnStyles` wins, and a rule's own setting outlasts it; a setting is `YES`, `NO`,
  `UNSET` or a lowercase level, and anything else turns the rule off, as Vale does. A core
  `Vocab`'s rules are `Vale.Terms` and `Vale.Avoid`, part of the Vale style; a section's adds
  `Vale.<Name>.Terms` and `Vale.<Name>.Avoid`, which run whatever the styles. The accept half
  needs `Vale.Spelling` at a level the run fails on (`error`, or the action's `fail_level`, and no
  lower than `MinAlertLevel`, `--minAlertLevel` or the action's `min_alert_level`); the reject half
  needs the vocabulary's `Avoid` rule there. It fails a list no rule reads, a `--filter` naming one
  of these rules, a `--glob` (or the action's `glob`) that leaves out the Markdown, and a rejected
  phrase that holds an accepted term, a regex entry's match included. `Vale.<Name>.Terms = NO`
  counts as off, as Vale's docs say, though Vale 3.24.0 ignores it.
- **Its own checker:** each declared file is in the repository, has an entry, and is named by the
  checker the workflow runs, or by a code file the checker names. Its lists count for every file.

It passes when every Markdown file a run checks gets both lists or neither, at least one gets
both, and nothing is broken. A file that gets one list and not the other fails, named: a reject
list that reaches only `docs/` lets a retired name through in the book. A run with no list of its
own (Vale under another style, beside a cspell that holds both) is no fault. `skipped`, naming
what's missing: a JavaScript cspell config; a directory, root, path or glob it can't follow (a
variable, an absolute path, an unquoted glob, an extglob, `--file-list` or `--file`, the Vale
action's `files`); a Vale config
named through `VALE_CONFIG_PATH`; any other `--filter`; and the repository's own checker with no
`vocabulary` declared. A file that gets one list beside a skipped run is `skipped` too: the
skipped run may hold the other. It can't tell whether the lists are complete: that's the audit's
question (`writing.style-rules-written`).
