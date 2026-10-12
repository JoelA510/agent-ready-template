import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const REPO = resolve(__dirname, '../..')
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// The script and a package.json with the given homepage (none when undefined).
function check(homepage: string | undefined, ...args: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'pages-homepage-'))
  roots.push(root)
  mkdirSync(join(root, 'scripts'))
  for (const f of ['check-pages-homepage.mjs', 'homepage.mjs']) cpSync(join(REPO, 'scripts', f), join(root, 'scripts', f))
  writeFileSync(join(root, 'package.json'), JSON.stringify(homepage === undefined ? { name: 'x' } : { name: 'x', homepage }))
  const result = spawnSync(process.execPath, ['scripts/check-pages-homepage.mjs', ...args], { cwd: root, encoding: 'utf8' })
  return { status: result.status, out: result.stdout + result.stderr }
}

describe('check-pages-homepage', () => {
  it('passes when the homepage is the site, with or without the trailing slash', () => {
    expect(check('https://owner.github.io/repo/', 'https://owner.github.io/repo').status).toBe(0)
    expect(check('https://owner.github.io/repo', 'https://owner.github.io/repo/').status).toBe(0)
    expect(check('https://Owner.GitHub.io/repo/', 'https://owner.github.io/repo/').status).toBe(0) // hosts are case-insensitive
  })

  it("fails on a fork still pointing at the template's site", () => {
    const { status, out } = check('https://joela510.github.io/agent-ready-template/', 'https://client.github.io/design/')
    expect(status).toBe(1)
    expect(out).toContain('would install their dependencies from https://joela510.github.io/agent-ready-template/')
    expect(out).toContain('Set package.json "homepage" to https://client.github.io/design/')
  })

  it('fails when there is no homepage, since the items would point at the placeholder', () => {
    const { status, out } = check(undefined, 'https://owner.github.io/repo/')
    expect(status).toBe(1)
    expect(out).toContain('example.com placeholder')
  })

  it('fails on a path that differs only after the host', () => {
    expect(check('https://owner.github.io/', 'https://owner.github.io/repo/').status).toBe(1)
  })

  it("fails on a homepage the registry can't build URLs under, with the reason", () => {
    const readme = check('https://github.com/owner/repo#readme', 'https://owner.github.io/repo/')
    expect(readme.status).toBe(1)
    expect(readme.out).toContain('has a query or fragment')
    expect(check('https://owner.github.io/repo/index.html', 'https://owner.github.io/repo/').out).toContain('names a page')
  })

  it('rejects a missing or malformed site URL', () => {
    expect(check('https://owner.github.io/repo/').status).toBe(2)
    expect(check('https://owner.github.io/repo/', 'owner.github.io/repo').status).toBe(1)
  })
})
