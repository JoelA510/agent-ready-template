import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findUnfinished } from '../check-placeholders.mjs'

const REPO = resolve(__dirname, '../..')
const SCRIPT = join(REPO, 'scripts/check-placeholders.mjs')
// The one-liner the prompts give targets without Node. Must agree with the script exactly.
const GREP_PATTERN = '[^]A-Za-z0-9_]\\[[A-Z][^]]*\\]([^([]|$)|^\\[[A-Z][^]]*\\]([^(:[]|$)|<!-- GUIDANCE'
const hasGrep = spawnSync('grep', ['--version']).status === 0

const skeletons = (readdirSync(join(REPO, 'templates/project'), { recursive: true, withFileTypes: true }) as import('node:fs').Dirent[])
  .filter((e) => e.isFile())
  .map((e) => join(e.parentPath, e.name))

// Finished documents in this repo: links, checkboxes, tables, code, comments — none of which may
// read as unfinished. The ADR template stays unfinished by design and is exempt by name.
const finished = [
  ...readdirSync(join(REPO, 'docs/adr'))
    .filter((f) => f.endsWith('.md') && f !== '0000-template.md')
    .map((f) => join(REPO, 'docs/adr', f)),
  join(REPO, 'docs/security/dependency-policy.md'),
  join(REPO, 'CONTRIBUTING.md'),
  join(REPO, 'GOVERNANCE.md'),
  join(REPO, 'README.md'),
  join(REPO, '.github/pull_request_template.md'),
]
const read = (file: string) => readFileSync(file, 'utf8')

describe('the skeletons follow the placeholder rule', () => {
  it('every skeleton has something the check finds (positive control)', () => {
    expect(skeletons.length).toBeGreaterThan(10)
    expect(skeletons.filter((file) => findUnfinished(read(file)).length === 0)).toEqual([])
  })

  it('every bracketed placeholder in a skeleton is one the check finds', () => {
    // Any `[` that isn't a link, reference, definition, checkbox, or code must close on its own
    // line, start uppercase, and be matched. A wrapped or lowercase placeholder would otherwise
    // be invisible, and "the check prints nothing" would certify an unfinished artifact.
    const escaped: string[] = []
    for (const file of skeletons) {
      read(file)
        .split('\n')
        .forEach((line, i) => {
          const hits = new Set(findUnfinished(line).map((f) => f.match))
          for (const m of line.matchAll(/(?<![\w\]])\[(?=[^\s'"/\]])/g)) {
            const rest = line.slice(m.index + 1)
            const close = rest.indexOf(']')
            // A link or reference link anywhere; a link definition only at the start of a line.
            const next = rest.slice(close + 1)
            const isLink = close !== -1 && (/^[([]/.test(next) || (m.index === 0 && next.startsWith(':')))
            if (isLink) continue
            const placeholder = close === -1 ? `[${rest}` : `[${rest.slice(0, close + 1)}`
            if (close === -1 || !hits.has(placeholder)) escaped.push(`${file}:${i + 1} ${placeholder}`)
          }
        })
    }
    expect(escaped).toEqual([])
  })

  it('every skeleton comment is a GUIDANCE comment or a synced-block marker', () => {
    const other = skeletons.flatMap((file) =>
      [...read(file).matchAll(/<!--(?! GUIDANCE| [a-z-]+:(?:start|end) -->)/g)].map((m) => `${file}@${m.index}`),
    )
    expect(other).toEqual([])
  })

  it('the ADR template has one source: docs/adr/ and the skeleton are identical', () => {
    expect(read(join(REPO, 'docs/adr/0000-template.md'))).toBe(read(join(REPO, 'templates/project/docs/adr/0000-template.md')))
  })
})

describe('the check', () => {
  it('finds nothing in finished documents', () => {
    const noisy = finished.flatMap((file) => findUnfinished(read(file)).map(({ line, match }) => `${file}:${line} ${match}`))
    expect(noisy).toEqual([])
  })

  it.each([
    ['a placeholder', 'Repo: [REPO]', 1],
    ['a placeholder in a command table cell', '| `[CHECK COMMAND]` | the gate |', 1],
    ['a guidance comment', '<!-- GUIDANCE: fill this in -->', 1],
    ['a stray comment close from a half-deleted comment', '     numbers. -->', 1],
    ['the close of a legitimate multi-line comment', '<!--\n  Keep this short.\n-->', 0],
    ['a markdown link', 'See [Semantic Versioning](https://semver.org/).', 0],
    ['a reference link', 'See [Keep a Changelog][kac].', 0],
    ['a link definition', '[Unreleased]: https://example.com/compare', 0],
    ['a mid-line placeholder followed by a colon', '- Auth bypass — [REFUTED / CORRECTED]: the RPC checks role', 1],
    ['a heading placeholder followed by a colon', '**PR [N]: [TITLE]**', 2],
    ['a checkbox', '- [ ] done  - [x] also done', 0],
    ['an array literal', "z.enum(['development', 'test'])", 0],
    ['generics and indexing', '`Optional[Settings]`, `Props[K]`, arr[I]', 0],
    ['a tool marker comment', '<!-- markdownlint-disable MD013 -->', 0],
    ['a synced-block marker', '<!-- definition-of-done:start -->', 0],
    ['a synced-block marker from rc.1, still in targets filled then', '[//]: # (definition-of-done:start)', 0],
  ])('%s', (_label, text, count) => {
    expect(findUnfinished(text)).toHaveLength(count)
  })

  it('reads a Keep-a-Changelog heading as a placeholder (known limit: a shortcut reference link looks the same)', () => {
    expect(findUnfinished('## [Unreleased]')).toHaveLength(1)
  })

  it.skipIf(!hasGrep)('agrees line for line with the grep one-liner given to targets (bar stray closes)', () => {
    for (const file of [...skeletons, ...finished]) {
      const fromScript = [...new Set(findUnfinished(read(file)).filter((f) => f.match !== '-->').map((f) => f.line))].sort(
        (a, b) => a - b,
      )
      let out = ''
      try {
        out = execFileSync('grep', ['-nE', GREP_PATTERN, file], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } })
      } catch (error) {
        if ((error as { status?: number }).status !== 1) throw error // 1 = no matches
      }
      const fromGrep = out
        .split('\n')
        .filter(Boolean)
        .map((line) => Number(line.split(':')[0]))
      expect(fromGrep, file).toEqual(fromScript)
    }
  })

  it('exits 1 on unfinished files, 0 on finished ones, 2 on bad input, and skips the ADR template', () => {
    const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
    expect(run(join(REPO, 'templates/project/docs/audit.md')).status).toBe(1)
    expect(run(...finished).status).toBe(0)
    const adr = run(join(REPO, 'docs/adr'))
    expect(adr.stdout).toContain('skipped')
    expect(adr.status).toBe(0)
    expect(run().status).toBe(2)
    expect(run(join(REPO, 'does-not-exist.md')).status).toBe(2)
    // An extensionless skeleton (CODEOWNERS) is read from a directory too.
    expect(run(join(REPO, 'templates/project/.github')).stdout).toContain('CODEOWNERS')
    // Examining nothing certifies nothing: only the exempt template, or a directory with no text.
    expect(run(join(REPO, 'docs/adr/0000-template.md')).status).toBe(2)
    const binaryOnly = mkdtempSync(join(tmpdir(), 'placeholders-'))
    writeFileSync(join(binaryOnly, 'mark.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]))
    writeFileSync(join(binaryOnly, 'browse'), Buffer.concat([Buffer.from('[PLACEHOLDER] \0'), Buffer.alloc(16)])) // an extensionless binary
    expect(run(binaryOnly).status).toBe(2)
    rmSync(binaryOnly, { recursive: true, force: true })
  })
})
