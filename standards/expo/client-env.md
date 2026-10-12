---
id: expo.client-env
title: No secret reaches the app bundle through the environment
severity: high
enforcement: check
audit-area: 8
---

**Requires:** no secret-named variable behind the `EXPO_PUBLIC_` prefix, no `${VAR}` left
unexpanded in `eas.json`, and no placeholder values in real env files.

**Why:** every `EXPO_PUBLIC_` value is inlined into the JavaScript bundle and readable by anyone who
unpacks the app, and so is everything in the app config, `extra` included. A key there is a key in
every user's pocket.

**Meeting it:** keep secrets in server code (an API route, an Edge Function) and call it; keep
`EXPO_PUBLIC_` for values that are public by nature (a URL, an anon key protected by row-level
security).

**The check:** runs `scripts/check-env.mjs --root <pack path>` (its header lists every finding) and
reports its findings. `n/a` when the app has no environment variables anywhere.
