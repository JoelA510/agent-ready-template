import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findInstructionFiles } from '../check-instructions.mjs'

const REPO = resolve(__dirname, '../..')
const SCRIPT = join(REPO, 'scripts/check-instructions.mjs')

let root: string
const write = (path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}
const run = (...args: string[]) =>
  spawnSync(process.execPath, [SCRIPT, '--root', root, ...args], { encoding: 'utf8' })
const findings = () => run().stdout.split('\n').filter((l) => /^\S+:\d+: [\w-]+: /.test(l))

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'check-instructions-'))
  execFileSync('git', ['init', '-q'], { cwd: root })
  write('package.json', JSON.stringify({ scripts: { test: 'vitest', 'check:all': 'x' } }))
  write('src/db/schema.ts', '')
  write('frontend/src/styles/chrome.css', '')
  write('docs/adr/0001-stack.md', '')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('this repo', () => {
  it('its own instruction files pass, and the check examined something (positive control)', () => {
    const result = spawnSync(process.execPath, [SCRIPT], { cwd: REPO, encoding: 'utf8' })
    expect(result.stdout + result.stderr).toMatch(/Checked [1-9]\d* file\(s\): \d+ link\(s\), \d+ import\(s\), [1-9]\d* path\(s\), [1-9]\d* script/)
    expect(result.status).toBe(0)
  })

  it("its AGENTS.md is sized for its own selection: Codex's 32 KiB binds, Claude Code's 200 lines advise", () => {
    expect(JSON.parse(readFileSync(join(REPO, '.agents/platforms.json'), 'utf8'))).toEqual({ platforms: ['claude-code', 'codex'] })
    const result = spawnSync(process.execPath, [SCRIPT], { cwd: REPO, encoding: 'utf8' })
    expect(result.stderr).not.toContain('no .agents/platforms.json')
    expect(Buffer.byteLength(readFileSync(join(REPO, 'AGENTS.md')))).toBeLessThanOrEqual(32 * 1024)
  })
})

describe('finds', () => {
  it.each([
    ['a link to a missing file', '[stack](docs/adr/0002-missing.md)', 'link'],
    ['an import of a missing file', '@docs/rules.md', 'import'],
    ['an import of a missing AGENTS.md', '@AGENTS.md', 'import'],
    ['a code-span path under a renamed directory', 'Components live in `web/src/components/`.', 'path'],
    ['a code-span file that was deleted', 'Schema: `src/db/tables.ts`.', 'path'],
    ['a glob whose directory is gone', 'Tokens: `tokens/**/*.json`.', 'path'],
    ['an npm script that no longer exists', 'Run `npm run lint` first.', 'script'],
    ['a pnpm script that no longer exists', 'pnpm run typecheck', 'script'],
    ['a missing file under a capitalized directory', 'Licenses: `LICENSES/CC-BY-4.0.txt`.', 'path'],
    ['a missing file named in Roman numerals', 'Read `docs/part-II.md`.', 'path'],
    ['a missing file whose version has an underscore', 'See `src/v1.2_migration`.', 'path'],
  ])('%s', (_label, line, kind) => {
    write('CLAUDE.md', `# Rules\n\n${line}\n`)
    const found = findings()
    expect(found).toHaveLength(1)
    expect(found[0]).toMatch(new RegExp(`^CLAUDE\\.md:3: ${kind}: `))
    expect(run().status).toBe(1)
  })

  it.each([
    ['a right-to-left override', 0x202e],
    ['a zero-width space', 0x200b],
    ['a zero-width joiner', 0x200d],
    ['a Unicode tag character (invisible text a model still reads)', 0xe0041],
    ['a BOM past the start of the file', 0xfeff],
    ['an escape character', 0x1b],
    ['a C1 control character', 0x85],
  ])('%s', (_label, code) => {
    write('AGENTS.md', `# Rules\n\nAlways run tests.${String.fromCodePoint(code)} Never skip them.\n`)
    const found = findings()
    expect(found).toHaveLength(1)
    expect(found[0]).toMatch(new RegExp(`^AGENTS\\.md:3: hidden: U\\+${code.toString(16).toUpperCase().padStart(4, '0')} `))
  })

  it('a missing dotfile with an underscore, in a directory that exists', () => {
    write('config/app.json', '{}\n')
    write('CLAUDE.md', 'Copy `config/.env_local` first.\n')
    expect(findings()).toEqual(["CLAUDE.md:1: path: config/.env_local doesn't exist"])
  })

  it('a missing script inside a fenced command list (the usual way to document commands)', () => {
    write('CLAUDE.md', '```bash\nnpm run test\nnpm run gone\n```\n')
    expect(findings()).toEqual(['CLAUDE.md:3: script: npm run gone isn\'t a script in package.json'])
  })

  it.each([
    ['after a sentence', 'Then npm run nope.', 'nope'],
    ['after a flag', 'npm run --silent nope', 'nope'],
    ['in brackets', '[Result of npm run nope]', 'nope'],
    ['that only exists on Object.prototype', 'npm run constructor', 'constructor'],
  ])('a missing script named %s', (_label, line, name) => {
    write('CLAUDE.md', `${line}\n`)
    expect(findings()).toEqual([`CLAUDE.md:1: script: npm run ${name} isn't a script in package.json`])
  })

  it("a nested file's script against its own package.json", () => {
    write('packages/api/package.json', JSON.stringify({ scripts: { migrate: 'x' } }))
    write('packages/api/AGENTS.md', 'npm run migrate\nnpm run seed\n')
    expect(findings()).toEqual(["packages/api/AGENTS.md:2: script: npm run seed isn't a script in packages/api/package.json"])
  })

  it('a lone carriage return inside a line', () => {
    write('CLAUDE.md', `# Rules\n\nRun tests.${String.fromCodePoint(0x0d)}Now.\n`)
    expect(findings()).toEqual(['CLAUDE.md:3: hidden: U+000D at column 11'])
  })

  it.each([
    ['a variation selector after ASCII', 0xfe0f],
    ['a variation selector from the supplement after ASCII', 0xe0101],
    ['an Arabic letter mark', 0x061c],
    ['a soft hyphen', 0x00ad],
    ['a line separator', 0x2028],
    ['a Mongolian vowel separator', 0x180e],
    ['a Hangul filler', 0x3164],
    ['an interlinear annotation anchor', 0xfff9],
  ])('%s', (_label, code) => {
    write('CLAUDE.md', `abc${String.fromCodePoint(code)}def\n`)
    expect(findings()).toEqual([`CLAUDE.md:1: hidden: U+${code.toString(16).toUpperCase().padStart(4, '0')} at column 4`])
  })

  it('a run of variation selectors after an emoji (the smuggling encoding), past the first', () => {
    const vs = (n: number) => String.fromCodePoint(0xe0100 + n)
    write('CLAUDE.md', `${String.fromCodePoint(0x1f600)}${vs(1)}${vs(2)}${vs(3)}\n`)
    expect(findings()).toHaveLength(2)
  })

  it('a zero-width joiner between ASCII letters', () => {
    write('CLAUDE.md', `ig${String.fromCodePoint(0x200d)}nore\n`)
    expect(findings()).toEqual(['CLAUDE.md:1: hidden: U+200D at column 3'])
  })

  it('a link with a title whose target is gone', () => {
    write('CLAUDE.md', '[ADR](docs/adr/0009-gone.md "the old one")\n')
    expect(findings()).toEqual(['CLAUDE.md:1: link: docs/adr/0009-gone.md doesn\'t exist'])
  })

  it('a link with a stray % whose target is gone, without crashing', () => {
    write('CLAUDE.md', '[progress](docs/100%-done.md)\n')
    const result = run()
    expect(result.stderr).not.toContain('URIError')
    expect(findings()).toEqual(['CLAUDE.md:1: link: docs/100%-done.md doesn\'t exist'])
  })

  it.each([
    ['a CLAUDE.md that never imports AGENTS.md', 'CLAUDE.md', '# Claude notes\n'],
    ['an import only inside a code block', 'CLAUDE.md', '```\n@AGENTS.md\n```\n'],
    ['.claude/CLAUDE.md importing a path that resolves beside it', '.claude/CLAUDE.md', '@AGENTS.md\n'],
  ])('AGENTS.md hidden from Claude Code: %s', (_label, path, text) => {
    write('AGENTS.md', '# Rules\n')
    write(path, text)
    expect(findings().filter((f) => f.includes('hides-agents'))).toHaveLength(1)
    expect(run().status).toBe(1)
  })

  it('AGENTS.md hidden by a personal CLAUDE.local.md', () => {
    write('AGENTS.md', '# Rules\n')
    write('CLAUDE.local.md', '# my notes\n')
    expect(findings()).toEqual([expect.stringMatching(/^CLAUDE\.local\.md:1: hides-agents: your personal CLAUDE\.local\.md/)])
  })

  it('a script reference when there is no package.json at all', () => {
    rmSync(join(root, 'package.json'))
    write('CLAUDE.md', 'npm run test\n')
    expect(findings()[0]).toContain("there's no package.json between this file and the root")
  })

  it.each([
    ['a name that is not its directory', 'pdf', 'name: pdf-tools\ndescription: Use when a PDF needs work.', 'name "pdf-tools" must match its directory, "pdf"'],
    ['a name with capitals', 'PDF', 'name: PDF\ndescription: Use when a PDF needs work.', 'must be 1-64 characters'],
    ['no description', 'pdf', 'name: pdf', '"description" is missing, empty, or not a string'],
    ['a description over 1024 characters', 'pdf', `name: pdf\ndescription: ${'x'.repeat(1025)}`, 'the limit is 1024'],
    ['frontmatter that isn\'t valid YAML', 'pdf', 'name: pdf\ndescription: Use when: a PDF needs work', "isn't valid YAML"],
    ['a field outside the spec in the shared path', 'pdf', 'name: pdf\ndescription: Use when a PDF needs work.\nargument-hint: "<file>"', "isn't an Agent Skills field"],
  ])('a skill that breaks the Agent Skills spec: %s', (_label, dir, frontmatter, detail) => {
    write(`.agents/skills/${dir}/SKILL.md`, `---\n${frontmatter}\n---\nDo the work.\n`)
    const found = findings()
    expect(found).toHaveLength(1)
    expect(found[0].startsWith(`.agents/skills/${dir}/SKILL.md:1: skill: `)).toBe(true)
    expect(found[0]).toContain(detail)
  })

  it.each(['.claude/skills', '.github/skills', '.cursor/skills', '.gemini/skills', '.codex/skills', '.agent/skills'])(
    'a broken skill in %s',
    (dir) => {
      write(`${dir}/pdf/SKILL.md`, '---\nname: other\ndescription: Use when a PDF needs work.\n---\n')
      expect(findings()).toEqual([`${dir}/pdf/SKILL.md:1: skill: name "other" must match its directory, "pdf"`])
    },
  )

  it('an AGENTS.md over 24,000 bytes, with no platform selection (the legacy budget)', () => {
    write('AGENTS.md', `# Rules\n\n${'Keep it short. '.repeat(1700)}\n`)
    expect(findings()).toEqual([expect.stringMatching(/^AGENTS\.md:1: size: 25\d{3} bytes; Antigravity reads at most 24000 .*every platform the template knows/)])
  })

  it.each([
    ['a .gemini/settings.json that leaves AGENTS.md out', { '.gemini/settings.json': '{"context":{"fileName":"GEMINI.md"}}' }, '.gemini/settings.json'],
    ['a .gemini/ directory with no settings', { '.gemini/commands/x.toml': 'prompt = "x"\n' }, '.gemini/'],
    ['a GEMINI.md that does not import it', { 'GEMINI.md': '# Gemini\n' }, 'GEMINI.md'],
    ['a .gemini/settings.json that is not JSON', { '.gemini/settings.json': '{ context: ' }, '.gemini/settings.json'],
  ])('AGENTS.md hidden from Gemini CLI: %s', (_label, files, file) => {
    write('AGENTS.md', '# Rules\n')
    for (const [path, text] of Object.entries(files)) write(path, text)
    const found = findings().filter((f) => f.includes(': hides-agents: '))
    expect(found).toHaveLength(1)
    expect(found[0].startsWith(`${file}:1: hides-agents: `)).toBe(true)
  })

  it.each([
    ['instructions', (text: string) => text.replace('Run the audit.', 'Run the audit, then fix it.'), 'instructions'],
    ['description', (text: string) => text.replace('description: Use when', 'description: Only use when'), 'description'],
  ])("a skill whose two agents' copies differ in its %s", (_label, change, part) => {
    const skill = '---\nname: audit\ndescription: Use when a repo needs an audit.\n---\n\nRun the audit.\n'
    write('.agents/skills/audit/SKILL.md', skill)
    write('.claude/skills/audit/SKILL.md', change(skill))
    expect(findings()).toEqual([expect.stringContaining(`.claude/skills/audit/SKILL.md:1: skill-copy: differs from .agents/skills/audit/SKILL.md in its ${part}`)])
  })

  it.each([
    ['staged by process:apply', 'prompts/skeletons/'],
    ['staged in a monorepo package', 'packages/app/prompts/skeletons/'],
    ["kept by the template and its forks", 'templates/project/'],
  ])('a path that exists only in a skeleton directory (%s)', (_label, dir) => {
    write(`${dir}AGENTS.skeleton.md`, '# AGENTS.md\n')
    write(`${dir}docs/adr/0000-template.md`, '# ADR template\n')
    write('AGENTS.md', `Copy \`docs/adr/0000-template.md\`. The skeletons are in \`${dir}docs/\`.\n`)
    const result = run()
    expect(findings()).toEqual(["AGENTS.md:1: path: docs/adr/0000-template.md doesn't exist"])
    expect(result.stderr).toContain(`Left out as skeletons (marked by AGENTS.skeleton.md): ${dir}`)
    write('docs/adr/0000-template.md', '# ADR template\n') // copied to its real path: found
    expect(findings()).toEqual([])
  })

  it("a nested instruction file inside a skeleton directory isn't linted as live", () => {
    write('prompts/skeletons/AGENTS.skeleton.md', '# AGENTS.md\n')
    write('prompts/skeletons/packages/api/AGENTS.md', 'See `src/db/gone.ts`.\n')
    write('AGENTS.md', 'Rules.\n')
    expect(findings()).toEqual([])
  })

  it('instruction files for other agents, and nested ones', () => {
    for (const path of ['.cursor/rules/style.mdc', '.github/copilot-instructions.md', 'GEMINI.md', 'packages/api/AGENTS.md']) {
      write(path, 'See `src/db/gone.ts`.\n')
    }
    expect(findings().map((f) => f.split(':')[0]).sort()).toEqual(
      ['.cursor/rules/style.mdc', '.github/copilot-instructions.md', 'GEMINI.md', 'packages/api/AGENTS.md'].sort(),
    )
  })
})

describe('the platform selection', () => {
  const big = `# Rules\n\n${'Keep it short. '.repeat(2000)}\n` // 30,010 bytes: over Antigravity's 24,000, under Codex's 32 KiB
  const select = (selection: unknown) => write('.agents/platforms.json', typeof selection === 'string' ? selection : JSON.stringify(selection))
  const notes = () => run().stderr.split('\n').filter((l) => l.startsWith('Note: '))
  const custom = {
    name: 'Example Agent',
    files: ['AGENTS.md'],
    agentsMd: 'native',
    hardBytes: 28_000,
    sources: [{ url: 'https://example.com/docs/rules', checked: '2026-10-14' }],
  }

  it('sizes AGENTS.md for the selected platforms: 30,000 bytes fit Codex alone', () => {
    write('AGENTS.md', big)
    select({ platforms: ['codex'] })
    expect(Buffer.byteLength(big)).toBeGreaterThan(30_000)
    expect(findings()).toEqual([])
    expect(run().status).toBe(0)
  })

  it('fails the same file when a stricter platform is selected, and names it and the selection', () => {
    write('AGENTS.md', big)
    select({ platforms: ['codex', 'antigravity'] })
    expect(findings()).toEqual([
      expect.stringMatching(/^AGENTS\.md:1: size: 30010 bytes; Antigravity reads at most 24000 .*selects \(codex, antigravity\)/),
    ])
    expect(run().status).toBe(1)
  })

  it('fails the same file with no selection, at the legacy 24,000, and recommends recording one', () => {
    write('AGENTS.md', big)
    expect(findings()).toEqual([expect.stringMatching(/^AGENTS\.md:1: size: 30010 bytes; Antigravity reads at most 24000 /)])
    expect(run().stderr).toContain('Note: no .agents/platforms.json records which coding agents this repo uses')
  })

  it('holds a file to the strictest limit of a custom platform as well', () => {
    write('AGENTS.md', big)
    select({ platforms: ['codex'], custom: [custom] })
    expect(findings()).toEqual([expect.stringMatching(/^AGENTS\.md:1: size: 30010 bytes; Example Agent reads at most 28000, .*\(codex, Example Agent\)/)])
  })

  it('has no size finding for a file no selected platform limits', () => {
    write('AGENTS.md', `# Rules\n\n${'Keep it short. '.repeat(3000)}\n`) // 45,000 bytes
    select({ platforms: ['cursor', 'copilot', 'gemini-cli'] })
    expect(findings()).toEqual([])
  })

  it.each([
    ['an unknown platform id', { platforms: ['codex', 'windsurf'] }, '"windsurf" isn\'t a platform the template knows'],
    ['an unknown field', { platforms: ['codex'], agents: [] }, 'has an unknown field "agents"'],
    ['a selection of nothing', { platforms: [] }, 'selects no platform'],
    ['a custom entry with no sources', { platforms: ['codex'], custom: [{ ...custom, sources: [] }] }, 'needs "sources"'],
    ['a custom source with no checked date', { platforms: ['codex'], custom: [{ ...custom, sources: [{ url: 'https://example.com/docs' }] }] }, 'sources[0] needs a "url"'],
    ['a custom source with no url', { platforms: ['codex'], custom: [{ ...custom, sources: [{ checked: '2026-10-14' }] }] }, 'sources[0] needs a "url"'],
    ['a custom entry with an unknown field', { platforms: ['codex'], custom: [{ ...custom, maxBytes: 1 }] }, 'unknown field "maxBytes"'],
    ['a custom entry whose limit is a guess in words', { platforms: ['codex'], custom: [{ ...custom, hardBytes: 'about 30k' }] }, 'needs "hardBytes"'],
  ])('reports %s', (_label, selection, detail) => {
    write('AGENTS.md', '# Rules\n')
    select(selection)
    const found = findings()
    expect(found).toEqual([expect.stringContaining('.agents/platforms.json:1: platforms: ')])
    expect(found[0]).toContain(detail)
    expect(run().status).toBe(1)
  })

  it('accepts a custom entry with every fact sourced, and a limit recorded as unknown (null)', () => {
    write('AGENTS.md', '# Rules\n')
    select({ platforms: ['codex'], custom: [{ ...custom, hardBytes: null, notes: 'No limit documented on the page consulted.' }] })
    expect(findings()).toEqual([])
  })

  it("can't size anything from a selection that isn't JSON, and says so with exit 2", () => {
    write('AGENTS.md', '# Rules\n')
    select('{ "platforms": ["codex", }')
    const result = run()
    expect(result.status).toBe(2)
    expect(result.stderr).toContain("isn't valid JSON")
  })

  it("notes Claude Code's 200-line guidance, counting what CLAUDE.md imports, without changing the exit code", () => {
    write('AGENTS.md', `# Rules\n${'- a rule\n'.repeat(195)}`)
    write('CLAUDE.md', '@AGENTS.md\n\n## Claude Code\n\n- one note\n')
    select({ platforms: ['claude-code'] })
    expect(notes()).toEqual([expect.stringMatching(/^Note: Claude Code's documented guidance is under 200 lines .*CLAUDE\.md is 201 with what it imports \(AGENTS\.md\)/)])
    expect(findings()).toEqual([])
    expect(run().status).toBe(0)
    // Positive control for the boundary: two lines fewer, and there's nothing to say.
    write('AGENTS.md', `# Rules\n${'- a rule\n'.repeat(193)}`)
    expect(notes()).toEqual([])
  })

  it("doesn't apply Claude Code's guidance when Claude Code isn't selected", () => {
    write('AGENTS.md', `# Rules\n${'- a rule\n'.repeat(400)}`)
    write('CLAUDE.md', '@AGENTS.md\n')
    select({ platforms: ['codex'] })
    expect(notes()).toEqual([])
  })

  it('keeps the guidance note beside a failing finding, and the exit code is the finding\'s', () => {
    write('AGENTS.md', `# Rules\n${'- a rule\n'.repeat(250)}See \`src/db/gone.ts\`.\n`)
    write('CLAUDE.md', '@AGENTS.md\n')
    select({ platforms: ['claude-code'] })
    const result = run()
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/\nNote: Claude Code's documented guidance/)
  })
})

describe('does not report', () => {
  it.each([
    ['paths that exist, from the root or the file', 'Schema: `src/db/schema.ts`, ADRs in `docs/adr/`.'],
    ['a path said in the context of a parent directory', 'Chrome styles: `styles/chrome.css`.'],
    ['a glob whose directory exists', 'Every `src/db/*.ts` file.'],
    ['a link that resolves, and external links', '[ADR](docs/adr/0001-stack.md), [site](https://example.com), [top](#rules)'],
    ['imports that resolve, and personal ones', '@docs/adr/0001-stack.md and @~/.claude/me.md'],
    ['package names and email addresses in prose', 'Uses @testing-library/react and @dnd-kit/core; mail me@example.com.'],
    ['slashes that are not paths', '`and/or`, `text/html`, `react-refresh/only-export-components`, `.sm/.lg`, `docs/...`'],
    ['a path rooted elsewhere, or a placeholder', '`<target>/prompts/skeletons/`, `docs/audits/YYYY-MM-<slug>/audit.md`'],
    ['a placeholder part written in capitals', 'Logs go in `rp-log/session-NN/`, one file per day: `rp-log/session-NN/YYYY-MM-DD.md`.'],
    ['a code reference with a module path', 'Wrap with `tools/md_edit.wrap_block` before saving.'],
    ['single-segment directory mentions', 'Check `plans/` in your home directory.'],
    ['build output', '`dist/assets/`, `node_modules/@fontsource/inter/`, `browse/dist/browse`'],
    ['a script that exists', 'Run `npm run check:all` and `npm run test -- --watch`.'],
    ['a leading BOM', `${String.fromCodePoint(0xfeff)}# Rules`],
    ['tabs', 'Indent\twith tabs.'],
  ])('%s', (_label, text) => {
    write('CLAUDE.md', `${text}\n`)
    expect(findings()).toEqual([])
    expect(run().status).toBe(0)
  })

  it('paths, imports, and links inside a fenced block', () => {
    write('CLAUDE.md', 'Example:\n\n```text\n@missing.md `src/nope/x.ts` [x](nope.md)\n```\n')
    expect(findings()).toEqual([])
  })

  it.each([
    ['a script after a sentence, with a colon, in brackets, or after a flag', 'Then npm run test. Also npm run check:all: the gate. [npm run test] npm run --silent test'],
    ['workspace-targeted runs and --if-present', 'npm run -w web build, npm run build --workspace=web, pnpm run --filter api dev, npm run --if-present gone'],
    ['bun running a file', 'bun run src/server.ts and bun run index.ts'],
    ['an emoji with its presentation selector', `${String.fromCodePoint(0x26a0, 0xfe0f)} careful`],
    ['an emoji ZWJ sequence', String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467)],
    ['a zero-width non-joiner inside a Persian word', String.fromCodePoint(0x0645, 0x06cc, 0x200c, 0x062e, 0x0648, 0x0627, 0x0647, 0x0645)],
    ['a repo-root link, and a link with a query and a title', '[a](/docs/adr/0001-stack.md) [b](docs/adr/0001-stack.md?plain=1 "Stack")'],
    ['a CLAUDE.md that imports AGENTS.md beside it, and nothing else', ''],
  ])('%s', (_label, text) => {
    write('AGENTS.md', '# Rules\n')
    write('CLAUDE.md', `@AGENTS.md\n\n${text}\n`)
    expect(findings()).toEqual([])
    expect(run().status).toBe(0)
  })

  it('CRLF line endings', () => {
    write('CLAUDE.md', '# Rules\r\n\r\nRun `npm run test`.\r\n')
    expect(findings()).toEqual([])
  })

  it('.claude/CLAUDE.md importing AGENTS.md relative to itself', () => {
    write('AGENTS.md', '# Rules\n')
    write('.claude/CLAUDE.md', '@../AGENTS.md\n')
    expect(findings()).toEqual([])
  })

  it('a CLAUDE.md that is a link to AGENTS.md, and lints the file once', () => {
    write('AGENTS.md', 'See `src/db/gone.ts`.\n')
    symlinkSync('AGENTS.md', join(root, 'CLAUDE.md'))
    expect(findings()).toEqual(["AGENTS.md:1: path: src/db/gone.ts doesn't exist"])
  })

  it.each([
    ['settings that list AGENTS.md', { '.gemini/settings.json': '{"context":{"fileName":["AGENTS.md","GEMINI.md"]}}' }],
    ['a GEMINI.md that imports it', { 'GEMINI.md': '@./AGENTS.md\n' }],
    ['a repo that does not use Gemini at all', {}],
    ['settings with comments and trailing commas', { '.gemini/settings.json': '{\n  // Point Gemini at AGENTS.md\n  "context": { "fileName": ["AGENTS.md", "GEMINI.md",], },\n}\n' }],
    ['the setting under its older name', { '.gemini/settings.json': '{"contextFileName": "AGENTS.md"}' }],
  ])('AGENTS.md reaching Gemini CLI: %s', (_label, files) => {
    write('AGENTS.md', '# Rules\n')
    for (const [path, text] of Object.entries(files)) write(path, text)
    expect(findings()).toEqual([])
  })

  it.each([
    ['a block-scalar description and a list of allowed tools', 'description: |\n  Use when a PDF needs work.\n  Handles forms too.\nallowed-tools:\n  - Bash\n  - Read'],
    ['a trailing comment and a YAML escape', 'description: "Use when a PDF\\tneeds work." # why'],
    ['keys named like Object methods', 'description: Use when a PDF needs work.\nconstructor: x\ntoString: y'],
  ])('valid YAML in a Claude Code skill: %s', (_label, rest) => {
    write('.claude/skills/pdf/SKILL.md', `---\nname: pdf\n${rest}\n---\nDo the work.\n`)
    expect(findings()).toEqual([])
  })

  it('a SKILL.md that starts with a byte-order mark', () => {
    write('.agents/skills/pdf/SKILL.md', '\uFEFF---\nname: pdf\ndescription: Use when a PDF needs work.\n---\n')
    expect(findings()).toEqual([])
  })

  it("a skill's two copies as this repo's build writes them: frontmatter and notice differ by design", () => {
    for (const home of ['.agents', '.claude']) {
      write(`${home}/skills/complete/SKILL.md`, readFileSync(join(REPO, home, 'skills/complete/SKILL.md'), 'utf8'))
    }
    expect(findings().filter((f) => f.includes(': skill-copy: '))).toEqual([])
  })

  it('a valid skill carrying fields another tool adds', () => {
    write(
      '.claude/skills/pdf/SKILL.md',
      '---\nname: pdf\ndescription: "Use when a PDF needs work: forms, merges."\nargument-hint: "<file>"\nmetadata:\n  owner: docs-team\n---\nDo the work.\n',
    )
    expect(findings()).toEqual([])
  })

  it("an instruction directory's images and scripts", () => {
    write('.agents/skills/pdf/SKILL.md', '---\nname: pdf\ndescription: Use when a PDF needs the logo.\n---\nUse the logo.\n')
    write('.agents/skills/pdf/assets/logo.png', `${String.fromCodePoint(0, 0x1a, 0x0d)}PNG`)
    write('.agents/skills/pdf/scripts/run.sh', 'cat src/nope/gone.ts\n')
    expect(findings()).toEqual([])
  })

  it('a path git ignores (generated, so absent from a clean checkout)', () => {
    write('.gitignore', 'generated/\n')
    write('CLAUDE.md', 'Output lands in `generated/tokens.css`.\n')
    expect(findings()).toEqual([])
  })

  it('an instruction file that is a symlink out of the repo, whose content never reaches the report', () => {
    const outside = mkdtempSync(join(tmpdir(), 'outside-'))
    try {
      writeFileSync(join(outside, 'notes.md'), 'See `private/acct-4417-payroll.md`.\n')
      symlinkSync(join(outside, 'notes.md'), join(root, 'AGENTS.md'))
      write('CLAUDE.md', '# Rules\n')
      expect(run().stdout).not.toContain('acct-4417')
      // Positive control: a symlink inside the repo is still read.
      write('docs/agents.md', 'See `src/db/gone.ts`.\n')
      rmSync(join(root, 'AGENTS.md'))
      symlinkSync('docs/agents.md', join(root, 'AGENTS.md'))
      expect(findings()).toContain("AGENTS.md:1: path: src/db/gone.ts doesn't exist")
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('a directory git ignores, named without its trailing slash', () => {
    write('.gitignore', 'src/test/fixtures/\n')
    write('CLAUDE.md', 'Real shipments go in `src/test/fixtures`, never committed.\n')
    expect(findings()).toEqual([])
    // Positive control: the same path, not ignored, is still reported.
    write('.gitignore', '\n')
    expect(findings()).toEqual(["CLAUDE.md:1: path: src/test/fixtures doesn't exist"])
  })

  it('imports outside CLAUDE/AGENTS files, where `@` means nothing special', () => {
    write('.cursorrules', 'Mention @docs/rules.md for the reader.\n')
    expect(findings()).toEqual([])
  })
})

describe('the run', () => {
  it('works with --root inside an agent worktree', () => {
    const wt = join(root, '.claude/worktrees/wt')
    mkdirSync(wt, { recursive: true })
    execFileSync('git', ['init', '-q'], { cwd: wt })
    writeFileSync(join(wt, 'CLAUDE.md'), '`src/gone/x.ts`\n')
    const result = spawnSync(process.execPath, [SCRIPT, '--root', wt], { encoding: 'utf8' })
    expect(result.stdout).toContain("CLAUDE.md:1: path: src/gone/x.ts doesn't exist")
    expect(result.status).toBe(1)
  })

  it('finds nested files when --root is a subdirectory of the repo', () => {
    write('packages/api/CLAUDE.md', 'fine\n')
    write('packages/api/sub/AGENTS.md', '`src/gone.ts`\n')
    const result = spawnSync(process.execPath, [SCRIPT, '--root', join(root, 'packages/api')], { encoding: 'utf8' })
    expect(result.stdout).toContain("sub/AGENTS.md:1: path: src/gone.ts doesn't exist")
    expect(result.stdout + result.stderr).toContain('2 file(s)')
  })

  it('finds a nested file in a directory whose name has non-ASCII characters', () => {
    write('apps/café/AGENTS.md', '`src/gone.ts`\n')
    expect(findings()).toEqual(["apps/café/AGENTS.md:1: path: src/gone.ts doesn't exist"])
  })

  it('walks the tree when the root is not a git repository', () => {
    rmSync(join(root, '.git'), { recursive: true })
    write('apps/web/AGENTS.md', '`src/gone.ts`\n')
    expect(findings()).toEqual(["apps/web/AGENTS.md:1: path: src/gone.ts doesn't exist"])
  })

  it('fails, not passes, when there is nothing to examine', () => {
    const result = run()
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('No agent instruction files')
  })

  it('rejects bad arguments and missing files', () => {
    expect(spawnSync(process.execPath, [SCRIPT, '--root'], { encoding: 'utf8' }).status).toBe(2)
    expect(spawnSync(process.execPath, [SCRIPT, '--bogus'], { encoding: 'utf8' }).status).toBe(2)
    expect(run('NOPE.md').status).toBe(2)
  })

  it('checks only the files it is given', () => {
    write('CLAUDE.md', '`src/db/gone.ts`\n')
    write('AGENTS.md', 'fine\n')
    expect(run('AGENTS.md').status).toBe(0)
    expect(run('CLAUDE.md').status).toBe(1)
  })

  it('finds top-level and nested files, and skips agent worktrees', () => {
    write('CLAUDE.md', 'x\n')
    write('AGENTS.md', 'x\n')
    write('apps/web/CLAUDE.md', 'x\n')
    write('.claude/worktrees/a/CLAUDE.md', 'x\n')
    expect(findInstructionFiles(root).map((p) => p.slice(root.length + 1))).toEqual([
      'AGENTS.md',
      'CLAUDE.md',
      'apps/web/CLAUDE.md',
    ])
  })
})
