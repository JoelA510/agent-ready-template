---
pack: static-site
title: Statically hosted sites
detect:
  - file: firebase.json
  - file: netlify.toml
  - file: _headers
  - file: public/_headers
  - file: staticwebapp.config.json
---

# Static site

A site served as files by a static host (Firebase Hosting, Netlify, Cloudflare Pages, Azure Static
Web Apps), whether hand-written pages or a built single-page app: security headers set where the
host reads them, the files crawlers ask for actually deployed, and the HTML and its links checked
in CI. Detected from the host's config at the root; a root `index.html` alone isn't a marker,
because plenty of apps and tools have one.

The header check reads `firebase.json` (`hosting.headers`), `netlify.toml` (`[[headers]]`), a
`_headers` file (Netlify and Cloudflare Pages), `staticwebapp.config.json` (`globalHeaders`), and
`vercel.json` (`headers`) when one is present. GitHub Pages can't set response headers at all, so
a site hosted there can't meet `static-site.security-headers`; the check says so rather than
failing it.
