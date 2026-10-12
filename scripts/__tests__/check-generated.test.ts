import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { fixtureGit } from './fixture-git'

const REPO = resolve(__dirname, '../..')
const SCRIPT = 'scripts/check-generated.mjs'

// The fixture is this repo's last commit (not the working tree, so an in-progress edit can't
// turn this red), with the script under test copied over from the working tree, node_modules
// linked in, and the builds run once and committed as a known-synced baseline. Every test starts
// from that baseline, so the tests prove what the script does, not whether HEAD is in sync
// (that's CI's `check:generated` step).
let root: string

const git = fixtureGit(() => root)
const commit = (message: string) => git('commit', '-q', '--no-verify', '--allow-empty', '-m', message)
const run = () => spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8' })

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'check-generated-'))
  const archive = execFileSync('git', ['archive', '--format=tar', 'HEAD'], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 })
  execFileSync('tar', ['-x', '-C', root], { input: archive })
  // The script under test and the pipeline config, plus every script module (whatever the config
  // imports today), package.json (which names the builds), and the skills source, all from the
  // working tree: a list of the config's imports would go stale.
  const modules = readdirSync(join(REPO, 'scripts')).filter((f) => f.endsWith('.mjs')).map((f) => `scripts/${f}`)
  for (const file of [SCRIPT, 'style-dictionary.config.mjs', 'package.json', ...modules]) copyFileSync(join(REPO, file), join(root, file))
  rmSync(join(root, '.agents'), { recursive: true, force: true })
  cpSync(join(REPO, '.agents'), join(root, '.agents'), { recursive: true })
  symlinkSync(join(REPO, 'node_modules'), join(root, 'node_modules'), 'dir')
  git('init', '-q')
  execFileSync(process.execPath, ['style-dictionary.config.mjs'], { cwd: root, stdio: 'ignore' })
  execFileSync(process.execPath, ['scripts/build-registry.mjs'], { cwd: root, stdio: 'ignore' })
  execFileSync(process.execPath, ['scripts/build-skills.mjs'], { cwd: root, stdio: 'ignore' })
  git('add', '-A')
  commit('baseline')
  git('tag', 'baseline')
}, 120_000)

beforeEach(() => {
  git('reset', '-q', '--hard', 'baseline')
  git('clean', '-q', '-fd', '-e', 'node_modules')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('check-generated', () => {
  it('passes when the committed outputs match their sources', () => {
    const { status, stdout, stderr } = run()
    expect({ status, stderr }).toEqual({ status: 0, stderr: '' })
    expect(stdout).toContain('✓ Generated outputs match their sources')
  }, 60_000)

  it('fails when a token source changed but its outputs were not regenerated', () => {
    const radius = join(root, 'tokens/core/radius.json')
    writeFileSync(radius, readFileSync(radius, 'utf8').replace('"0.625rem"', '"0.75rem"'))
    commit('token only')
    const { status, stderr } = run()
    expect(stderr).toContain('M platforms/js/tokens-core.ts')
    expect(stderr).toContain('M src/styles/tokens/tokens-core.css')
    expect(status).toBe(1)
  }, 60_000)

  it.each([
    ['platforms/js/tokens-renamed.json', 'a token output renamed or dropped from the config'],
    ['src/styles/tokens/tokens-old.css', 'a stale CSS output'],
    ['public/r/removed.json', 'a registry item for a removed component'],
  ])('fails on a committed orphan: %s (%s)', (orphan) => {
    writeFileSync(join(root, orphan), '{}\n')
    git('add', '-A')
    commit('orphan')
    const { status, stderr } = run()
    expect(stderr).toContain(`D ${orphan}`)
    expect(status).toBe(1)
  }, 60_000)

  it('fails when a build script is not the plain `node <file>` shape it can run', () => {
    const pkgPath = join(root, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    pkg.scripts['tokens:build'] = 'npx something'
    writeFileSync(pkgPath, JSON.stringify(pkg))
    const { status, stderr } = run()
    expect(stderr).toContain('package.json script "tokens:build" is "npx something"')
    expect(status).toBe(2)
  }, 60_000)
})
