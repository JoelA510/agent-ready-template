import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { parseSkill } from '../skills.mjs'

// The skill evals (evals/, run by `claude plugin eval`) cost money, so nothing runs them per pull
// request; this keeps the suite whole for when someone does: every skill a model can start has a
// routing case, and every case loads.
const REPO = resolve(__dirname, '../..')
const EVALS = join(REPO, 'evals')
const manifest = JSON.parse(readFileSync(join(REPO, '.claude-plugin/plugin.json'), 'utf8'))

const frontmatter = (file: string) => {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(file, 'utf8'))
  if (!match) throw new Error(`${file} has no frontmatter`)
  return parse(match[1]) as Record<string, unknown>
}
const skills = readdirSync(join(REPO, '.agents/skills')).map((dir) => {
  const { name, metadata, problems } = parseSkill(readFileSync(join(REPO, '.agents/skills', dir, 'SKILL.md'), 'utf8'), dir)
  expect(problems, dir).toEqual([])
  return { name, explicit: metadata.invocation === 'explicit' }
})
// A case is a directory with a prompt.md, below a group directory that isn't one.
const cases = ['routing', 'behavior'].flatMap((group) =>
  readdirSync(join(EVALS, group)).map((name) => ({ group, name, dir: join(EVALS, group, name) })),
)
const graders = (dir: string): Array<Record<string, unknown> & { file: string }> =>
  readdirSync(join(dir, 'graders')).map((f) => ({ ...frontmatter(join(dir, 'graders', f)), file: f }))

describe('the skill evals', () => {
  it('load the generated skill copies as one plugin', () => {
    expect(manifest.skills).toEqual(['./.claude/skills/'])
    expect(skills.length).toBeGreaterThan(5) // positive control: the skills were found
  })

  it('have a routing case for every skill a model can start, and none for one it can\'t', () => {
    const routed = cases.filter((c) => c.group === 'routing').map((c) => c.name)
    for (const skill of skills) {
      if (skill.explicit) expect(routed, skill.name).not.toContain(skill.name)
      else expect(routed, `add evals/routing/${skill.name}/ (evals/README.md)`).toContain(skill.name)
    }
  })

  it.each(cases.map((c) => [`${c.group}/${c.name}`, c]))('%s loads: a prompt, graders, and its scaffold', (_, c) => {
    const prompt = frontmatter(join(c.dir, 'prompt.md'))
    expect(prompt.tags).toEqual([c.group])
    expect(prompt.allowed_tools).toEqual(['Read', 'Glob', 'Grep', 'Skill']) // Bash, Write, and Edit need --allow-tools
    const list = graders(c.dir)
    expect(list.length).toBeGreaterThan(0)
    const caseYaml = join(c.dir, 'case.yaml')
    if (c.group === 'behavior') {
      const config = parse(readFileSync(caseYaml, 'utf8'))
      expect(config).toMatchObject({ schema_version: '1.1', name: c.name })
      const script = join(c.dir, config.context.scaffold_script)
      expect(existsSync(script), script).toBe(true)
      if (process.platform !== 'win32') expect(statSync(script).mode & 0o111, `${script} is executable`).not.toBe(0)
    } else {
      expect(existsSync(caseYaml)).toBe(false) // routing cases need no workspace
    }
  })

  it("grade a skill's routing case on that skill, by its namespaced name", () => {
    // Claude Code's bundled skill of the same name (verify) can't pass a grader that names the plugin.
    for (const c of cases.filter((x) => x.group === 'routing' && !x.name.startsWith('no-'))) {
      const list = graders(c.dir)
      expect(list, c.name).toEqual([
        expect.objectContaining({ type: 'tool_used', tool: 'Skill', input_match: `"skill"\\s*:\\s*"${manifest.name}:${c.name}"` }),
      ])
      expect(list[0].min ?? 1, c.name).toBeGreaterThan(0)
    }
  })

  it('grade a no- case only on no skill firing at all', () => {
    const negatives = cases.filter((x) => x.group === 'routing' && x.name.startsWith('no-'))
    expect(negatives.length).toBeGreaterThan(0)
    for (const c of negatives) {
      expect(graders(c.dir), c.name).toEqual([{ file: 'no-skill.md', type: 'tool_used', tool: 'Skill', min: 0, max: 0, arm: 'both' }])
    }
  })

  it("check a behavior case read the prompt its skill runs, since the judge can't see that", () => {
    for (const c of cases.filter((x) => x.group === 'behavior')) {
      // The skill the case starts (/<skill> in its prompt), and the prompt that skill runs.
      const skill = /^\/([a-z-]+)\s/m.exec(readFileSync(join(c.dir, 'prompt.md'), 'utf8'))?.[1] ?? ''
      expect(existsSync(join(REPO, '.agents/skills', skill, 'SKILL.md')), `${c.name} starts a skill (/<skill> in its prompt)`).toBe(true)
      const runs = /`prompts\/([a-z-]+)\.md`/.exec(readFileSync(join(REPO, '.agents/skills', skill, 'SKILL.md'), 'utf8'))?.[1]
      expect(runs, `${c.name} starts ${skill}`).toBeTruthy()
      const reads = graders(c.dir).filter((g) => g.type === 'tool_used' && g.tool === 'Read')
      expect(reads.map((g) => String(g.input_match)), c.name).toEqual([`"file_path"\\s*:\\s*"[^"]*prompts/${runs}\\.md"`])
    }
  })
})
