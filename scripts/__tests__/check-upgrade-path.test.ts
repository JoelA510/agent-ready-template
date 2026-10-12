import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { previousRelease } from '../check-upgrade-path.mjs'

// A scratch template with its own history: a release tag, then a newer commit. The check runs from
// the scratch copy, so its "previous release" is the scratch tag, not this repository's.
const REPO = resolve(__dirname, '../..')
let template: string
const git = (...args: string[]) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: template, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
}
const check = (...args: string[]) => spawnSync(process.execPath, [join(template, 'scripts/check-upgrade-path.mjs'), ...args], { encoding: 'utf8' })

beforeEach(() => {
  template = mkdtempSync(join(tmpdir(), 'upgrade-template-'))
  for (const path of ['scripts/apply-process.mjs', 'scripts/check-upgrade-path.mjs', 'scripts/check-instructions.mjs', 'scripts/repo-files.mjs', 'scripts/runtime.mjs', 'scripts/skills.mjs', 'scripts/template-dependency.mjs', 'package.json', 'prompts', '.agents/skills', '.claude/skills', 'templates/project', 'templates/standards', 'standards']) {
    cpSync(join(REPO, path), join(template, path), { recursive: true })
  }
  git('init', '-q')
  git('add', '-A')
  git('commit', '-q', '--no-verify', '-m', 'release')
  git('tag', 'v0.1.0')
  writeFileSync(join(template, 'prompts/review.md'), `${readFileSync(join(template, 'prompts/review.md'), 'utf8')}\nA line the next release adds.\n`)
  git('commit', '-q', '--no-verify', '-am', 'next')
})
afterEach(() => rmSync(template, { recursive: true, force: true }))

describe('check-upgrade-path', () => {
  it('passes an upgrade that updates in place, naming what it did', () => {
    const r = check()
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/^✓ A repository with v0\.1\.0's process takes [0-9a-f]{12}'s cleanly: 0 copied, 1 updated in place, 0 removed; nothing parked or left over\./)
  })

  it('fails an upgrade that parks a file nobody edited', () => {
    // A planted defect in this commit's apply: every update is parked instead of applied.
    const path = join(template, 'scripts/apply-process.mjs')
    const source = readFileSync(path, 'utf8')
    const planted = source.replace("actions.push({ kind: 'update', dest, content })", "actions.push({ kind: 'park', dest, content })")
    expect(planted).not.toBe(source) // positive control: the defect was planted
    writeFileSync(path, planted)
    git('commit', '-q', '--no-verify', '-am', 'broken apply')
    const r = check()
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('parked 1 file(s) nobody edited')
  })

  it('upgrades from a release, not the candidate before it', () => {
    git('tag', 'v0.2.0-rc.1', 'HEAD~1')
    git('tag', 'v0.2.0', 'HEAD~1')
    expect(previousRelease(template)).toBe('v0.2.0')
  })

  it("can't check without a release behind HEAD, and says so", () => {
    git('tag', '-d', 'v0.1.0')
    const r = check()
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('No release tag behind HEAD')
  })
})
