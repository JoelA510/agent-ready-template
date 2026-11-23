import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { sources } from '../apply-process.mjs'

type Check = { context: string; integration_id: number }
type Workflow = { on: Record<string, { branches: string[] }>; jobs: Record<string, { name: string }> }
const stage = new Map(sources().map(asset => [asset.dest, asset.content]))
const branch = 'release/trunk'
const gates = ['continuity.yml', 'agentshield.yml', 'skill-eval-ci.yml']

function staged(path: string) {
  const file = stage.get('prompts/skeletons/.github/' + path)
  if (!file) throw new Error('File missing from consumer staging: ' + path)
  return file.toString('utf8')
}

function workflow(file: string): Workflow {
  return parse(staged('workflows/' + file).replaceAll('[DEFAULT BRANCH]', branch))
}

describe('enrolling optional agent checks in a consumer ruleset', () => {
  it('runs the target branch filters and keeps the optional gates independent of project npm scripts', () => {
    for (const name of ['ci.yml', ...gates]) {
      const flow = workflow(name)
      expect(flow.on.push.branches).toEqual([branch])
      expect(flow.on.pull_request.branches).toEqual([branch])
    }
    for (const name of gates) {
      const source = staged('workflows/' + name)
      expect(source).toContain("node-version: '24'")
      expect(source).not.toMatch(/node-version-file:|run: npm\b/)
    }
    const continuity = staged('workflows/continuity.yml')
    expect(continuity).toContain('github.event.repository.default_branch')
    expect(continuity).toContain('"refs/heads/$DEFAULT_BRANCH"')
    expect(continuity).toContain('git show "$base:continuity/gate.mjs"')
  })

  it('requires exactly the observed jobs for every combination, with or without end-to-end tests', () => {
    const skeleton = JSON.parse(staged('rulesets/main.json'))
    expect(skeleton.conditions.ref_name.include).toEqual(['~DEFAULT_BRANCH'])
    const key = Object.keys(skeleton).find(name => name.startsWith('[OPTIONAL CHECKS:'))
    if (!key) throw new Error('Missing optional check groups')
    const groups: Record<string, Check[]> = skeleton[key]
    expect(Object.keys(groups).sort()).toEqual([...gates].sort())
    const baseline: Check[] = skeleton.rules.find((r: { type: string }) => r.type === 'required_status_checks')
      .parameters.required_status_checks
    const ci = workflow('ci.yml')
    for (const e2e of [false, true]) {
      for (let mask = 0; mask < 2 ** gates.length; mask++) {
        const enabled = gates.filter((_, index) => mask & (1 << index))
        // The adopter fills in the audit context from its own, separately supplied audit workflow.
        const expected = ['Dependency audit', ...Object.entries(ci.jobs).filter(([job]) => e2e || job !== 'e2e').map(([, job]) => job.name)]
        for (const file of enabled) expected.push(...Object.values(workflow(file).jobs).map(job => job.name))
        const checks = baseline.filter(check => e2e || check.context !== 'End-to-end').concat(enabled.flatMap(file => groups[file]))
        expect(checks.map(check => check.context.replace('[AUDIT JOB NAME]', 'Dependency audit')).sort()).toEqual(expected.sort())
        expect(checks.every(check => check.integration_id === 15368)).toBe(true)
      }
    }
  })
})
