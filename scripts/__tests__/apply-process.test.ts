import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ManifestError, PROCESS_PROMPTS, PROCESS_SKILLS, TEMPLATE_ONLY, drift } from '../apply-process.mjs'
import { runProbe } from '../check-conformance.mjs'
import { listRepoFiles, skeletonDirs } from '../repo-files.mjs'
import { fixtureGit } from './fixture-git'
import { ISOLATED_ENV, resolvesFrom } from './isolated-env'

const REPO = resolve(__dirname, '../..')

// Each test gets its own copy of the template's process assets (so a test can change the
// "template" between applies) and an empty target.
let template: string
let target: string
const dirs: string[] = []

function scratch(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

beforeEach(() => {
  template = scratch('apply-template-')
  target = scratch('apply-target-')
  for (const path of ['scripts/apply-process.mjs', 'scripts/check-instructions.mjs', 'scripts/agent-platforms.mjs', 'scripts/repo-files.mjs', 'scripts/runtime.mjs', 'scripts/skills.mjs', 'scripts/template-dependency.mjs', 'package.json', 'prompts', '.agents/skills', '.claude/skills', 'templates/project', 'templates/standards', 'standards']) {
    cpSync(join(REPO, path), join(template, path), { recursive: true })
  }
})

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function apply(...extra: string[]) {
  const result = spawnSync(process.execPath, [join(template, 'scripts/apply-process.mjs'), '--target', target, ...extra], {
    encoding: 'utf8',
  })
  return { status: result.status, out: result.stdout + result.stderr }
}
const read = (root: string, path: string) => readFileSync(join(root, path), 'utf8')
const write = (root: string, path: string, content: string) => {
  mkdirSync(join(root, path, '..'), { recursive: true })
  writeFileSync(join(root, path), content)
}

describe('process:apply: delivery', () => {
  it('stages everything under prompts/, delivers the skills live, and puts nothing else at a live path', () => {
    const { status, out } = apply()
    expect(status).toBe(0)
    for (const path of [
      'prompts/new-project.md',
      'prompts/existing-project.md',
      'prompts/README.md',
      'prompts/run-log.md',
      '.agents/skills/bootstrap/SKILL.md',
      '.agents/skills/complete/SKILL.md',
      '.claude/skills/bootstrap/SKILL.md',
      '.claude/skills/complete/SKILL.md',
      'prompts/skeletons/CLAUDE.skeleton.md',
      'prompts/skeletons/docs/audit.md',
      'prompts/skeletons/docs/adr/0001-stack.md',
      'prompts/.apply-manifest.json',
    ]) {
      expect(existsSync(join(target, path)), path).toBe(true)
    }
    for (const live of ['CLAUDE.md', 'CONTRIBUTING.md', '.env.example', 'docs', '.gemini', '.claude/commands']) {
      expect(existsSync(join(target, live)), live).toBe(false)
    }
    expect(out).toContain('The skeletons are staged under prompts/skeletons/')
    // The report names the manifest it wrote, and the first step commits the delivery untouched.
    expect(out).toContain('Recorded prompts/.apply-manifest.json')
    // Formatters are excluded first, so a pre-commit formatter can't rewrite the delivery; one run
    // by hand can wait for the first change, where a config edit is in scope.
    expect(out).toMatch(/^ {2}1\. If this repo runs a formatter, keep it off prompts\//m)
    expect(out).toContain('One that runs on commit (a pre-commit\n     hook, lint-staged) needs that before this delivery is committed. One run only by hand can wait')
    expect(out).toMatch(/^ {2}2\. Commit this delivery as it is, with prompts\/\.apply-manifest\.json/m)
    expect(out).not.toContain('Nothing to change.')
  })

  it('delivers skills that pass check:instructions inside the target, where only the target exists', () => {
    apply()
    // Linting parses the skills, which needs the template's dependencies (process:apply doesn't).
    symlinkSync(join(REPO, 'node_modules'), join(template, 'node_modules'), 'dir')
    const lint = spawnSync(process.execPath, [join(template, 'scripts/check-instructions.mjs'), '--root', target], { encoding: 'utf8' })
    expect(lint.stdout + lint.stderr).toMatch(/✓ Checked [1-9]\d* file\(s\)/)
    expect(lint.status).toBe(0)
  })

  it('says how to install the dependencies check:instructions needs, instead of crashing', () => {
    apply()
    // Positive control: nothing above the scratch template provides `yaml`, in the environment the
    // lint runs in below (isolated-env.ts says why that environment drops NODE_PATH).
    expect(resolvesFrom(join(template, 'scripts/template-dependency.mjs'), 'yaml')).toBe(false)
    const lint = spawnSync(process.execPath, [join(template, 'scripts/check-instructions.mjs'), '--root', target], { encoding: 'utf8', env: ISOLATED_ENV })
    expect(lint.stderr).toContain('npm ci --ignore-scripts')
    expect(lint.stderr).not.toMatch(/^\s+at /m) // no stack trace
    expect(lint.status).toBe(2)
  })

  it("recommends recording the platform selection, and never writes, records, or removes the target's own", () => {
    const first = apply()
    expect(first.out).toContain('No .agents/platforms.json records which coding agents this repo uses')
    expect(first.out).toContain('prompts/agent-platforms.md')
    expect(existsSync(join(target, '.agents/platforms.json'))).toBe(false)
    const selection = '{"platforms": ["codex"]}\n'
    write(target, '.agents/platforms.json', selection)
    const again = apply()
    expect(again.out).not.toContain('No .agents/platforms.json')
    expect(read(target, '.agents/platforms.json')).toBe(selection)
    expect(Object.keys(JSON.parse(read(target, 'prompts/.apply-manifest.json')).files)).not.toContain('.agents/platforms.json')
    // The guide the recommendation points at is delivered.
    expect(existsSync(join(target, 'prompts/agent-platforms.md'))).toBe(true)
  })

  it('stages the skeletons where the checks recognize them as skeletons, not the repo\'s files', () => {
    apply()
    expect(skeletonDirs(listRepoFiles(target))).toEqual(['prompts/skeletons/'])
  })

  it('stages no file an agent would load as live instructions', () => {
    apply()
    const staged = (readdirSync(join(target, 'prompts/skeletons'), { recursive: true }) as string[]).map((p) => basename(p))
    const instructionNames = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', 'CLAUDE.local.md', '.cursorrules', '.windsurfrules']
    expect(staged.filter((name) => instructionNames.includes(name))).toEqual([])
  })

  it('classifies every prompt and skill in the template as delivered or template-only', () => {
    const prompts = readdirSync(join(REPO, 'prompts')).filter((f) => f.endsWith('.md'))
    const skills = readdirSync(join(REPO, '.agents/skills'))
    expect(skills.length, 'skills (positive control)').toBeGreaterThanOrEqual(5)
    expect(prompts.filter((f) => !PROCESS_PROMPTS.includes(f) && !TEMPLATE_ONLY.prompts.includes(f))).toEqual([])
    expect(skills.filter((f) => !PROCESS_SKILLS.includes(f) && !TEMPLATE_ONLY.skills.includes(f))).toEqual([])
  })

  it('removes the .claude/commands/ an earlier run delivered, and keeps one the target edited', () => {
    // An earlier template delivered the workflows as .claude/commands/; this one ships skills.
    apply()
    const manifestPath = join(target, 'prompts/.apply-manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    // That earlier run delivered commands and no skills.
    for (const dest of Object.keys(manifest.files)) if (/^\.(agents|claude)\/skills\//.test(dest)) delete manifest.files[dest]
    rmSync(join(target, '.agents'), { recursive: true })
    rmSync(join(target, '.claude/skills'), { recursive: true })
    const delivered = '# the old bootstrap command\n'
    for (const name of ['bootstrap.md', 'complete.md']) {
      manifest.files[`.claude/commands/${name}`] = createHash('sha256').update(delivered).digest('hex')
    }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    write(target, '.claude/commands/bootstrap.md', delivered)
    write(target, '.claude/commands/complete.md', '# the old bootstrap command, edited by the target\n')
    const { status, out } = apply()
    expect(status).toBe(0)
    expect(existsSync(join(target, '.claude/commands/bootstrap.md'))).toBe(false)
    expect(existsSync(join(target, '.claude/commands/complete.md'))).toBe(true)
    // The untouched command went, so its skill arrives; the edited one stays, so its skill waits.
    expect(existsSync(join(target, '.claude/skills/bootstrap/SKILL.md'))).toBe(true)
    expect(existsSync(join(target, '.claude/skills/complete/SKILL.md'))).toBe(false)
    expect(out).toContain('.claude/skills/complete/SKILL.md')
  })

  it("holds back a skill the target already has, such as the run recipe Claude Code's /verify records", () => {
    write(target, '.claude/skills/verify/SKILL.md', '---\nname: verify\ndescription: Start the app and check the change.\n---\n\nRun npm start.\n')
    const { out } = apply()
    expect(out).toContain('Held back: the target has a skill of its own by this name')
    expect(out).toContain('! .agents/skills/verify/SKILL.md')
    expect(existsSync(join(target, '.agents/skills/verify'))).toBe(false)
    expect(existsSync(join(target, '.claude/skills/verify/SKILL.md.template'))).toBe(false)
    expect(read(target, '.claude/skills/verify/SKILL.md')).toContain('Run npm start.')
    expect(Object.keys(JSON.parse(read(target, 'prompts/.apply-manifest.json')).files).filter((k) => k.includes('/verify/'))).toEqual([])
    expect(existsSync(join(target, '.agents/skills/pre-pr/SKILL.md'))).toBe(true) // the rest still arrives
    const check = apply('--check')
    expect(check.status).toBe(0) // held back isn't drift, but it's said
    expect(check.out).toContain("own skill(s) hold the template's back: .agents/skills/verify")
  })

  it("holds back a target's own skill even when it mentions the template's prompt", () => {
    write(target, '.claude/skills/verify/SKILL.md', '---\nname: verify\ndescription: Our checks.\n---\n\nFollow prompts/verify.md, then npm start.\n')
    expect(apply().out).toContain('Held back: the target has a skill of its own by this name')
    expect(existsSync(join(target, '.agents/skills/verify'))).toBe(false)
  })

  it('parks, not holds back, skills an earlier apply delivered when the manifest was deleted', () => {
    apply()
    for (const home of ['.agents', '.claude']) write(target, `${home}/skills/pre-pr/SKILL.md`, `${read(target, `${home}/skills/pre-pr/SKILL.md`)}\nA local note.\n`)
    rmSync(join(target, 'prompts/.apply-manifest.json')) // what the malformed-manifest message says to do
    const { out } = apply()
    expect(out).not.toContain('Held back')
    expect(existsSync(join(target, '.claude/skills/pre-pr/SKILL.md.template'))).toBe(true)
  })

  it("holds back a skill that would silently replace the target's own command, until the command goes", () => {
    write(target, '.claude/commands/pre-pr.md', "# our team's own pre-PR checklist\n")
    const first = apply()
    expect(first.status).toBe(0)
    expect(first.out).toContain('Held back: in Claude Code this skill would silently replace')
    expect(existsSync(join(target, '.claude/skills/pre-pr/SKILL.md'))).toBe(false)
    expect(existsSync(join(target, '.agents/skills/pre-pr/SKILL.md'))).toBe(true) // Claude Code doesn't read this one
    expect(read(target, '.claude/commands/pre-pr.md')).toBe("# our team's own pre-PR checklist\n")
    rmSync(join(target, '.claude/commands/pre-pr.md'))
    apply()
    expect(existsSync(join(target, '.claude/skills/pre-pr/SKILL.md'))).toBe(true)
  })

  it('delivers a binary skill file byte for byte, and never an OS dropping', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x80])
    mkdirSync(join(template, '.agents/skills/bootstrap/assets'), { recursive: true })
    writeFileSync(join(template, '.agents/skills/bootstrap/assets/logo.png'), png)
    writeFileSync(join(template, '.agents/skills/bootstrap/.DS_Store'), Buffer.from([0, 0, 0, 1]))
    expect(apply().status).toBe(0)
    expect(readFileSync(join(target, '.agents/skills/bootstrap/assets/logo.png')).equals(png)).toBe(true)
    expect(existsSync(join(target, '.agents/skills/bootstrap/.DS_Store'))).toBe(false)
    expect(apply().out).toContain('Nothing to change.')
  })

  it("delivers a fresh run log, not the template's own run history", () => {
    const log = read(template, 'prompts/run-log.md')
    write(template, 'prompts/run-log.md', log.replace(/(\| _yyyy-mm-dd_[^\n]*\n)/, '$1| 2026-09-24 | existing | template-internal | … | … | yes | … |\n'))
    apply()
    const delivered = read(target, 'prompts/run-log.md')
    expect(delivered).toContain('| _yyyy-mm-dd_')
    expect(delivered).not.toContain('template-internal')
  })

  it('points at existing agent instructions, including nested ones, instead of adding a parallel file', () => {
    write(target, '.claude/CLAUDE.md', '# existing rules\n')
    const { out } = apply()
    expect(out).toContain('The target already has agent instructions: .claude/CLAUDE.md.')
    // New or existing project alike: the rules move to a root AGENTS.md, which CLAUDE.md imports.
    expect(out).toContain('create it from prompts/skeletons/AGENTS.skeleton.md, and move the shared rules from .claude/CLAUDE.md into it')
    expect(out).toContain('`@../AGENTS.md` as the first line of .claude/CLAUDE.md')
    expect(out).not.toContain('into .claude/CLAUDE.md')
    expect(existsSync(join(target, 'CLAUDE.md'))).toBe(false)
    expect(existsSync(join(target, 'AGENTS.md'))).toBe(false)
  })

  // The AGENTS skeleton as a prompt run leaves it: placeholders filled (an unfilled one reads as a
  // leftover from an old apply, not as instructions).
  const filledAgents = () => read(target, 'prompts/skeletons/AGENTS.skeleton.md').replace(/\[[A-Z][^\]\n]*\]/g, 'filled')

  // The advice and the scorecard give one answer: a target that follows the advice passes
  // core.agent-rules, and the next apply has nothing left to say.
  it('advises rules kept only in CLAUDE.md into the shape core.agent-rules passes', () => {
    write(target, 'CLAUDE.md', '# Project rules\n\n- Run the tests before committing.\n')
    const first = apply().out
    expect(runProbe(target, 'core.agent-rules')).toMatchObject({ status: 'fail', evidence: ['no AGENTS.md at the root', 'rules kept only in: CLAUDE.md'] })
    expect(first).toContain('the standard core.agent-rules fails rules kept only in CLAUDE.md')
    // Follow it word for word: AGENTS.md from the skeleton, with the moved rules; CLAUDE.md imports it.
    expect(first).toContain('create it from prompts/skeletons/AGENTS.skeleton.md')
    const importLine = first.match(/`(@[^`]+)` as the first line of CLAUDE\.md/)?.[1]
    expect(importLine).toBe('@AGENTS.md')
    write(target, 'AGENTS.md', `${filledAgents()}\n- Run the tests before committing.\n`)
    write(target, 'CLAUDE.md', `${importLine}\n\n## Claude Code\n`)
    expect(runProbe(target, 'core.agent-rules').status).toBe('pass')
    const again = apply().out
    expect(again).not.toContain('already has agent instructions')
    expect(again).not.toContain('skips AGENTS.md')
  })

  it('says nothing about merging once AGENTS.md carries the operating rules (a re-apply after a prompt run)', () => {
    write(target, 'AGENTS.md', '# shared rules\n')
    write(target, 'CLAUDE.md', '@AGENTS.md\n')
    expect(apply().out).toContain('Merge the rules from prompts/skeletons/AGENTS.skeleton.md into AGENTS.md.') // positive control
    write(target, 'AGENTS.md', filledAgents())
    const { out } = apply()
    expect(out).not.toContain('Merge the rules')
    expect(out).not.toContain('already has agent instructions')
  })

  it('prefers AGENTS.md as the merge target, and never a personal CLAUDE.local.md', () => {
    write(target, 'CLAUDE.local.md', '# my notes\n')
    expect(apply().out).not.toContain('rules from prompts/skeletons')
    write(target, 'AGENTS.md', '# shared rules\n')
    const { out } = apply()
    expect(out).toContain('Merge the rules from prompts/skeletons/AGENTS.skeleton.md into AGENTS.md.')
    expect(out).toContain('your personal CLAUDE.local.md makes Claude Code skip AGENTS.md')
  })

  it.each([
    ['a CLAUDE.md with no import', 'CLAUDE.md', '# claude notes\n', true],
    ['an import only inside a code block', 'CLAUDE.md', '```\n@AGENTS.md\n```\n', true],
    ['.claude/CLAUDE.md importing a path that resolves beside it', '.claude/CLAUDE.md', '@AGENTS.md\n', true],
    ['a CLAUDE.md that imports it', 'CLAUDE.md', '@AGENTS.md\n\n## Claude Code\n', false],
    ['.claude/CLAUDE.md importing it relative to itself', '.claude/CLAUDE.md', '@../AGENTS.md\n', false],
  ])('warns about a CLAUDE.md that hides AGENTS.md from Claude Code: %s', (_label, path, text, warns) => {
    write(target, 'AGENTS.md', '# shared rules\n')
    write(target, path, text)
    expect(apply().out.includes('skips AGENTS.md, so the rules there never reach it')).toBe(warns)
  })

  it('does not warn about a CLAUDE.md that is a link to AGENTS.md', () => {
    write(target, 'AGENTS.md', '# shared rules\n')
    symlinkSync('AGENTS.md', join(target, 'CLAUDE.md'))
    expect(apply().out).not.toContain('skips AGENTS.md')
  })
})

describe('process:apply: re-runs', () => {
  it('says to commit a manifest it wrote, and never also that nothing changed', () => {
    // A target whose files already match the template, with no record of an earlier apply.
    apply()
    rmSync(join(target, 'prompts/.apply-manifest.json'))
    const { out } = apply()
    expect(out).toContain('Recorded prompts/.apply-manifest.json')
    expect(out).toContain('Commit this delivery as it is')
    expect(out).not.toContain('Nothing to change.')
  })

  it('is a quiet no-op when nothing changed, and leaves the manifest untouched', () => {
    apply()
    const before = read(target, 'prompts/.apply-manifest.json')
    const { status, out } = apply()
    expect(status).toBe(0)
    expect(out).toContain('Nothing to change.')
    expect(out).not.toContain('Next steps')
    expect(out).not.toContain('Recorded')
    // The skills it delivered are its own, not the target's instructions to merge into.
    expect(out).not.toContain('already has agent instructions')
    expect(read(target, 'prompts/.apply-manifest.json')).toBe(before)
  })

  it("keeps the target's own edits when the template didn't change", () => {
    apply()
    write(target, 'prompts/existing-project.md', 'edited after a run surfaced a gap\n')
    const { out } = apply()
    expect(out).toContain('1 edited in the target, kept as-is')
    expect(existsSync(join(target, 'prompts/existing-project.md.template'))).toBe(false)
  })

  it('does not count line endings, a BOM, or trailing whitespace as an edit', () => {
    apply()
    const path = 'prompts/skeletons/docs/dev-plan.md'
    write(target, path, `\uFEFF${read(target, path).replace(/\n/g, '  \r\n')}`)
    write(template, `templates/project/docs/dev-plan.md`, 'improved skeleton\n')
    const { out } = apply()
    expect(out).toContain(`↑ ${path}`)
    expect(read(target, path)).toBe('improved skeleton\n')
  })

  it('updates in place a file the template changed and the target never touched', () => {
    apply()
    write(template, 'templates/project/docs/dev-plan.md', 'improved skeleton\n')
    const { out } = apply()
    expect(out).toContain('↑ prompts/skeletons/docs/dev-plan.md')
    expect(out).toContain('1. Commit the updated files with prompts/.apply-manifest.json, as their own commit.')
    expect(out).not.toContain('Leave the *.template files out')
    expect(read(target, 'prompts/skeletons/docs/dev-plan.md')).toBe('improved skeleton\n')
    expect(apply().out).toContain('Nothing to change.')
  })

  it('parks once when both sides changed, and stays quiet after the merge', () => {
    apply()
    write(target, 'prompts/new-project.md', 'target edit\n')
    write(template, 'prompts/new-project.md', 'template edit\n')
    const first = apply()
    expect(first.out).toContain('~ prompts/new-project.md  ->  prompts/new-project.md.template')
    expect(first.out).toContain('Leave the *.template files out of it.')
    expect(read(target, 'prompts/new-project.md')).toBe('target edit\n')
    expect(read(target, 'prompts/new-project.md.template')).toBe('template edit\n')

    // The user merges by hand and deletes the .template.
    write(target, 'prompts/new-project.md', 'target edit + template edit\n')
    rmSync(join(target, 'prompts/new-project.md.template'))
    const second = apply()
    expect(second.out).toContain('Nothing to change.')
    expect(existsSync(join(target, 'prompts/new-project.md.template'))).toBe(false)

    // A later template change is a new offer.
    write(template, 'prompts/new-project.md', 'template edit 2\n')
    expect(apply().out).toContain('~ prompts/new-project.md  ->  prompts/new-project.md.template')
  })

  it('records adopting the template version exactly, so the next template change updates in place', () => {
    apply()
    write(target, 'prompts/new-project.md', 'target edit\n')
    write(template, 'prompts/new-project.md', 'template edit\n')
    apply()
    write(target, 'prompts/new-project.md', 'template edit\n') // adopted verbatim
    rmSync(join(target, 'prompts/new-project.md.template'))
    apply()
    write(template, 'prompts/new-project.md', 'template edit 2\n')
    const { out } = apply()
    expect(out).toContain('↑ prompts/new-project.md')
    expect(read(target, 'prompts/new-project.md')).toBe('template edit 2\n')
  })

  it('leaves a delivered file deleted if the target removed it', () => {
    apply()
    rmSync(join(target, 'prompts/skeletons/docs/env-validation.md'))
    const { out } = apply()
    expect(out).toContain('- prompts/skeletons/docs/env-validation.md')
    expect(existsSync(join(target, 'prompts/skeletons/docs/env-validation.md'))).toBe(false)
  })

  it('removes a file the template dropped if untouched, and reports it if edited', () => {
    apply()
    write(target, 'prompts/skeletons/docs/audit.md', 'our audit notes\n')
    rmSync(join(template, 'templates/project/docs/audit.md'))
    rmSync(join(template, 'templates/project/docs/dev-plan.md'))
    const { out } = apply()
    expect(out).toContain('x prompts/skeletons/docs/dev-plan.md')
    expect(existsSync(join(target, 'prompts/skeletons/docs/dev-plan.md'))).toBe(false)
    expect(out).toContain('? prompts/skeletons/docs/audit.md')
    expect(read(target, 'prompts/skeletons/docs/audit.md')).toBe('our audit notes\n')
    expect(apply().out).toContain('? prompts/skeletons/docs/audit.md') // reported until resolved
  })

  it("never touches the target's run log once it exists", () => {
    apply()
    write(target, 'prompts/run-log.md', 'our runs\n')
    write(template, 'prompts/run-log.md', 'new header\n')
    const { out } = apply()
    expect(read(target, 'prompts/run-log.md')).toBe('our runs\n')
    expect(existsSync(join(target, 'prompts/run-log.md.template'))).toBe(false)
    expect(out).toContain('Nothing to change.')
  })

  it('parks, with an honest message, a pre-existing file at a delivered path', () => {
    write(target, 'prompts/README.md', 'the target had its own prompts folder\n')
    const { out } = apply()
    expect(read(target, 'prompts/README.md')).toBe('the target had its own prompts folder\n')
    expect(out).toContain("no record of an earlier apply, so it can't tell an old delivery from your edit")
    expect(out).toContain('~ prompts/README.md  ->  prompts/README.md.template')
  })

  it('flags unfilled skeletons left at live paths by an apply that predates staging', () => {
    // What an apply before staging left at the live path: the rules skeleton, unfilled.
    write(target, 'CLAUDE.md', read(REPO, 'templates/project/AGENTS.skeleton.md'))
    const { out } = apply()
    expect(out).toContain('look like unfilled skeletons')
    expect(out).toContain('  ! CLAUDE.md')
    expect(out).not.toContain('already has agent instructions') // not a real instruction file
  })
})

describe('process:apply: standards', () => {
  it('delivers core always, a named pack on request, and keeps delivering it until dropped', () => {
    apply()
    expect(existsSync(join(target, 'prompts/standards/README.md'))).toBe(true)
    expect(existsSync(join(target, 'prompts/standards/core/agent-rules.md'))).toBe(true)
    expect(existsSync(join(target, 'prompts/standards/node'))).toBe(false)
    const withNode = apply('--pack', 'node@mobile-app') // the path is the config's business
    expect(withNode.out).toContain('Standards delivered: core, node (prompts/standards/).')
    expect(existsSync(join(target, 'prompts/standards/node/strict-types.md'))).toBe(true)
    expect(JSON.parse(read(target, 'prompts/.apply-manifest.json')).packs).toEqual(['node'])
    expect(apply().out).toContain('Nothing to change.') // remembered
    const dropped = apply('--drop-pack', 'node')
    expect(dropped.out).toContain('x prompts/standards/node/strict-types.md')
    expect(existsSync(join(target, 'prompts/standards/node'))).toBe(false)
    expect(JSON.parse(read(target, 'prompts/.apply-manifest.json')).packs).toBeUndefined()
  })

  it("keeps a recorded pack this template doesn't ship, instead of crashing or removing it", () => {
    apply()
    // As a newer template would have left it: a pack this one doesn't have.
    const manifest = JSON.parse(read(target, 'prompts/.apply-manifest.json'))
    write(target, 'prompts/standards/rust/locked.md', 'a newer pack\n')
    manifest.packs = ['rust']
    manifest.files['prompts/standards/rust/locked.md'] = createHash('sha256').update('a newer pack\n').digest('hex')
    write(target, 'prompts/.apply-manifest.json', JSON.stringify(manifest))
    const { status, out } = apply()
    expect(status).toBe(0)
    expect(out).toContain("pack(s) this template doesn't ship: rust")
    expect(read(target, 'prompts/standards/rust/locked.md')).toBe('a newer pack\n')
    expect(JSON.parse(read(target, 'prompts/.apply-manifest.json')).packs).toEqual(['rust'])
    expect(apply('--check')).toMatchObject({ status: 0, out: expect.stringContaining("doesn't ship: rust") })
    // Dropping it works like any pack: its untouched files go.
    expect(apply('--drop-pack', 'rust').status).toBe(0)
    expect(existsSync(join(target, 'prompts/standards/rust'))).toBe(false)
    expect(JSON.parse(read(target, 'prompts/.apply-manifest.json')).packs).toBeUndefined()
    expect(apply('--drop-pack', 'cobol').status).toBe(2) // neither shipped nor recorded
  })

  it('refuses a pack the catalog lacks, naming the ones it has', () => {
    const { status, out } = apply('--pack', 'cobol')
    expect(status).toBe(2)
    expect(out).toContain('No pack cobol')
    expect(out).toContain('node, python')
    expect(existsSync(join(target, 'prompts'))).toBe(false)
  })
})

describe('process:apply: merge proposals', () => {
  // A template with history, so the version last offered can be read back from its commit.
  const gitTemplate = fixtureGit(() => template)
  const commitTemplate = (message: string) => {
    gitTemplate('add', '-A')
    gitTemplate('commit', '-q', '--no-verify', '-m', message)
  }
  beforeEach(() => {
    gitTemplate('init', '-q')
    commitTemplate('template')
  })
  const lines = (n: number, edit: Record<number, string> = {}) => Array.from({ length: n }, (_, i) => edit[i] ?? `line ${i}`).join('\n') + '\n'

  it('parks a clean merge of both sides when the edits touch different lines', () => {
    write(template, 'prompts/new-project.md', lines(12))
    commitTemplate('base')
    apply()
    write(target, 'prompts/new-project.md', lines(12, { 1: 'target edit' }))
    write(template, 'prompts/new-project.md', lines(12, { 10: 'template edit' }))
    commitTemplate('change')
    const { out } = apply()
    expect(out).toContain('prompts/new-project.md.template (merged cleanly)')
    expect(read(target, 'prompts/new-project.md.template')).toBe(lines(12, { 1: 'target edit', 10: 'template edit' }))
    expect(read(target, 'prompts/new-project.md')).toBe(lines(12, { 1: 'target edit' })) // the target's file is untouched
  })

  it("finds the version last offered by its hash when this history doesn't hold the recorded commit", () => {
    // A target applied from a copy of this history (an import, a squashed export): its commit isn't
    // here, but the version it was offered is.
    write(template, 'prompts/new-project.md', lines(12))
    commitTemplate('base')
    apply()
    const manifest = JSON.parse(read(target, 'prompts/.apply-manifest.json'))
    write(target, 'prompts/.apply-manifest.json', JSON.stringify({ ...manifest, templateCommit: 'f'.repeat(40) }))
    write(target, 'prompts/new-project.md', lines(12, { 1: 'target edit' }))
    write(template, 'prompts/new-project.md', lines(12, { 10: 'template edit' }))
    commitTemplate('change')
    const { out } = apply()
    expect(out).toContain('prompts/new-project.md.template (merged cleanly)')
    expect(read(target, 'prompts/new-project.md.template')).toBe(lines(12, { 1: 'target edit', 10: 'template edit' }))
    expect(out).toContain('or a repository this template was copied from without its history')
  })

  it("parks the plain new version when the recorded commit doesn't hold what was offered", () => {
    write(template, 'prompts/new-project.md', lines(6))
    commitTemplate('base')
    write(template, 'prompts/new-project.md', lines(6, { 0: 'uncommitted when applied' })) // a dirty template checkout
    apply()
    write(target, 'prompts/new-project.md', lines(6, { 0: 'uncommitted when applied', 3: 'target edit' }))
    write(template, 'prompts/new-project.md', lines(6, { 5: 'template edit' }))
    commitTemplate('change')
    const { out } = apply()
    expect(out).toContain('~ prompts/new-project.md  ->  prompts/new-project.md.template\n')
    expect(read(target, 'prompts/new-project.md.template')).toBe(lines(6, { 5: 'template edit' }))
  })

  it('marks conflicts when both sides changed the same line, and falls back to the plain version without history', () => {
    write(template, 'prompts/new-project.md', lines(4))
    commitTemplate('base')
    apply()
    write(target, 'prompts/new-project.md', lines(4, { 2: 'target edit' }))
    write(template, 'prompts/new-project.md', lines(4, { 2: 'template edit' }))
    commitTemplate('change')
    expect(apply().out).toContain('prompts/new-project.md.template (1 conflict(s) marked)')
    const proposal = read(target, 'prompts/new-project.md.template')
    expect(proposal).toMatch(/^<{7} your copy\n/m)
    expect(proposal).toMatch(/^\|{7} template, last offered\n/m)
    expect(proposal).toMatch(/^>{7} template, now\n/m)
    // Without the offered version in history (an archive checkout), the new version is parked as is.
    rmSync(join(target, 'prompts/new-project.md.template'))
    rmSync(join(template, '.git'), { recursive: true, force: true })
    write(template, 'prompts/new-project.md', lines(4, { 2: 'template edit 2' }))
    expect(apply().out).toContain('~ prompts/new-project.md  ->  prompts/new-project.md.template\n')
    expect(read(target, 'prompts/new-project.md.template')).toBe(lines(4, { 2: 'template edit 2' }))
  })
})

describe('process:apply: --check', () => {
  const check = () => apply('--check')

  it('is current right after an apply, and drifts when the template moves on', () => {
    expect(check()).toMatchObject({ status: 1, out: expect.stringContaining('Not delivered') })
    apply()
    expect(check()).toMatchObject({ status: 0, out: expect.stringContaining('✓ Current with this template.') })
    write(template, 'prompts/review.md', 'a newer review prompt\n')
    const drifted = check()
    expect(drifted.status).toBe(1)
    expect(drifted.out).toContain('↑ prompts/review.md (update)')
    expect(read(target, 'prompts/review.md')).not.toBe('a newer review prompt\n') // --check writes nothing
  })

  it('says when the target was applied from a commit this template checkout lacks', () => {
    const gitTemplate = fixtureGit(() => template)
    gitTemplate('init', '-q')
    gitTemplate('add', '-A')
    gitTemplate('commit', '-q', '--no-verify', '-m', 'template')
    apply()
    expect(check().out).not.toContain("isn't in this template checkout's history")
    const manifest = JSON.parse(read(target, 'prompts/.apply-manifest.json'))
    write(target, 'prompts/.apply-manifest.json', JSON.stringify({ ...manifest, templateCommit: 'f'.repeat(40) }))
    expect(check().out).toContain(`! ${'f'.repeat(12)} isn't in this template checkout's history`)
  })

  it("doesn't call a target ahead because the template checkout is shallow", () => {
    const gitTemplate = fixtureGit(() => template)
    gitTemplate('init', '-q')
    gitTemplate('add', '-A')
    gitTemplate('commit', '-q', '--no-verify', '-m', 'older')
    apply() // recorded from the older commit
    write(template, 'prompts/review.md', 'a newer review prompt\n')
    gitTemplate('add', '-A')
    gitTemplate('commit', '-q', '--no-verify', '-m', 'newer')
    const shallow = join(scratch('apply-shallow-'), 'template')
    spawnSync('git', ['clone', '-q', '--depth', '1', `file://${template}`, shallow], { encoding: 'utf8' })
    const result = spawnSync(process.execPath, [join(shallow, 'scripts/apply-process.mjs'), '--target', target, '--check'], { encoding: 'utf8' })
    expect(result.stdout).toContain('↑ prompts/review.md (update)') // positive control: it compared
    expect(result.stdout).not.toContain("isn't in this template checkout's history")
  })

  it('reports a parked .template left behind and a conflict marker in a delivered file', () => {
    apply()
    write(target, 'prompts/review.md.template', 'parked\n')
    write(target, 'prompts/investigate.md', '<<<<<<< your copy\nmine\n=======\ntheirs\n>>>>>>> template, now\n')
    write(template, 'prompts/investigate.md', read(target, 'prompts/investigate.md')) // template-side identical: no change to make
    const { status, out } = check()
    expect(status).toBe(1)
    expect(out).toContain('prompts/review.md.template is still parked')
    expect(out).toContain('prompts/investigate.md holds a merge conflict marker')
  })
})

describe('process:apply: gitignored deliveries', () => {
  it("names delivered files the target's .gitignore covers", () => {
    const gitTarget = fixtureGit(() => target)
    gitTarget('init', '-q')
    write(target, '.gitignore', '.claude/\n')
    const { out } = apply()
    expect(out).toMatch(/The target's \.gitignore covers \d+ delivered file\(s\)/)
    expect(out).toContain('! .claude/skills/')
    // Positive control: an exception clears it.
    write(target, '.gitignore', '.claude/*\n!.claude/skills/\n')
    expect(apply().out).not.toContain(".gitignore covers")
  })

  // A blank line in a CRLF .gitignore is an empty pattern to git, which `check-ignore` matches
  // against a path ending in a slash; the delivered paths and git's listing never take that form.
  it('a CRLF .gitignore with blank lines covers no delivery, and hides no file from the listing', () => {
    fixtureGit(() => target)('init', '-q')
    write(target, '.gitignore', 'node_modules/\r\n\r\ndist/\r\n\r\n')
    write(target, 'docs/notes.md', 'notes\n')
    expect(apply().out).not.toContain('.gitignore covers')
    expect(listRepoFiles(target)).toEqual(expect.arrayContaining(['docs/notes.md', '.claude/skills/verify/SKILL.md']))
    // Positive control: a real pattern in the same CRLF file still covers its deliveries.
    write(target, '.gitignore', 'node_modules/\r\n\r\n.claude/\r\n\r\n')
    expect(apply().out).toContain('.gitignore covers')
  })

  it('offers a force-add for a target whose .gitignore is not to be edited', () => {
    fixtureGit(() => target)('init', '-q')
    write(target, '.gitignore', '.claude/\n')
    expect(apply().out).toContain('force-add them (`git add -f <path>`)')
  })

  // An existing-repo trial: .claude/ was ignored, the delivery commit left the skills out, and
  // --check called a fresh clone of it current, reading the missing files as deleted on purpose.
  it('--check reports delivered files that are ignored and never committed, in the clone too', () => {
    const gitTarget = fixtureGit(() => target)
    gitTarget('init', '-q')
    write(target, '.gitignore', '.claude/\n')
    apply()
    gitTarget('add', '-A')
    gitTarget('commit', '-q', '--no-verify', '-m', 'delivery')
    const clone = join(scratch('apply-clone-'), 'clone')
    spawnSync('git', ['clone', '-q', target, clone], { encoding: 'utf8' })
    expect(existsSync(join(clone, '.claude/skills'))).toBe(false)
    expect(existsSync(join(clone, 'prompts/.apply-manifest.json'))).toBe(true) // positive control: it is a delivered clone
    const checkAt = (dir: string) => {
      const result = spawnSync(process.execPath, [join(template, 'scripts/apply-process.mjs'), '--target', dir, '--check'], { encoding: 'utf8' })
      return { status: result.status, out: result.stdout + result.stderr }
    }
    for (const dir of [target, clone]) {
      const { status, out } = checkAt(dir)
      expect(status, dir).toBe(1)
      expect(out).toMatch(/! \d+ delivered file\(s\) are ignored by the target's \.gitignore and not committed/)
      expect(out).toContain('    .claude/skills/')
      // A re-apply doesn't commit anything: the remedy is the commit, not "merge what it parks".
      expect(out).toContain('✗ Drifted: commit the ignored delivered files (above).')
      expect(out).not.toContain('merge what it parks')
    }
    // Force-added and committed, they're tracked, so the clone has them and --check is current.
    gitTarget('add', '-f', '.claude/skills')
    gitTarget('commit', '-q', '--no-verify', '-m', 'skills')
    expect(checkAt(target)).toMatchObject({ status: 0, out: expect.stringContaining('✓ Current with this template.') })
    const clone2 = join(scratch('apply-clone-'), 'clone')
    spawnSync('git', ['clone', '-q', target, clone2], { encoding: 'utf8' })
    expect(checkAt(clone2)).toMatchObject({ status: 0, out: expect.stringContaining('✓ Current with this template.') })
  })

  it('names the manifest too: without it, every clone reads as never delivered', () => {
    fixtureGit(() => target)('init', '-q')
    write(target, '.gitignore', '*.json\n')
    expect(apply().out).toContain('! prompts/.apply-manifest.json')
  })
})

// Skill copies follow the target's .agents/platforms.json (ADR 0020's addendum): each platform
// reads skills from one home, so a project that runs only Codex gets no .claude/skills/. Nothing
// already delivered is ever removed for falling outside the selection.
describe('process:apply: the platform selection', () => {
  const select = (selection: unknown) => write(target, '.agents/platforms.json', typeof selection === 'string' ? selection : JSON.stringify(selection))
  const manifest = () => JSON.parse(read(target, 'prompts/.apply-manifest.json')).files as Record<string, string>
  const homesIn = (files: Record<string, string>) => [...new Set(Object.keys(files).filter((f) => /skills\//.test(f)).map((f) => f.split('/').slice(0, 2).join('/')))].sort()
  const SKILL = '.claude/skills/verify/SKILL.md'

  it('delivers only the skill home the selected platforms read, and says so', () => {
    select({ platforms: ['codex'] })
    const { status, out } = apply()
    expect(status).toBe(0)
    expect(existsSync(join(target, '.agents/skills/verify/SKILL.md'))).toBe(true)
    expect(existsSync(join(target, '.claude'))).toBe(false)
    expect(homesIn(manifest())).toEqual(['.agents/skills'])
    expect(out).toContain('Skills delivered for the platforms .agents/platforms.json selects (Codex): .agents/skills/.')
    expect(out).toMatch(/keep it off prompts\/ and \.agents\/skills\/\n\s+\(for Prettier, those two lines in \.prettierignore\)/)
  })

  it('delivers .claude/skills/ alone for Claude Code alone, and both homes for both', () => {
    select({ platforms: ['claude-code'] })
    apply()
    expect(homesIn(manifest())).toEqual(['.claude/skills'])
    expect(existsSync(join(target, '.agents/skills'))).toBe(false)
    select({ platforms: ['claude-code', 'cursor'] })
    apply()
    expect(homesIn(manifest())).toEqual(['.agents/skills', '.claude/skills'])
  })

  it('with no selection, delivers every home, as before (positive control)', () => {
    const { out } = apply()
    expect(homesIn(manifest())).toEqual(['.agents/skills', '.claude/skills'])
    expect(out).not.toContain('Skills delivered for the platforms')
    expect(out).toMatch(/keep it off prompts\/, \.agents\/skills\/, and \.claude\/skills\/\n\s+\(for Prettier, those three lines/)
  })

  it('never removes or updates what an earlier apply put in a home the selection drops, and reports it', () => {
    apply() // no selection: both homes
    write(target, '.claude/skills/pre-pr/SKILL.md', `${read(target, '.claude/skills/pre-pr/SKILL.md')}\nA local note.\n`)
    const before = read(target, SKILL)
    select({ platforms: ['codex'] })
    write(template, SKILL, `${before}\nA template change.\n`)
    const { status, out } = apply()
    expect(status).toBe(0)
    expect(out).toContain('Left as it is, and no longer updated: delivered by an earlier apply to a skill home no platform in .agents/platforms.json reads')
    expect(out).toContain(`- ${SKILL}`)
    expect(read(target, SKILL)).toBe(before) // not updated
    expect(read(target, '.claude/skills/pre-pr/SKILL.md')).toContain('A local note.') // not removed, edited or not
    expect(existsSync(join(target, `${SKILL}.template`))).toBe(false)
    expect(homesIn(manifest())).toEqual(['.agents/skills', '.claude/skills']) // still recorded
    // --check: a note, not drift.
    const check = apply('--check')
    expect(check.out).toContain("in a skill home no platform in .agents/platforms.json reads; left as they are, and no longer updated")
    expect(check.status).toBe(0)
    // Selecting Claude Code again picks up from what was delivered: the untouched copy updates.
    select({ platforms: ['codex', 'claude-code'] })
    const again = apply()
    expect(again.out).toContain(`↑ ${SKILL}`)
    expect(read(target, SKILL)).toContain('A template change.')
  })

  it("leaves a home's files alone when the target deleted them, and forgets them", () => {
    apply()
    rmSync(join(target, '.claude'), { recursive: true })
    select({ platforms: ['codex'] })
    const { out } = apply()
    expect(out).not.toContain('Left as it is')
    expect(homesIn(manifest())).toEqual(['.agents/skills'])
  })

  it('names a selected platform whose skills live where process:apply does not deliver', () => {
    select({
      platforms: ['codex'],
      custom: [{ name: 'Example Agent', files: ['AGENTS.md'], agentsMd: 'native', hardBytes: null, skills: '.example/skills', sources: [{ url: 'https://example.com/docs', checked: '2026-10-14' }] }],
    })
    const { out } = apply()
    expect(out).toContain("! Example Agent reads skills from .example/skills/, where process:apply doesn't deliver")
    expect(homesIn(manifest())).toEqual(['.agents/skills'])
  })

  it('delivers no skills for a selection that reads none of the homes', () => {
    select({ custom: [{ name: 'Example Agent', files: ['AGENTS.md'], agentsMd: 'native', hardBytes: null, skills: null, sources: [{ url: 'https://example.com/docs', checked: '2026-10-14' }] }] })
    const { status, out } = apply()
    expect(status).toBe(0)
    expect(homesIn(manifest())).toEqual([])
    expect(out).toContain('Skills delivered for the platforms .agents/platforms.json selects (Example Agent): no skill home')
    expect(existsSync(join(target, 'prompts/new-project.md'))).toBe(true)
  })

  it.each([
    ['JSON that does not parse', '{"platforms": ['],
    ['a selection of nothing it knows', { platforms: ['windsurf'] }],
  ])('with %s, delivers every home and says why', (_label, selection) => {
    select(selection)
    const { status, out } = apply()
    expect(status).toBe(0)
    expect(homesIn(manifest())).toEqual(['.agents/skills', '.claude/skills'])
    expect(out).toMatch(/! \.agents\/platforms\.json .*, so the skills go to every home, as with no selection\./)
  })
})

describe('process:apply: refusals', () => {
  it('--list writes nothing', () => {
    const { status, out } = apply('--list')
    expect(status).toBe(0)
    expect(out).toContain('Would copy')
    expect(existsSync(join(target, 'prompts'))).toBe(false)
  })

  it.each([
    ['not JSON', '{ not json'],
    ['null files', '{"files": null}'],
    ['an array of files', '{"files": []}'],
    ['a non-hash value', '{"files": {"prompts/README.md": 42}}'],
    ['packs that are not a list of names', '{"files": {}, "packs": "node"}'],
    ['a pack that is a path', '{"files": {}, "packs": ["../../elsewhere"]}'],
    ['a key that climbs out of the target', `{"files": {"prompts/../../victim.txt": "${'0'.repeat(64)}"}}`],
    ['an absolute key', `{"files": {"/etc/victim.txt": "${'0'.repeat(64)}"}}`],
    ['a template commit that is not a string', '{"files": {}, "templateCommit": 42}'],
    ['a key outside the delivery paths', `{"files": {"src/main.ts": "${'0'.repeat(64)}"}}`],
  ])('refuses a manifest that is %s, instead of guessing', (_label, content) => {
    write(target, 'prompts/.apply-manifest.json', content)
    const { status, out } = apply()
    expect(out).toContain('unreadable or malformed')
    expect(out).not.toContain('TypeError')
    expect(status).toBe(1)
  })

  it('never writes or deletes outside the target, whatever the manifest says', () => {
    const outside = scratch('apply-outside-')
    write(outside, 'sub/victim.txt', 'keep me\n')
    const digest = createHash('sha256').update('keep me\n').digest('hex')
    const rel = join('..', basename(outside), 'sub/victim.txt').split('\\').join('/')
    write(target, 'prompts/.apply-manifest.json', JSON.stringify({ files: { [`prompts/${rel}`]: digest, [rel]: digest } }))
    const { status, out } = apply()
    expect(status).toBe(1)
    expect(out).toContain('unreadable or malformed')
    expect(read(outside, 'sub/victim.txt')).toBe('keep me\n')
  })

  it('never writes or removes through a symlink that leads out of the target', () => {
    const outside = scratch('apply-outside-')
    write(outside, 'victim.txt', 'keep me\n')
    apply()
    symlinkSync(outside, join(target, 'prompts/old'), 'dir')
    const manifest = JSON.parse(read(target, 'prompts/.apply-manifest.json'))
    manifest.files['prompts/old/victim.txt'] = createHash('sha256').update('keep me\n').digest('hex')
    write(target, 'prompts/.apply-manifest.json', JSON.stringify(manifest))
    const { out } = apply()
    expect(out).toContain('Skipped: the path leads out of the target through a symlink')
    expect(read(outside, 'victim.txt')).toBe('keep me\n')
    expect(apply('--check')).toMatchObject({ status: 1, out: expect.stringContaining('prompts/old/victim.txt leads out of the target') })
    // Nor through a link at the file itself, dangling or not, or at its parked .template.
    rmSync(join(target, 'prompts/old'))
    write(outside, 'shared.md', 'shared\n')
    rmSync(join(target, 'prompts/review.md'))
    symlinkSync(join(outside, 'stolen.md'), join(target, 'prompts/review.md')) // dangling
    rmSync(join(target, 'prompts/pre-pr.md'))
    symlinkSync(join(outside, 'shared.md'), join(target, 'prompts/pre-pr.md'))
    write(target, 'prompts/investigate.md', 'the target edited this\n')
    symlinkSync(join(outside, 'parked.md'), join(target, 'prompts/investigate.md.template'))
    write(template, 'prompts/investigate.md', 'a newer investigate prompt\n')
    write(template, 'prompts/pre-pr.md', 'a newer pre-pr prompt\n')
    apply()
    expect(readdirSync(outside).sort()).toEqual(['shared.md', 'victim.txt'])
    expect(existsSync(join(outside, 'stolen.md'))).toBe(false)
    expect(existsSync(join(outside, 'parked.md'))).toBe(false)
    expect(read(outside, 'shared.md')).toBe('shared\n')
    // And a delivery directory that is itself a link out gets nothing written into it.
    const fresh = scratch('apply-target-')
    const elsewhere = scratch('apply-elsewhere-')
    mkdirSync(join(fresh, '.claude'))
    symlinkSync(elsewhere, join(fresh, '.claude/skills'), 'dir')
    spawnSync(process.execPath, [join(template, 'scripts/apply-process.mjs'), '--target', fresh], { encoding: 'utf8' })
    expect(readdirSync(elsewhere)).toEqual([])
    // prompts/ itself, where the manifest lives: refused before anything is read or written.
    const linked = scratch('apply-target-')
    const shared = scratch('apply-shared-')
    symlinkSync(shared, join(linked, 'prompts'), 'dir')
    const refused = spawnSync(process.execPath, [join(template, 'scripts/apply-process.mjs'), '--target', linked], { encoding: 'utf8' })
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain('leads out of the target through a symlink')
    expect(readdirSync(shared)).toEqual([])
  })

  it('drift, which the fleet report calls, refuses a manifest reached through a symlink too', () => {
    symlinkSync(scratch('apply-shared-'), join(target, 'prompts'), 'dir')
    expect(() => drift(target)).toThrow(ManifestError)
  })

  it("never lets the manifest's template commit reach git as an option", () => {
    const gitTemplate = fixtureGit(() => template)
    gitTemplate('init', '-q')
    gitTemplate('add', '-A')
    gitTemplate('commit', '-q', '--no-verify', '-m', 'template')
    apply()
    const outside = scratch('apply-outside-')
    mkdirSync(join(outside, 'x:prompts'))
    const manifest = JSON.parse(read(target, 'prompts/.apply-manifest.json'))
    write(target, 'prompts/.apply-manifest.json', JSON.stringify({ ...manifest, templateCommit: `--output=${outside}/x` }))
    write(target, 'prompts/review.md', 'the target edited this\n')
    write(template, 'prompts/review.md', 'a newer review prompt\n')
    expect(apply().out).toContain('prompts/review.md.template') // parked, as the plain new version
    expect(readdirSync(join(outside, 'x:prompts'))).toEqual([])
  })

  it("refuses to drop core, which is always delivered", () => {
    const { status, out } = apply('--drop-pack', 'core')
    expect(status).toBe(2)
    expect(out).toContain("core is always delivered")
  })

  it('rejects a missing target, the template itself, a path inside it, and unknown arguments', () => {
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [join(template, 'scripts/apply-process.mjs'), ...args], { encoding: 'utf8' }).status
    expect(run('--target', join(target, 'nope'))).toBe(1)
    expect(run('--target', template)).toBe(1)
    expect(run('--target', join(template, 'prompts'))).toBe(1)
    expect(run('--target', target, '--mode', 'new')).toBe(2)
    expect(run()).toBe(1)
  })
})
