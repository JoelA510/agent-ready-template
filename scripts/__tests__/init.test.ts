import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { siteBase, TEMPLATE_HOMEPAGE } from '../homepage.mjs'
import { listRepoFiles } from '../repo-files.mjs'
import { fixtureGit } from './fixture-git'

const REPO = resolve(__dirname, '../..')
// This test ships with every fork. In one that has already been rebranded, the expectations
// about the template's own placeholder content lapse; everything else still holds.
const ORIGINAL_NAME: string = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).name
const ORIGINAL_VERSION: string = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version
const UNBRANDED = ORIGINAL_NAME === '@acme/design-system'

// The fixture is a fresh fork: every file of this working tree (so a new "Acme" in a doc fails
// here before it's committed), committed as a baseline that each test resets to, with
// node_modules linked in for the gates the rebranded fork has to pass.
let root: string
let outside: string
const git = fixtureGit(() => root)
const init = (...args: string[]) => spawnSync(process.execPath, ['scripts/init.mjs', ...args], { cwd: root, encoding: 'utf8' })
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const changed = () => git('status', '--porcelain').trim()
// stderr with the one expected notice removed: in an already-rebranded fork, init says so.
const errors = (stderr: string) => stderr.replace(/^No "Acme" left to replace.*\n/m, '')
const REBRAND = ['--name', 'Client Inc.', '--slug', 'clientinc', '--homepage', 'https://design.client.example']
// Files that name the placeholder on purpose, and lines marked to keep it.
const EXEMPT = new Set(['CHANGELOG.md', 'scripts/init.mjs', 'scripts/__tests__/init.test.ts'])

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'init-'))
  outside = mkdtempSync(join(tmpdir(), 'init-outside-'))
  for (const rel of listRepoFiles(REPO)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    copyFileSync(join(REPO, rel), join(root, rel))
  }
  symlinkSync(join(REPO, 'node_modules'), join(root, 'node_modules'), 'dir')
  git('init', '-q')
  git('add', '-A')
  git('commit', '-q', '--no-verify', '-m', 'fork')
  git('tag', 'fork')
}, 60_000)

beforeEach(() => {
  git('reset', '-q', '--hard', 'fork')
  git('clean', '-q', '-fd', '-e', 'node_modules')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

describe('init', () => {
  it('leaves no Acme anywhere a fork ships, except history and lines marked to keep it', () => {
    const { status, stderr } = init(...REBRAND)
    expect({ status, errors: errors(stderr) }).toEqual({ status: 0, errors: '' })
    const leftovers = listRepoFiles(root)
      .filter((rel) => !EXEMPT.has(rel) && !rel.startsWith('node_modules'))
      .flatMap((rel) =>
        read(rel)
          .split('\n')
          .map((line, i) => ({ rel, line: i + 1, text: line.trim() }))
          .filter(({ text }) => /acme/i.test(text) && !text.includes('init:keep')),
      )
    expect(leftovers).toEqual([])
  }, 60_000)

  it('names the package, the lockfile, and the registry, and points the registry at --homepage', () => {
    expect(init(...REBRAND).status).toBe(0)
    const pkg = JSON.parse(read('package.json'))
    expect([pkg.name, pkg.homepage]).toEqual(['@clientinc/design-system', 'https://design.client.example/'])
    const lock = JSON.parse(read('package-lock.json'))
    expect([lock.name, lock.packages[''].name]).toEqual(['@clientinc/design-system', '@clientinc/design-system'])
    const registry = JSON.parse(read('registry.json'))
    expect([registry.name, registry.homepage]).toEqual(['clientinc-design-system', 'https://design.client.example/'])
    // The served items install their dependencies from the fork's site, not the template's.
    expect(JSON.parse(read('public/r/alert-dialog.json')).registryDependencies).toContain('https://design.client.example/r/button.json')
    expect(read('index.html')).toContain('<title>Client Inc. — Design System Template</title>')
  }, 60_000)

  it.runIf(UNBRANDED)("drops the template's own homepage when --homepage isn't given, so the fork's registry can't install the template's components", () => {
    // The premise: the template's homepage is the one init knows to remove.
    expect(siteBase(JSON.parse(read('package.json')).homepage)).toBe(TEMPLATE_HOMEPAGE)
    const { status, stdout } = init('--name', 'Client Inc.', '--slug', 'clientinc')
    expect(status).toBe(0)
    expect(JSON.parse(read('package.json'))).not.toHaveProperty('homepage')
    expect(JSON.parse(read('public/r/alert-dialog.json')).registryDependencies).toContain('https://example.com/r/button.json')
    expect(stdout).toContain('set package.json "homepage" to its URL')
    expect(stdout).toContain('Replace SECURITY.md')
  }, 60_000)

  it.runIf(UNBRANDED)('starts the fork at 0.1.0 and records the template version it started from, once', () => {
    const templateVersion = ORIGINAL_VERSION
    expect(init(...REBRAND).status).toBe(0)
    const pkg = JSON.parse(read('package.json'))
    expect([pkg.version, pkg.templateVersion]).toEqual(['0.1.0', templateVersion])
    const lock = JSON.parse(read('package-lock.json'))
    expect([lock.version, lock.packages[''].version]).toEqual(['0.1.0', '0.1.0'])
    // A re-run (the fork has released since) leaves both alone.
    writeFileSync(join(root, 'package.json'), JSON.stringify({ ...pkg, version: '2.3.0' }, null, 2) + '\n')
    expect(init(...REBRAND).status).toBe(0)
    expect(JSON.parse(read('package.json'))).toMatchObject({ version: '2.3.0', templateVersion })
  }, 60_000)

  it("leaves the version alone in a copy rebranded before init recorded templateVersion", () => {
    expect(init(...REBRAND).status).toBe(0)
    const pkg = JSON.parse(read('package.json'))
    delete pkg.templateVersion
    writeFileSync(join(root, 'package.json'), JSON.stringify({ ...pkg, version: '0.4.0' }, null, 2) + '\n')
    const { status, stderr } = init(...REBRAND)
    expect(status).toBe(0)
    expect(JSON.parse(read('package.json'))).toMatchObject({ version: '0.4.0' })
    expect(JSON.parse(read('package.json'))).not.toHaveProperty('templateVersion')
    expect(stderr).toContain('Only the package name, registry, and page title were set, and the homepage.')
  }, 60_000)

  it('keeps a homepage the fork set itself, before init or on a re-run', () => {
    const pkg = JSON.parse(read('package.json'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ ...pkg, homepage: 'https://client.github.io/design' }, null, 2) + '\n')
    expect(init('--name', 'Client Inc.', '--slug', 'clientinc').status).toBe(0)
    expect(JSON.parse(read('package.json')).homepage).toBe('https://client.github.io/design')
    expect(JSON.parse(read('public/r/alert-dialog.json')).registryDependencies).toContain('https://client.github.io/design/r/button.json')
    expect(init('--name', 'Client Inc.', '--slug', 'clientinc').status).toBe(0)
    expect(JSON.parse(read('package.json')).homepage).toBe('https://client.github.io/design')
  }, 60_000)

  it.runIf(UNBRANDED)("replaces the template's lowercase identifiers with the slug", () => {
    expect(init(...REBRAND).status).toBe(0)
    expect(read('src/components/ui/separator.stories.tsx')).toContain('billing@clientinc.example')
    expect(read('docs/system/contributing.mdx')).toContain('`clientinc-analytics`')
  }, 60_000)

  it('changes only the name and version lines of the lockfile', () => {
    expect(init(...REBRAND).status).toBe(0)
    const diff = git('diff', '-U0', '--', 'package-lock.json')
      .split('\n')
      .filter((line) => /^[-+]\s/.test(line))
    // Rebranding the template itself restarts the version at 0.1.0; a fork keeps its own. (A fork
    // already named @clientinc has no name line to change.)
    const renamed = ORIGINAL_NAME !== '@clientinc/design-system'
    const restarts = UNBRANDED && ORIGINAL_VERSION !== '0.1.0'
    const lines = (indent: string) => [
      ...(renamed ? [`-${indent}"name": "${ORIGINAL_NAME}",`] : []),
      ...(restarts ? [`-${indent}"version": "${ORIGINAL_VERSION}",`] : []),
      ...(renamed ? [`+${indent}"name": "@clientinc/design-system",`] : []),
      ...(restarts ? [`+${indent}"version": "0.1.0",`] : []),
    ]
    expect(diff).toEqual([...lines('  '), ...lines('      ')])
  }, 60_000)

  it('uses --scope for the package name when given', () => {
    expect(init('--name', 'Client Inc.', '--slug', 'clientinc', '--scope', '@client').status).toBe(0)
    expect(JSON.parse(read('package.json')).name).toBe('@client/design-system')
    expect(JSON.parse(read('registry.json')).name).toBe('client-design-system')
  }, 60_000)

  it('leaves a fork that type-checks and has no generated file out of date, whatever the name', () => {
    // An apostrophe would end a single-quoted string; & and $& are special elsewhere.
    const { status, stdout } = init('--name', "O'Reilly & Sons, Inc.", '--slug', 'oreilly')
    expect(status).toBe(0)
    expect(stdout).toContain('written as \u2019')
    git('add', '-A')
    git('commit', '-q', '--no-verify', '-m', 'rebrand')
    const drift = spawnSync(process.execPath, ['scripts/check-generated.mjs'], { cwd: root, encoding: 'utf8' })
    expect({ status: drift.status, stderr: drift.stderr }).toEqual({ status: 0, stderr: '' })
    const tsc = spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.app.json', '--noEmit'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect({ status: tsc.status, stdout: tsc.stdout }).toEqual({ status: 0, stdout: '' })
  }, 120_000)

  it('keeps lines marked init:keep, and the changelog, as written', () => {
    writeFileSync(join(root, 'notes.md'), 'Ships as Acme Inc. <!-- init:keep -->\nSold by Acme Inc.\n')
    expect(init(...REBRAND).status).toBe(0)
    expect(read('notes.md')).toBe('Ships as Acme Inc. <!-- init:keep -->\nSold by Client Inc.\n')
    expect(git('diff', '--name-only', '--', 'CHANGELOG.md').trim()).toBe('')
  }, 60_000)

  it("skips symlinks and gitlinks instead of following or crashing on them", () => {
    writeFileSync(join(outside, 'elsewhere.md'), 'Acme Inc.\n')
    symlinkSync(join(outside, 'elsewhere.md'), join(root, 'linked.md'))
    mkdirSync(join(root, 'vendor-sub'))
    git('update-index', '--add', '--cacheinfo', `160000,${git('rev-parse', 'HEAD').trim()},vendor-sub`)
    const { status, stderr } = init(...REBRAND)
    expect({ status, errors: errors(stderr) }).toEqual({ status: 0, errors: '' })
    expect(readFileSync(join(outside, 'elsewhere.md'), 'utf8')).toBe('Acme Inc.\n')
  }, 60_000)

  it('is a no-op the second time, and says so', () => {
    expect(init(...REBRAND).status).toBe(0)
    git('add', '-A')
    git('commit', '-q', '--no-verify', '-m', 'rebrand')
    const again = init(...REBRAND)
    expect(again.status).toBe(0)
    expect(again.stderr).toContain('looks rebranded already')
    expect(changed()).toBe('')
  }, 60_000)

  it.each([
    [['--name', 'Client Inc.'], 'Usage:'],
    [['--name', 'Client', 'Inc.', '--slug', 'clientinc'], 'unexpected argument "Inc."'],
    [['--name', 'Client Inc.', '--slug', 'clientinc', '--slug', 'other'], '--slug is given twice'],
    [['--name', 'Client "Best" Inc.', '--slug', 'clientinc'], "can't contain quotes"],
    [['--name', 'Client {Inc}', '--slug', 'clientinc'], "can't contain quotes"],
    [['--name', 'Dollar$& Inc.', '--slug', 'dollar'], "can't contain quotes"],
    [['--name', 'Acme Robotics Inc.', '--slug', 'robotics'], 'can\'t contain "acme"'],
    [['--name', 'Client Inc.', '--slug', 'acme-robotics'], 'can\'t contain "acme"'],
    [['--name', 'Client Inc.', '--slug', 'Client Inc'], 'must be kebab-case'],
    [['--name', 'Client Inc.', '--slug', 'client--inc'], 'must be kebab-case'],
    [['--name', 'Client Inc.', '--slug', 'clientinc', '--scope', 'client'], 'must look like @clientinc'],
    [['--name', 'Client Inc.', '--slug', 'clientinc', '--homepage', 'design.client.example'], 'is not a URL'],
    [['--name', 'Client Inc.', '--slug', 'clientinc', '--homepage', 'ftp://design.client.example'], 'must be an http(s) URL'],
    [['--name', 'Client Inc.', '--slug', 'clientinc', '--homepage', 'https://github.com/client/design#readme'], 'has a query or fragment'],
    [['--name', 'Client Inc.', '--slug', 'clientinc', '--homepag', 'https://x.example'], 'unknown option --homepag'],
    [['--name', 'Client Inc.', '--slug', 'clientinc', '--scope'], '--scope needs a value'],
  ])('rejects %j before writing anything', (args, message) => {
    const { status, stderr } = init(...args)
    expect(status).toBe(1)
    expect(stderr).toContain(message)
    expect(changed()).toBe('')
  }, 60_000)
})
