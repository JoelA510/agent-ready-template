---
id: expo.doctor-in-ci
title: CI runs Expo's dependency and config checks
severity: medium
enforcement: check
audit-area: 7
---

**Requires:** a `pull_request` workflow runs `npx expo-doctor` or `npx expo install --check`.

**Why:** an Expo SDK pins exact versions of the native packages it was tested with. A dependency
update that drifts one of them builds and passes unit tests, then crashes in the native build or
at runtime. expo-doctor also catches committed native folders that silently stop EAS from applying
app config changes.

**Meeting it:** `CI=1 npx expo install --check` (it exits non-zero in CI), or `npx expo-doctor`,
in the job that runs on pull requests. expo-doctor needs the network.

**The check:** looks for either command in what `pull_request` workflows run for the app at the
pack's path, traced through scripts and counted only where it can fail the run.
