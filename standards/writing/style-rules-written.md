---
id: writing.style-rules-written
title: The style rules are written down, and the mechanical ones are enforced
severity: low
enforcement: audit
audit-area: 12
---

**Requires:** one file that people and agents both read holds the repository's voice and style
rules, and each rule a machine can check (a spelling variant, a banned phrase, a format) is in the
prose check rather than only in that file.

**Why:** a rule that lives only in a style guide is enforced by whoever remembers it. A rule that
lives only in a checker is unexplained, so nobody can tell whether a violation is a mistake or a
deliberate exception.

**Meeting it:** keep the voice rules in the agent instructions (or a style guide they point to),
and move each mechanical rule into the checker with a pointer back to where it's explained.

**Audit question:** pick five rules from the style guide. Which does the check enforce, and which
of the rest could it? And are the names the work uses on the accept list, and each retired name
on the reject list? (`writing.vocabulary-registered` checks that the lists exist and are read, not
that they're complete.)
