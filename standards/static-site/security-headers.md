---
id: static-site.security-headers
title: The host sends security headers on every page
severity: high
enforcement: check
audit-area: 8
---

**Requires:** a header rule that applies to every page and sets a `Content-Security-Policy`
(not only `-Report-Only`), `X-Content-Type-Options: nosniff`, a `Referrer-Policy`, and clickjacking
protection: `frame-ancestors` in the CSP, or `X-Frame-Options`.

**Why:** a static host serves exactly what the config says, and the defaults add almost none of
these. Without a CSP, one injected script (a compromised third-party tag, a stored link) runs with
the page's full authority; without `frame-ancestors`, any site can frame the page and overlay it.
A brochure site has no third-party scripts, so a strict policy costs nothing.

**Meeting it:** in `firebase.json`, a `hosting.headers` entry with `"source": "**"` and each header
under `headers`; in a `_headers` file, a `/*` block. Start from `default-src 'self'; frame-ancestors
'none'; base-uri 'self'; object-src 'none'` and add what the pages load.

**The check:** reads the host configs named in the pack's README, keeps the rules whose pattern
matches every page (`**`, `/*`, `/(.*)`, or one for `*.html`), and names each required header none
of them sets. It reads `firebase.json` with comments, as firebase-tools does, Netlify's `values` as a
table or inline, and `_headers` at the root, in `public/` or `static/`, or in the served directory.
A `<meta http-equiv="Content-Security-Policy">` in `index.html`, outside an HTML comment, counts for
the CSP, though not for `frame-ancestors`, which a meta tag can't set. `Strict-Transport-Security` isn't
required here: hosts differ in whether they add it themselves, and the check can't see what they
add. `n/a` when no config hosts a site;
`skipped` for a site hosted only on GitHub Pages, which can't set headers. It can't see headers a
CDN or proxy in front of the host adds.
