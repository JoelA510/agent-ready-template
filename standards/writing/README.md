---
pack: writing
title: Writing repositories
detect:
  - file: .vale.ini
  - file: _vale.ini
  - file: vale.ini
  - file: .vale
  - file: _vale
  - file: .markdownlint*
  - file: .markdownlint-cli2.*
  - file: cspell.json
  - file: .cspell.json
  - file: cSpell.json
  - file: .cSpell.json
  - file: cspell.jsonc
  - file: .cspell.jsonc
  - file: cspell.yaml
  - file: .cspell.yaml
  - file: cspell.yml
  - file: .cspell.yml
  - file: cspell.config.*
  - file: .cspell.config.*
  - file: .config/cspell*
  - file: .config/.cspell*
  - file: .config/cSpell.json
  - file: .config/.cSpell.json
  - file: .vscode/cspell.json
  - file: .vscode/cSpell.json
  - file: .vscode/.cspell.json
  - file: .textlintrc
  - file: .textlintrc.*
---

# Writing

A repository whose product is prose: a manuscript, documentation, a body of articles. Its tests
are the rules the writing follows (spelling variants, banned phrases, formatting), checked on every
change, and the voice that a checker can't hold written down where people and agents read it.
Detected from a prose linter's config at the root (cspell's in `.config/` too); cspell settings
kept only in `package.json`, or a repository that checks its prose with its own scripts, is
declared with `--pack writing` or in its config.
