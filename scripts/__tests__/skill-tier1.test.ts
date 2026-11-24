import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const moduleUrl = pathToFileURL(resolve(__dirname, '../ci/skill-tier1.mjs')).href
const image = 'ghcr.io/nvidia/skillevaluator-tier1@sha256:' + 'a'.repeat(64)
const path = 'skills/meeting-notes'
const required = ['schema', 'security', 'quality', 'version', 'code-integrity', 'pii', 'license', 'lint', 'unicode']
let root: string

// Exercise the distribution's actual ESM entry with retained-report wires from the pinned image.
function verify(control?: string, exit = 0, paths = [path]) {
  const args = [
    '--input-type=module',
    '-e',
    'const [url,dir,paths,image,exit,control] = process.argv.slice(1);' +
      'const { checkReports, verifyControl } = await import(url);' +
      'const checked = checkReports(dir, JSON.parse(paths), image, Number(exit)); if (control) verifyControl(control, checked);',
    moduleUrl,
    root,
    JSON.stringify(paths),
    image,
    String(exit),
    control ?? '',
  ]
  const { status, stderr, error } = spawnSync(process.execPath, args, { encoding: 'utf8' })
  if (error) throw error
  return { status, stderr }
}

function fixture(failed = '') {
  const passed = failed === ''
  const status = passed ? 'passed' : 'failed'
  const results = required.map((id) => ({
    publication_evidence: { schema_version: 1, producer: 'skillevaluator.tier1', tier: 1, check_id: id },
    passed: id !== failed,
    quality: id === 'quality' ? { overall_score: 85 } : undefined,
    status: id === failed ? 'failed' : 'passed',
    incomplete_scans: [] as string[],
    findings:
      id !== failed
        ? []
        : [
            {
              category: id === 'schema' ? 'SCHEMA' : 'SECURITY',
              severity: 'high',
              check_name: id === 'schema' ? 'name_consistency' : 'Instruction Override (P1)',
              message: id === 'schema' ? 'Directory name does not match' : 'Prompt Injection: synthetic fixture',
              file_path: 'SKILL.md',
            },
          ],
  }))
  const row = {
    path,
    report_dir: 'skill-001',
    passed,
    overall_status: status,
    exit_code: passed ? 0 : 1,
    incomplete_scans: [] as string[],
    total_validators: results.length,
  }
  const summary = {
    enforcement: { mode: 'strict', downgraded: false },
    execution: { image, llm_enabled: false },
    selection: { mode: 'all', discovered: 1, selected: [path] },
    total: 1,
    passed: Number(passed),
    failed: Number(!passed),
    incomplete: 0,
    overall_passed: passed,
    overall_status: status,
    skills: [row],
  }
  const report = {
    target_path: path,
    overall_passed: passed,
    overall_status: status,
    incomplete_scans: [] as string[],
    total_validators: results.length,
    results,
  }
  return { summary, report }
}

function save({ summary, report }: ReturnType<typeof fixture>) {
  writeFileSync(join(root, 'summary.json'), JSON.stringify(summary))
  writeFileSync(join(root, 'skill-001', 'skillevaluator-tier1.json'), JSON.stringify(report))
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tier1-evidence-'))
  mkdirSync(join(root, 'skill-001'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('retained Tier 1 evidence', () => {
  it('rejects an empty source root and a tag-only image before invoking Docker', () => {
    mkdirSync(join(root, 'skills'))
    for (const [pin, message] of [
      [image, 'No SKILL.md'],
      ['ghcr.io/nvidia/skillevaluator-tier1:latest', 'by digest'],
    ]) {
      const run = spawnSync(process.execPath, [fileURLToPath(moduleUrl), 'scan', 'skills', 'output'], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, PATH: '', TIER1_IMAGE: pin },
      })
      expect(run.status).toBe(2)
      expect(run.stderr).toContain(message)
    }
  })

  it('accepts complete results and requires the individual planted rule at its expected location', () => {
    save(fixture())
    expect(verify('clean')).toEqual({ status: 0, stderr: '' })
    for (const kind of ['schema', 'security']) {
      expect(verify(kind).status).toBe(1) // Removing the plant must turn its control red.
      const reports = fixture(kind)
      save(reports)
      expect(verify(kind, 1)).toEqual({ status: 0, stderr: '' })
      const finding = reports.report.results.flatMap((result) => result.findings)[0]
      finding.file_path = 'another-file.md'
      save(reports)
      expect(verify(kind, 1).stderr).toContain('Expected completed')
      finding.file_path = 'SKILL.md'
      finding.check_name = 'unrelated-finding'
      save(reports)
      expect(verify(kind, 1).stderr).toContain('Expected completed')
      save(fixture())
    }
  })

  it('refuses skipped, partial, wrong-directory and inconsistent output even with exit zero', () => {
    const mutations: ((reports: ReturnType<typeof fixture>) => void)[] = [
      ({ summary }) => {
        summary.skills = []
        summary.total = 0
      },
      ({ summary }) => {
        summary.selection.selected = []
      },
      ({ summary }) => {
        summary.skills[0].path = 'skills/unexpected'
      },
      ({ summary }) => {
        summary.skills[0].report_dir = '../outside'
      },
      ({ summary }) => {
        summary.execution.image = 'other'
      },
      ({ summary }) => {
        summary.overall_status = 'skipped'
      },
      ({ summary }) => {
        summary.incomplete = 1
      },
      ({ summary }) => {
        summary.enforcement.mode = 'advisory'
      },
      ({ report }) => {
        report.results = []
        report.total_validators = 0
      },
      ({ report }) => {
        report.results[0].status = 'skipped'
      },
      ({ report }) => {
        report.results[0].incomplete_scans = ['missing scanner']
      },
      ({ report }) => {
        report.results[0].passed = false
      },
      ({ report }) => {
        report.total_validators++
      },
      ({ summary }) => {
        summary.skills.push({ ...summary.skills[0] })
      },
    ]
    for (const mutate of mutations) {
      const reports = fixture()
      mutate(reports)
      save(reports)
      expect(verify().status, mutate.toString()).toBe(1)
    }
    save(fixture())
    expect(verify(undefined, 1).stderr).toContain('Contradictory scanner exit')
    rmSync(join(root, 'skill-001', 'skillevaluator-tier1.json'))
    expect(verify().status).toBe(1)
  })

  it('cannot accept an infrastructure failure as proof of a security finding', () => {
    const reports = fixture('security')
    reports.report.incomplete_scans = ['skillspector']
    save(reports)
    expect(verify('security', 1).stderr).toContain('Incomplete')
    save(fixture('security'))
    expect(verify('security', 125).stderr).toContain('Contradictory scanner exit')
  })

  it('binds each completed report to its repository-relative skill path', () => {
    const { summary, report } = fixture()
    const paths = [path, 'skills/follow-ups']
    const other = { ...report, target_path: paths[1] }
    summary.total = summary.passed = summary.selection.discovered = 2
    summary.selection.selected = paths
    summary.skills.push({ ...summary.skills[0], path: paths[1], report_dir: 'skill-002' })
    mkdirSync(join(root, 'skill-002'))
    const second = join(root, 'skill-002', 'skillevaluator-tier1.json')
    save({ summary, report })
    writeFileSync(second, JSON.stringify(other))
    expect(verify(undefined, 0, paths)).toEqual({ status: 0, stderr: '' })
    save({ summary, report: other })
    writeFileSync(second, JSON.stringify(report))
    expect(verify(undefined, 0, paths).stderr).toContain('report target')
  })

  it('accepts the quality threshold itself and rejects a passing validator below it', () => {
    const reports = fixture()
    const quality = reports.report.results.find((result) => result.quality)?.quality
    if (!quality) throw new Error('Quality fixture missing')
    quality.overall_score = 70
    save(reports)
    expect(verify().status).toBe(0)
    quality.overall_score = 69.9
    save(reports)
    expect(verify().stderr).toContain('quality score')
  })
})
