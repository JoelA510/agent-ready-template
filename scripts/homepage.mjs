// The component registry's home: package.json "homepage", the site that serves public/r/. One
// contract for everything that reads it (init's --homepage, build-registry, and
// check-pages-homepage), so a value one accepts, another can't reject or read differently.
//
// The registry builds each dependency URL as `r/<name>.json` under this address, so it has to be
// a directory: an http(s) URL with no query, fragment, credentials, or page name. npm's usual
// `https://github.com/owner/repo#readme` is refused rather than silently resolved to the wrong
// place. A missing trailing slash is added, since GitHub Pages serves a project site at
// https://<owner>.github.io/<repo> and `r/x.json` would otherwise replace the repo segment.

/** Stands in until a fork names its own site. */
export const PLACEHOLDER_HOMEPAGE = 'https://example.com/'

/** This template's own site. init removes it from a fresh fork (see init.mjs). */
export const TEMPLATE_HOMEPAGE = 'https://joela510.github.io/agent-ready-template/'

/** The site's directory URL, ending in `/`. Throws an Error that says what's wrong with `value`. */
export function siteBase(value, label = 'homepage') {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label} "${value}" is not a URL`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`${label} "${value}" must be an http(s) URL`)
  if (url.username || url.password) throw new Error(`${label} "${value}" must not contain credentials`)
  if (url.search || url.hash) {
    throw new Error(`${label} "${value}" has a query or fragment; it must be the site's own address, e.g. https://owner.github.io/repo/`)
  }
  if (/\.html?$/i.test(url.pathname)) throw new Error(`${label} "${value}" names a page; it must be the site's own address, the directory it serves`)
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.href
}

/** Whether `value` is `site` once both are read as site addresses; false for an invalid value. */
export function isSite(value, site) {
  let base
  try {
    base = siteBase(value)
  } catch {
    return false // siteBase throws only to say the value isn't a valid address, so it isn't `site`
  }
  return base === siteBase(site)
}
