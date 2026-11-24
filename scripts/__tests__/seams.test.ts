import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, posix, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILDS, buildEntry, GENERATED, outputOf } from '../generated.mjs'

type Owner = 'process' | 'interface' | 'local-power' | 'shared'
type Rule = { owner: Owner; purpose: string; paths: string[] }
type Generated = { owner: Owner; sources: string[]; repositoryInputs?: string[] }
type Manifest = { owners: Record<Owner, string>; rules: Rule[]; generated: Record<string, Generated> }

const root = resolve(__dirname, '../..')
const manifest: Manifest = JSON.parse(readFileSync(join(root, 'docs/system/seams.json'), 'utf8'))
// The index includes staged additions, dotfiles, nested templates and files deleted only in the worktree.
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)

function matches(path: string, selector: string) {
  if (selector.endsWith('/')) return path.startsWith(selector)
  return selector.includes('*') ? posix.matchesGlob(path, selector) : path === selector
}

function ownerOf(path: string, rules: Rule[] = manifest.rules): Owner {
  const matchesByRule = rules.flatMap(({ owner, paths }) =>
    paths.filter((selector) => matches(path, selector)).map((selector) => ({ owner, selector })),
  )
  if (matchesByRule.length !== 1) {
    const detail = matchesByRule.map(({ owner, selector }) => `${owner} (${selector})`).join(', ')
    throw new Error(`${path}: ${detail || 'unclassified'}`)
  }
  return matchesByRule[0].owner
}

describe('ownership at repository graduation', () => {
  it('assigns every tracked path exactly once', () => {
    expect(tracked).toContain('scripts/check-conformance.mjs')
    const owners = new Set(tracked.map((path) => ownerOf(path)))
    expect([...owners].sort()).toEqual(['interface', 'local-power', 'process', 'shared'])
    expect([...owners].sort()).toEqual(Object.keys(manifest.owners).sort())
  })

  it('rejects an unknown path, including an unreviewed script alongside shared tools', () => {
    expect(() => ownerOf('unassigned/file.md')).toThrow('unassigned/file.md: unclassified')
    expect(() => ownerOf('scripts/check-new-policy.mjs')).toThrow('scripts/check-new-policy.mjs: unclassified')
    expect(() => ownerOf('scripts/ci/new-tool.mjs')).toThrow('scripts/ci/new-tool.mjs: unclassified')
  })

  it('rejects a second owner even when the more specific selector occurs last', () => {
    const path = 'packs/local-power/bootstrap.sh'
    expect(ownerOf(path)).toBe('local-power')
    const overlap: Rule = { owner: 'process', purpose: 'planted overlap', paths: [path] }
    expect(() => ownerOf(path, [...manifest.rules, overlap])).toThrow(
      'packs/local-power/bootstrap.sh: local-power (packs/local-power/), process (packs/local-power/bootstrap.sh)',
    )
  })

  it.each<[Owner, string[]]>([
    ['process', [
      '.github/workflows/skill-lift.yml', 'scripts/ci/skill-lift.mjs', 'scripts/__tests__/skill-lift.test.ts',
      'evals/skill-lift/benchmark.lock.json', 'continuity/gate.mjs', '.github/workflows/continuity.yml',
      'templates/project/.github/rulesets/main.json', 'standards/core/security-policy.md',
    ]],
    ['shared', [
      'continuity/ledger/decision.json', 'continuity/evidence/result.json', 'evals/skill-lift/verify/evals.json',
      'evals/skill-lift/verify/prereg.md', '.github/rulesets/main.json', 'docs/security/audit-waivers.json',
      'docs/standards/conformance.json', 'docs/system/seams.json', 'scripts/__tests__/seams.test.ts',
    ]],
    ['local-power', [
      'docs/adr/0025-local-runtime-pack.md', 'packs/local-power/nomos/verify-evidence.py',
      'packs/local-power/locks/ecc/package-lock.json', 'packs/local-power/tests/bootstrap.test.mjs',
    ]],
  ])('keeps existing and proposed paths with %s', (owner, paths) => {
    for (const path of paths) expect(ownerOf(path), path).toBe(owner)
  })

  it('keeps each tracked generated file with its canonical sources and builder', () => {
    expect(Object.keys(manifest.generated).sort()).toEqual([...BUILDS].sort())
    for (const output of GENERATED) {
      const files = tracked.filter((path) => outputOf(path)?.path === output)
      expect(files.length, output).toBeGreaterThan(0)
      const build = outputOf(output)!.build
      const { owner, sources, repositoryInputs } = manifest.generated[build]
      expect(ownerOf(buildEntry(root, build)), build).toBe(owner)
      expect(sources.length, build).toBeGreaterThan(0)
      for (const selector of sources) {
        const inputs = tracked.filter((path) => matches(path, selector))
        expect(inputs.length, selector).toBeGreaterThan(0)
        for (const path of inputs) expect(ownerOf(path), path).toBe(owner)
      }
      for (const path of files) expect(ownerOf(path), path).toBe(owner)
      for (const path of repositoryInputs ?? []) {
        expect(tracked).toContain(path)
        expect(ownerOf(path), path).toBe('shared')
      }
    }
  })
})
