import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = resolve(__dirname, '../check-audit.mjs')
const TODAY = '2026-09-24'
const dirs: string[] = []

type Vuln = { severity: string; via: unknown[] }

// Shapes taken from a real `npm audit --json` report (auditReportVersion 2): each package entry
// lists advisories as objects in `via`, or as strings pointing at another package's entry, and
// `metadata.vulnerabilities` counts package entries by severity, `metadata.dependencies` the
// packages audited.
function advisory(ghsa: string, severity: string, title = `${ghsa} title`) {
  return { source: 1, name: 'x', title, url: `https://github.com/advisories/${ghsa}`, severity, range: '<1' }
}
const AUDITED = { prod: 12, dev: 30, optional: 0, peer: 0, peerOptional: 0, total: 42 }
function report(vulns: Record<string, Vuln>, metadataOverride?: Record<string, number>, dependencies: unknown = AUDITED) {
  const counts: Record<string, number> = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 }
  for (const v of Object.values(vulns)) counts[v.severity] = (counts[v.severity] ?? 0) + 1
  return { auditReportVersion: 2, vulnerabilities: vulns, metadata: { vulnerabilities: metadataOverride ?? counts, dependencies } }
}
const waiver = (overrides: Record<string, unknown> = {}) => ({
  advisory: 'GHSA-aaaa-bbbb-cccc',
  package: 'brace-expansion',
  reason: 'Only reachable through a build-time glob over our own source tree; no user input.',
  owner: 'design-systems working group',
  expires: '2026-10-31',
  ...overrides,
})

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'check-audit-'))
  dirs.push(dir)
  return dir
}

function run(auditReport: unknown, waivers: unknown = [], extra: string[] = [], env: Record<string, string> = {}) {
  const dir = scratch()
  writeFileSync(join(dir, 'audit.json'), typeof auditReport === 'string' ? auditReport : JSON.stringify(auditReport))
  writeFileSync(join(dir, 'waivers.json'), typeof waivers === 'string' ? waivers : JSON.stringify({ waivers }))
  const result = spawnSync(
    process.execPath,
    [SCRIPT, '--input', join(dir, 'audit.json'), '--waivers', join(dir, 'waivers.json'), '--today', TODAY, ...extra],
    { encoding: 'utf8', env: { ...process.env, ...env } },
  )
  return { status: result.status, out: result.stdout + result.stderr }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const HIGH = report({
  'brace-expansion': { severity: 'high', via: [advisory('GHSA-aaaa-bbbb-cccc', 'high')] },
  minimatch: { severity: 'high', via: ['brace-expansion'] },
})

describe('check-audit: advisories', () => {
  it('passes a clean report, and says how many dependencies it audited', () => {
    const { status, out } = run(report({}))
    expect(out).toContain('npm audit: 42 dependencies, 0 advisories, 0 high or critical')
    expect(status).toBe(0)
  })

  it('fails on an unwaived high advisory', () => {
    const { status, out } = run(HIGH)
    expect(out).toContain('Unwaived: high     GHSA-aaaa-bbbb-cccc  brace-expansion')
    expect(status).toBe(1)
  })

  it('counts one advisory once, but requires coverage in every package that carries it', () => {
    // As in the real report: GHSA-82fw-gwwq-j7x9 appears as an object `via` under both vitest
    // and @vitest/mocker.
    const shared = advisory('GHSA-aaaa-bbbb-cccc', 'high')
    const both = report({ vitest: { severity: 'high', via: [shared] }, '@vitest/mocker': { severity: 'high', via: [shared] } })
    const { status, out } = run(both, [waiver({ package: 'vitest' })])
    expect(out).toContain('1 advisory, 1 high or critical')
    expect(out).toContain('Unwaived: high     GHSA-aaaa-bbbb-cccc  @vitest/mocker')
    expect(out).not.toContain('Unwaived: high     GHSA-aaaa-bbbb-cccc  vitest')
    expect(status).toBe(1)
  })

  it('treats critical as blocking too', () => {
    const critical = report({ undici: { severity: 'critical', via: [advisory('GHSA-dddd-eeee-ffff', 'critical')] } })
    expect(run(critical).status).toBe(1)
  })

  it('lists but does not block moderate and low advisories', () => {
    const moderate = report({ qs: { severity: 'moderate', via: [advisory('GHSA-1111-2222-3333', 'moderate')] } })
    const { status, out } = run(moderate)
    expect(out).toContain('(reported; below the blocking bar)')
    expect(status).toBe(0)
  })
})

describe('check-audit: refuses to read a report it cannot account for', () => {
  it.each([
    ['null vulnerabilities', { auditReportVersion: 2, vulnerabilities: null }],
    ['an array of vulnerabilities', { auditReportVersion: 2, vulnerabilities: [] }],
    ['an npm error payload', { error: { code: 'ENOTFOUND', summary: 'registry.npmjs.org' } }],
  ])('%s -> exit 2, not a pass', (_label, bad) => {
    const { status, out } = run(bad)
    expect(out).toContain('not an `npm audit --json` report')
    expect(status).toBe(2)
  })

  it('fails when a high entry traces to no parsed advisory (a changed `via` shape)', () => {
    const unparseable = report({ undici: { severity: 'high', via: ['GHSA-9999-9999-9999'] } })
    const { status, out } = run(unparseable)
    expect(out).toContain("Couldn't trace these high/critical entries to an advisory: undici (high)")
    expect(status).toBe(2)
  })

  it("fails when the parsed counts don't match npm's own totals", () => {
    const { status, out } = run(report({}, { info: 0, low: 0, moderate: 0, high: 1, critical: 0 }))
    expect(out).toContain("don't match npm's totals for high (0 vs 1)")
    expect(status).toBe(2)
  })

  // A clean report from an audit of nothing (an empty or missing lockfile) once passed as clean.
  it.each([
    ['zero dependencies audited', { prod: 0, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 0 }, 'npm audit examined 0 dependencies, so nothing was checked'],
    ['zero, in the older numeric form', 0, 'npm audit examined 0 dependencies, so nothing was checked'],
    ['no count of what was audited', null, "doesn't say how many dependencies it audited"],
  ])('%s -> exit 2, not a pass', (_label, dependencies, message) => {
    const { status, out } = run(report({}, undefined, dependencies))
    expect(out).toContain(message)
    expect(status).toBe(2)
    // Positive control: the numeric form with something in it passes.
    expect(run(report({}, undefined, 7)).status).toBe(0)
  })

  it('reports invalid JSON as exit 2 with the reason, not a stack trace', () => {
    const { status, out } = run('{"vulnerabilities": {', [])
    expect(out).toContain('--input report is not valid JSON')
    expect(status).toBe(2)
  })
})

describe('check-audit: waivers', () => {
  it('passes a high advisory with a current waiver for that package, and says so', () => {
    const { status, out } = run(HIGH, [waiver()])
    expect(out).toContain('waived until 2026-10-31, owner design-systems working group')
    expect(status).toBe(0)
  })

  it('does not let a waiver for one package cover the advisory in another', () => {
    const { status, out } = run(HIGH, [waiver({ package: 'not-the-package' })])
    expect(out).toContain('Unwaived: high     GHSA-aaaa-bbbb-cccc  brace-expansion')
    expect(out).toContain('Stale waiver: GHSA-aaaa-bbbb-cccc is no longer reported in not-the-package')
    expect(status).toBe(1)
  })

  it('treats an expired waiver as covering nothing', () => {
    const { status, out } = run(HIGH, [waiver({ expires: '2026-09-23' })])
    expect(out).toContain('Unwaived: high     GHSA-aaaa-bbbb-cccc  brace-expansion')
    expect(out).toContain('Expired waiver: GHSA-aaaa-bbbb-cccc')
    expect(out).not.toContain('waived until')
    expect(status).toBe(1)
  })

  it('waives an advisory with no GHSA link by the npm id the report gives it', () => {
    const npmOnly = { source: 1234, name: 'x', title: 'old advisory', url: 'https://www.npmjs.com/advisories/1234', severity: 'high', range: '<1' }
    const noGhsa = report({ 'brace-expansion': { severity: 'high', via: [npmOnly] } })
    expect(run(noGhsa).out).toContain('Unwaived: high     npm-1234')
    const { status, out } = run(noGhsa, [waiver({ advisory: 'npm-1234' })])
    expect(out).not.toContain('Unwaived')
    expect(status).toBe(0)
  })

  // A waiver validated with its values trimmed but compared untrimmed matched nothing: the
  // advisory read as unwaived and the waiver as stale.
  it('reads ids, package names, and dates with stray whitespace as written without it', () => {
    const padded = waiver({ advisory: ' GHSA-aaaa-bbbb-cccc ', package: 'brace-expansion\t', owner: ' design-systems working group ', expires: ' 2026-10-31\n' })
    const { status, out } = run(HIGH, [padded])
    expect(out).toContain('waived until 2026-10-31, owner design-systems working group)')
    expect(out).not.toContain('Unwaived')
    expect(out).not.toContain('Stale waiver')
    expect(status).toBe(0)
    // And a padded expired date still expires.
    expect(run(HIGH, [waiver({ expires: ' 2026-09-23 ' })]).out).toContain('Expired waiver: GHSA-aaaa-bbbb-cccc (brace-expansion) expired 2026-09-23.')
  })

  it('fails on a stale waiver whose advisory is no longer reported', () => {
    const { status, out } = run(report({}), [waiver()])
    expect(out).toContain('Stale waiver: GHSA-aaaa-bbbb-cccc')
    expect(status).toBe(1)
  })

  it.each([
    ['a short reason', { reason: 'low risk' }, '"reason" must be a string'],
    ['a non-string reason', { reason: { length: 50 } }, '"reason" must be a string'], // passes a naive .length check
    ['no owner', { owner: '' }, '"owner" is required'],
    ['no package', { package: undefined }, '"package" is required'],
    ['a CVE id, which the report never uses', { advisory: 'CVE-2026-1' }, '"advisory" must be the id the audit reports'],
    ['an npm id that is not a number', { advisory: 'npm-abc' }, '"advisory" must be the id the audit reports'],
    ['a malformed expiry', { expires: 'next year' }, '"expires" must be a real date'],
    ['an impossible date', { expires: '2026-02-31' }, '"expires" must be a real date'],
    ['a permanent expiry', { expires: '9999-12-31' }, 'more than 90 days out'],
  ])('rejects a waiver with %s', (_label, overrides, message) => {
    const { status, out } = run(HIGH, [waiver(overrides)])
    expect(out).toContain(message)
    expect(status).toBe(2)
  })

  it('rejects duplicate waivers and non-object entries', () => {
    expect(run(HIGH, [waiver(), waiver()]).out).toContain('duplicate waiver for GHSA-aaaa-bbbb-cccc in brace-expansion')
    expect(run(HIGH, [null]).status).toBe(2)
  })

  it('reports an unreadable register as exit 2', () => {
    const { status, out } = run(HIGH, '{"waivers": [')
    expect(out).toContain('Waiver register is not valid JSON')
    expect(status).toBe(2)
  })
})

describe('check-audit: running npm', () => {
  // A stand-in `npm` on PATH: records its arguments and prints a canned report, so the spawn and
  // parse path CI actually uses is exercised without the network.
  function fakeNpm(output: string) {
    const bin = scratch()
    const argsFile = join(bin, 'args.txt')
    const reportFile = join(bin, 'report.json')
    writeFileSync(reportFile, `${output}\n`) // `read` drops a final line with no newline
    // Shell builtins only: PATH holds nothing but this directory.
    const script = `#!/bin/sh\necho "$@" > "${argsFile}"\nwhile IFS= read -r line; do printf '%s\\n' "$line"; done < "${reportFile}"\nexit 1\n`
    writeFileSync(join(bin, 'npm'), script)
    chmodSync(join(bin, 'npm'), 0o755)
    return { bin, argsFile }
  }

  it.skipIf(process.platform === 'win32')('includes every dependency class, whatever npm omit is set to', () => {
    const { bin, argsFile } = fakeNpm(JSON.stringify(HIGH))
    const result = spawnSync(process.execPath, [SCRIPT, '--today', TODAY], {
      encoding: 'utf8',
      env: { ...process.env, PATH: bin, NODE_ENV: 'production', npm_config_omit: 'dev' },
    })
    expect(readFileSync(argsFile, 'utf8').trim()).toBe('audit --json --include=dev --include=optional --include=peer')
    expect(result.stderr).toContain('Unwaived: high     GHSA-aaaa-bbbb-cccc')
    expect(result.status).toBe(1)
  })

  it.skipIf(process.platform === 'win32')('says why when npm cannot be run at all', () => {
    const empty = scratch()
    const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env: { ...process.env, PATH: empty } })
    expect(result.stderr).toContain("npm audit produced no report (ENOENT")
    expect(result.status).toBe(2)
  })

  it('resolves --waivers against the current directory, like --input', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'a.json'), JSON.stringify(report({})))
    writeFileSync(join(dir, 'w.json'), JSON.stringify({ waivers: [] }))
    const result = spawnSync(process.execPath, [SCRIPT, '--input', 'a.json', '--waivers', 'w.json', '--today', TODAY], {
      cwd: dir,
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
  })

  it('writes the full picture to the GitHub Actions step summary', () => {
    const dir = scratch()
    const summary = join(dir, 'summary.md')
    mkdirSync(dir, { recursive: true })
    run(HIGH, [], [], { GITHUB_STEP_SUMMARY: summary })
    const md = readFileSync(summary, 'utf8')
    expect(md).toContain('### Dependency audit')
    expect(md).toContain('✗ Unwaived: high     GHSA-aaaa-bbbb-cccc  brace-expansion')
  })

  it('rejects unknown arguments and bad dates', () => {
    expect(run(report({}), [], ['--strict']).status).toBe(2)
    expect(run(report({}), [], ['--today', '24/09/2026']).status).toBe(2)
  })
})
