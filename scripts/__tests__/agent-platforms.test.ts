import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PLATFORMS, PROCEDURE, readSelection } from '../agent-platforms.mjs'

const REPO = resolve(__dirname, '../..')

describe('the platform registry', () => {
  it('knows the six platforms the template ships wiring for (positive control)', () => {
    expect(PLATFORMS.map((p) => p.id)).toEqual(['claude-code', 'codex', 'cursor', 'copilot', 'gemini-cli', 'antigravity'])
  })

  it.each(PLATFORMS.map((p) => [p.id, p] as const))('%s: every fact is sourced and dated, and every limit is a number or unknown', (_id, p) => {
    expect(p.sources.length).toBeGreaterThan(0)
    for (const s of p.sources) {
      expect(s.url).toMatch(/^https:\/\/\S+$/)
      expect(s.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    expect(p.hardBytes === null || (Number.isInteger(p.hardBytes) && p.hardBytes > 0)).toBe(true)
    expect(p.guidanceLines === null || (Number.isInteger(p.guidanceLines) && p.guidanceLines > 0)).toBe(true)
    // A limit says what happens past it; a missing one says what was consulted.
    if (p.hardBytes !== null) expect(p.hardEffect).toMatch(/\S/)
    else expect(p.notes).toMatch(/no (byte|size) limit|documents no/i)
    if (p.guidanceLines !== null) expect(p.loads?.length).toBeGreaterThan(0)
    expect(['native', 'import', 'setting']).toContain(p.agentsMd)
    expect(p.files).toContain('AGENTS.md')
  })
})

describe('prompts/agent-platforms.md', () => {
  const text = readFileSync(join(REPO, PROCEDURE), 'utf8')
  const start = text.indexOf('<!-- platform-table:start -->')
  const end = text.indexOf('<!-- platform-table:end -->')
  const rows = text
    .slice(start, end)
    .split('\n')
    .filter((l) => l.startsWith('| `'))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))

  it('has a row per registry platform, in order (positive control: the table is found)', () => {
    expect(start).toBeGreaterThan(-1)
    expect(rows.map((r) => r[0])).toEqual(PLATFORMS.map((p) => `\`${p.id}\``))
  })

  it.each(PLATFORMS.map((p) => [p.id, p] as const))('%s: its row states the registry facts', (id, p) => {
    const [, name, agentsMd, , hard, guidance, read] = rows.find((r) => r[0] === `\`${id}\``)!
    expect(name).toBe(p.name)
    expect(agentsMd).toBe(p.agentsMd)
    expect(hard).toMatch(p.hardBytes === null ? /^none documented$/ : new RegExp(`^${p.hardBytes} bytes\\b`))
    expect(guidance).toMatch(p.guidanceLines === null ? /^none$/ : new RegExp(`^${p.guidanceLines} lines\\b`))
    expect(read).toBe(p.sources.map((s) => s.checked).sort().at(-1))
  })
})

describe("this repo's own selection", () => {
  it('reads cleanly and selects the maintainer platforms', () => {
    const selection = readSelection(REPO)
    expect(selection).toEqual({ platforms: PLATFORMS.filter((p) => ['claude-code', 'codex'].includes(p.id)), problems: [] })
  })
})
