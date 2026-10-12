---
id: tauri.csp
title: The app sets a content security policy and doesn't weaken it
severity: high
enforcement: check
audit-area: 8
---

**Requires:** `app.security.csp` is set and restricts scripts (it has a `script-src` or a
`default-src`); neither allows `'unsafe-eval'` (`'wasm-unsafe-eval'` is fine); and
`dangerousDisableAssetCspModification` is off.

**Why:** Tauri enables CSP only when the config sets one, and the project template ships
`"csp": null`. Without it, one injected script in the web view can call every command the
capabilities allow, which on a desktop means the user's files.

**Meeting it:** start from `default-src 'self'; script-src 'self'` and add what the app loads.

**The check:** reads the CSP as a string or as a directive object.
