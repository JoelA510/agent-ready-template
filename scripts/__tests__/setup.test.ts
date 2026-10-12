import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// scripts/setup.sh with stand-ins: an npm that records its calls, and a node, mise, and nvm that
// report or "install" a version, so no test downloads anything. Each test runs it in a scratch
// project whose .nvmrc it chooses.
const SETUP = resolve(__dirname, '../setup.sh')
const RUNNING = process.versions.node

describe.skipIf(process.platform === 'win32')('setup.sh', () => {
  let project: string
  let bin: string
  let calls: string
  const exe = (path: string, body: string) => {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, `#!/bin/bash\n${body}\n`)
    chmodSync(path, 0o755)
  }
  // A node that says it's `version` and otherwise defers to the real one (for the packageManager read).
  const fakeNode = (dir: string, version: string) =>
    exe(join(dir, 'node'), `if [ "$*" = "-p process.versions.node" ]; then echo ${version}; else exec "${process.execPath}" "$@"; fi`)

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'setup-'))
    bin = mkdtempSync(join(tmpdir(), 'setup-bin-'))
    calls = join(bin, 'calls')
    exe(join(bin, 'npm'), `echo "npm $*" >> "${calls}"; [ "$1" = "--version" ] && echo 10.9.9; exit \${FAKE_NPM_STATUS:-0}`)
    writeFileSync(join(project, 'package-lock.json'), '{}\n')
    writeFileSync(join(project, 'package.json'), '{ "packageManager": "npm@10.9.9" }\n')
  })
  afterEach(() => {
    rmSync(project, { recursive: true, force: true })
    rmSync(bin, { recursive: true, force: true })
  })

  const run = (env: Record<string, string> = {}, ...args: string[]) =>
    spawnSync('bash', [SETUP, ...args], {
      cwd: project,
      encoding: 'utf8',
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: project, NVM_DIR: join(project, 'no-nvm'), ...env },
    })
  const recorded = () => (existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [])

  it("installs with the running node when it's the one .nvmrc pins, by major or in full", () => {
    for (const pin of [RUNNING.split('.')[0], `v${RUNNING}`]) {
      writeFileSync(join(project, '.nvmrc'), `${pin}\n`)
      const r = run()
      expect(r.status, r.stderr).toBe(0)
      expect(r.stdout).toContain(`Installed dependencies with npm ci (node ${RUNNING})`)
    }
    expect(recorded().filter((c) => c.startsWith('npm ci'))).toEqual(['npm ci --no-audit --no-fund', 'npm ci --no-audit --no-fund'])
  })

  it('a major that only starts the same digits is another version', () => {
    writeFileSync(join(project, '.nvmrc'), `${RUNNING.split('.')[0].slice(0, 1)}\n`) // "2" is not 22.x
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('neither mise nor nvm is installed')
  })

  it("stops, installing nothing, when the pin differs and there's no mise or nvm to get it", () => {
    writeFileSync(join(project, '.nvmrc'), '99\n')
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr).toContain(`node is ${RUNNING} and .nvmrc pins 99`)
    expect(recorded().some((c) => c.startsWith('npm ci'))).toBe(false)
  })

  it('gets the pinned Node from mise, installs with it, and puts it on the env file once', () => {
    writeFileSync(join(project, '.nvmrc'), '99\n')
    const node99 = join(bin, 'mise-node-99')
    fakeNode(join(node99, 'bin'), '99.1.0')
    exe(join(bin, 'mise'), `echo "mise $*" >> "${calls}"; [ "$1" = where ] && echo "${node99}"; exit 0`)
    const envFile = join(project, 'session.env')
    for (let i = 0; i < 2; i++) expect(run({}, '--env-file', envFile).status).toBe(0)
    expect(recorded().filter((c) => c.startsWith('mise'))).toEqual(['mise install node@99', 'mise where node@99', 'mise install node@99', 'mise where node@99'])
    expect(readFileSync(envFile, 'utf8')).toBe(`export PATH=${join(node99, 'bin')}:"$PATH"\n`)
    // What the session sees after sourcing it.
    const sourced = spawnSync('bash', ['-c', 'source "$1" && node -p process.versions.node', '_', envFile], { encoding: 'utf8', env: { PATH: process.env.PATH } })
    expect(sourced.stdout.trim()).toBe('99.1.0')
  })

  it('falls back to nvm, from NVM_DIR', () => {
    writeFileSync(join(project, '.nvmrc'), '99.1\n')
    const nvmDir = join(project, 'nvm')
    const node99 = join(nvmDir, 'versions/node/v99.1.0/bin')
    fakeNode(node99, '99.1.0')
    mkdirSync(nvmDir, { recursive: true })
    // Like the real one: loaded without --no-use, it tries the .nvmrc version and returns 3.
    const nvmSh = (install: string) =>
      writeFileSync(
        join(nvmDir, 'nvm.sh'),
        `[ "$1" = --no-use ] || return 3\nnvm() { echo "nvm $*" >> "${calls}"; case "$1" in install) ${install} ;; which) echo "${node99}/node" ;; esac; }\n`,
      )
    nvmSh('true')
    const r = run({ NVM_DIR: nvmDir })
    expect(r.status, r.stderr).toBe(0)
    expect(recorded().filter((c) => c.startsWith('nvm'))).toEqual(['nvm install 99.1', 'nvm which 99.1'])
    expect(r.stdout).toContain('Installed dependencies with npm ci (node 99.1.0)')
    nvmSh('return 7')
    const failed = run({ NVM_DIR: nvmDir })
    expect(failed.status).toBe(1)
    expect(failed.stderr).toContain("couldn't install Node 99.1 (exit 7)")
  })

  it('says so, and exits 1, when mise fails or npm is missing', () => {
    writeFileSync(join(project, '.nvmrc'), '99\n')
    exe(join(bin, 'mise'), 'exit 4')
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("mise couldn't install Node 99")
    rmSync(join(project, '.nvmrc'))
    rmSync(join(bin, 'npm'))
    // A PATH with node but no npm: a directory holding only a link to this node.
    const onlyNode = join(bin, 'only-node')
    mkdirSync(onlyNode)
    exe(join(onlyNode, 'node'), `exec "${process.execPath}" "$@"`)
    const noNpm = spawnSync('/bin/bash', [SETUP], { cwd: project, encoding: 'utf8', env: { PATH: onlyNode, HOME: project, NVM_DIR: join(project, 'no-nvm') } })
    expect(noNpm.status).toBe(1)
    expect(noNpm.stderr).toContain("there's no npm on PATH")
  })

  it('fails when the Node it installed still isn\'t the pinned one', () => {
    writeFileSync(join(project, '.nvmrc'), '99\n')
    const wrong = join(bin, 'mise-node-wrong')
    fakeNode(join(wrong, 'bin'), '98.0.0')
    exe(join(bin, 'mise'), `[ "$1" = where ] && echo "${wrong}"; exit 0`)
    const r = run()
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('is 98.0.0')
  })

  it('says when npm differs from the pin, without changing it', () => {
    writeFileSync(join(project, 'package.json'), '{ "packageManager": "npm@11.0.0" }\n')
    const r = run()
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('npm is 10.9.9 and package.json pins 11.0.0')
    expect(recorded().some((c) => c.includes('install -g'))).toBe(false)
  })

  it('does nothing when node_modules already matches the lockfile, and fails when npm ci does', () => {
    mkdirSync(join(project, 'node_modules'))
    writeFileSync(join(project, 'node_modules/.package-lock.json'), '{}\n')
    expect(run().stdout).toContain('already match')
    expect(recorded().some((c) => c.startsWith('npm ci'))).toBe(false)
    rmSync(join(project, 'node_modules'), { recursive: true })
    const failed = run({ FAKE_NPM_STATUS: '1' })
    expect(failed.status).not.toBe(0)
    expect(failed.stdout).not.toContain('Installed')
  })

  it('reads a non-numeric .nvmrc as a warning, not a version', () => {
    writeFileSync(join(project, '.nvmrc'), 'lts/*\n')
    const r = run()
    expect(r.status).toBe(0)
    expect(r.stderr).toContain("isn't a version number")
  })
})
