---
id: expo.update-environment
title: Every eas update names its EAS environment
severity: high
enforcement: check
audit-area: 7
---

**Requires:** each `eas update` a workflow or a script runs passes `--environment`.

**Why:** an update's JavaScript bundle is built where `eas update` runs, with whatever environment
variables it can see. With `--environment`, it loads that EAS environment's variables and ignores
local `.env` files. Without it, eas-cli skips the requirement entirely when `CI` is set (SDK 55 and
later demand the flag only at a terminal), so a CI update is built from the runner's environment
and `.env` files, and can ship a production app pointing at a development backend, with no error.

**Meeting it:** `eas update --channel production --environment production --message "..."`, the
environment matching the build profile's `environment` in `eas.json`.

**The check:** finds `eas update` (or `eas-cli update`) in every workflow and package script, and
fails on one without `--environment`, unless it's in a package script every caller of which passes
the flag through (`pnpm update:prod --environment production`; for npm, after a lone `--`, since
npm keeps the flags before it). `n/a` when nothing runs
`eas update`. EAS Workflows' `type: update` jobs, which default to production, aren't read.
