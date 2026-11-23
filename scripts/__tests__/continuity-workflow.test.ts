import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { fixtureGit } from './fixture-git'

const workflow = parse(readFileSync(resolve(__dirname, '../../.github/workflows/continuity.yml'), 'utf8'))
const steps = workflow.jobs.gate.steps as { run?: string; uses?: string; with?: Record<string, unknown> }[]
const scripts = steps.flatMap((step) => step.run ? [step.run] : [])

it('checks edited PR bodies and every merge result with a read-only, full-history checkout', () => {
  expect(workflow.on.pull_request).toEqual({ branches: ['main'], types: ['opened', 'synchronize', 'reopened', 'edited', 'ready_for_review'] })
  expect(workflow.on.push).toEqual({ branches: ['main'] })
  expect(workflow.on.schedule).toHaveLength(1)
  expect(Object.hasOwn(workflow.on, 'workflow_dispatch')).toBe(true)
  expect(workflow.jobs.gate.permissions).toEqual({ contents: 'read' })
  expect(steps.find((s) => s.uses?.startsWith('actions/checkout@'))?.with).toMatchObject({ 'fetch-depth': 0, 'persist-credentials': false })
  expect(scripts).toHaveLength(2)
})

// Exercise the workflow's actual shell. On Windows use the Bash shipped beside Git's own sh,
// since PATH can point to the WSL launcher even when no distribution is installed.
const bash = process.platform === 'win32'
  ? join(dirname(spawnSync('git', ['var', 'GIT_SHELL_PATH'], { encoding: 'utf8' }).stdout?.trim() || '.'), 'bash.exe')
  : 'bash'
const windowsWithoutBash = process.platform === 'win32' && spawnSync(bash, ['-c', 'exit 0']).status !== 0

describe.skipIf(windowsWithoutBash)(windowsWithoutBash ? 'continuity workflow Git anchors (Git Bash unavailable on Windows)' : 'continuity workflow Git anchors', () => {
  let repo: string, runner: string, base: string, tree: string
  const git = fixtureGit(() => repo)
  const commit = (message: string) => {
    git('add', '.')
    git('commit', '--no-verify', '-qm', message)
    return git('rev-parse', 'HEAD').trim()
  }
  beforeEach(() => {
    runner = mkdtempSync(join(tmpdir(), 'continuity-workflow-'))
    repo = join(runner, 'workspace')
    mkdirSync(join(repo, 'continuity'), { recursive: true })
    git('init', '-q')
    git('config', 'core.autocrlf', 'false')
    writeFileSync(join(repo, '.nvmrc'), '24\n')
    writeFileSync(join(repo, 'continuity/gate.mjs'), 'console.log(JSON.stringify(process.argv.slice(2)))\n')
    base = commit('trusted gate and toolchain')
    writeFileSync(join(repo, '.nvmrc'), '18\n')
    writeFileSync(join(repo, 'continuity/gate.mjs'), 'process.exit(77)\n')
    tree = commit('candidate with a different reader')
  })
  afterEach(() => rmSync(runner, { recursive: true, force: true }))

  function run(script: string, event: string, extra: Record<string, string> = {}) {
    return spawnSync(bash, ['-c', script], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_EVENT_NAME: event, GITHUB_REF: 'refs/heads/main', GITHUB_ENV: join(runner, 'env'),
        GITHUB_WORKSPACE: repo, GITHUB_EVENT_PATH: join(runner, 'event.json'), RUNNER_TEMP: runner, EVENT_BASE: base, TREE: tree, ...extra },
    })
  }

  it.each(['pull_request', 'push', 'schedule', 'workflow_dispatch'])('%s runs the protected reader on the candidate', (event) => {
    const anchor = run(scripts[0], event, { EVENT_BASE: event === 'schedule' || event === 'workflow_dispatch' ? '' : base })
    expect(anchor.status, anchor.error?.message ?? anchor.stderr).toBe(0)
    expect(readFileSync(join(runner, 'env'), 'utf8').trim()).toBe(`BASE=${base}`)
    expect(readFileSync(join(repo, '.nvmrc'), 'utf8').trim()).toBe('24')
    const check = run(scripts[1], event, { BASE: base })
    expect(check.status, check.error?.message ?? check.stderr).toBe(0)
    const args = JSON.parse(check.stdout) as string[]
    expect(args).toEqual(['check', '--root', repo, '--base', base, '--tree', tree, '--event-file', join(runner, 'event.json'), '--stale', 'warn',
      ...(event === 'schedule' || event === 'workflow_dispatch' ? ['--all'] : [])])
  })

  it('rejects an absent anchor, an off-branch dispatch and a protected base with no reader', () => {
    expect(run(scripts[0], 'push', { EVENT_BASE: '' }).status).toBe(1)
    expect(run(scripts[0], 'workflow_dispatch', { GITHUB_REF: 'refs/heads/untrusted' }).status).toBe(1)
    git('rm', '-q', 'continuity/gate.mjs')
    base = commit('remove the reader from the base')
    writeFileSync(join(repo, 'candidate.txt'), 'changed\n')
    tree = commit('candidate must not bootstrap a reader')
    const missing = run(scripts[0], 'pull_request')
    expect(missing.status).toBe(128)
    expect(missing.stderr).toContain('continuity/gate.mjs')
  })
})
