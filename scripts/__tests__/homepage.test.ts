import { describe, expect, it } from 'vitest'
import { isSite, PLACEHOLDER_HOMEPAGE, siteBase, TEMPLATE_HOMEPAGE } from '../homepage.mjs'

// The one reading of package.json "homepage" that init, build-registry, and check-pages-homepage
// share: the directory URL the registry builds `r/<name>.json` under.
describe('siteBase', () => {
  it.each([
    ['https://owner.github.io/repo', 'https://owner.github.io/repo/'], // a Pages project site keeps its path
    ['https://owner.github.io/repo/', 'https://owner.github.io/repo/'],
    ['HTTPS://Owner.GitHub.io/repo', 'https://owner.github.io/repo/'], // scheme and host are case-insensitive
    ['https://design.client.example', 'https://design.client.example/'],
    ['http://localhost:8123', 'http://localhost:8123/'],
  ])('reads %s as %s', (value, expected) => {
    expect(siteBase(value)).toBe(expected)
  })

  it.each([
    ['design.client.example', 'is not a URL'],
    ['ftp://design.client.example', 'must be an http(s) URL'],
    ['https://github.com/owner/repo#readme', 'has a query or fragment'], // npm's usual homepage
    ['https://owner.github.io/repo?ref=x', 'has a query or fragment'],
    ['https://owner.github.io/repo/index.html', 'names a page'],
    ['https://user:secret@owner.github.io/repo/', 'must not contain credentials'],
  ])('refuses %s: %s', (value, reason) => {
    expect(() => siteBase(value, 'homepage')).toThrow(reason)
  })

  it('holds its own constants to the contract', () => {
    expect(siteBase(PLACEHOLDER_HOMEPAGE)).toBe(PLACEHOLDER_HOMEPAGE)
    expect(siteBase(TEMPLATE_HOMEPAGE)).toBe(TEMPLATE_HOMEPAGE)
  })
})

describe('isSite', () => {
  it('compares addresses as sites, and an invalid or missing value is no site', () => {
    expect(isSite('https://joela510.github.io/agent-ready-template', TEMPLATE_HOMEPAGE)).toBe(true)
    expect(isSite('https://client.github.io/design/', TEMPLATE_HOMEPAGE)).toBe(false)
    expect(isSite('not a url', TEMPLATE_HOMEPAGE)).toBe(false)
    expect(isSite(undefined, TEMPLATE_HOMEPAGE)).toBe(false)
  })
})
