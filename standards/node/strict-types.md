---
id: node.strict-types
title: Types are strict, or checked as JavaScript
severity: high
enforcement: check
audit-area: 2
---

**Requires:** every TypeScript project config that compiles `.ts` or `.tsx` sources sets `strict`;
one that compiles only JavaScript sets `checkJs`.

**Why:** the definition of done says the project's agreed strictness holds and is never loosened to
get green. A strict flag turned off in an emergency and never restored is the common way it's lost,
and nothing else notices.

**Meeting it:** `"strict": true` in the config the sources compile under (a base config that others
extend counts). For a JavaScript codebase, `"checkJs": true` with `allowJs`. Raising strictness on
an existing codebase is a flagged refactor; record the current state in the baseline meanwhile.

**The check:** parses `tsconfig.json` (or `jsconfig.json`) next to `package.json` with TypeScript
itself, following `extends` and project `references`, and reads each config's resolved options and
file list. Fails when no config exists, since then nothing typechecks the project.
