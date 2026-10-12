import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatUpdate, updateFleet } from '../fleet-update.mjs'

// Repositories are bare git repositories on disk, reached by file:// URL, so nothing touches the
// network; GitHub's pull request endpoint is a fake fetch that records what it was sent.
const REPO = resolve(__dirname, '../..')
let base: string
const sh = (cwd: string, ...args: string[]) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}
const identity = ['-c', 'user.name=t', '-c', 'user.email=t@example.com']

// A repository on "GitHub": a bare repository with one commit on main.
function remote(name: string, files: Record<string, string> = { 'README.md': '# app\n' }) {
  const work = join(base, `${name}-work`)
  mkdirSync(work, { recursive: true })
  sh(work, 'init', '-q', '-b', 'main')
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(join(work, f, '..'), { recursive: true })
    writeFileSync(join(work, f), text)
  }
  sh(work, 'add', '-A')
  sh(work, ...identity, 'commit', '-q', '-m', 'init')
  const bare = join(base, `${name}.git`)
  sh(base, 'clone', '-q', '--bare', work, bare)
  return `file://${bare}`
}
const fleet = (repos: object[]) => {
  const path = join(base, 'hub/fleet.json')
  mkdirSync(join(base, 'hub'), { recursive: true })
  writeFileSync(path, JSON.stringify({ repos }))
  return path
}
const branches = (url: string) => sh(base, 'ls-remote', '--heads', url).split('\n').filter(Boolean).map((l) => l.split('refs/heads/')[1])

type Sent = { url: string; body: Record<string, unknown> }
type Pull = { head: { ref: string }; state: string; html_url: string }
// GitHub's pull requests for acme/app: a list (filtered by state and head) and a create that
// answers `status` and, when it succeeds, adds the pull request to the list.
function github(status = 201, pulls: Pull[] = []) {
  const sent: Sent[] = []
  const fetch = (async (url: string, init: { method?: string; body?: string }) => {
    if ((init.method ?? 'GET') === 'GET') {
      const q = new URL(url).searchParams
      const head = q.get('head')
      const listed = pulls.filter((p) => (!head || head === `acme:${p.head.ref}`) && (q.get('state') !== 'open' || p.state === 'open'))
      return new Response(JSON.stringify(listed), { status: 200 })
    }
    const body = JSON.parse(init.body ?? '{}')
    sent.push({ url, body })
    if (status !== 201) return new Response(JSON.stringify({ message: 'Validation Failed', errors: [{ message: 'A pull request already exists' }] }), { status })
    const html_url = `https://github.com/acme/app/pull/${pulls.length + 1}`
    pulls.push({ head: { ref: body.head }, state: 'open', html_url })
    return new Response(JSON.stringify({ html_url }), { status })
  }) as unknown as typeof globalThis.fetch
  return { sent, fetch, pulls }
}
const slugOf = () => 'acme/app'

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'fleet-update-'))
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

describe('fleet-update', () => {
  it('a dry run says what each repository would get, and pushes nothing', async () => {
    const url = remote('app')
    const run = await updateFleet(fleet([{ name: 'app', url }]), { slugOf })
    expect(run.repos[0]).toMatchObject({ status: 'would propose', branch: expect.stringMatching(/^template\/process-[0-9a-f]{12}$/) })
    expect(run.repos[0].changed?.length).toBeGreaterThan(20)
    expect(branches(url)).toEqual(['main'])
    expect(formatUpdate(run)).toContain('(dry run)')
  })

  it('--apply pushes a branch and opens one pull request, once', async () => {
    const url = remote('app')
    const { sent, fetch } = github()
    const run = await updateFleet(fleet([{ name: 'app', url, packs: ['node@web'] }]), { apply: true, token: 't', fetch, slugOf })
    expect(run.repos[0]).toMatchObject({ status: 'proposed', url: 'https://github.com/acme/app/pull/1' })
    expect(branches(url).sort()).toEqual(['main', run.repos[0].branch].sort())
    expect(sent).toEqual([{ url: 'https://api.github.com/repos/acme/app/pulls', body: expect.objectContaining({ head: run.repos[0].branch, base: 'main', title: expect.stringContaining('Update the process') }) }])
    // The fleet entry's pack was delivered, and the commit holds the manifest.
    const clone = join(base, 'check')
    sh(base, 'clone', '-q', '--branch', run.repos[0].branch ?? '', url, clone)
    expect(JSON.parse(readFileSync(join(clone, 'prompts/.apply-manifest.json'), 'utf8')).packs).toEqual(['node'])
    // A re-run finds the branch and leaves it alone.
    const again = await updateFleet(fleet([{ name: 'app', url }]), { apply: true, token: 't', fetch, slugOf })
    expect(again.repos[0].status).toBe('already proposed')
    expect(sent).toHaveLength(1)
  })

  it('commits parked files for the reviewer to merge, and says so in the pull request', async () => {
    const url = remote('app', { 'prompts/README.md': 'our own prompts readme\n' })
    const { sent, fetch } = github()
    const run = await updateFleet(fleet([{ name: 'app', url }]), { apply: true, token: 't', fetch, slugOf })
    expect(run.repos[0].parked).toEqual(['prompts/README.md.template'])
    expect(String(sent[0].body.body)).toContain('changed on both sides')
    expect(String(sent[0].body.body)).toContain('`prompts/README.md.template`')
  })

  it('is current when the repository already has this process', async () => {
    const url = remote('app')
    const work = join(base, 'current')
    sh(base, 'clone', '-q', url, work)
    expect(spawnSync(process.execPath, [join(REPO, 'scripts/apply-process.mjs'), '--target', work]).status).toBe(0)
    sh(work, 'add', '-A')
    sh(work, ...identity, 'commit', '-q', '-m', 'process')
    sh(work, 'push', '-q', 'origin', 'main')
    const run = await updateFleet(fleet([{ name: 'app', url }]), { slugOf })
    expect(run.repos[0].status).toBe('current')
  })

  it("reports what it couldn't do, per repository, without stopping the rest", async () => {
    const url = remote('app')
    const { fetch } = github(422)
    const run = await updateFleet(fleet([{ name: 'gone', url: `file://${join(base, 'nope.git')}` }, { name: 'app', url }]), { apply: true, token: 't', fetch, slugOf })
    expect(run.repos[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('git clone failed') })
    expect(run.repos[1]).toMatchObject({ status: 'failed', error: expect.stringContaining('A pull request already exists') })
    expect(run.repos[1].error).toContain('is pushed') // the branch stays
    // git's multi-line error stays in its row, so the table doesn't end there.
    const row = formatUpdate(run).split('\n').find((l) => l.startsWith('| gone |')) ?? ''
    expect(row).toMatch(/git clone failed.* \| {2}\| {2}\| {2}\|$/)
    // A re-run opens the pull request for the branch that's there, without pushing again.
    const later = github()
    const again = await updateFleet(fleet([{ name: 'app', url }]), { apply: true, token: 't', fetch: later.fetch, slugOf })
    expect(again.repos[0]).toMatchObject({ status: 'proposed', url: 'https://github.com/acme/app/pull/1' })
    expect(later.sent).toEqual([{ url: 'https://api.github.com/repos/acme/app/pulls', body: expect.objectContaining({ head: expect.stringMatching(/^template\/process-/), base: 'main' }) }])
  })

  it('waits while an earlier update is still open, since both rewrite the manifest', async () => {
    const url = remote('app')
    const { sent, fetch } = github(201, [{ head: { ref: 'template/process-aaaaaaaaaaaa' }, state: 'open', html_url: 'https://github.com/acme/app/pull/7' }])
    const run = await updateFleet(fleet([{ name: 'app', url }]), { apply: true, token: 't', fetch, slugOf })
    expect(run.repos[0]).toMatchObject({ status: 'waiting', error: expect.stringContaining('https://github.com/acme/app/pull/7') })
    expect(sent).toEqual([])
    expect(branches(url)).toEqual(['main'])
    // A dry run with a token says so too, rather than "would propose".
    expect((await updateFleet(fleet([{ name: 'app', url }]), { token: 't', fetch, slugOf })).repos[0].status).toBe('waiting')
    // And when the token can't list them, a dry run says what it couldn't check, and goes on.
    const refusing = (async () => new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })) as unknown as typeof globalThis.fetch
    expect((await updateFleet(fleet([{ name: 'app', url }]), { token: 't', fetch: refusing, slugOf })).repos[0]).toMatchObject({
      status: 'would propose',
      error: expect.stringContaining("couldn't check for an earlier update still open"),
    })
  })

  it('says a declined proposal was declined, and leaves it closed', async () => {
    const url = remote('app')
    const first = github()
    const run = await updateFleet(fleet([{ name: 'app', url }]), { apply: true, token: 't', fetch: first.fetch, slugOf })
    first.pulls[0].state = 'closed'
    const again = await updateFleet(fleet([{ name: 'app', url }]), { apply: true, token: 't', fetch: first.fetch, slugOf })
    expect(again.repos[0]).toMatchObject({ status: 'already proposed', state: 'closed', branch: run.repos[0].branch })
    expect(formatUpdate(again)).toContain('already proposed (declined)')
    expect(first.sent).toHaveLength(1)
  })

  it('refuses a ref that is a tag before pushing anything: a pull request needs a branch', async () => {
    const url = remote('app')
    sh(join(base, 'app.git'), 'tag', 'v1', 'main')
    const { sent, fetch } = github()
    const run = await updateFleet(fleet([{ name: 'app', url, ref: 'v1' }]), { apply: true, token: 't', fetch, slugOf })
    expect(run.repos[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('a tag or a commit') })
    expect(sent).toEqual([])
    expect(branches(url)).toEqual(['main'])
  })

  it("commits delivered files the target ignores, and passes apply's warning on", async () => {
    const url = remote('app', { 'README.md': '# app\n', '.gitignore': '.claude/\nprompts/.apply-manifest.json\n' })
    const { sent, fetch } = github()
    const run = await updateFleet(fleet([{ name: 'app', url }]), { apply: true, token: 't', fetch, slugOf })
    expect(run.repos[0].warnings?.join('\n')).toContain('.gitignore covers')
    expect(String(sent[0].body.body)).toContain('`process:apply` warned')
    const clone = join(base, 'check')
    sh(base, 'clone', '-q', '--branch', run.repos[0].branch ?? '', url, clone)
    expect(sh(clone, 'ls-files', '.claude/skills/verify/SKILL.md', 'prompts/.apply-manifest.json').split('\n')).toEqual(['.claude/skills/verify/SKILL.md', 'prompts/.apply-manifest.json'])
    expect(formatUpdate(run)).toContain('## app: process:apply warned')
  })

  it("reports apply's own error, not its usage text", async () => {
    const url = remote('app')
    const run = await updateFleet(fleet([{ name: 'app', url, packs: ['gone@web'] }]), { slugOf })
    expect(run.repos[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('No pack gone') })
    expect(run.repos[0].error).not.toContain('Usage')
  })

  it('refuses --apply without a token, and a repository not on github.com', async () => {
    const url = remote('app')
    await expect(updateFleet(fleet([{ name: 'app', url }]), { apply: true })).rejects.toThrow('GITHUB_TOKEN or GH_TOKEN')
    const run = await updateFleet(fleet([{ name: 'app', url }]), { apply: true, token: 't', fetch: github().fetch })
    expect(run.repos[0]).toMatchObject({ status: 'failed', error: expect.stringContaining("isn't a github.com repository") })
    expect(branches(url)).toEqual(['main'])
  })
})
