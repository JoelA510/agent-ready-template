import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseSkill } from '../skills.mjs'

const REPO = resolve(__dirname, '../..')
let root: string
const write = (path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const build = () => spawnSync(process.execPath, ['scripts/build-skills.mjs'], { cwd: root, encoding: 'utf8' })
const SOURCE = '---\nname: audit\ndescription: Use when a repo needs an audit.\nmetadata:\n  argument-hint: "<repo path>"\n---\n\nRun the audit.\n'

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'build-skills-'))
  for (const file of ['scripts/build-skills.mjs', 'scripts/skills.mjs', 'scripts/template-dependency.mjs']) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    copyFileSync(join(REPO, file), join(root, file))
  }
  symlinkSync(join(REPO, 'node_modules'), join(root, 'node_modules'), 'dir')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('build-skills', () => {
  it("copies each skill for Claude Code, promoting argument-hint and keeping the body", () => {
    write('.agents/skills/audit/SKILL.md', SOURCE)
    write('.agents/skills/audit/references/areas.md', '# Areas\n')
    expect(build().status).toBe(0)
    const copy = read('.claude/skills/audit/SKILL.md')
    const skill = parseSkill(copy, 'audit', { strict: false })
    expect(skill.fields).toEqual({ name: 'audit', description: 'Use when a repo needs an audit.', 'argument-hint': '<repo path>' })
    expect(copy).toContain("Claude Code's copy of .agents/skills/audit/SKILL.md")
    expect(copy.endsWith('\nRun the audit.\n')).toBe(true)
    expect(skill.problems).toEqual([])
    expect(read('.claude/skills/audit/references/areas.md')).toBe('# Areas\n')
  })

  it('carries every spec field into the copy, and makes an explicit workflow manual-only in Claude Code', () => {
    write(
      '.agents/skills/audit/SKILL.md',
      '---\nname: audit\ndescription: Use when asked by name to audit.\nlicense: MIT\ncompatibility: Requires git\nallowed-tools: Read Grep\nmetadata:\n  invocation: explicit\n  owner: platform-team\n---\nAudit.\n',
    )
    expect(build().status).toBe(0)
    expect(parseSkill(read('.claude/skills/audit/SKILL.md'), 'audit', { strict: false }).fields).toEqual({
      name: 'audit',
      description: 'Use when asked by name to audit.',
      'disable-model-invocation': true,
      license: 'MIT',
      compatibility: 'Requires git',
      'allowed-tools': 'Read Grep',
      metadata: { owner: 'platform-team' },
    })
  })

  it('reports a skill directory with no SKILL.md instead of crashing', () => {
    write('.agents/skills/audit/SKILL.md', SOURCE)
    mkdirSync(join(root, '.agents/skills/leftover'))
    const { status, stderr } = build()
    expect(status).toBe(1)
    expect(stderr).toContain('.agents/skills/leftover/ has no SKILL.md')
  })

  it("removes the copy of a skill that's gone from the source", () => {
    write('.agents/skills/audit/SKILL.md', SOURCE)
    write('.claude/skills/retired/SKILL.md', 'old\n')
    expect(build().status).toBe(0)
    expect(existsSync(join(root, '.claude/skills/retired'))).toBe(false)
  })

  it.each([
    ['a name that is not its directory', SOURCE.replace('name: audit', 'name: audits'), 'must match its directory'],
    ['a Claude-only field in the portable source', SOURCE.replace('metadata:\n', 'argument-hint: "<x>"\nmetadata:\n'), "isn't an Agent Skills field"],
    ['no frontmatter', 'Run the audit.\n', 'no YAML frontmatter'],
  ])('refuses %s and leaves the last good copies in place', (_label, text, message) => {
    write('.claude/skills/audit/SKILL.md', 'last good copy\n')
    write('.agents/skills/audit/SKILL.md', text)
    const { status, stderr } = build()
    expect(status).toBe(1)
    expect(stderr).toContain(message)
    expect(read('.claude/skills/audit/SKILL.md')).toBe('last good copy\n')
  })

  it('fails, not passes, when there is no source to build from', () => {
    const { status, stderr } = build()
    expect(status).toBe(2)
    expect(stderr).toContain('.agents/skills/ does not exist')
  })
})

describe('parseSkill', () => {
  it('reads a value that ends in " ---" whole: the closing fence is a line of its own', () => {
    const skill = parseSkill('---\nname: pdf\ndescription: Use when a PDF needs work ---\n---\nDo the work.\n', 'pdf')
    expect(skill.description).toBe('Use when a PDF needs work ---')
    expect(skill.body).toBe('Do the work.\n')
    expect(skill.problems).toEqual([])
  })

  it('reads empty frontmatter as missing fields, not as no frontmatter', () => {
    expect(parseSkill('---\n---\nBody.\n', 'pdf').problems).toEqual([
      'frontmatter must be a set of "key: value" fields',
    ])
  })
})
