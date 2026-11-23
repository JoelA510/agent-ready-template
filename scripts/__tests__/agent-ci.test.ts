import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

type Step = {
  id?: string
  uses?: string
  run?: string
  env?: Record<string, string>
  with?: Record<string, unknown>
  'continue-on-error'?: boolean
}
type Job = {
  name: string
  steps: Step[]
  permissions: Record<string, string>
  env?: Record<string, string>
  if?: string
  'continue-on-error'?: boolean
}
type Workflow = {
  on: Record<string, unknown>
  permissions: Record<string, string>
  jobs: Record<'scan' | 'controls', Job>
  env?: Record<string, string>
}

const load = (name: string): Workflow =>
  parse(readFileSync(resolve(__dirname, '../../.github/workflows', name), 'utf8'))

describe.each(['agentshield.yml', 'skill-eval-ci.yml'])('%s', (name) => {
  it('checks every PR to main with read-only checkouts, including deletions and ordinary edits', () => {
    const workflow = load(name)
    expect(workflow.on.pull_request).toEqual({ branches: ['main'] })
    expect(workflow.on.push).toEqual({ branches: ['main'] })
    expect(workflow.on).toHaveProperty('workflow_dispatch')
    expect(workflow.on).not.toHaveProperty('pull_request_target')
    expect(workflow.permissions).toEqual({})
    for (const job of [workflow.jobs.scan, workflow.jobs.controls]) {
      expect(job.permissions).toEqual({ contents: 'read' })
      expect(job.if).toBeUndefined()
      expect(job['continue-on-error']).toBeFalsy()
      const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout@'))
      expect(checkout?.with?.['persist-credentials']).toBe(false)
      for (const step of job.steps.filter((step) => step.uses)) {
        expect(step.uses).toMatch(/^[\w-]+\/[\w.-]+@[a-f0-9]{40}$/)
      }
    }
  })
})

it('qualifies the production AgentShield action and severity policy with clean, permission and secret controls', () => {
  const { scan, controls } = load('agentshield.yml').jobs
  const isAgentShield = (step: Step) => step.uses?.startsWith('affaan-m/agentshield@')
  const scans = scan.steps.filter(isAgentShield)
  const fixtures = controls.steps.filter(isAgentShield)
  expect(scans.length).toBeGreaterThan(0)
  expect(fixtures.map((s) => s.id).sort()).toEqual(['clean', 'permission', 'secret'])
  for (const step of [...scans, ...fixtures]) {
    expect(step.uses).toBe(scans[0].uses)
    expect(step.with).toMatchObject({ 'min-severity': 'high', 'fail-on-findings': 'true' })
    expect(!!step['continue-on-error']).toBe(step.id === 'permission' || step.id === 'secret')
  }
  const project = scans.find((step) => step.id === 'scan')
  expect(project?.with).toMatchObject({
    path: '${{ runner.temp }}/agent-config',
    'supply-chain': 'true',
    'supply-chain-online': 'false',
    'fail-on-supply-chain': 'true',
    format: 'sarif',
    'sarif-output': '${{ runner.temp }}/project.sarif',
  })
  const coverage = scan.steps.find((s) => s.run?.includes('agent-config-canary.mjs assert-scan'))
  expect(coverage?.env?.SCAN_SUPPLY_CHAIN).toBe('${{ steps.scan.outputs.supply-chain-status }}')
  expect(coverage?.['continue-on-error']).toBeFalsy()
  const assertion = controls.steps.find((s) => s.run?.includes('agent-config-canary.mjs assert'))
  expect(assertion?.['continue-on-error']).toBeFalsy()
  for (const id of ['clean', 'permission', 'secret']) {
    const fixture = fixtures.find((s) => s.id === id)
    expect(fixture?.with?.format).toBe('sarif')
    expect(assertion?.env?.[id.toUpperCase() + '_OUTCOME']).toBe('${{ steps.' + id + '.outcome }}')
    expect(assertion?.env?.[id.toUpperCase() + '_SUPPLY_CHAIN']).toBe('${{ steps.' + id + '.outputs.supply-chain-status }}')
  }
  expect(new Set(fixtures.map((s) => s.with?.path)).size).toBe(3)
})

it('uses the same immutable Tier 1 image for all source skills and scanner controls and publishes only the summary', () => {
  const { jobs, env } = load('skill-eval-ci.yml')
  expect(env?.TIER1_IMAGE).toMatch(/^ghcr\.io\/nvidia\/skillevaluator-tier1@sha256:[a-f0-9]{64}$/)
  for (const job of [jobs.scan, jobs.controls]) {
    expect(job.env?.TIER1_IMAGE).toBeUndefined()
    for (const step of job.steps) {
      expect(step.env?.TIER1_IMAGE).toBeUndefined()
      expect(step['continue-on-error']).toBeFalsy()
    }
  }
  expect(jobs.scan.steps.some((s) => s.run?.includes('skill-tier1.mjs scan .agents/skills'))).toBe(true)
  expect(jobs.controls.steps.some((s) => s.run?.includes('skill-tier1.mjs selftest'))).toBe(true)
  const uploads = [...jobs.scan.steps, ...jobs.controls.steps].filter((s) => s.uses?.startsWith('actions/upload-artifact@'))
  expect(uploads).toHaveLength(1)
  expect(uploads[0].with).toMatchObject({ 'if-no-files-found': 'error' })
  expect(uploads[0].with?.path).toMatch(/^\$\{\{ runner\.temp \}\}\/[\w-]+\/summary\.json$/)
})
