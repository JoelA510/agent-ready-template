import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, posix, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sources } from '../apply-process.mjs'
import { parseSkill } from '../skills.mjs'
import reserved from './reserved-command-names.json'

// The process layer is prose that points at other prose and at commands. These checks keep
// those pointers true — the kind of drift a reviewer can't see because each file reads fine
// on its own.
const REPO = resolve(__dirname, '../..')
const read = (path: string) => readFileSync(join(REPO, path), 'utf8')

// Tracked markdown only (plus new files in this change), so a scratch note or an agent worktree
// under .claude/ can't fail the gate.
const docs = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.md', '*.mdx'], {
  cwd: REPO,
  encoding: 'utf8',
})
  .split('\n')
  .filter((p) => p && existsSync(join(REPO, p)) && !p.startsWith('.claude/worktrees/'))

// Blocks kept word-for-word identical across files, between `<!-- <name>:start|end -->` markers.
// HTML comments, because Prettier rewrites a `[//]: # (...)` marker and survives these.
function between(path: string, name: string) {
  const text = read(path)
  const start = text.indexOf(`<!-- ${name}:start -->`)
  const end = text.indexOf(`<!-- ${name}:end -->`)
  expect(start, `${path} ${name} start marker`).toBeGreaterThan(-1)
  expect(end, `${path} ${name} end marker`).toBeGreaterThan(start)
  return text.slice(start, end)
}
function outsideMarkers(text: string, name: string) {
  const start = text.indexOf(`<!-- ${name}:start -->`)
  const end = text.indexOf(`<!-- ${name}:end -->`)
  return start === -1 ? text : text.slice(0, start) + text.slice(end)
}

describe.each([
  {
    name: 'definition-of-done',
    copies: ['CONTRIBUTING.md', 'templates/project/CONTRIBUTING.md', 'prompts/new-project.md'],
    instances: [] as string[],
  },
  {
    name: 'operating-rules',
    copies: ['templates/project/AGENTS.skeleton.md', 'prompts/new-project.md'],
    // This repo's own AGENTS.md is an *instance* of these rules, the way a target's AGENTS.md
    // is: placeholders filled, template-specific rules added. It's expected to share wording,
    // and keeping it current is a review item, not a sync.
    instances: ['AGENTS.md'],
  },
])('synced block: $name', ({ name, copies, instances }) => {
  it.each(copies.slice(1))('%s carries it word for word (change every copy together)', (path) => {
    expect(between(path, name)).toBe(between(copies[0], name))
  })

  // A project runs its own formatter over the files it builds from the skeletons; Prettier
  // rewrites `*before*` to `_before_`, and the block no longer matches. (Checked by running
  // Prettier 3 over the skeleton with and without the markers.)
  it.each(copies.filter((path) => path.startsWith('templates/project/')))('%s keeps Prettier out of it', (path) => {
    const text = read(path)
    expect(text).toContain(`<!-- prettier-ignore-start -->\n<!-- ${name}:start -->`)
    expect(text).toContain(`<!-- ${name}:end -->\n<!-- prettier-ignore-end -->`)
  })

  it('has no unmarked copy anywhere in the docs', () => {
    // A signature is an item's bold heading plus the first words after it, taken from the
    // canonical block itself, so rewording an item can't switch this check off (positive
    // control: the signatures must come out of the block). A deliberate variant with the same
    // heading and different wording (this repo's own AGENTS.md) or a one-line summary isn't a
    // copy; a pasted item is.
    const signatures = [...between(copies[0], name).matchAll(/^\s*(?:-|\d+\.) (\*\*[^*]+\*\*[^\S\n]*(?:\S+\s+){3}\S+)/gm)].map(
      ([, sig]) => sig.replace(/\s+/g, ' '),
    )
    expect(signatures.length).toBeGreaterThan(5)
    const outside = docs.filter((path) => !instances.includes(path)).flatMap((path) => {
      const text = outsideMarkers(read(path), name).replace(/\s+/g, ' ')
      return signatures.filter((sig) => text.includes(sig)).map((sig) => `${path}: ${sig}`)
    })
    expect(outside).toEqual([])
  })
})

describe('workflow skills', () => {
  // Names Claude Code or a widely installed skill pack would shadow; sourced and dated in the file.
  const RESERVED = { 'Claude Code': reserved.claudeCode, gstack: reserved.gstack }
  const skills = docs.filter((p) => /^\.agents\/skills\/[^/]+\/SKILL\.md$/.test(p))
  const dirOf = (path: string) => path.split('/')[2]

  it('finds the skills (positive control)', () => {
    expect(skills.length).toBeGreaterThanOrEqual(5)
  })

  it.each(skills)('%s follows the Agent Skills spec, says when to use it, and what it takes', (path) => {
    const skill = parseSkill(read(path), dirOf(path))
    expect(skill.problems).toEqual([])
    expect(skill.description).toMatch(/^Use when \S/)
    expect(skill.metadata['argument-hint']).toMatch(/\S/)
  })

  it.each(skills)('%s passes its inputs in words any agent can follow, not $ARGUMENTS', (path) => {
    expect(read(path)).not.toContain('$ARGUMENTS')
  })

  it.each(skills)('%s names only prompts that exist', (path) => {
    for (const [, prompt] of read(path).matchAll(/prompts\/([\w-]+\.md)/g)) {
      expect(existsSync(join(REPO, 'prompts', prompt)), prompt).toBe(true)
    }
  })

  it.each(skills)('%s has a Claude Code copy', (path) => {
    expect(existsSync(join(REPO, '.claude/skills', dirOf(path), 'SKILL.md'))).toBe(true)
  })

  // Taken on purpose: a project skill replaces a bundled one of its name, and Claude Code runs a
  // project skill named verify before each commit (code.claude.com/docs/en/skills.md, "Run your
  // checks before each commit", v2.1.286+, read 2026-10-07).
  const REPLACES_BUNDLED = ['verify']

  it.each(skills)('%s is not shadowed by a built-in or a widely installed skill', (path) => {
    const name = dirOf(path)
    for (const [owner, { names }] of Object.entries(RESERVED)) {
      expect(names.length, `${owner} list (positive control)`).toBeGreaterThan(10)
      if (owner === 'Claude Code' && REPLACES_BUNDLED.includes(name)) continue
      expect(names, `/${name} is taken by ${owner}`).not.toContain(name)
    }
  })

  it.each(REPLACES_BUNDLED)('%s still replaces a bundled skill, so the exception is still needed', (name) => {
    expect(RESERVED['Claude Code'].names).toContain(name)
    expect(skills).toContain(`.agents/skills/${name}/SKILL.md`)
  })
})

describe('commands named in the docs', () => {
  const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>

  it('every `npm run <script>` refers to a script in package.json', () => {
    const missing = docs
      .filter((path) => !path.startsWith('templates/project/')) // target-side placeholders
      .flatMap((path) =>
        [...read(path).matchAll(/npm run ([\w:-]+)/g)]
          .filter(([, name]) => !(name in scripts))
          .map(([, name]) => `${path}: npm run ${name}`),
      )
    expect(missing).toEqual([])
  })

  it('every `(skeleton: <path>)` a prompt names is a skeleton that exists', () => {
    const refs = docs.filter((path) => path.startsWith('prompts/') || path.startsWith('.agents/skills/')).flatMap((path) =>
      [...read(path).matchAll(/skeleton:\s+([\w./-]+[\w/])/g)].map(([, ref]) => ({ path, ref })),
    )
    expect(refs.length).toBeGreaterThan(10) // positive control: the pattern still matches
    const missing = refs.filter(({ ref }) => !existsSync(join(REPO, 'templates/project', ref)))
    expect(missing).toEqual([])
  })

  it('the Storybook copy of the PR checklist runs the full gate', () => {
    const text = read('docs/system/contributing.mdx')
    expect(text).toContain('npm run check')
    expect(text).not.toMatch(/run all four/i)
  })
})

describe('phase references', () => {
  const PROMPTS = {
    'new-project': 'prompts/new-project.md',
    'existing-project': 'prompts/existing-project.md',
    investigate: 'prompts/investigate.md',
  }
  // Phase N -> number of top-level numbered items in that phase ("Phase 2.5" is item 5 of Phase 2).
  const phasesOf = (path: string) => {
    const phases = new Map<string, number>()
    const text = read(path)
    const heads = [...text.matchAll(/^## Phase (\d+)/gm)]
    heads.forEach((h, i) => {
      const body = text.slice(h.index, heads[i + 1]?.index ?? text.length)
      phases.set(h[1], [...body.matchAll(/^\d+\. /gm)].length)
    })
    return phases
  }
  const defined = Object.fromEntries(Object.entries(PROMPTS).map(([k, p]) => [k, phasesOf(p)]))
  // "new-project's Phase 2", "the investigate prompt's Phase 0", "investigate.md's Phase 1".
  const CITATION = new RegExp(`(${Object.keys(PROMPTS).join('|')})?(?:\\.md)?(?: prompt)?[’' ]{0,2}(?:s )?Phase (\\d+)(?:\\.(\\d+))?`, 'gi')
  // An unnamed citation refers to the file's own prompt: the prompt itself, or the one a skill
  // runs.
  const ownPrompt = (path: string, text: string) =>
    Object.entries(PROMPTS).find(([, p]) => p === path)?.[0] ??
    (/^\.(agents|claude)\/skills\//.test(path) ? Object.entries(PROMPTS).find(([, p]) => text.includes(p))?.[0] : undefined)
  const exists = (prompt: string, phase: string, item?: string) => {
    const items = defined[prompt]?.get(phase)
    return items !== undefined && (item === undefined || Number(item) <= items)
  }

  it('every prompt defines phases (positive control)', () => {
    for (const [name, phases] of Object.entries(defined)) expect(phases.size, name).toBeGreaterThan(2)
  })

  it('every "Phase N" or "Phase N.M" cited anywhere exists in the prompt it names', () => {
    const broken: string[] = []
    for (const path of docs) {
      if (path === 'CHANGELOG.md') continue // history quotes old text on purpose
      const text = read(path)
      const own = ownPrompt(path, text)
      for (const m of text.matchAll(CITATION)) {
        const [, named, phase, item] = m
        const inPrompt = named?.toLowerCase() ?? own
        const ok = inPrompt ? exists(inPrompt, phase, item) : Object.keys(PROMPTS).some((p) => exists(p, phase, item))
        if (!ok) broken.push(`${path}: ${m[0].trim()}`)
      }
    }
    expect(broken).toEqual([])
  })
})

describe('relative links', () => {
  // Code (fenced blocks and inline spans) can contain `](`, e.g. a regex; it isn't a link.
  const stripCode = (text: string) => text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
  const links = (text: string) =>
    [...stripCode(text).matchAll(/\]\(([^)\s]+)\)/g)]
      .map(([, href]) => href.split('#')[0])
      .filter((href) => href && !/^[a-z]+:/i.test(href))

  it('resolve in this repo', () => {
    const broken = docs.flatMap((path) =>
      links(read(path))
        .filter((href) => !existsSync(resolve(REPO, dirname(path), href)))
        .map((href) => `${path} -> ${href}`),
    )
    expect(broken).toEqual([])
  })

  it('name a heading or an id in the page they point to, when they carry an anchor', () => {
    // GitHub's slugs (github-slugger): the heading's text, lowercased, punctuation dropped, each
    // space a hyphen, and -1, -2 on repeats. Headings in fenced code don't count.
    const slug = (heading: string) =>
      heading
        .replace(/`([^`]*)`/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]+>/g, '')
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .replace(/\s/g, '-')
    const anchors = (text: string) => {
      const seen = new Map<string, number>()
      const out = new Set<string>()
      for (const [, heading] of text.replace(/```[\s\S]*?```/g, '').matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
        const base = slug(heading)
        const n = seen.get(base) ?? 0
        seen.set(base, n + 1)
        out.add(n ? `${base}-${n}` : base)
      }
      for (const [, id] of text.matchAll(/\s(?:id|name)="([^"]+)"/g)) out.add(id)
      return out
    }
    const anchored = docs.flatMap((path) =>
      [...stripCode(read(path)).matchAll(/\]\(([^)\s]*#[^)\s]+)\)/g)]
        .map(([, href]) => href)
        .filter((href) => !/^[a-z]+:/i.test(href))
        .map((href) => {
          const [file, fragment] = href.split('#')
          return { path, href, target: file ? join(dirname(path), file) : path, fragment: decodeURIComponent(fragment) }
        })
        .filter(({ target }) => /\.mdx?$/.test(target)),
    )
    expect(anchored.length).toBeGreaterThan(0) // positive control: there are anchors to check
    const broken = anchored.filter(({ target, fragment }) => !anchors(read(target)).has(fragment)).map(({ path, href }) => `${path} -> ${href}`)
    expect(broken).toEqual([])
  })

  it('resolve in a target too, for every file process:apply delivers', () => {
    // The real delivery list, from the script itself, so a layout change can't leave this
    // checking a stale mapping.
    const delivered = sources()
    const paths = new Set(delivered.map((d) => d.dest))
    expect(paths.size).toBeGreaterThan(10)
    const broken = delivered
      .filter((d) => /\.mdx?$/.test(d.dest))
      .flatMap((d) =>
        links(d.content)
          .map((href) => ({ href, resolved: posix.normalize(posix.join(posix.dirname(d.dest), href)).replace(/\/$/, '') }))
          .filter(({ resolved }) => !paths.has(resolved) && ![...paths].some((p) => p.startsWith(`${resolved}/`)))
          .map(({ href }) => `${d.dest} -> ${href}`),
      )
    expect(broken).toEqual([])
  })
})

describe('verification labels', () => {
  it('the skeletons and prompts use the one three-level vocabulary', () => {
    for (const path of [
      'templates/project/docs/audit.md',
      'templates/project/docs/remediation-plan.md',
      'prompts/existing-project.md',
      'prompts/investigate.md',
      'prompts/review.md',
      'prompts/pre-pr.md',
    ]) {
      const text = read(path)
      for (const label of ['statically reviewed', 'executed', 'fully validated']) expect(text, `${path}: ${label}`).toContain(label)
      expect(text, path).not.toMatch(/\*verified\*|\*provisional\*|verified\|provisional/)
    }
  })
})
