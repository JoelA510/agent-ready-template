import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { append, revalidate } from '../../continuity/gate.mjs'
import { fixtureGit } from './fixture-git'

const source = resolve(__dirname, '../..')
const cli = join(source, 'scripts/ci/skill-lift.mjs')
const moduleUrl = pathToFileURL(cli).href
const directory = 'evals/skill-lift/verify'
const file = (p: string) => readFileSync(p, 'utf8')
const put = (p: string, content: string) => {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, content)
}
let work: string, repo: string, out: string, base: string, tree: string
const git = fixtureGit(() => repo)
const commit = (summary: string) => {
  git('add', '-A')
  git('commit', '--allow-empty', '--no-verify', '-qm', summary)
  return git('rev-parse', 'HEAD').trim()
}
const processRun = (args: string[], env: NodeJS.ProcessEnv = process.env) => {
  const r = spawnSync(process.execPath, args, { cwd: repo, env, encoding: 'utf8' })
  return { status: r.status, text: r.stdout + r.stderr }
}
const args = (mode: string) => [mode, '--skill', 'verify', '--tree', tree, '--base', base, '--out', out]
const invoke = (mode: string) => processRun([cli, ...args(mode)])

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'lift-ci-'))
  repo = join(work, 'repo')
  out = join(work, 'private')
  mkdirSync(repo)
  git('init', '-q', '-b', 'main')
  git('config', 'core.autocrlf', 'false')
  put(join(repo, 'baseline.md'), 'Existing repository decision.\n')
  git('add', 'baseline.md')
  append(
    { workstream: 'core', title: 'Baseline', statement: 'The existing ledger anchor.', paths: ['baseline.md'] },
    { root: repo },
  )
  base = commit('base')
})
afterEach(() => rmSync(work, { recursive: true, force: true }))

function enroll(funded = false, omit = '') {
  const result = processRun([
    '--input-type=module',
    '-e',
    `import {benchmarkCitations as p} from ${JSON.stringify(moduleUrl)};console.log(JSON.stringify(p))`,
  ])
  expect(result.status, result.text).toBe(0)
  const paths: string[] = JSON.parse(result.text)
  for (const p of paths) put(join(repo, p), file(join(source, p)))
  put(join(repo, 'continuity/gate.mjs'), file(join(source, 'continuity/gate.mjs')))
  if (funded) {
    const path = join(repo, 'evals/skill-lift/benchmark.lock.json'),
      lock = JSON.parse(file(path))
    Object.assign(lock, { enrollment: 'fixture-relay', budgetUsd: 2 })
    lock.agents['claude-code'].model = 'anthropic/claude-fixture-20261101'
    lock.agents.codex.model = 'openai/gpt-fixture-2026-11-01'
    lock.judge['claude-code'].model = 'openai/judge-fixture-2026-11-01'
    lock.judge.codex.model = 'anthropic/judge-fixture-20261101'
    for (const a of ['claude-code', 'codex']) lock.prices[lock.agents[a].model] = { input_per_mtok: 1, output_per_mtok: 2 }
    put(path, JSON.stringify(lock))
  }
  git('add', '-A')
  const id = append(
    {
      workstream: 'skill-lift',
      title: 'Preregister verify',
      statement: 'Freeze the experiment.',
      paths: paths.filter((p) => p !== omit),
    },
    { root: repo },
  )
  revalidate(id, 'held', { root: repo, method: 'Reviewed the frozen inputs.' })
  put(join(repo, directory, 'decision.txt'), id + '\n')
  tree = commit('enroll reviewed fixture')
}

it('stages exact Git bytes, including the prompt and shared task inputs, while unfunded evaluation stays offline', () => {
  enroll()
  put(join(repo, 'prompts/verify.md'), 'local edit that is outside the selected commit')
  expect(invoke('prepare')).toEqual({ status: 0, text: '' })
  expect(file(join(out, 'verify/prompts/verify.md'))).toBe(git('show', 'HEAD:prompts/verify.md'))
  expect(file(join(out, 'verify/SKILL.md'))).toBe(git('show', 'HEAD:.agents/skills/verify/SKILL.md'))
  expect(readdirSync(join(out, 'verify/evals/files')).sort()).toEqual(['CONTRIBUTING.md', 'changes.json', 'checks.py'])
  expect(invoke('prepare').status).toBe(1)
  expect(invoke('run')).toMatchObject({ status: 1, text: expect.stringContaining('enrollment is inactive') })
  expect(existsSync(join(out, 'results'))).toBe(false)
  const dest = join(work, 'summary.json')
  expect(processRun([cli, 'summarize', '--skill', 'verify', '--tree', tree, '--in', out, '--out', dest]).status).toBe(1)
  expect(JSON.parse(file(dest))).toMatchObject({ outcome: 'incomplete', tree })
  expect(processRun([cli, 'summarize', '--skill', 'verify', '--tree', tree, '--in', out, '--out', dest]).status).toBe(1)
}, 90000)

it('refuses a held decision missing a required citation and a non-parent Git base before creating output', () => {
  enroll(false, 'prompts/verify.md')
  expect(invoke('prepare')).toMatchObject({ status: 1, text: expect.stringContaining('omits benchmark inputs') })
  expect(existsSync(out)).toBe(false)
  const r = processRun([cli, 'prepare', '--skill', 'verify', '--tree', tree, '--base', tree, '--out', out])
  expect(r.status).toBe(1)
  expect(existsSync(out)).toBe(false)
}, 60000)

it('rejects stale preregistration, edited private fixtures, and injected private configuration', () => {
  enroll()
  expect(invoke('prepare').status).toBe(0)
  const fixture = join(out, 'verify/evals/files/checks.py'),
    old = file(fixture)
  put(fixture, 'changed')
  expect(invoke('run')).toMatchObject({ status: 1, text: expect.stringContaining('Prepared input changed') })
  put(fixture, old)
  put(join(out, 'verify/evals/config.yml'), 'harbor: {}')
  expect(invoke('run')).toMatchObject({ status: 1, text: expect.stringContaining('Prepared input changed') })
  expect(existsSync(join(out, 'results'))).toBe(false)
  put(join(repo, 'prompts/verify.md'), 'new authoring')
  base = tree
  tree = commit('change the frozen prompt')
  out = join(work, 'new')
  expect(invoke('prepare')).toMatchObject({ status: 1, text: expect.stringContaining('not HELD') })
}, 90000)

it('runs both paid command specifications through fakes with independent role grants, bounded spend, and exactly one private results root', () => {
  enroll(true)
  const ids = processRun([
    '--input-type=module', '-e', `import {validateBenchmark} from ${JSON.stringify(moduleUrl)}
import {readFileSync} from 'node:fs'
const load = file => JSON.parse(readFileSync(file, 'utf8'))
const lock = load('evals/skill-lift/benchmark.lock.json'), dataset = load('evals/skill-lift/verify/evals.json')
const judge = lock.judge['claude-code']
for (const id of ['openai/gpt-fixture-2026-11-01', 'openai/gpt-fixture-20261101', 'openai/gpt-fixture@sha256:' + 'a'.repeat(64)]) {
  judge.model = id; validateBenchmark(lock, dataset)
}
for (const id of ['openai/gpt-fixture', 'openai/gpt-fixture-latest', 'openai/gpt-fixture-20260230', 'openai/gpt-fixture@sha256:bad']) {
  judge.model = id
  try { validateBenchmark(lock, dataset) } catch { continue }
  throw Error('Unexpectedly accepted mutable or invalid model identifier')
}`,
  ])
  expect(ids).toEqual({status: 0, text: ''})
  expect(invoke('prepare').status).toBe(0)
  const record = join(work, 'calls.json')
  const wrapper = `import {benchmark} from ${JSON.stringify(moduleUrl)}
import {writeFileSync} from 'node:fs'
const calls=[]
const check=(bin,args,env)=>{
 if(['OPENAI_API_KEY','ANTHROPIC_API_KEY','SKILL_LIFT_CLAUDE_TOKEN'].some(k=>k in env))throw Error('credential during preflight')
 if(bin==='docker')return 'linux'
 return bin==='python'?JSON.stringify({python:'3.13.18',evaluator:'1.0.1',harbor:'0.25.0',agents:{'claude-code':'2.1.292',codex:'0.161.0'}}):''
}
const launch=async(bin,args,env)=>{calls.push({bin,args,env})}
process.exitCode=await benchmark(process.argv.slice(1),{check,launch})
writeFileSync(${JSON.stringify(record)},JSON.stringify(calls))`
  const fixtureEnv = {
    ...process.env,
    SKILL_LIFT_ENROLLMENT: 'fixture-relay',
    SKILL_LIFT_PROVIDER_CAP_USD: '2',
    SKILL_LIFT_CLAUDE_TOKEN: 'agent-claude-fixture',
    SKILL_LIFT_CODEX_TOKEN: 'agent-codex-fixture',
    SKILL_LIFT_OPENAI_JUDGE_TOKEN: 'judge-openai-fixture',
    SKILL_LIFT_ANTHROPIC_JUDGE_TOKEN: 'judge-anthropic-fixture',
    SKILL_LIFT_OPENAI_BASE_URL: 'https://openai.example.invalid/v1',
    SKILL_LIFT_ANTHROPIC_BASE_URL: 'https://anthropic.example.invalid',
    GITHUB_TOKEN: 'unrelated-test-grant',
  }
  const launch = (env: NodeJS.ProcessEnv) => processRun(['--input-type=module', '-e', wrapper, ...args('run')], env)
  expect(launch({ ...fixtureEnv, SKILL_LIFT_PROVIDER_CAP_USD: '3' }).status).toBe(1)
  expect(launch({ ...fixtureEnv, SKILL_LIFT_CODEX_TOKEN: fixtureEnv.SKILL_LIFT_OPENAI_JUDGE_TOKEN }).status).toBe(1)
  expect(existsSync(record)).toBe(false)
  expect(launch(fixtureEnv)).toEqual({ status: 0, text: '' })
  const calls: { bin: string; args: string[]; env: Record<string, string> }[] = JSON.parse(file(record))
  expect(calls).toHaveLength(2)
  for (const [i, c] of calls.entries()) {
    expect(c.bin).toBe('python')
    expect(c.args).toContain('from skillevaluator.cli import cli; cli(prog_name="skillevaluator")')
    expect(c.args).toContain('--no-stop-on-pass')
    expect(c.args).toContain('--no-tolerate-baseline-timeouts')
    expect(c.args[c.args.indexOf('--max-cost-usd') + 1]).toBe('1')
    expect(c.args[c.args.indexOf('--max-attempts-total') + 1]).toBe('60')
    expect(c.args[c.args.indexOf('--n-attempts') + 1]).toBe('3')
    expect(c.args[c.args.indexOf('--custom-dockerfile-mode') + 1]).toBe('preserve')
    expect(c.args[c.args.indexOf('--evaluated-source-revision') + 1]).toBe(tree)
    expect(c.env.ANTHROPIC_API_KEY).toBe(
      i === 0 ? fixtureEnv.SKILL_LIFT_CLAUDE_TOKEN : fixtureEnv.SKILL_LIFT_ANTHROPIC_JUDGE_TOKEN,
    )
    expect(c.env.OPENAI_API_KEY).toBe(i === 0 ? fixtureEnv.SKILL_LIFT_OPENAI_JUDGE_TOKEN : fixtureEnv.SKILL_LIFT_CODEX_TOKEN)
    expect(c.env.GITHUB_TOKEN).toBeUndefined()
  }
  expect(readdirSync(join(out, 'results')).sort()).toEqual(['claude-code', 'codex'])
  expect(launch(fixtureEnv).status).toBe(1)
}, 90000)
