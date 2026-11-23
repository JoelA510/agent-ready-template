import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { fixtureGit } from './fixture-git'

const helper = resolve(__dirname, '../ci/agent-config-canary.mjs')
let work: string
let repo: string
const git = fixtureGit(() => repo)
const settings = '.claude/settings.json'
const read = (path: string) => readFileSync(path, 'utf8')
const put = (path: string, value: string) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, value)
}
const env = { CLEAN_OUTCOME: 'success', PERMISSION_OUTCOME: 'failure', SECRET_OUTCOME: 'failure',
  CLEAN_SUPPLY_CHAIN: 'clean', PERMISSION_SUPPLY_CHAIN: 'clean', SECRET_SUPPLY_CHAIN: 'clean' }
const run = (cmd: string, path: string, overrides: Record<string, string> = {}) =>
  spawnSync(process.execPath, [helper, cmd, path], { cwd: repo, env: { ...process.env, ...env, ...overrides }, encoding: 'utf8' })

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'agentshield-test-'))
  repo = join(work, 'repo')
  mkdirSync(repo)
})
afterEach(() => rmSync(work, { recursive: true, force: true }))

it('plants independent broad-permission and synthetic-credential configurations without printing their contents', () => {
  const dir = join(work, 'agent-controls')
  const r = run('prepare', dir)
  expect(r.status, r.stderr).toBe(0)
  expect(r.stdout + r.stderr).toBe('')
  const config = (name: string) => JSON.parse(read(join(dir, name, settings)))
  const clean = config('clean')
  expect(config('permission')).toEqual({ permissions: { ...clean.permissions, allow: ['Bash(*)'] } })
  const secret = config('secret')
  expect(secret.env.AWS_ACCESS_KEY_ID).toMatch(/^AKIA[A-F0-9]{16}$/)
  expect(secret).toEqual({ ...clean, env: { AWS_ACCESS_KEY_ID: secret.env.AWS_ACCESS_KEY_ID } })
  expect(run('prepare', dir).status).toBe(1)
})

it('scans tracked configuration, expanding shared instructions and preserving every field outside canonical SHA-512 integrity', () => {
  git('init', '-q')
  git('config', 'core.autocrlf', 'false')
  const digest = 'sha512-' + Buffer.alloc(64, 12).toString('base64')
  const lock = { packages: { example: { integrity: digest, resolved: digest, metadata: { integrity: digest } },
    invalid: { integrity: digest + '-extra' } }, token: digest }
  put(join(repo, 'package-lock.json'), JSON.stringify(lock))
  put(join(repo, '.agents/skills/test/SKILL.md'), '---\nname: test\n---\n')
  put(join(repo, 'CLAUDE.md'), '@AGENTS.md\n\nClaude only.\n')
  put(join(repo, 'AGENTS.md'), 'Shared $& instructions.\n')
  put(join(repo, settings), '{}')
  put(join(repo, 'linked-doc.md'), 'AGENTS.md')
  git('add', '.')
  const link = git('hash-object', '-w', 'linked-doc.md').trim()
  git('update-index', '--cacheinfo', '120000', link, 'linked-doc.md')
  git('update-index', '--add', '--cacheinfo', '160000', 'a'.repeat(40), 'external-library')
  put(join(repo, '.claude/settings.local.json'), '{"notForCI":true}')
  const dir = join(work, 'agent-config')
  expect(run('project', dir).status).toBe(0)
  expect(JSON.parse(read(join(dir, 'package-lock.json')))).toEqual({
    ...lock, packages: { ...lock.packages, example: { ...lock.packages.example, integrity: 'verified-format-sha512-integrity' } },
  })
  expect(read(join(repo, 'package-lock.json'))).toBe(JSON.stringify(lock))
  expect(read(join(dir, 'CLAUDE.md'))).toBe('Shared $& instructions.\n\n\nClaude only.\n')
  expect(read(join(dir, 'linked-doc.md'))).toBe(read(join(repo, 'AGENTS.md')))
  expect(existsSync(join(dir, 'external-library'))).toBe(true)
  expect(existsSync(join(dir, '.claude/settings.local.json'))).toBe(false)
  put(join(repo, 'package-lock.json'), '{"packages":{},"discarded":"a","discarded":"b"}')
  expect(run('project', join(work, 'ambiguous')).status).toBe(1)
  expect(run('project', join(repo, 'inside')).status).toBe(1)
  expect(existsSync(join(repo, 'inside'))).toBe(false)
  put(join(repo, 'package-lock.json'), JSON.stringify(lock))
  git('update-index', '--add', '--cacheinfo', '160000', 'a'.repeat(40), 'extra/.claude/hooks')
  expect(run('project', join(work, 'opaque-configuration')).stderr).toContain('submodule')
})

function report(name: string, rules: string[], file = settings, scanned = 1, target = join(work, 'agent-controls', name)) {
  const run = {
    tool: { driver: { name: 'AgentShield' } },
    invocations: [{ executionSuccessful: true, workingDirectory: { uri: target } }],
    properties: { filesScanned: scanned },
    results: rules.map((ruleId) => ({ ruleId, level: 'error', properties: { severity: 'critical' },
      locations: [{ physicalLocation: { artifactLocation: { uri: file } } }] })),
  }
  put(join(work, name + '.sarif'), JSON.stringify({ version: '2.1.0', runs: [run] }))
}

it('requires a completed nonempty report for this scan copy even when the action exits successfully', () => {
  const root = join(work, 'agent-config')
  const scan = (status: string) => run('assert-scan', work, { SCAN_SUPPLY_CHAIN: status }).status
  report('project', [], settings, 2, root)
  expect(scan('clean')).toBe(0)
  expect(scan('risky')).toBe(0)
  expect(scan('not-run')).toBe(1)
  report('project', [], settings, 0, root)
  expect(scan('clean')).toBe(1)
  report('project', [], settings, 2, work)
  expect(scan('clean')).toBe(1)
})

it('requires both failed actions, exactly their finding families and file locations, and completed scans', () => {
  const permission = 'permissions-permissive-Bash(*)'
  const secret = 'secrets-aws-access-key-81'
  report('clean', [])
  report('permission', [permission])
  report('secret', [secret, 'settings-env-secret-literal'])
  expect(run('assert', work).status).toBe(0)
  expect(run('assert', work, { PERMISSION_OUTCOME: 'success' }).status).toBe(1)
  expect(run('assert', work, { SECRET_SUPPLY_CHAIN: 'error' }).status).toBe(1)
  report('permission', [])
  expect(run('assert', work).status).toBe(1)
  report('permission', [permission])
  report('secret', [])
  expect(run('assert', work).status).toBe(1)
  report('secret', [secret], 'other.json')
  expect(run('assert', work).status).toBe(1)
  report('secret', [secret, 'unrelated'])
  expect(run('assert', work).status).toBe(1)
  report('secret', [secret])
  report('clean', [], settings, 0)
  expect(run('assert', work).status).toBe(1)
  put(join(work, 'clean.sarif'), 'unpublished-sensitive-content')
  const error = run('assert', work)
  expect(error.status).toBe(1)
  expect(error.stderr).not.toContain('unpublished-sensitive-content')
})
