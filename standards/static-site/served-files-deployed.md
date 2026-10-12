---
id: static-site.served-files-deployed
title: robots.txt and sitemap.xml are in what gets deployed
severity: medium
enforcement: check
audit-area: 12
---

**Requires:** a `robots.txt` or `sitemap.xml` the repository keeps ends up in the directory the
host serves: kept there, or in the directory the build copies into it as is (`public/` for Vite).

**Why:** a build tool copies only its static directory into the output, so a `robots.txt` at the
repository root, beside `index.html`, looks deployed and isn't. Crawlers then get the host's 404
page, and a sitemap that was written by hand quietly does nothing.

**Meeting it:** move them into `public/` (Vite, Astro, Next.js) or `static/` (SvelteKit, Hugo),
or point the host at a directory that has them.

**The check:** finds the served directory (`hosting.public` in `firebase.json`, `publish` in
`netlify.toml`, read relative to its `base`). `n/a` when it's the repository root, when the
repository keeps neither file, or when no config names a directory. Otherwise each file has to be in
the served directory, if that directory is committed, or in a `public/` or `static/` directory at
the pack's root or beside the served directory, which a build copies into it. It doesn't run the
build, so a generator that copies root files itself (Jekyll's `_site`) reads as a failure.
