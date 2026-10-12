import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isolatedEnv, resolvesFrom } from './isolated-env'

// The install tests' positive controls rest on resolvesFrom answering "no" only when a package
// really is out of reach, so it's shown answering both ways.
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'isolated-env-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('resolvesFrom', () => {
  it('finds what the template installs, from inside it', () => {
    expect(resolvesFrom(resolve(__dirname, '../check-env.mjs'), 'typescript')).toBe(true)
  })

  it('finds a package through NODE_PATH, and not once isolatedEnv drops it', () => {
    mkdirSync(join(dir, 'global/planted-pkg'), { recursive: true })
    writeFileSync(join(dir, 'global/planted-pkg/package.json'), '{"name":"planted-pkg","main":"index.js"}\n')
    writeFileSync(join(dir, 'global/planted-pkg/index.js'), 'module.exports = 1\n')
    mkdirSync(join(dir, 'scratch'))
    const file = join(dir, 'scratch/script.mjs')
    const withNodePath = { ...process.env, NODE_PATH: join(dir, 'global') }
    expect(resolvesFrom(file, 'planted-pkg', withNodePath)).toBe(true)
    expect(resolvesFrom(file, 'planted-pkg', isolatedEnv(withNodePath))).toBe(false)
  })
})
