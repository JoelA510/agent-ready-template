---
pack: expo
title: Expo and EAS apps
detect:
  - dependency: expo
---

# Expo

A React Native app built with Expo and shipped through EAS: over-the-air updates that only reach
binaries they're compatible with and are built with the right environment, nothing secret in what
the app bundles, and Expo's own health checks in CI. Detected from `expo` in the root
`package.json`; an app in a workspace (`mobile-app/`) is declared with a path.

App config written as code (`app.config.ts`) can't be evaluated without running it, so the checks
read `app.json` and say when the answer is only in code. Facts are from Expo's documentation and
eas-cli's source, read on 2026-10-07 (SDK 57 stable, 58 in beta).
