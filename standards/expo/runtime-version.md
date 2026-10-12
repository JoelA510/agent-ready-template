---
id: expo.runtime-version
title: Updates carry a runtime version policy
severity: high
enforcement: check
audit-area: 7
---

**Requires:** an app that uses `expo-updates` sets `runtimeVersion` to a policy (`appVersion`,
`nativeVersion`, or `fingerprint`) in its app config, for every platform.

**Why:** the runtime version is how EAS Update knows which installed binaries an update can run on.
A hand-written string has to be bumped by hand on every native change; the day someone forgets, an
update that calls a native module the installed binary doesn't have reaches every user and crashes
on launch. A policy computes it.

**Meeting it:** `"runtimeVersion": { "policy": "appVersion" }` (Expo's recommendation, with
`version` bumped on each native release), or `"fingerprint"`, which hashes the native project and
costs more builds.

**The check:** applies when `expo-updates` is a dependency or `updates.url` is set. Reads
`expo.runtimeVersion` in `app.json` (or both `ios.runtimeVersion` and `android.runtimeVersion`):
a policy object passes (`appVersion`, `nativeVersion`, `fingerprint`, or `sdkVersion`), a string or
an unknown policy fails. `skipped` when only `app.config.*`, which is code, could
set it; an `app.json` that isn't JSON fails.
