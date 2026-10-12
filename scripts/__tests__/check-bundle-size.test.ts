import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkBudgets, parseSize } from '../check-bundle-size.mjs'

const REPO = resolve(__dirname, '../..')
const SCRIPT = join(REPO, 'scripts/check-bundle-size.mjs')

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bundle-size-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const write = (rel: string, content: string | Buffer) => {
  mkdirSync(join(root, rel, '..'), { recursive: true })
  writeFileSync(join(root, rel), content)
}
// Content that gzip can't shrink much, so a size is easy to land above or below a budget.
const noise = (bytes: number, seed = 1) => {
  let x = seed
  return Buffer.from(Array.from({ length: bytes }, () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0), x >>> 24)))
}
const gz = (buf: Buffer) => gzipSync(buf, { level: 9 }).length

describe('parseSize', () => {
  it.each([
    ['90 kB', 90000],
    ['1.5 kB', 1500],
    ['92160 B', 92160],
    [2048, 2048],
  ])('reads %s', (value, bytes) => expect(parseSize(value)).toBe(bytes))

  it.each([['90 KB'], ['90 KiB'], ['90'], ['0 kB'], [-1], [null], ['ninety kB']])('refuses %s', (value) => expect(parseSize(value)).toBeNull())
})

describe('checkBudgets', () => {
  it('sums the gzipped size of every file a glob matches, against its budget', () => {
    const a = noise(3000, 1)
    const b = noise(2000, 2)
    write('dist/assets/a.js', a)
    write('dist/assets/b.js', b)
    write('dist/assets/c.css', 'body{color:red}')
    const total = gz(a) + gz(b)
    const at = (limit: number) => checkBudgets(root, { dir: 'dist', budgets: [{ files: 'assets/*.js', gzip: limit }] })
    expect(at(total)).toEqual({ results: [{ files: 'assets/*.js', matched: 2, size: total, limit: total, over: false }], problems: [] })
    expect(at(total - 1).results[0].over).toBe(true) // one byte over
  })

  it('fails a budget that measured nothing, a missing build, and a config it can\'t read', () => {
    write('dist/assets/a.js', 'x')
    expect(checkBudgets(root, { dir: 'dist', budgets: [{ files: 'assets/*.mjs', gzip: '1 kB' }] }).problems).toEqual(['assets/*.mjs matched no file in dist'])
    expect(checkBudgets(root, { dir: 'build', budgets: [{ files: '*.js', gzip: '1 kB' }] }).problems).toEqual(["build doesn't exist: run the build first"])
    expect(checkBudgets(root, { dir: 'dist', budgets: [] }).problems[0]).toContain('at least one entry')
    expect(checkBudgets(root, { dir: 'dist', budgets: [{ files: 'assets/*.js', gzip: '1 KB' }] }).problems).toEqual(['budget 1 needs "files" (a glob) and "gzip" (a size like "90 kB")'])
    expect(checkBudgets(root, { dir: '../elsewhere', budgets: [{ files: '*', gzip: '1 kB' }] }).problems[0]).toContain('outside the repository')
  })

  it('matches files in subdirectories with **', () => {
    write('dist/assets/chunks/x.js', noise(100))
    expect(checkBudgets(root, { dir: 'dist', budgets: [{ files: 'assets/**/*.js', gzip: '1 kB' }] }).results[0].matched).toBe(1)
    expect(checkBudgets(root, { dir: 'dist', budgets: [{ files: 'assets/*.js', gzip: '1 kB' }] }).problems[0]).toContain('matched no file')
  })
})

describe('the command', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8' })

  it('exits 1 over budget, naming the fix, and 0 within it', () => {
    write('dist/a.js', noise(4000))
    expect(gz(noise(4000))).toBeGreaterThan(3000) // positive control: the noise doesn't compress
    write('budget.json', JSON.stringify({ dir: 'dist', budgets: [{ files: '*.js', gzip: '1 kB' }] }))
    const over = run('--config', join(root, 'budget.json'))
    expect(over.status).toBe(1)
    expect(over.stdout).toMatch(/^✗ \*\.js: \d+\.\d kB gzipped \(1 file\), budget 1\.0 kB/)
    expect(over.stderr).toContain('raise the budget in bundle-budget.json and say why')
    write('budget.json', JSON.stringify({ dir: 'dist', budgets: [{ files: '*.js', gzip: '10 kB' }] }))
    expect(run('--config', join(root, 'budget.json')).status).toBe(0)
  })

  it('exits 1 on a config that is missing or not JSON', () => {
    expect(run('--config', join(root, 'none.json')).status).toBe(1)
    write('bad.json', '{')
    expect(run('--config', join(root, 'bad.json')).stderr).toContain("can't read")
  })

  it('holds this repository to a budget for its JS and its CSS', () => {
    const config = JSON.parse(readFileSync(join(REPO, 'bundle-budget.json'), 'utf8'))
    expect(config.dir).toBe('dist')
    expect(config.budgets.map((b: { files: string }) => b.files)).toEqual(['assets/*.js', 'assets/*.css'])
    for (const b of config.budgets) expect(b.why, b.files).toBeTruthy()
  })
})
