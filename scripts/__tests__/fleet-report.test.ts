import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { createHash } from 'node:crypto'
import { githubApi } from '../check-settings.mjs'
import { formatFleet, readFleet, scoreFleet, withoutCredentials } from '../fleet-report.mjs'
import { fixtureGit } from './fixture-git'

const SCRIPT = resolve(__dirname, '../fleet-report.mjs')
const TODAY = '2026-10-07'

let base: string
const write = (path: string, text: string) => {
  mkdirSync(dirname(join(base, path)), { recursive: true })
  writeFileSync(join(base, path), text)
}
const fleet = (repos: unknown[]) => write('hub/fleet.json', `${JSON.stringify({ repos }, null, 2)}\n`)
const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, '--fleet', join(base, 'hub/fleet.json'), '--today', TODAY, ...args], { encoding: 'utf8' })

// A repository that meets every core standard, as a git repository with one commit.
function conforming(dir: string) {
  write(`${dir}/AGENTS.md`, '# Rules\n')
  write(`${dir}/SECURITY.md`, 'Report privately.\n')
  write(`${dir}/renovate.json`, '{ "minimumReleaseAge": "3 days" }\n')
  write(`${dir}/prompts/.apply-manifest.json`, '{"templateCommit":"abc","files":{}}\n')
  write(`${dir}/.github/workflows/ci.yml`, 'on: pull_request\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pipx run zizmor .\n')
  const git = fixtureGit(() => join(base, dir))
  git('init', '-q')
  git('add', '.')
  git('commit', '-q', '--no-verify', '-m', 'init')
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'fleet-'))
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

describe('the fleet file', () => {
  it.each([
    [[{ name: 'a', path: 'x', url: 'https://example.com/a.git' }], 'give exactly one of "path" and "url"'],
    [[{ name: 'a', path: 'x' }, { name: 'a', path: 'y' }], 'a second repository named a'],
    [[{ name: 'a', path: 'x', ref: 'main' }], '"ref" is a branch or tag, and only goes with "url"'],
    [[{ name: 'a', path: 'x', visibility: 'internal' }], '"visibility" must be public or private'],
    [[{ name: 'a', path: 'x', owner: 'me' }], '"owner" isn\'t a fleet field'],
    [[{ name: 'a', path: '../x', url: 123 }], '"url" must be a non-empty string'],
    [[{ name: 'a', url: 'file:///x', path: 42 }], '"path" must be a non-empty string'],
    [[{ name: 'a', path: 'x', packs: [] }], '"packs" must be a non-empty list'],
    [[], 'at least one repository'],
  ])('refuses %j', (repos, message) => {
    fleet(repos)
    expect(() => readFleet(join(base, 'hub/fleet.json'))).toThrow(message)
    expect(run().status).toBe(2)
  })
})

describe('the hub skeleton', () => {
  const HUB = resolve(__dirname, '../../templates/hub')

  it('has a fleet file the report accepts', () => {
    expect(readFleet(join(HUB, 'fleet.json')).length).toBeGreaterThan(0)
  })

  it('runs weekly, posts with GITHUB_TOKEN, clones with the app token, and fails only on a repository it couldn\'t check', () => {
    const wf = parse(readFileSync(join(HUB, '.github/workflows/fleet-report.yml'), 'utf8'))
    expect(Object.keys(wf.on)).toEqual(['schedule', 'workflow_dispatch'])
    expect(wf.permissions).toEqual({}) // nothing by default; the job asks
    expect(wf.jobs.report.permissions).toEqual({ contents: 'read', issues: 'write' })
    const steps = wf.jobs.report.steps as { id?: string; name?: string; uses?: string; run?: string; if?: string; env?: Record<string, string>; with?: Record<string, unknown> }[]
    const app = steps.find((st) => st.uses?.startsWith('actions/create-github-app-token@'))
    expect(app?.with).toMatchObject({ 'permission-contents': 'read', 'permission-administration': 'read' })
    const report = steps.find((st) => st.id === 'report')
    expect(report?.env?.GH_TOKEN).toBe('${{ steps.app-token.outputs.token }}')
    expect(report?.run).toContain('--settings')
    expect(report?.run).toContain('|| status=$?') // a failing standard is the report's content, not a job failure
    const post = steps.find((st) => st.run?.includes('gh issue edit'))
    expect(post?.env?.GH_TOKEN).toBe('${{ github.token }}')
    expect(steps.at(-1)?.if).toBe("steps.report.outputs.status == '2'")
    const template = steps.find((st) => st.with?.path === 'template')
    expect(template?.with?.['fetch-depth']).toBe(0) // process drift reads the template's history
  })

  it('updates only by hand, a dry run unless asked, with write access only for the pushes', () => {
    const wf = parse(readFileSync(join(HUB, '.github/workflows/fleet-update.yml'), 'utf8'))
    expect(Object.keys(wf.on)).toEqual(['workflow_dispatch'])
    expect(wf.on.workflow_dispatch.inputs.apply).toMatchObject({ type: 'boolean', default: false })
    expect(wf.permissions).toEqual({})
    expect(wf.jobs.update.permissions).toEqual({ contents: 'read' })
    const steps = wf.jobs.update.steps as { uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, unknown> }[]
    expect(steps.find((st) => st.uses?.startsWith('actions/create-github-app-token@'))?.with).toMatchObject({ 'permission-contents': 'write', 'permission-pull-requests': 'write' })
    const update = steps.find((st) => st.run?.includes('fleet-update.mjs'))
    expect(update?.run).toContain('set -o pipefail') // the default shell would let tee hide a failure
    expect(update?.run).toMatch(/if \[ "\$APPLY" = "true" \]; then flag=--apply/)
  })
})

describe('withoutCredentials', () => {
  it('drops a username and password from a URL, and leaves anything else as it is', () => {
    expect(withoutCredentials('https://me:ghp_secret@github.com/acme/app.git')).toBe('https://github.com/acme/app.git')
    expect(withoutCredentials('https://github.com/acme/app.git')).toBe('https://github.com/acme/app.git')
    expect(withoutCredentials('git@github.com:acme/app.git')).toBe('git@github.com:acme/app.git')
  })
})

describe('a report', { timeout: 120_000 }, () => {
  it('scores each repository, by path or by URL, and lists the failing standards across them', async () => {
    conforming('good')
    conforming('remote')
    write('bad/README.md', '# No standards here\n')
    for (let i = 1; i <= 12; i++) write(`bad/.agent/workflows/w${String(i).padStart(2, '0')}.md`, '# Step\n')
    fleet([
      { name: 'good', path: '../good', visibility: 'private' },
      { name: 'bad', path: '../bad', visibility: 'public' },
      { name: 'cloned', url: `file://${join(base, 'remote')}`, visibility: 'private' },
    ])
    const result = await scoreFleet(join(base, 'hub/fleet.json'), { today: TODAY })
    expect(result.repos.map((r) => [r.name, r.card?.exitCode])).toEqual([
      ['good', 0],
      ['bad', 1],
      ['cloned', 0],
    ])
    const md = formatFleet(result)
    expect(md).toContain('3 repositories: 2 conform, 1 fail, 0 couldn\'t be checked.')
    expect(md).toMatch(/\| good \| core only \| \d+ \| 0 \|.*\| conforms \|/)
    expect(md).toMatch(/\| bad \| core only \| \d+ \| [1-9]\d* \|.*\| fails \|/)
    expect(md).toContain('| `core.license` | medium | 1: bad |')
    expect(md).toContain('### bad')
    expect(md).toContain('- `core.agent-rules` (high): no AGENTS.md at the root')
    // What a colon introduces, counted past the cap the evidence already had (10 and "... and 2 more").
    expect(md).toContain('converts them: .agent/workflows/w01.md; .agent/workflows/w02.md; .agent/workflows/w03.md; and 9 more\n')
  })

  it('reports a repository it couldn\'t check, and exits 2', () => {
    conforming('good')
    fleet([
      { name: 'good', path: '../good' },
      { name: 'missing', path: '../missing' },
      { name: 'unreachable', url: `file://${join(base, 'nowhere')}` },
    ])
    const result = run('--out', join(base, 'report.md'), '--json', join(base, 'report.json'))
    expect(result.status).toBe(2)
    const md = readFileSync(join(base, 'report.md'), 'utf8')
    expect(md).toContain("Couldn't be checked: not a directory")
    expect(md).toContain("Couldn't be checked: git clone failed")
    const json = JSON.parse(readFileSync(join(base, 'report.json'), 'utf8'))
    expect(json.repos.map((r: { name: string; error?: string }) => [r.name, Boolean(r.error)])).toEqual([
      ['good', false],
      ['missing', true],
      ['unreachable', true],
    ])
  })

  it('says how far behind the template each repository\'s process is', async () => {
    conforming('good')
    const apply = spawnSync(process.execPath, [resolve(__dirname, '../apply-process.mjs'), '--target', join(base, 'good')], { encoding: 'utf8' })
    expect(apply.status).toBe(0)
    fleet([{ name: 'good', path: '../good', visibility: 'private' }])
    expect(formatFleet(await scoreFleet(join(base, 'hub/fleet.json'), { today: TODAY }))).toMatch(/\| good \|.*\| current \| conforms \|/)
    // A delivered file the target never touched, recorded at an older template version: one update.
    const manifestPath = join(base, 'good/prompts/.apply-manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    write('good/prompts/review.md', 'an older review prompt\n')
    manifest.files['prompts/review.md'] = createHash('sha256').update('an older review prompt\n').digest('hex')
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const md = formatFleet(await scoreFleet(join(base, 'hub/fleet.json'), { today: TODAY }))
    expect(md).toMatch(/\| good \|.*\| 1 to update \| conforms \|/)
    expect(md).toContain('- process: a `process:apply` re-run would change 1 file(s)')
  })

  // An existing-repo trial: .claude/ was ignored and the delivery commit left the skills out. The
  // report called them parked files or conflict markers, which a re-apply would clear; it can't.
  it('names delivered files the .gitignore kept out of every commit, apart from the leftovers', async () => {
    conforming('good')
    write('good/.gitignore', '.claude/\n')
    const apply = spawnSync(process.execPath, [resolve(__dirname, '../apply-process.mjs'), '--target', join(base, 'good')], { encoding: 'utf8' })
    expect(apply.status).toBe(0)
    const git = fixtureGit(() => join(base, 'good'))
    git('add', '-A')
    git('commit', '-q', '--no-verify', '-m', 'delivery')
    fleet([{ name: 'good', path: '../good', visibility: 'private' }])
    const md = formatFleet(await scoreFleet(join(base, 'hub/fleet.json'), { today: TODAY }))
    expect(md).toMatch(/\| good \|.*\| 0 to update, \d+ never committed \|/)
    expect(md).toMatch(/- process: .*\d+ delivered file\(s\) are ignored by its \.gitignore and never committed/)
    expect(md).not.toContain('left over')
    // Positive control: force-added and committed, the process is current again.
    git('add', '-f', '.claude')
    git('commit', '-q', '--no-verify', '-m', 'skills')
    expect(formatFleet(await scoreFleet(join(base, 'hub/fleet.json'), { today: TODAY }))).toMatch(/\| good \|.*\| current \|/)
  })

  it('adds each repository\'s GitHub settings, and a settings failure fails the repository', async () => {
    conforming('good')
    fixtureGit(() => join(base, 'good'))('remote', 'add', 'origin', 'https://github.com/acme/good.git')
    write('local/README.md', '# Not on GitHub\n')
    fleet([
      { name: 'good', path: '../good', visibility: 'private' },
      { name: 'local', path: '../local', visibility: 'private' },
    ])
    const routes: Record<string, { status: number; body?: unknown }> = {
      '/repos/acme/good': { status: 200, body: { private: true, default_branch: 'main', permissions: { admin: true } } },
      '/repos/acme/good/actions/permissions/workflow': { status: 200, body: { default_workflow_permissions: 'write', can_approve_pull_request_reviews: false } },
      '/repos/acme/good/vulnerability-alerts': { status: 204 },
      '/repos/acme/good/automated-security-fixes': { status: 200, body: { enabled: true, paused: false } },
      '/repos/acme/good/branches/main/protection': { status: 403, body: { message: 'Upgrade to GitHub Pro or make this repository public to enable this feature.' } },
    }
    const fetch = async (url: string) => {
      const r = routes[url.replace('https://api.github.com', '')] ?? { status: 404, body: { message: 'Not Found' } }
      return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status })
    }
    const result = await scoreFleet(join(base, 'hub/fleet.json'), { today: TODAY, get: githubApi({ token: 't', fetch: fetch as typeof globalThis.fetch }) })
    const md = formatFleet(result)
    expect(md).toMatch(/\| good \|.*\| 1 pass, 1 fail \| fails \|/)
    expect(md).toContain('- `core.settings-token-read-only` (high): the default GITHUB_TOKEN can write')
    expect(md).toMatch(/\| local \|.*\| skipped \|/)
    // A token without admin skips most of them, and the cell says so rather than "0 fail".
    routes['/repos/acme/good'] = { status: 200, body: { private: false, default_branch: 'main', permissions: { admin: false } } }
    routes['/repos/acme/good/rules/branches/main'] = { status: 200, body: [] }
    delete routes['/repos/acme/good/branches/main/protection']
    const blind = formatFleet(await scoreFleet(join(base, 'hub/fleet.json'), { today: TODAY, get: githubApi({ token: 't', fetch: fetch as typeof globalThis.fetch }) }))
    expect(blind).toMatch(/\| good \|.*\| 0 pass, 0 fail, 5 skipped \|/)
  })

  it('exits 0 when every repository conforms, and 1 when one fails', () => {
    conforming('good')
    fleet([{ name: 'good', path: '../good', visibility: 'private' }])
    expect(run().status).toBe(0)
    write('bad/README.md', '# No standards here\n')
    fleet([
      { name: 'good', path: '../good', visibility: 'private' },
      { name: 'bad', path: '../bad', visibility: 'private' },
    ])
    expect(run().status).toBe(1)
  })
})
