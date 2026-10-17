import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { floor, satisfies } from '../runtime.mjs'

// Repo-wide invariants on what git tracks. The file list comes from git itself, not from a glob
// that could quietly match nothing, and each check asserts it examined files before it asserts
// they're clean.
const REPO = resolve(__dirname, '../..')

type TrackedFile = { path: string; binary: boolean }

// `git ls-files --eol` reports how git classifies each file's committed content: `i/-text` is
// binary (by content or by a .gitattributes `binary` rule), anything else is text. Letting git
// decide keeps this in step with .gitattributes instead of keeping a second extension list.
// Files deleted from the working tree but not yet `git rm`'d are skipped, not crashed on.
function trackedFiles(): TrackedFile[] | null {
  let out: string
  try {
    out = execFileSync('git', ['ls-files', '--eol', '-z'], { cwd: REPO, encoding: 'utf8' })
  } catch {
    return null // not a git checkout (a ZIP download or degit copy)
  }
  return out
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const [info, path] = line.split('\t')
      return { path, binary: info.startsWith('i/-text') }
    })
    .filter(({ path }) => existsSync(join(REPO, path)))
}

const tracked = trackedFiles()

const MAX_BYTES = 1024 * 1024
// Each entry needs a reason; an entry for a file that no longer exceeds the limit fails below,
// so the list can't silently outlive its purpose. Empty today (package-lock.json is ~0.55 MB).
const LARGE_FILE_ALLOWLIST: Record<string, string> = {}

// Skipped visibly, with the reason in the test name, when there's no git metadata to read.
const suiteName = tracked === null ? 'repo hygiene (skipped: not a git checkout)' : 'repo hygiene'
describe.skipIf(tracked === null)(suiteName, () => {
  const files = tracked ?? []
  const textFiles = files.filter((f) => !f.binary).map((f) => f.path)

  it('examines the tracked files (positive control)', () => {
    expect(files.length).toBeGreaterThan(100)
    expect(textFiles).toContain('package.json')
  })

  it('tracks no raw control characters in text files', () => {
    // Tab and LF are the only control characters text here should contain (.gitattributes
    // normalizes line endings to LF). A raw NUL or backspace can turn a file into an opaque
    // "binary" diff nobody reviews; write escapes like \u0000 in source instead.
    const offenders = textFiles.flatMap((file) => {
      const text = readFileSync(join(REPO, file), 'utf8')
      // Matching control characters is this test's whole job, so the rule against them in a
      // regex (which guards against accidental ones) doesn't apply here.
      // eslint-disable-next-line no-control-regex
      const match = /[\u0000-\u0008\u000B-\u001F\u007F]/.exec(text)
      if (!match) return []
      const line = text.slice(0, match.index).split('\n').length
      return [`${file}:${line} U+${match[0].charCodeAt(0).toString(16).padStart(4, '0')}`]
    })
    expect(offenders).toEqual([])
  })

  it('tracks no file over 1 MB unless it is allowlisted with a reason', () => {
    const large = files.filter(({ path }) => statSync(join(REPO, path)).size > MAX_BYTES)
    expect(large.map((f) => f.path).filter((path) => !(path in LARGE_FILE_ALLOWLIST))).toEqual([])
  })

  it('has no stale large-file allowlist entries', () => {
    const paths = new Set(files.map((f) => f.path))
    const stale = Object.keys(LARGE_FILE_ALLOWLIST).filter(
      (path) => !paths.has(path) || statSync(join(REPO, path)).size <= MAX_BYTES,
    )
    expect(stale).toEqual([])
  })
})

// One runtime pin: CI reads .nvmrc (or, in the one floor job, names exactly the lowest version
// engines accepts), installs the npm package.json pins, and the .nvmrc version is inside
// engines. A sibling repo ran CI on Node 20 while production ran 24, and nothing noticed.
type Step = { text: string; index: number }
type Job = { file: string; name: string; text: string; steps: Step[] }

// A small reader for the workflow shape GitHub documents (`jobs.<id>.steps[]`), enough to tell
// steps apart whatever order their keys come in. Each step is its `- ` line plus every more
// indented line after it.
function workflowJobs(file: string, text: string): Job[] {
  const lines = text.split('\n')
  const jobsAt = lines.findIndex((l) => /^jobs:\s*$/.test(l))
  if (jobsAt === -1) return []
  const jobs: Job[] = []
  let current: { name: string; lines: string[] } | null = null
  for (const line of lines.slice(jobsAt + 1)) {
    const header = line.match(/^ {2}([\w-]+):\s*$/)
    if (header) {
      if (current) jobs.push(toJob(file, current))
      current = { name: header[1], lines: [] }
    } else if (/^\S/.test(line)) break
    else current?.lines.push(line)
  }
  if (current) jobs.push(toJob(file, current))
  return jobs
}
function toJob(file: string, { name, lines }: { name: string; lines: string[] }): Job {
  const steps: Step[] = []
  const stepsAt = lines.findIndex((l) => /^\s+steps:\s*$/.test(l))
  if (stepsAt !== -1) {
    const itemIndent = lines.slice(stepsAt + 1).find((l) => /^\s+- /.test(l))?.match(/^(\s+)-/)?.[1].length
    let step: string[] | null = null
    for (const line of lines.slice(stepsAt + 1)) {
      const indent = line.match(/^(\s*)/)![1].length
      if (itemIndent !== undefined && indent === itemIndent && line.trimStart().startsWith('- ')) {
        if (step) steps.push({ text: step.join('\n'), index: steps.length })
        step = [line]
      } else if (line.trim() === '' || line.trimStart().startsWith('#') || (itemIndent !== undefined && indent > itemIndent)) step?.push(line)
      else break
    }
    if (step) steps.push({ text: step.join('\n'), index: steps.length })
  }
  return { file, name, text: lines.join('\n'), steps }
}

const WORKFLOWS = join(REPO, '.github/workflows')
const hasWorkflows = existsSync(WORKFLOWS)
describe.skipIf(!hasWorkflows)(hasWorkflows ? 'runtime pin' : 'runtime pin (skipped: no .github/workflows)', () => {
  const engines = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).engines.node as string
  const jobs = (hasWorkflows ? readdirSync(WORKFLOWS) : [])
    .filter((f) => /\.ya?ml$/.test(f))
    .flatMap((f) => workflowJobs(f, readFileSync(join(WORKFLOWS, f), 'utf8')))
  const isSetupNode = (s: Step) => /uses:\s*actions\/setup-node@/.test(s.text)
  const runsNode = (s: Step) => /\brun:[^\n]*\b(npm|npx|node|pnpm|yarn)\b|\brun:\s*\|[\s\S]*\b(npm|npx|node|pnpm|yarn)\b/.test(s.text)
  // The pinned npm installs itself (npx npm@<pin> install -g npm@<pin>): npm 10.9.7, bundled with Node
// 22.22.2, fails replacing itself with npm 11 ("Cannot find module 'promise-retry'").
const pinsNpm = (s: Step) => /packageManager[^\n]*npx -y "npm@\$v" install -g "npm@\$v"/.test(s.text)
  const nodeJobs = jobs.filter((j) => j.steps.some(runsNode))

  it('finds the jobs that run Node (positive control)', () => {
    expect(nodeJobs.length).toBeGreaterThanOrEqual(2)
  })

  it.each(nodeJobs.map((j) => [`${j.file} ${j.name}`, j]))('%s sets up Node from the pin, then installs the pinned npm, before running anything', (_label, job) => {
    const j = job as Job
    const setup = j.steps.findIndex(isSetupNode)
    const pin = j.steps.findIndex(pinsNpm)
    const firstRun = j.steps.findIndex((s) => runsNode(s) && !pinsNpm(s))
    expect(setup, 'a setup-node step').toBeGreaterThanOrEqual(0)
    expect(pin, 'a step installing the packageManager npm').toBeGreaterThan(setup)
    expect(firstRun, 'Node runs only after both').toBeGreaterThan(pin)
    expect(j.text, 'no job container with its own Node').not.toMatch(/^\s+(container|image):\s*['"]?node:/m)
  })

  it('every setup-node step reads .nvmrc, except one floor job that names exactly the engines floor', () => {
    const setups = jobs.flatMap((j) => j.steps.filter(isSetupNode).map((s) => ({ job: `${j.file} ${j.name}`, text: s.text })))
    const named = setups.filter((s) => /node-version:/.test(s.text))
    expect(setups.filter((s) => !/node-version-file: \.nvmrc\b/.test(s.text) && !/node-version:/.test(s.text))).toEqual([])
    expect(named.map((s) => s.text.match(/node-version:\s*['"]?([\d.]+)/)?.[1])).toEqual([floor(engines)])
  })

  it("package-lock.json's root entry carries the same engines range", () => {
    const lock = JSON.parse(readFileSync(join(REPO, 'package-lock.json'), 'utf8'))
    expect(lock.packages[''].engines?.node, 'run npm install --package-lock-only after changing engines').toBe(engines)
  })

  it('.nvmrc names a version inside the engines range', () => {
    const pinned = readFileSync(join(REPO, '.nvmrc'), 'utf8').trim()
    expect(satisfies(pinned, engines), `.nvmrc ${pinned} vs engines ${engines}`).toBe(true)
  })

  it('reads steps whatever order their keys come in, and stops at the next step', () => {
    const [job] = workflowJobs('x.yml', [
      'jobs:',
      '  a:',
      '    steps:',
      '      - with:',
      '          node-version: 20',
      '        uses: actions/setup-node@v6',
      '      # a comment between steps',
      '      - name: Other',
      '        run: npm ci',
    ].join('\n'))
    expect(job.steps).toHaveLength(2)
    expect(isSetupNode(job.steps[0])).toBe(true)
    expect(job.steps[0].text).not.toContain('npm ci')
  })

  it('a composite action is not yet covered: extend this test before adding one', () => {
    expect(existsSync(join(REPO, '.github/actions'))).toBe(false)
  })
})

// The ruleset (.github/rulesets/main.json) is what makes CI block a merge, by naming each check.
// GitHub enforces the copy imported in Settings, not this file, so when a job below is renamed or
// added, re-import the file (or edit the live ruleset the same way): a required name no job
// reports anymore leaves every PR waiting forever, and a new job isn't required at all. This
// test keeps the file right; the failure message says what else to do.
describe.skipIf(!hasWorkflows)('workflow permissions', () => {
  // The template's workflows and the skeletons' (the hub's, and the project CI skeleton): nothing
  // granted by default, so a job added later starts with no token scopes, and each job names the
  // ones it uses.
  const HUB = join(REPO, 'templates/hub/.github/workflows')
  const SKELETON = join(REPO, 'templates/project/.github/workflows')
  const files = [WORKFLOWS, HUB, SKELETON]
    .filter((dir) => existsSync(dir))
    .flatMap((dir) => readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).map((f) => join(dir, f)))

  it.each(files.map((f) => [f.slice(REPO.length + 1), f]))('%s grants nothing at the top, and each job asks for its own', (_label, file) => {
    const wf = parseYaml(readFileSync(file, 'utf8'))
    expect(wf.permissions).toEqual({})
    const jobs = Object.entries(wf.jobs ?? {}) as [string, { permissions?: unknown; uses?: string }][]
    expect(jobs.length).toBeGreaterThan(0)
    for (const [id, job] of jobs) expect(job.permissions, `job ${id}`).toBeTypeOf('object')
  })

  // Dependabot moves the pins in .github/workflows only; a skeleton left behind would hand every
  // project an older commit than the template runs. Each action a skeleton uses is pinned to the
  // commit the template's own workflows use.
  const pins = (file: string) =>
    [...readFileSync(file, 'utf8').matchAll(/uses:\s*([\w.-]+\/[\w.-]+)@([0-9a-f]{40})/g)].map((m) => ({ action: m[1], sha: m[2] }))
  const own = new Map(readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f)).flatMap((f) => pins(join(WORKFLOWS, f))).map((p) => [p.action, p.sha]))
  const skeletonFiles = files.filter((f) => !f.startsWith(WORKFLOWS))

  it('finds pinned actions in the skeletons (positive control)', () => {
    expect(skeletonFiles.flatMap(pins).length).toBeGreaterThan(0)
  })

  it.each(skeletonFiles.map((f) => [f.slice(REPO.length + 1), f]))('%s pins each action to the commit the template uses', (_label, file) => {
    const stale = pins(file).filter((p) => own.has(p.action) && own.get(p.action) !== p.sha)
    expect(stale.map((p) => `${p.action}@${p.sha} (the template uses ${own.get(p.action)})`)).toEqual([])
  })

  // The same for zizmor, which runs from a pinned version Dependabot doesn't move.
  const zizmor = (file: string) => [...readFileSync(file, 'utf8').matchAll(/zizmor==([\d.]+)/g)].map((m) => m[1])
  const ownZizmor = new Set(readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f)).flatMap((f) => zizmor(join(WORKFLOWS, f))))

  it('runs zizmor at the version the template runs (positive control: both are found)', () => {
    expect(ownZizmor.size).toBe(1)
    expect(skeletonFiles.flatMap(zizmor).length).toBeGreaterThan(0)
    expect([...new Set(skeletonFiles.flatMap(zizmor))]).toEqual([...ownZizmor])
  })
})

// The audit workflow. One concurrency group for every event once let a push to main cancel the
// weekly scheduled run (or the reverse), and the token that opens the scheduled-failure issue
// once sat in the job that checks out the repository and runs npm.
const AUDIT_WORKFLOW = join(WORKFLOWS, 'audit.yml')
describe.skipIf(!existsSync(AUDIT_WORKFLOW))('the audit workflow', () => {
  type Job = { if?: string; needs?: string | string[]; permissions?: Record<string, string>; steps?: { uses?: string; run?: string }[] }
  type Wf = { concurrency?: { group?: string }; jobs: Record<string, Job> }
  const wf = () => parseYaml(readFileSync(AUDIT_WORKFLOW, 'utf8')) as Wf
  const writes = (job: Job) => Object.entries(job.permissions ?? {}).filter(([, v]) => v === 'write').map(([k]) => k)
  const runsCode = (job: Job) => (job.steps ?? []).some((st) => /actions\/checkout@/.test(st.uses ?? '') || /\b(npm|npx|node)\b/.test(st.run ?? ''))

  it('groups runs by event as well as ref, so a push and the schedule never cancel each other', () => {
    const group = wf().concurrency?.group ?? ''
    expect(group).toContain('github.event_name')
    expect(group).toContain('github.ref')
  })

  it('opens the scheduled-failure issue from a job of its own that runs no code, and nothing else can write', () => {
    const jobs = Object.entries(wf().jobs)
    const auditJob = jobs.find(([, job]) => (job.steps ?? []).some((st) => st.run === 'npm run check:audit'))
    expect(auditJob, 'the job that runs npm run check:audit (positive control)').toBeDefined()
    expect(writes(auditJob![1])).toEqual([])
    const writers = jobs.filter(([, job]) => writes(job).length)
    expect(writers.map(([, job]) => writes(job))).toEqual([['issues']])
    const [, issueJob] = writers[0]
    expect(runsCode(issueJob)).toBe(false)
    expect([issueJob.needs].flat()).toEqual([auditJob![0]])
    expect(issueJob.if).toMatch(/failure\(\)/)
    expect(issueJob.if).toMatch(/github\.event_name == 'schedule'/)
    // Positive control: the audit job itself would count as running code.
    expect(runsCode(auditJob![1])).toBe(true)
  })
})

// The project skeletons: a literal reader fills the ruleset from the CI skeleton, so the ruleset
// skeleton names every job the CI skeleton runs, under the same name. The audit's check comes from
// its own workflow, which isn't a skeleton, so it stays a placeholder.
describe('the ruleset skeleton requires every job of the CI skeleton', () => {
  type Check = Record<string, unknown> & { context: string }
  type Ruleset = { rules: { type: string; parameters?: { required_status_checks?: Check[] } }[] }
  type Ci = { jobs: Record<string, { name?: string }> }
  const isPlaceholder = (s: string) => /^\[[A-Z][^\]]*\]$/.test(s)
  const jobNames = (ci: Ci) => Object.entries(ci.jobs).map(([id, job]) => job.name ?? id)
  const required = (ruleset: Ruleset) => ruleset.rules.find((r) => r.type === 'required_status_checks')!.parameters!.required_status_checks!
  // What the comparison reports: the jobs the ruleset doesn't require, and the reverse.
  const mismatch = (ci: Ci, ruleset: Ruleset) => {
    const jobs = jobNames(ci)
    const contexts = required(ruleset).map((c) => c.context).filter((c) => !isPlaceholder(c))
    return { notRequired: jobs.filter((j) => !contexts.includes(j)), noSuchJob: contexts.filter((c) => !jobs.includes(c)) }
  }
  const ci = parseYaml(readFileSync(join(REPO, 'templates/project/.github/workflows/ci.yml'), 'utf8')) as Ci
  const ruleset = JSON.parse(readFileSync(join(REPO, 'templates/project/.github/rulesets/main.json'), 'utf8')) as Ruleset

  it('finds the jobs and the required checks, and catches a job left out (positive control)', () => {
    expect(jobNames(ci).length).toBeGreaterThanOrEqual(2)
    expect(required(ruleset).length).toBeGreaterThanOrEqual(2)
    const dropped: Ruleset = {
      rules: ruleset.rules.map((r) =>
        r.type === 'required_status_checks'
          ? { ...r, parameters: { required_status_checks: required(ruleset).filter((c) => c.context !== 'End-to-end') } }
          : r,
      ),
    }
    expect(mismatch(ci, dropped)).toEqual({ notRequired: ['End-to-end'], noSuchJob: [] })
  })

  it("names exactly the CI skeleton's jobs, plus a placeholder for the audit workflow's", () => {
    expect(mismatch(ci, ruleset)).toEqual({ notRequired: [], noSuchJob: [] })
    expect(required(ruleset).map((c) => c.context).filter(isPlaceholder)).toEqual(['[AUDIT JOB NAME]'])
  })

  it('leaves only context and integration_id in each entry once its placeholders are deleted', () => {
    for (const check of required(ruleset)) {
      expect(Object.keys(check).filter((k) => !isPlaceholder(k)).sort()).toEqual(['context', 'integration_id'])
      expect(check.integration_id).toBe(15368)
    }
  })
})

// A new-repo trial copied the CI skeleton literally and lost its own Format step: the skeleton had
// none, and its adapt line only took steps away. Phase 2.5's tooling (typecheck, lint, format, test,
// build) each gets a step, so a literal copy keeps every gate the prompt asks CI to run.
describe("the CI skeleton runs every gate Phase 2.5's tooling names", () => {
  type Ci = { jobs: Record<string, { steps: { run?: string }[] }> }
  const GATES = ['npm run typecheck', 'npm run lint', 'npm run format:check', 'npm test', 'npm run build']
  const missing = (ci: Ci) => GATES.filter((g) => !ci.jobs.check.steps.some((st) => st.run === g))
  const ci = parseYaml(readFileSync(join(REPO, 'templates/project/.github/workflows/ci.yml'), 'utf8')) as Ci

  it('the prompt names the gates (so the list above is the prompt\'s, not invented here)', () => {
    expect(readFileSync(join(REPO, 'prompts/new-project.md'), 'utf8')).toMatch(/typecheck \(strict\), lint, format, pre-commit hooks, and CI\s+\(typecheck \+ lint \+ test \+ build/)
  })

  it('has a step for each, and notices one taken away (positive control)', () => {
    expect(missing(ci)).toEqual([])
    const noFormat: Ci = { jobs: { ...ci.jobs, check: { steps: ci.jobs.check.steps.filter((st) => st.run !== 'npm run format:check') } } }
    expect(missing(noFormat)).toEqual(['npm run format:check'])
  })
})

describe.skipIf(!hasWorkflows)('the ruleset requires every pull-request check', () => {
  const RULESET = join(REPO, '.github/rulesets/main.json')
  type Job = { name?: string; if?: string; strategy?: { matrix?: unknown } }
  type Workflow = { on?: unknown; jobs?: Record<string, Job> }
  const triggers = (on: unknown): string[] =>
    typeof on === 'string' ? [on] : Array.isArray(on) ? on.map(String) : on && typeof on === 'object' ? Object.keys(on) : []
  // A job whose `if` admits only other events (`github.event_name == 'schedule'`, and no `||` or
  // `!=` that could let a pull request in) is skipped on every pull request, which GitHub reports
  // as passing: requiring it would require nothing.
  const prOnlySkipped = (job: Job) => {
    const cond = typeof job.if === 'string' ? job.if : ''
    const events = [...cond.matchAll(/github\.event_name\s*==\s*'([\w-]+)'/g)].map((m) => m[1])
    return events.length > 0 && !events.includes('pull_request') && !/\|\||!=/.test(cond)
  }
  const workflows = (hasWorkflows ? readdirSync(WORKFLOWS) : [])
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => ({ f, doc: parseYaml(readFileSync(join(WORKFLOWS, f), 'utf8')) as Workflow }))
  const allJobs = workflows
    .filter(({ doc }) => triggers(doc.on).includes('pull_request'))
    .flatMap(({ f, doc }) => Object.entries(doc.jobs ?? {}).map(([id, job]) => ({ f, id, job, name: job.name ?? id, matrix: Boolean(job.strategy?.matrix) })))
  const prJobs = allJobs.filter((j) => !prOnlySkipped(j.job))

  it('reads every trigger form, and finds the pull-request jobs (positive control)', () => {
    expect(triggers('pull_request')).toEqual(['pull_request'])
    expect(triggers(['push', 'pull_request'])).toEqual(['push', 'pull_request'])
    expect(triggers({ pull_request: { branches: ['main'] } })).toEqual(['pull_request'])
    expect(prJobs.map((j) => j.name)).toEqual(expect.arrayContaining(['Build, lint, typecheck, test', 'npm audit (high and critical block)']))
  })

  it('leaves out only a job no pull request can run, and keeps one a condition could let in (positive control)', () => {
    expect(allJobs.filter((j) => prOnlySkipped(j.job)).map((j) => j.name)).toEqual(['Open an issue when the scheduled audit fails'])
    expect(prOnlySkipped({ if: "failure() && github.event_name == 'schedule'" })).toBe(true)
    expect(prOnlySkipped({ if: "github.event_name == 'schedule' || github.event_name == 'pull_request'" })).toBe(false)
    expect(prOnlySkipped({ if: "github.event_name != 'push'" })).toBe(false)
    expect(prOnlySkipped({ if: 'failure()' })).toBe(false)
    expect(prOnlySkipped({})).toBe(false)
  })

  it('reports each job under a fixed name (a matrix job reports one check per combination)', () => {
    expect(prJobs.filter((j) => j.matrix || j.name.includes('${{')).map((j) => `${j.f}: ${j.id}`)).toEqual([])
  })

  it('names exactly those checks, each from GitHub Actions', () => {
    expect(existsSync(RULESET), 'restore .github/rulesets/main.json, or delete this test if the repo protects main another way').toBe(true)
    const ruleset = JSON.parse(readFileSync(RULESET, 'utf8'))
    const rule = ruleset.rules.find((r: { type: string }) => r.type === 'required_status_checks')
    const checks = rule.parameters.required_status_checks as { context: string; integration_id?: number }[]
    expect(
      checks.map((c) => c.context).sort(),
      'update .github/rulesets/main.json, then re-import it in Settings → Rules → Rulesets (or edit the live ruleset the same way)',
    ).toEqual(prJobs.map((j) => j.name).sort())
    expect(checks.filter((c) => c.integration_id !== 15368)).toEqual([])
    expect(ruleset.conditions.ref_name.include).toEqual(['~DEFAULT_BRANCH'])
    expect(ruleset.enforcement).toBe('active')
  })
})

// A project built from the template takes releases (docs/system/updating-from-the-template.mdx),
// so the version it records has to name a CHANGELOG entry. In a project built from the template,
// which has its own version and changelog, this is the template's rule, not the project's.
const PKG = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
const BUILT_FROM_TEMPLATE = Object.hasOwn(PKG, 'templateVersion')
describe.skipIf(BUILT_FROM_TEMPLATE)(
  BUILT_FROM_TEMPLATE ? 'the template release (skipped: a project built from the template versions itself)' : 'the template release',
  () => {
  const releases = [...readFileSync(join(REPO, 'CHANGELOG.md'), 'utf8').matchAll(/^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?\s*$/gm)]

  it('package.json names the newest CHANGELOG release, which has a date, under [Unreleased]', () => {
    expect(releases.length).toBeGreaterThanOrEqual(2)
    expect(releases[0][1]).toBe('Unreleased')
    expect(releases[1][1], 'the newest release heading').toBe(PKG.version)
    expect(releases[1][2], `## [${PKG.version}] - YYYY-MM-DD`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const lock = JSON.parse(readFileSync(join(REPO, 'package-lock.json'), 'utf8'))
    expect([lock.version, lock.packages[''].version]).toEqual([PKG.version, PKG.version])
  })
  },
)

describe('the engines range', () => {
  it.each([
    ['24', true],
    ['22', true],
    ['22.12.0', true],
    ['26.1.0', true],
    ['22.11.9', false],
    ['20', false],
    ['23', false],
    ['25.1.0', false],
  ])('%s satisfies ^22.12.0 || ^24.0.0 || >=26.0.0: %s', (version, expected) => {
    expect(satisfies(version, '^22.12.0 || ^24.0.0 || >=26.0.0')).toBe(expected)
  })

  it('has a floor, and refuses forms it does not understand rather than guess', () => {
    expect(floor('^24.0.0 || ^22.12.0')).toBe('22.12.0')
    expect(() => satisfies('24', '~24.1.0')).toThrow(/Unsupported engines range/)
    expect(() => satisfies('24', '>=18 <25')).toThrow(/Unsupported engines range/)
    expect(() => satisfies('24', '18.x')).toThrow(/Unsupported engines range/)
  })

  it.each([
    ['>=20', '20', true],
    ['>=20', '18.19.0', false],
    ['^22.12', '22.11.0', false],
    ['^22.12', '22', true],
    ['^20', '21.0.0', false],
  ])('reads the partial range %s: %s satisfies it: %s', (range, version, expected) => {
    expect(satisfies(version, range)).toBe(expected)
    expect(floor(range)).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
