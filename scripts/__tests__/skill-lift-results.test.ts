import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, expect, it } from 'vitest'

const moduleUrl = pathToFileURL(resolve(__dirname, '../ci/skill-lift-results.mjs')).href
const tree = 'a'.repeat(40)
const names = ['claude-code', 'codex'] as const
const runId = '20261123_031209_350_123456789abc'
const metric_set = 'skill-evaluator-default-v2', score_policy = 'skill-evaluator-dimension-mean-v1'
const lock = { agents: { 'claude-code': { model: 'anthropic/example-agent-a' }, codex: { model: 'openai/example-agent-b' } },
  judge: { 'claude-code': { provider: 'openai', model: 'openai/example-judge-a' }, codex: { provider: 'anthropic', model: 'anthropic/example-judge-b' } },
  attempts: 3, threshold: 0.05, passThreshold: 0.8, budgetUsd: 10, decoys: ['unrelated'] }
const entries = Array.from({ length: 10 }, (_, i) => ({
  id: i === 9 ? 'unrelated' : 'record-' + i, should_trigger: i < 9, prompt: 'Look up entry ' + i, expected_output: 'Value ' + i,
  assertions: ['Returns the expected value.'],
}))
const dataset = { skill_name: 'verify', evals: entries }
const privateText = 'private-trajectory-marker'
let root: string
const pathFor = (agent: string, ...parts: string[]) => join(root, agent, runId, ...parts)
function put(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value))
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}'
  return JSON.stringify(value)
}

// Mirrors the release's _write_entry_json/build_dataset_snapshot, RunBudget.metadata and
// collect_harbor_results layouts. No model output or live inference is represented by this fixture.
function fixture(baselineSucceeds = false, decoyFails = false) {
  for (const agent of names) {
    const model = lock.agents[agent].model, judge = lock.judge[agent].model.split('/')[1]
    const staged = entries.map(e => ({ ...e, has_skill: true, evaluated_skill: 'verify', skill_workspace_mode: 'isolated',
      expected_skill: 'verify', expected_behavior: e.assertions, question: e.prompt, ground_truth: e.expected_output,
      workspace_skill_names: ['verify'], grading_mode: 'default', custom_grader: false, agent_workdir: '/workspace' }))
    const manifest = { dataset_digest_algorithm: 'skill-evaluator-dataset-snapshot/1', schema_version: '1.1', evaluator_version: '1.0.1',
      dataset_digest: 'sha256:' + createHash('sha256').update(canonical(staged)).digest('hex'),
      dataset_summary: { total_tasks: 10, positive_tasks: 9, negative_tasks: 1, unclassified_tasks: 0, source: 'dataset' } }
    const config = { evaluated_source: { commit: tree }, agents: { [agent]: { model } },
      judge: { enabled: true, provider: lock.judge[agent].provider, model: judge },
      grading: { mode: 'default' }, skill_workspace: { mode: 'isolated' }, credential_validation: { status: 'verified' },
      harbor: { environment: { value: 'docker' }, n_attempts: 3, stop_on_pass: false } }
    put(pathFor(agent, 'run_config.json'), config)
    put(pathFor(agent, 'dataset_snapshot.json'), { ...manifest, dataset: staged })
    put(pathFor(agent, 'result.json'), { run_id: runId, skill_name: 'verify', evaluator_version: '1.0.1', partial: false,
      execution_status: 'succeeded', execution_errors: [], agents: { [agent]: {} }, dataset_digest: manifest.dataset_digest,
      dataset_digest_algorithm: manifest.dataset_digest_algorithm, dataset_snapshot: manifest, run_config: config,
      attempt_policy: { pass_threshold: .8, stop_on_pass: false }, budget: { status: 'ok', partial: false,
        attempts_not_run: 0, not_run: [], planned_attempts: 60, started_attempts: 60, finished_attempts: 60,
        unmeasured_attempts: { cost_usd: 0, judge_calls: 0, agent_tokens: 0 },
        used: { cost_usd: .42, judge_calls: 180, agent_tokens: 1200 }, limits: { max_cost_usd: 5 } } })
    for (const arm of ['with-skill', 'without-skill']) {
      const withSkill = arm === 'with-skill', cases: Record<string, unknown> = {}
      for (const entry of entries) {
        const passed = entry.should_trigger ? withSkill || baselineSucceeds : !(withSkill && decoyFails)
        const attempts = Array.from({ length: 3 }, (_, index) => {
          const trial = entry.id + '-' + (index + 1), goal = Number(passed)
          put(pathFor(agent, agent, arm, 'trials', trial, 'reward.json'), { agent, model, has_skill: withSkill, entry_id: entry.id, trial_id: trial,
            metric_set, score_policy, judge_contract: 'skill-evaluator-judges-v2', security: 1, accuracy: goal, goal_accuracy: goal,
            behavior_check: goal, details: { security: {}, accuracy: {}, goal_accuracy: { judge_model_used: judge,
              judge_fallback_used: false }, behavior_check: {} }, raw_private_reason: privateText })
          return { attempt: index + 1, trial, score: passed ? 1 : .33, passed, goal_accuracy: goal,
            required_failure: passed ? null : 'wrong_answer', reason: privateText }
        })
        cases[entry.id] = { attempts_used: 3, attempts_skipped: 0, attempts_recovered: 0, attempts_missing: 0, attempts }
      }
      put(pathFor(agent, agent, arm, 'summary.json'), { agent, model, execution_status: 'succeeded', execution_errors: [], expected_cases: 10,
        scored_cases: 10, judge_failures: 0, expected_attempts: 30, scored_attempts: 30, num_trials: 30, num_reward_rows: 30,
        mixed_metric_contracts: false, metric_set, score_policy, trial_failures: [], skill_activation: { status: 'activated' },
        pass_at_k: { k: 3, stop_on_pass: false, pass_threshold: .8, case_details_truncated: false, total_cases: 10, extra_case_count: 0, cases } })
    }
  }
}

const run = (override = {}) => spawnSync(process.execPath, ['--input-type=module', '-e',
  'const {summarize}=await import(process.argv[1]); console.log(JSON.stringify(summarize(JSON.parse(process.argv[2]))))',
  moduleUrl, JSON.stringify({ root, tree, dataset, lock, ...override })], { encoding: 'utf8' })

beforeAll(() => { root = mkdtempSync(join(tmpdir(), 'skill-lift-results-')); fixture() })
afterAll(() => rmSync(root, { recursive: true, force: true }))

it('scores 120 retained trials within each harness and publishes only the safe measured summary', () => {
  const p = run()
  expect(p.status, p.stderr).toBe(0)
  const result = JSON.parse(p.stdout)
  expect(result.outcome).toBe('qualified')
  for (const agent of names) {
    const measured = result.harnesses[agent]
    expect(measured.lift).toBeCloseTo(.9)
    expect(measured.interval[0]).toBeGreaterThan(0)
    expect(measured.cases).toHaveLength(10)
    expect(measured.agentCostUsd).toBe(.42)
    expect(measured.agentCostPerCaseUsd).toBeCloseTo(.042)
  }
  expect(result.harnesses.codex.judge.model).not.toBe(result.harnesses['claude-code'].judge.model)
  expect(run().stdout).toBe(p.stdout)
  expect(p.stdout).not.toContain(privateText)
})

it('keeps no measurable improvement inconclusive and a failed critical decoy ineligible', () => {
  try {
    fixture(true)
    expect(JSON.parse(run().stdout).outcome).toBe('inconclusive')
    fixture(false, true)
    expect(JSON.parse(run().stdout).outcome).toBe('failed')
  } finally { fixture() }
})

it('rejects a foreign tree, changed enrolled rubric, unknown judge and incomplete result set', () => {
  expect(run({ tree: 'b'.repeat(40) }).status).not.toBe(0)
  expect(run({ dataset: { ...dataset, evals: entries.map(e => ({ ...e, expected_output: 'Altered rubric' })) } }).status).not.toBe(0)
  expect(run({ lock: { ...lock, judge: { ...lock.judge, codex: { provider: 'anthropic', model: null } } } }).status).not.toBe(0)
  const moved = pathFor('codex', 'codex', 'with-skill', 'trials', 'record-1-1')
  const parked = join(root, 'parked')
  renameSync(moved, parked)
  try { expect(run().status).not.toBe(0) } finally { renameSync(parked, moved) }
})

it('fails closed on duplicate physical rewards, model fallbacks, unmeasured costs, or missing common metrics', () => {
  const reward = pathFor('codex', 'codex', 'with-skill', 'trials', 'record-0-1', 'reward.json')
  const runFile = pathFor('codex', 'result.json')
  const original = readFileSync(reward, 'utf8'), originalRun = readFileSync(runFile, 'utf8')
  try {
    const r = JSON.parse(original), result = JSON.parse(originalRun)
    for (const changed of [{ ...r, trial_id: 'record-1-1' }, { ...r, accuracy: null },
      { ...r, details: { ...r.details, goal_accuracy: { judge_model_used: 'other', judge_fallback_used: true } } }]) {
      put(reward, changed)
      expect(run().status).not.toBe(0)
    }
    writeFileSync(reward, original)
    result.budget.unmeasured_attempts.cost_usd = 1
    put(runFile, result)
    expect(run().status).not.toBe(0)
  } finally { writeFileSync(reward, original); writeFileSync(runFile, originalRun) }
})

it('rejects jointly inflated native limits and costs even when each run reports that it stayed under its own limit', () => {
  const originals = names.map(agent => readFileSync(pathFor(agent, 'result.json'), 'utf8'))
  try {
    for (const [i, agent] of names.entries()) {
      const result = JSON.parse(originals[i])
      result.budget.limits.max_cost_usd = 8
      result.budget.used.cost_usd = 7
      put(pathFor(agent, 'result.json'), result)
    }
    expect(run().status).not.toBe(0)
    expect(run({ lock: { ...lock, budgetUsd: null } }).status).not.toBe(0)
  } finally { names.forEach((agent, i) => writeFileSync(pathFor(agent, 'result.json'), originals[i])) }
})
