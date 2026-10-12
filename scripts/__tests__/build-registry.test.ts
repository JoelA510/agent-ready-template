import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const REPO = resolve(__dirname, '../..')
const readJson = (root: string, rel: string) => JSON.parse(readFileSync(join(root, rel), 'utf8'))

type Item = { name: string; dependencies?: string[]; registryDependencies?: string[]; files: { path: string; content?: string }[] }
const served = (root: string): Item[] =>
  readdirSync(join(root, 'public/r'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(root, `public/r/${f}`))

// What the shadcn CLI needs from a served item (read in the shadcn 4.21 source, and shown with
// `shadcn add` against a local copy): the file's content, since a file without it is skipped in
// silence, and each dependency on another item here as that item's URL, since a bare name
// resolves to shadcn's own registry.
describe('the served registry (public/r), as committed', () => {
  const items = served(REPO)
  const base = new URL(readJson(REPO, 'registry.json').homepage.replace(/\/?$/, '/'))

  it('has an item per component (so the checks below examined something)', () => {
    expect(items.length).toBeGreaterThan(40)
    expect(items.map((i) => i.name)).toEqual(expect.arrayContaining(['button', 'utils', 'alert-dialog']))
  })

  it('has an llms.txt that names the registry and links every item it serves', () => {
    // llmstxt.org: an H1 (the only required part), a blockquote summary, then H2 sections of links.
    const text = readFileSync(join(REPO, 'public/llms.txt'), 'utf8')
    expect(text.split('\n')[0]).toBe(`# ${readJson(REPO, 'registry.json').name}`)
    expect(text).toMatch(/^# .+\n\n> /)
    expect(text.match(/^## .+$/gm)).toEqual(['## Components', '## Utilities'])
    const links = [...text.matchAll(/^- \[[^\]]+\]\(([^)]+)\): \S/gm)].map((m) => m[1])
    expect(links.sort()).toEqual(items.map((i) => `${base.href}r/${i.name}.json`).sort())
  })

  it("inlines every file's source, exactly as it is on disk", () => {
    const stale = items.flatMap((item) =>
      item.files.filter((f) => f.content !== readFileSync(join(REPO, f.path), 'utf8')).map((f) => `${item.name}: ${f.path}`),
    )
    expect(stale).toEqual([])
  })

  it('names each dependency by the URL of an item this registry serves', () => {
    const deps = items.flatMap((item) => item.registryDependencies ?? [])
    expect(deps.length).toBeGreaterThan(40)
    const wrong = deps.filter((dep) => {
      const m = new RegExp(`^${base.href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}r/([a-z0-9-]+)\\.json$`).exec(dep)
      return !m || !existsSync(join(REPO, 'public/r', `${m[1]}.json`))
    })
    expect(wrong).toEqual([])
  })

  // A bare name installs npm's `latest`, which can be a major a component doesn't compile against.
  it('names each npm dependency with the major package.json declares it at', () => {
    const declared: Record<string, string> = readJson(REPO, 'package.json').dependencies
    const deps = items.flatMap((item) => (item.dependencies ?? []).map((dep) => ({ item: item.name, dep })))
    expect(deps.length).toBeGreaterThan(40)
    const wrong = deps.filter(({ dep }) => {
      const m = /^(@?[^@]+)@\^(\d+(?:\.\d+)?)$/.exec(dep)
      const range = m ? declared[m[1]] : undefined
      if (!m || !range) return true
      const [major, minor] = range.replace(/^[\^~]/, '').split('.')
      return m[2] !== (major === '0' ? `0.${minor}` : major)
    })
    expect(wrong).toEqual([])
    expect(deps.find((d) => d.item === 'data-table' && d.dep.startsWith('@tanstack/react-table@'))?.dep).toBe('@tanstack/react-table@^9')
  })
})

describe('build-registry, from a homepage', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  // Just what the script reads: itself, package.json, and the sources it publishes.
  function fixture(homepage: string | undefined, dependencies: Record<string, string> = {}) {
    const root = mkdtempSync(join(tmpdir(), 'build-registry-'))
    roots.push(root)
    for (const rel of ['scripts/build-registry.mjs', 'scripts/homepage.mjs', 'src/lib/utils.ts', 'src/hooks/use-mobile.ts', 'src/components/ui']) {
      mkdirSync(join(root, rel, '..'), { recursive: true })
      cpSync(join(REPO, rel), join(root, rel), { recursive: true })
    }
    const pkg = readJson(REPO, 'package.json')
    if (homepage === undefined) delete pkg.homepage
    else pkg.homepage = homepage
    Object.assign(pkg.dependencies, dependencies)
    writeFileSync(join(root, 'package.json'), JSON.stringify(pkg))
    return root
  }
  const build = (root: string) => spawnSync(process.execPath, ['scripts/build-registry.mjs'], { cwd: root, encoding: 'utf8' })
  const depsOf = (root: string, name: string) => readJson(root, `public/r/${name}.json`).registryDependencies

  it("keeps a project site's path when the homepage has no trailing slash (GitHub Pages)", () => {
    const root = fixture('https://owner.github.io/repo')
    expect(build(root).status).toBe(0)
    expect(depsOf(root, 'alert-dialog')).toEqual(['https://owner.github.io/repo/r/button.json', 'https://owner.github.io/repo/r/utils.json'])
  })

  it('uses example.com as a placeholder when there is no homepage', () => {
    const root = fixture(undefined)
    expect(build(root).status).toBe(0)
    expect(depsOf(root, 'alert-dialog')).toContain('https://example.com/r/button.json')
  })

  it.each([
    ['design.client.example', 'is not a URL'],
    ['https://owner.github.io/repo#readme', 'has a query or fragment'], // would drop the repo segment from every URL
  ])('refuses the homepage %s, writing nothing', (homepage, reason) => {
    const root = fixture(homepage)
    const { status, stderr } = build(root)
    expect(status).not.toBe(0)
    expect(stderr).toContain(reason)
    expect(stderr).toContain('The registry needs the http(s) URL of the site that serves public/r/')
    expect(existsSync(join(root, 'registry.json'))).toBe(false)
  })

  it('follows a major upgrade in package.json, and not an in-range one', () => {
    const npmDepsOf = (root: string) => readJson(root, 'public/r/data-table.json').dependencies
    const inRange = fixture('https://owner.github.io/repo/', { '@tanstack/react-table': '^8.99.0', 'lucide-react': '~1.0.4' })
    expect(build(inRange).status).toBe(0)
    expect(npmDepsOf(inRange)).toEqual(['@tanstack/react-table@^8', 'lucide-react@^1'])
    const major = fixture('https://owner.github.io/repo/', { '@tanstack/react-table': '^9.2.6' })
    expect(build(major).status).toBe(0)
    expect(npmDepsOf(major)).toContain('@tanstack/react-table@^9')
  })

  it.each(['latest', 'workspace:*', '>=8 <10'])('writes nothing when a dependency is declared as %j, which has no major to pin', (range) => {
    const root = fixture('https://owner.github.io/repo/', { '@tanstack/react-table': range })
    const { status, stderr } = build(root)
    expect(status).toBe(1)
    expect(stderr).toContain(`@tanstack/react-table: package.json declares "${range}"`)
    expect(existsSync(join(root, 'registry.json'))).toBe(false)
    expect(existsSync(join(root, 'public/r'))).toBe(false)
  })

  it('writes nothing when a dependency names no item', () => {
    const root = fixture('https://owner.github.io/repo/')
    writeFileSync(join(root, 'src/components/ui/probe.tsx'), "import { Missing } from '@/components/ui/missing'\nexport const Probe = Missing\n")
    const { status, stderr } = build(root)
    expect(status).toBe(1)
    expect(stderr).toContain('probe -> missing (no such item)')
    expect(existsSync(join(root, 'registry.json'))).toBe(false)
    expect(existsSync(join(root, 'public/r'))).toBe(false)
  })
})
