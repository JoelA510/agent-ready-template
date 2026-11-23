import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

const agents = ['claude-code', 'codex']
const arms = ['with-skill', 'without-skill']
const nativeSchema = 'skill-evaluator-dataset-snapshot/1'
const metricSet = 'skill-evaluator-default-v2'
const scorePolicy = 'skill-evaluator-dimension-mean-v1'
const draws = 10000
const seed = 0x534B4C46
const unit = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
const noErrors = value => Array.isArray(value) && value.length === 0
const mean = a => a.reduce((sum, item) => sum + item, 0) / a.length
const same = isDeepStrictEqual
function judgeMatches(actual, frozen) {
  const prefix = frozen.provider + '/'
  const nativeName = frozen.model.startsWith(prefix) ? frozen.model.slice(prefix.length) : frozen.model
  return actual === nativeName || actual === prefix + nativeName
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const objects = value => value !== null && typeof value === 'object' && !Array.isArray(value)

function check(ok, reason) {
  if (!ok) throw new Error('Unqualified Skill Lift evidence: ' + reason)
}

function directory(path) {
  check(lstatSync(path).isDirectory() && realpathSync(path) === resolve(path), 'linked or missing results directory')
  return path
}

function json(path, receipts) {
  const info = lstatSync(path)
  check(info.isFile() && realpathSync(path) === resolve(path) && info.size > 0 && info.size <= 16 * 1024 * 1024,
    'missing, linked or oversized evidence file')
  const bytes = readFileSync(path)
  receipts.set(path, hash(bytes))
  try { return JSON.parse(bytes.toString('utf8')) }
  catch { throw new Error('Invalid native evidence JSON') }
}

function files(dir) {
  const entries = readdirSync(directory(dir), { withFileTypes: true })
  check(entries.length <= 160 && entries.every(entry => !entry.isSymbolicLink()), 'unexpected retained directory entries')
  return entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
}

// The enrolled fixtures use strings, booleans, safe integers and arrays. Sorting keys this way
// reproduces Python's native compact UTF-8 dataset representation for these JSON objects.
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (objects(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  check(typeof value !== 'number' || Number.isSafeInteger(value), 'unrecognized enrollment number encoding')
  return JSON.stringify(value)
}

function verifyDataset(run, cfg, snapshot, expected) {
  check(snapshot.schema_version === '1.1' && snapshot.evaluator_version === '1.0.1' &&
    snapshot.dataset_digest_algorithm === nativeSchema && Array.isArray(snapshot.dataset) && snapshot.dataset.length === expected.size,
  'incomplete dataset snapshot')
  const claim = 'sha256:' + hash(canonical(snapshot.dataset))
  const { dataset: entries, ...manifest } = snapshot
  const positive = [...expected.values()].filter(entry => entry.should_trigger).length
  check(snapshot.dataset_digest === claim && run.dataset_digest === claim && run.dataset_digest_algorithm === nativeSchema &&
    same(snapshot.dataset_summary, { total_tasks: expected.size, positive_tasks: positive, negative_tasks: expected.size - positive,
      unclassified_tasks: 0, source: 'dataset' }) && same(run.dataset_snapshot, manifest), 'native dataset digest or coverage mismatch')
  const remaining = new Map(expected)
  for (const entry of entries) {
    const { has_skill, evaluated_skill, skill_workspace_mode, workspace_skill_names, grading_mode, custom_grader, agent_workdir,
      expected_skill, expected_behavior, ground_truth, question, ...authored } = entry
    check(typeof has_skill === 'boolean' && evaluated_skill === 'verify' && skill_workspace_mode === 'isolated' &&
      grading_mode === 'default' && custom_grader === false && [null,'/workspace'].includes(agent_workdir) &&
      (same(workspace_skill_names, []) || same(workspace_skill_names, ['verify'])), 'dataset task staging changed')
    check(expected_skill === 'verify' && same(expected_behavior, authored.assertions) &&
      ground_truth === authored.expected_output && question === authored.prompt, 'native grading aliases differ from enrollment')
    check(remaining.has(authored.id) && same(authored, remaining.get(authored.id)), 'enrolled case or rubric differs from native dataset')
    remaining.delete(authored.id)
  }
  check(!remaining.size && cfg.grading?.mode === 'default' && cfg.skill_workspace?.mode === 'isolated', 'dataset grading or workspace differs')
  return claim
}

function bootstrap(differences) {
  let state = seed
  function sample() {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return Math.floor((state >>> 0) / 0x100000000 * differences.length)
  }
  const values = Array.from({ length: draws }, () => {
    let sum = 0
    for (let i = 0; i < differences.length; i++) sum += differences[sample()]
    return sum / differences.length
  }).sort((a, b) => a - b)
  return [values[249], values[9749]]
}

function readRewards(dir, agent, arm, enrolled, lock, receipts) {
  const rewards = new Map()
  const trials = files(dir)
  check(trials.length === enrolled.size * lock.attempts, 'wrong count of retained trial rewards')
  for (const name of trials) {
    const path = directory(join(dir, name))
    const reward = json(join(path, 'reward.json'), receipts)
    check(reward.agent === agent && reward.model === lock.agents[agent].model && enrolled.has(reward.entry_id) && reward.has_skill === (arm === 'with-skill') &&
      typeof reward.trial_id === 'string' && reward.trial_id.length > 0 && !rewards.has(reward.trial_id) &&
      !Object.hasOwn(reward, 'evaluation_status') && !Object.keys(reward.evaluation_errors ?? {}).length &&
      reward.metric_set === metricSet && reward.score_policy === scorePolicy && reward.judge_contract === 'skill-evaluator-judges-v2',
    'unscored, repeated or misidentified trial reward')
    const details = reward.details
    const measured = ['security', 'accuracy', 'goal_accuracy', 'behavior_check']
    check(objects(details) && measured.every(metric => unit(reward[metric]) && objects(details[metric]) &&
      !['error', 'not_applicable', 'skipped'].includes(details[metric].status)) && Object.values(details).every(d => d?.status !== 'error'),
      'incomplete judge details')
    const judges = Object.values(details).filter(d => d && Object.hasOwn(d, 'judge_model_used'))
    check(judges.length > 0 && judges.every(d => judgeMatches(d.judge_model_used, lock.judge[agent]) && d.judge_fallback_used === false),
      'judge identity or fallback differs from enrollment')
    const { entry_id, security, accuracy, goal_accuracy, behavior_check } = reward
    rewards.set(reward.trial_id, { entry_id, security, accuracy, goal_accuracy, behavior_check })
  }
  return rewards
}

function readArm(runDir, agent, arm, enrolled, lock, receipts) {
  const dir = directory(join(runDir, agent, arm))
  const summary = json(join(dir, 'summary.json'), receipts)
  const total = enrolled.size * lock.attempts
  check(summary.agent === agent && summary.model === lock.agents[agent].model && summary.execution_status === 'succeeded' &&
    noErrors(summary.execution_errors) && summary.expected_cases === enrolled.size && summary.scored_cases === enrolled.size &&
    summary.judge_failures === 0 && summary.expected_attempts === total && summary.scored_attempts === total &&
    summary.num_trials === total && summary.num_reward_rows === total && summary.mixed_metric_contracts === false &&
    summary.metric_set === metricSet && summary.score_policy === scorePolicy && noErrors(summary.trial_failures),
  'arm incomplete or evaluated with the wrong model or rubric')
  if (arm === 'with-skill') check(summary.skill_activation?.status === 'activated', 'no observed skill activation')
  const pass = summary.pass_at_k
  check(pass?.k === lock.attempts && pass.stop_on_pass === false && pass.pass_threshold === lock.passThreshold &&
    pass.case_details_truncated === false && pass.total_cases === enrolled.size && pass.extra_case_count === 0 &&
    same(Object.keys(pass.cases).sort(), [...enrolled.keys()].sort()), 'incomplete native attempt matrix')
  const rewards = readRewards(directory(join(dir, 'trials')), agent, arm, enrolled, lock, receipts)
  const result = new Map()
  for (const id of [...enrolled.keys()].sort()) {
    const row = pass.cases[id]
    check(row.attempts_used === lock.attempts && row.attempts_recovered === 0 && row.attempts_skipped === 0 &&
      row.attempts_missing === 0 && row.attempts.length === lock.attempts, 'missing, recovered or skipped attempt')
    const outcomes = Array(lock.attempts).fill(null)
    for (const a of row.attempts) {
      const reward = rewards.get(a.trial)
      check(Number.isInteger(a.attempt) && a.attempt >= 1 && a.attempt <= lock.attempts && !outcomes[a.attempt - 1] &&
        reward?.entry_id === id && unit(a.score) && unit(a.goal_accuracy) && reward.goal_accuracy === a.goal_accuracy &&
        typeof a.passed === 'boolean' && (a.required_failure === null || typeof a.required_failure === 'string') &&
        (!a.passed || (a.required_failure === null && a.score >= lock.passThreshold && a.goal_accuracy === 1)),
      'attempt verdict or retained reward does not match the case')
      if (a.score !== lock.passThreshold) check(a.passed === (a.score > lock.passThreshold && a.required_failure === null), 'inconsistent pass threshold')
      rewards.delete(a.trial)
      const score = mean([reward.security, reward.accuracy, mean([reward.goal_accuracy, reward.behavior_check])])
      outcomes[a.attempt - 1] = { score, passed: reward.security === 1 && reward.goal_accuracy === 1 && score >= lock.passThreshold,
        metrics: { security: reward.security, accuracy: reward.accuracy, goalAccuracy: reward.goal_accuracy, behaviorCheck: reward.behavior_check },
        nativeScore: a.score, nativePassed: a.passed }
    }
    result.set(id, outcomes)
  }
  check(rewards.size === 0, 'unmatched native trial evidence')
  return result
}

function readAgent(root, agent, lock, enrolled, tree) {
  const where = directory(join(root, agent))
  const runs = files(where)
  check(runs.length === 1 && /^\d{8}_\d{6}_\d+_[0-9a-f]{12}$/.test(runs[0]), 'expected exactly one fresh native run per harness')
  const native = directory(join(where, runs[0]))
  const receipts = new Map()
  const run = json(join(native, 'result.json'), receipts), cfg = json(join(native, 'run_config.json'), receipts)
  const snapshot = json(join(native, 'dataset_snapshot.json'), receipts)
  check(run.run_id === basename(native) && run.skill_name === 'verify' && run.evaluator_version === '1.0.1' &&
    run.partial === false && run.execution_status === 'succeeded' && noErrors(run.execution_errors) &&
    same(Object.keys(run.agents), [agent]) && same(run.run_config, cfg), 'native run identity or execution verdict mismatch')
  const judge = lock.judge[agent]
  check(cfg.evaluated_source?.commit === tree && cfg.agents?.[agent]?.model === lock.agents[agent].model &&
    cfg.judge?.enabled === true && judgeMatches(cfg.judge.model, judge) && cfg.judge.provider === judge.provider &&
    cfg.harbor?.n_attempts === lock.attempts && cfg.harbor.environment?.value === 'docker' && cfg.harbor.stop_on_pass === false &&
    !cfg.harbor.tolerate_baseline_timeouts && !Object.hasOwn(cfg.harbor, 'max_cases') && cfg.credential_validation?.status === 'verified' &&
    run.attempt_policy?.pass_threshold === lock.passThreshold && run.attempt_policy.stop_on_pass === false,
  'checkout, harness, requested judge or attempt settings differ from enrollment')
  const datasetDigest = verifyDataset(run, cfg, snapshot, enrolled)
  const total = enrolled.size * lock.attempts * 2
  const budget = run.budget
  check(budget?.status === 'ok' && budget.partial === false && budget.attempts_not_run === 0 && noErrors(budget.not_run) &&
    budget.planned_attempts === total && budget.started_attempts === total && budget.finished_attempts === total &&
    budget.unmeasured_attempts?.cost_usd === 0 && budget.unmeasured_attempts.judge_calls === 0 && budget.unmeasured_attempts.agent_tokens === 0 &&
    Number.isFinite(budget.used?.cost_usd) && budget.used.cost_usd >= 0 && Number.isFinite(budget.limits?.max_cost_usd) &&
    budget.limits.max_cost_usd > 0 && budget.limits.max_cost_usd <= lock.budgetUsd / agents.length &&
    budget.used.cost_usd <= budget.limits.max_cost_usd && Number.isSafeInteger(budget.used.judge_calls) && budget.used.judge_calls > 0 &&
    Number.isSafeInteger(budget.used.agent_tokens) && budget.used.agent_tokens > 0,
  'incomplete measured budget or attempt coverage')
  const [withSkill, baseline] = arms.map(arm => readArm(native, agent, arm, enrolled, lock, receipts))
  const cases = [...withSkill].map(([id, treated]) => {
    const control = baseline.get(id)
    const rate = values => mean(values.map(entry => Number(entry.passed)))
    return { id, withSkill: treated, withoutSkill: control, difference: rate(treated) - rate(control) }
  })
  const differences = cases.map(item => item.difference)
  const lift = mean(differences), interval = bootstrap(differences)
  const decoysPassed = lock.decoys.every(id => withSkill.get(id).every(attempt => attempt.passed && attempt.nativePassed))
  const outcome = !decoysPassed ? 'failed' : interval[0] <= 0 ? 'inconclusive' : lift < lock.threshold ? 'failed' : 'qualified'
  const hashes = [...receipts].map(([path, digest]) => [relative(native, path).split(sep).join('/'), digest])
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  return { outcome, model: cfg.agents[agent].model, judge: { model: judge.model, provider: judge.provider }, datasetDigest,
    evidenceDigest: 'sha256:' + hash(JSON.stringify(hashes)),
    cases, lift, interval, decoysPassed, completedCases: enrolled.size, completedAttempts: total, agentCostUsd: budget.used.cost_usd,
    agentCostPerCaseUsd: budget.used.cost_usd / enrolled.size, agentCostPerAttemptUsd: budget.used.cost_usd / total,
    agentTokens: budget.used.agent_tokens, measuredJudgeCalls: budget.used.judge_calls }
}

export function summarize({ root, lock, dataset, tree }) {
  check(typeof tree === 'string' && /^[a-f0-9]{40}$/.test(tree), 'missing full source commit')
  check(Number.isFinite(lock.budgetUsd) && lock.budgetUsd > 0 &&
    lock.attempts === 3 && lock.passThreshold === 0.8 && lock.threshold === 0.05 && same(lock.decoys, ['unrelated']) &&
    same(Object.keys(lock.agents).sort(), agents) && same(Object.keys(lock.judge).sort(), agents) &&
    agents.every(agent => [lock.agents[agent].model, lock.judge[agent].model, lock.judge[agent].provider].every(v =>
      typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,255}$/.test(v))), 'unfunded or incompatible model enrollment')
  const entries = dataset.evals
  check(dataset.skill_name === 'verify' && Array.isArray(entries) && entries.length === 10 &&
    entries.every(e => /^[a-z][a-z0-9-]{0,63}$/.test(e.id) && typeof e.should_trigger === 'boolean') &&
    same(entries.filter(e => !e.should_trigger).map(e => e.id).sort(), lock.decoys), 'incomplete or ambiguous enrolled dataset')
  const enrolled = new Map(entries.map(e => [e.id, e]))
  check(enrolled.size === entries.length && same(files(root), agents), 'duplicate cases or unexpected harnesses')
  const results = Object.fromEntries(agents.map(agent => [agent, readAgent(root, agent, lock, enrolled, tree)]))
  check(Object.values(results).reduce((total, result) => total + result.agentCostUsd, 0) <= lock.budgetUsd,
    'agent spend exceeded the frozen aggregate budget')
  const outcomes = Object.values(results).map(r => r.outcome)
  const outcome = outcomes.includes('failed') ? 'failed' : outcomes.includes('inconclusive') ? 'inconclusive' : 'qualified'
  return { schema: 1, outcome, tree, skill: 'verify', harnesses: results,
    uncertainty: { method: 'paired case-cluster percentile bootstrap', seed, replicates: draws, coverage: 0.95 },
    costScope: 'Agent inference USD; judge, container, and setup costs excluded.' }
}
