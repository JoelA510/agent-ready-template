import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { is_current, verify_chain } from '../../continuity/gate.mjs'
import { summarize } from './skill-lift-results.mjs'

const DIR = 'evals/skill-lift'
const VERIFY = DIR + '/verify'
const LOCK = DIR + '/benchmark.lock.json'
const POINTER = VERIFY + '/decision.txt'
const HARNESS = ['claude-code', 'codex']
const PROVIDERS = { 'claude-code': 'anthropic', codex: 'openai' }
const JUDGES = { 'claude-code': 'openai', codex: 'anthropic' }
const SUBJECT = 'JoelA510/agent-ready-template'
const FIXTURES = ['CONTRIBUTING.md', 'checks.py', 'changes.json']
const CASE_FILES = FIXTURES.map((name) => 'files/' + name)
export const benchmarkCitations = [
  LOCK,
  VERIFY + '/prereg.md',
  VERIFY + '/evals.json',
  VERIFY + '/environment/Dockerfile',
  ...FIXTURES.map((name) => VERIFY + '/files/' + name),
  '.agents/skills/verify/SKILL.md',
  'prompts/verify.md',
  DIR + '/evaluator.requirements.txt',
  'scripts/ci/skill-lift.mjs',
  'scripts/ci/skill-lift-results.mjs',
  'scripts/ci/rehearse-skill-lift.py',
  '.github/workflows/skill-lift.yml',
]
const DIGEST = /^[a-f0-9]{64}$/
const COMMIT = /^[a-f0-9]{40}$/
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const json = (bytes) => JSON.parse(bytes.toString('utf8'))
const insist = (value, message) => {
  if (!value) throw Error(message)
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const textFile = (path, value) => writeFileSync(path, value, { flag: 'wx', mode: 0o600 })
const objectKeys = (value, keys) =>
  value && typeof value === 'object' && !Array.isArray(value) && same(Object.keys(value).sort(), [...keys].sort())
const positive = (n) => Number.isFinite(n) && n > 0

function git(repo, ...args) {
  return execFileSync('git', ['--no-replace-objects', '-C', repo, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 8 * 1024 * 1024,
  })
}

function blob(repo, tree, path) {
  const line = git(repo, 'ls-tree', '-z', tree, '--', path).toString('utf8')
  const match = /^(100644|100755) blob ([a-f0-9]{40})\t([^\0]+)\0$/.exec(line)
  insist(match && match[3] === path, 'Missing or linked benchmark input: ' + path)
  return git(repo, 'cat-file', 'blob', match[2])
}

function modelId(model, provider) {
  if (typeof model !== 'string' || !model.startsWith(provider + '/')) return false
  const id = model.slice(provider.length + 1)
  if (/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}@sha256:[a-f0-9]{64}$/.test(id)) return true
  const date = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}-(20\d{2})(-?)(\d{2})\2(\d{2})$/.exec(id)
  if (!date) return false
  const iso = date[1] + '-' + date[3] + '-' + date[4]
  const parsed = Date.parse(iso + 'T00:00:00Z')
  return Number.isFinite(parsed) && new Date(parsed).toISOString().startsWith(iso + 'T')
}

export function validateBenchmark(lock, dataset) {
  insist(
    objectKeys(lock, [
      'version',
      'skill',
      'evaluator',
      'harbor',
      'python',
      'baseImage',
      'agents',
      'judge',
      'attempts',
      'passThreshold',
      'threshold',
      'decoys',
      'files',
      'prices',
      'budgetUsd',
      'enrollment',
    ]) &&
      lock.version === 1 &&
      lock.skill === 'verify' &&
      lock.evaluator === '1.0.1' &&
      lock.harbor === '0.25.0' &&
      lock.python === '3.13.18' &&
      /^python:3\.12-slim@sha256:[a-f0-9]{64}$/.test(lock.baseImage) &&
      lock.attempts === 3 &&
      lock.passThreshold === 0.8 &&
      lock.threshold === 0.05 &&
      same(lock.decoys, ['unrelated']) &&
      Array.isArray(lock.files) &&
      same([...lock.files].sort(), FIXTURES.map((f) => VERIFY + '/files/' + f).sort()) &&
      objectKeys(lock.agents, HARNESS) &&
      objectKeys(lock.judge, HARNESS),
    'Invalid benchmark lock',
  )
  const funded = lock.enrollment !== null
  insist(
    funded
      ? typeof lock.enrollment === 'string' &&
          /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(lock.enrollment) &&
          positive(lock.budgetUsd)
      : lock.budgetUsd === null,
    'Invalid funding enrollment',
  )
  for (const [i, name] of HARNESS.entries()) {
    const agent = lock.agents[name],
      judge = lock.judge[name]
    insist(
      objectKeys(agent, ['cli', 'model']) &&
        agent.cli === ['2.1.292', '0.161.0'][i] &&
        objectKeys(judge, ['model', 'provider']) &&
        judge.provider === JUDGES[name] &&
        (funded
          ? modelId(agent.model, PROVIDERS[name]) && modelId(judge.model, judge.provider)
          : agent.model === null && judge.model === null),
      'Invalid harness or judge identity',
    )
  }
  insist(
    objectKeys(lock.prices, funded ? [...new Set(HARNESS.map((k) => lock.agents[k].model))] : []),
    'Invalid agent price table',
  )
  for (const price of Object.values(lock.prices)) {
    insist(positive(price.input_per_mtok) && positive(price.output_per_mtok), 'Invalid agent model price')
  }
  insist(
    dataset.skill_name === 'verify' && Array.isArray(dataset.evals) && dataset.evals.length === 10,
    'Expected ten preregistered cases',
  )
  const ids = new Set(),
    used = new Set()
  for (const c of dataset.evals) {
    insist(
      typeof c.id === 'string' &&
        /^[a-z0-9][a-z0-9-]{0,95}$/.test(c.id) &&
        !ids.has(c.id) &&
        typeof c.prompt === 'string' &&
        c.prompt.trim() &&
        typeof c.expected_output === 'string' &&
        c.expected_output.trim() &&
        Array.isArray(c.assertions) &&
        c.assertions.length &&
        c.assertions.every((a) => typeof a === 'string' && a.trim()) &&
        Array.isArray(c.files) &&
        new Set(c.files).size === c.files.length &&
        c.files.every((f) => CASE_FILES.includes(f)) &&
        c.should_trigger === !lock.decoys.includes(c.id),
      'Malformed, duplicate or unreviewed benchmark case',
    )
    ids.add(c.id)
    for (const f of c.files) used.add(f)
  }
  insist(lock.decoys.every((id) => ids.has(id)) && CASE_FILES.every((f) => used.has(f)), 'Missing critical case or fixture')
  return funded
}

function snapshot(repo, tree, base) {
  insist(
    COMMIT.test(tree) &&
      COMMIT.test(base) &&
      tree !== base &&
      git(repo, 'rev-parse', 'HEAD').toString().trim() === tree &&
      git(repo, 'rev-parse', tree + '^1')
        .toString()
        .trim() === base,
    'Expected the checked-out commit and its first parent',
  )
  // A local worktree may differ from HEAD. Bind the code actually enforcing/reporting this run
  // as well as its staged skill data. Git's checkout line-ending conversion is immaterial here.
  for (const [path, module] of [
    ['scripts/ci/skill-lift.mjs', import.meta.url],
    ['scripts/ci/skill-lift-results.mjs', new URL('./skill-lift-results.mjs', import.meta.url)],
    ['continuity/gate.mjs', new URL('../../continuity/gate.mjs', import.meta.url)],
  ]) {
    const source = readFileSync(fileURLToPath(module), 'utf8').replaceAll('\r\n', '\n')
    insist(
      source === blob(repo, tree, path).toString('utf8').replaceAll('\r\n', '\n'),
      'Running benchmark code differs from selected commit',
    )
  }
  verify_chain({ root: repo, tree, base })
  const decision = blob(repo, tree, POINTER).toString('utf8').trim()
  insist(DIGEST.test(decision) && is_current(decision, { root: repo, tree }), 'Preregistration decision is not HELD')
  const record = json(blob(repo, tree, 'continuity/ledger/' + decision + '.json'))
  const cites = new Set(record.cites.filter((c) => c.kind === 'git-file').map((c) => c.path))
  insist(
    benchmarkCitations.every((p) => cites.has(p)),
    'Decision omits benchmark inputs',
  )
  const files = new Map(benchmarkCitations.map((p) => [p, blob(repo, tree, p)]))
  const lock = json(files.get(LOCK)),
    dataset = json(files.get(VERIFY + '/evals.json'))
  validateBenchmark(lock, dataset)
  const dockerfile = files.get(VERIFY + '/environment/Dockerfile').toString('utf8')
  insist(
    dockerfile
      .split(/\r?\n/)
      .filter((l) => /^\s*FROM\s/i.test(l))
      .every((l) => l.trim() === 'FROM ' + lock.baseImage) &&
      dockerfile.split(/\r?\n/).some((l) => l.trim() === 'FROM ' + lock.baseImage),
    'Task image does not match the lock',
  )
  const hashes = Object.fromEntries([...files].map(([p, b]) => [p, sha(b)]))
  return { lock, dataset, files, manifest: { version: 1, skill: 'verify', tree, base, decision, hashes } }
}

function projection(s) {
  const pairs = [
    ['verify/SKILL.md', '.agents/skills/verify/SKILL.md'],
    ['verify/prompts/verify.md', 'prompts/verify.md'],
    ['verify/evals/evals.json', VERIFY + '/evals.json'],
    ['verify/evals/environment/Dockerfile', VERIFY + '/environment/Dockerfile'],
    ...FIXTURES.map((f) => ['verify/evals/files/' + f, VERIFY + '/files/' + f]),
  ]
  return new Map([
    ...pairs.map(([target, src]) => [target, s.files.get(src)]),
    ['prepared.json', Buffer.from(JSON.stringify(s.manifest) + '\n')],
    ['prices.json', Buffer.from(JSON.stringify(s.lock.prices) + '\n')],
  ])
}

function privateLocation(repo, value) {
  const p = resolve(value)
  insist(realpathSync(dirname(p)) === dirname(p), 'Private output parent must be an existing real directory')
  const rel = relative(realpathSync(repo), p)
  insist(rel.startsWith('..' + sep) || isAbsolute(rel), 'Benchmark output must be outside the repository')
  return p
}

function verifyPrepared(out, expected, allowResults) {
  insist(realpathSync(out) === out && lstatSync(out).isDirectory(), 'Invalid prepared directory')
  const seen = new Set()
  function visit(dir, prefix) {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const name = prefix + ent.name,
        path = join(dir, ent.name)
      if (allowResults && name === 'results' && ent.isDirectory()) continue
      if (ent.isDirectory()) {
        insist(
          [...expected.keys()].some((key) => key.startsWith(name + '/')),
          'Unexpected prepared directory',
        )
        visit(path, name + '/')
      } else {
        insist(ent.isFile() && expected.has(name) && readFileSync(path).equals(expected.get(name)), 'Prepared input changed')
        seen.add(name)
      }
    }
  }
  visit(out, '')
  insist(seen.size === expected.size, 'Prepared input missing')
}

// The native Harbor host needs both role grants. Its staged task environment must contain only
// the current agent grant. Exercise the pinned resolver without provider credentials or I/O.
const runtimeProof = `import importlib.metadata as md, json, os, platform
from skillevaluator.provider_config import resolve_llm_provider
from skillevaluator.tier3.harbor.local_runtime import PINNED_RUNTIME_VERSIONS
from skillevaluator.tier3.harbor.runner import _provider_environment, _resolve_agent_runtime_plan
for agent, judge, agent_key, judge_key, model in [
 ("claude-code","openai","ANTHROPIC_API_KEY","OPENAI_API_KEY","anthropic/claude-fixture"),
 ("codex","anthropic","OPENAI_API_KEY","ANTHROPIC_API_KEY","openai/gpt-fixture")]:
 os.environ.update(SKILL_EVAL_LLM_PROVIDER=judge,SKILL_EVAL_LLM_MODEL="judge-fixture",OPENAI_BASE_URL="https://openai.example.invalid/v1",ANTHROPIC_BASE_URL="https://anthropic.example.invalid")
 os.environ[agent_key]="agent-fixture"; os.environ[judge_key]="judge-fixture"
 p=resolve_llm_provider()
 j=_provider_environment(p)
 plan=_resolve_agent_runtime_plan(provider=p,agents=[agent],models={agent:model},model_sources={agent:"cli"},configured_runtime_env={},env_mode="docker")[agent]
 assert agent_key in plan.staged_env and judge_key not in plan.staged_env
 assert plan.subprocess_env[agent_key]=="agent-fixture" and j[judge_key]=="judge-fixture" and agent_key not in j
print(json.dumps({"python":platform.python_version(),"evaluator":md.version("skillevaluator"),"harbor":md.version("harbor"),"agents":dict(PINNED_RUNTIME_VERSIONS)}))`

function child(bin, args, env, timeout = 120000) {
  try {
    return execFileSync(bin, args, {
      cwd: env.HOME,
      env,
      encoding: 'utf8',
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 2 * 1024 * 1024,
    })
  } catch {
    throw Error('Benchmark dependency check failed: ' + bin)
  }
}

function childBase(env, home) {
  return {
    PATH: env.PATH,
    HOME: home,
    LANG: 'C.UTF-8',
    PYTHONNOUSERSITE: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    ...(process.platform === 'win32' ? { SystemRoot: env.SystemRoot } : {}),
  }
}

function relay(value, api) {
  const url = new URL(value)
  insist(
    url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      (api === 'openai' ? /^\/v1\/?$/.test(url.pathname) : url.pathname === '/') &&
      url.hostname.includes('.') &&
      !['api.openai.com', 'api.anthropic.com'].includes(url.hostname),
    'Expected an enrolled HTTPS relay endpoint',
  )
  return url.href.replace(/\/$/, '')
}

export function fundedRoute(lock, env) {
  insist(lock.enrollment && env.SKILL_LIFT_ENROLLMENT === lock.enrollment, 'Paid Skill Lift enrollment is inactive')
  const cap = Number(env.SKILL_LIFT_PROVIDER_CAP_USD)
  insist(positive(cap) && cap <= lock.budgetUsd, 'Missing or excessive provider-enforced aggregate cap')
  const keys = [
    'SKILL_LIFT_CLAUDE_TOKEN',
    'SKILL_LIFT_CODEX_TOKEN',
    'SKILL_LIFT_OPENAI_JUDGE_TOKEN',
    'SKILL_LIFT_ANTHROPIC_JUDGE_TOKEN',
  ].map((k) => env[k])
  insist(
    keys.every(
      (k) =>
        typeof k === 'string' && k.trim() === k && k.length >= 12 && !/^sk-(ant-|proj-|svcacct-|[a-zA-Z0-9]{20})/.test(k),
    ) && new Set(keys).size === keys.length,
    'Expected four distinct enrolled run-scoped relay grants',
  )
  const openai = relay(env.SKILL_LIFT_OPENAI_BASE_URL, 'openai'),
    anthropic = relay(env.SKILL_LIFT_ANTHROPIC_BASE_URL, 'anthropic')
  return {
    cap,
    roles: HARNESS.map((name, i) => {
      const judge = lock.judge[name]
      const judgeModel = judge.model.split('/')[1]
      return {
        SKILL_EVAL_LLM_PROVIDER: judge.provider,
        SKILL_EVAL_LLM_MODEL: judgeModel,
        LLM_JUDGE_MODEL: judgeModel,
        LLM_JUDGE_FALLBACK_POLICY: 'replace',
        LLM_JUDGE_FALLBACK_MODELS: '',
        LLM_JUDGE_RETRY_POLICY: 'strict',
        OPENAI_BASE_URL: openai,
        ANTHROPIC_BASE_URL: anthropic,
        ANTHROPIC_API_KEY: i === 0 ? keys[0] : keys[3],
        OPENAI_API_KEY: i === 0 ? keys[2] : keys[1],
      }
    }),
  }
}

function evaluate(bin, args, env, cwd) {
  // Give Harbor time to release the trial containers before terminating its process group.
  return new Promise((fulfill, reject) => {
    const proc = spawn(bin, args, { cwd, env, detached: true, stdio: 'ignore' })
    let force
    function signal(value) {
      if (!proc.pid) return
      try {
        process.kill(-proc.pid, value)
      } catch (e) {
        if (e.code !== 'ESRCH') reject(e)
      }
    }
    function stop() {
      if (force) return
      signal('SIGTERM')
      force = setTimeout(() => signal('SIGKILL'), 10000)
    }
    const timer = setTimeout(stop, 35 * 60_000)
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    function cleanup() {
      clearTimeout(timer)
      clearTimeout(force)
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      if (force) signal('SIGKILL')
    }
    proc.once('error', () => {
      cleanup()
      reject(Error('Evaluator failed to start'))
    })
    proc.once('close', (code) => {
      cleanup()
      if (code === 0 && !force) fulfill()
      else reject(Error('Evaluator failed, was interrupted or timed out'))
    })
  })
}

export async function benchmark(
  argv,
  { repo = process.cwd(), env = process.env, check = child, launch = evaluate, collect = summarize } = {},
) {
  const [mode, ...rest] = argv
  const keys = mode === 'summarize' ? ['skill', 'tree', 'in', 'out'] : ['skill', 'tree', 'base', 'out']
  const { values: o } = parseArgs({ args: rest, options: Object.fromEntries(keys.map((k) => [k, { type: 'string' }])) })
  insist(
    ['prepare', 'run', 'summarize'].includes(mode) && keys.every((k) => o[k]) && o.skill === 'verify',
    'Invalid benchmark arguments',
  )
  const out = privateLocation(repo, o.out)
  if (mode === 'summarize') {
    try {
      const input = privateLocation(repo, o.in)
      insist(realpathSync(input) === input && COMMIT.test(o.tree), 'Invalid benchmark summary input')
      const base = git(repo, 'rev-parse', o.tree + '^1')
        .toString()
        .trim()
      const s = snapshot(repo, o.tree, base)
      verifyPrepared(input, projection(s), true)
      const result = await collect({ root: join(input, 'results'), lock: s.lock, dataset: s.dataset, tree: o.tree })
      textFile(out, JSON.stringify(result) + '\n')
      return result.outcome === 'qualified' ? 0 : 1
    } catch {
      textFile(
        out,
        JSON.stringify({ schema: 1, outcome: 'incomplete', skill: 'verify', tree: COMMIT.test(o.tree) ? o.tree : null }) +
          '\n',
      )
      return 1
    }
  }
  const s = snapshot(repo, o.tree, o.base),
    expected = projection(s)
  if (mode === 'prepare') {
    mkdirSync(out, { mode: 0o700 })
    for (const [path, bytes] of expected) {
      mkdirSync(dirname(join(out, path)), { recursive: true, mode: 0o700 })
      textFile(join(out, path), bytes)
    }
    verifyPrepared(out, expected, false)
    return 0
  }
  verifyPrepared(out, expected, false)
  const funding = fundedRoute(s.lock, env)
  insist(process.platform === 'linux' || launch !== evaluate, 'Paid runs require an ephemeral Linux runner')
  const results = join(out, 'results')
  mkdirSync(results, { mode: 0o700 })
  const home = mkdtempSync(join(tmpdir(), 'skill-lift-runtime-'))
  try {
    return await runEvaluators({ check, launch, env, home, results, out, s, expected, funding, tree: o.tree })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

async function runEvaluators({ check, launch, env, home, results, out, s, expected, funding, tree }) {
  const safe = childBase(env, home)
  const runtime = json(check('python', ['-I', '-c', runtimeProof], safe))
  insist(
    ['python', 'evaluator', 'harbor'].every((k) => runtime[k] === s.lock[k]) &&
      HARNESS.every((k) => runtime.agents[k] === s.lock.agents[k].cli),
    'Evaluator, broker isolation or harness pin mismatch',
  )
  const skill = join(out, 'verify')
  // Invoke the distribution's console-script entrypoint with the very interpreter just checked.
  const evaluator = ['-I', '-c', 'from skillevaluator.cli import cli; cli(prog_name="skillevaluator")']
  check('python', [...evaluator, 'tier3', 'validate', skill, '--strict'], safe)
  insist(check('docker', ['info', '--format', '{{.OSType}}'], safe).trim() === 'linux', 'A Linux Docker engine is required')
  for (const [i, name] of HARNESS.entries()) {
    const agent = s.lock.agents[name],
      price = s.lock.prices[agent.model],
      perAgent = funding.cap / HARNESS.length
    const allAttempts = s.dataset.evals.length * s.lock.attempts * 2
    const tokens = Math.max(
      1,
      Math.min(2_000_000_000, Math.floor((1e6 * perAgent) / Math.min(price.input_per_mtok, price.output_per_mtok))),
    )
    const dest = join(results, name)
    mkdirSync(dest, { mode: 0o700 })
    const agentHome = join(home, name)
    mkdirSync(agentHome, { mode: 0o700 })
    await launch(
      'python',
      [
        ...evaluator,
        'tier3',
        'evaluate',
        skill,
        '--backend',
        'harbor',
        '--env-mode',
        'docker',
        '--agents',
        name,
        '--agent-model',
        name + '=' + agent.model,
        '--n-attempts',
        String(s.lock.attempts),
        '--n-concurrent',
        '1',
        '--no-stop-on-pass',
        '--no-tolerate-baseline-timeouts',
        '--grading-mode',
        'default',
        '--skill-workspace-mode',
        'isolated',
        '--custom-dockerfile-mode',
        'preserve',
        '--pass-threshold',
        String(s.lock.passThreshold),
        '--max-attempts-total',
        String(allAttempts),
        '--max-agent-tokens',
        String(tokens),
        '--max-judge-calls',
        String(allAttempts * 3),
        '--max-cost-usd',
        String(perAgent),
        '--price-file',
        join(out, 'prices.json'),
        '--evaluated-source-repository',
        SUBJECT,
        '--evaluated-source-revision',
        tree,
        '--results-dir',
        dest,
      ],
      { ...childBase(env, agentHome), ...funding.roles[i] },
      agentHome,
    )
    verifyPrepared(out, expected, true)
  }
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await benchmark(process.argv.slice(2))
  } catch (error) {
    console.error('Skill Lift: ' + error.message)
    process.exitCode = 1
  }
}
