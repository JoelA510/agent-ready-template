import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { STATE_FILE, TIMEOUT_MS, detectTarget, findOnPath, probeTool, readState, report } from '../agent-target.mjs'

// scripts/agent-target.mjs against scratch checkouts: one with no state file, one with a state
// file whose tools are a listening port, a closed port, a command on a scratch PATH, and entries
// it must refuse to probe. Nothing here reaches past loopback.
const SCRIPT = resolve(__dirname, '../agent-target.mjs')

describe('agent-target', () => {
  let root: string
  let bin: string
  let server: Server | undefined
  const sockets: Socket[] = []
  const state = (tools: unknown) => {
    mkdirSync(join(root, '.local-power'), { recursive: true })
    writeFileSync(join(root, STATE_FILE), typeof tools === 'string' ? tools : JSON.stringify({ version: 1, tools }))
  }
  // A port that accepts connections, and one that did a moment ago and no longer does.
  const listen = () =>
    new Promise<number>((done) => {
      server = createServer((socket) => sockets.push(socket)).listen(0, '127.0.0.1', () => done((server!.address() as { port: number }).port))
    })
  // Destroys what's still connected first: close() alone waits out a kept-alive connection.
  const stop = async () => {
    for (const socket of sockets.splice(0)) socket.destroy()
    if (server) await new Promise((done) => server!.close(done))
    server = undefined
  }
  const closedPort = async () => {
    const port = await listen()
    await stop()
    return port
  }
  const run = (env: Record<string, string> = {}, ...args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, '--root', root, ...args], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', ...env },
    })

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agent-target-'))
    bin = mkdtempSync(join(tmpdir(), 'agent-target-bin-'))
  })
  afterEach(async () => {
    await stop()
    rmSync(root, { recursive: true, force: true })
    rmSync(bin, { recursive: true, force: true })
  })

  describe('the target', () => {
    it('is core in a checkout with no state file: a fresh clone, and Codex cloud', () => {
      expect(detectTarget({ env: {}, root })).toBe('core')
      const r = run()
      expect(r.status).toBe(0)
      expect(r.stdout).toBe('core\n')
    })

    it('is cloud when CLAUDE_CODE_REMOTE is "true", and only then', () => {
      expect(detectTarget({ env: { CLAUDE_CODE_REMOTE: 'true' }, root })).toBe('cloud')
      for (const other of ['1', 'TRUE', 'false', '']) expect(detectTarget({ env: { CLAUDE_CODE_REMOTE: other }, root })).toBe('core')
      expect(run({ CLAUDE_CODE_REMOTE: 'true' }).stdout).toBe('cloud\n')
    })

    it('is cloud even where a state file exists, and probes nothing there', async () => {
      state([{ name: 'db', probe: { type: 'tcp', host: '127.0.0.1', port: await listen() } }])
      expect(await report({ env: { CLAUDE_CODE_REMOTE: 'true' }, root })).toEqual({ target: 'cloud', tools: [], problem: null })
    })

    it('is local-power once the pack has written its state file', () => {
      state([])
      expect(detectTarget({ env: {}, root })).toBe('local-power')
      expect(run().stdout).toBe('local-power\n')
    })
  })

  describe('the tools', () => {
    it('reports a listening port up and a closed one down, each on its own line', async () => {
      const closed = await closedPort()
      const open = await listen()
      state([
        { name: 'gbrain-postgres', version: '16', probe: { type: 'tcp', host: '127.0.0.1', port: open } },
        { name: 'nomos', probe: { type: 'tcp', host: '127.0.0.1', port: closed } },
      ])
      const result = await report({ env: {}, root })
      expect(result.tools.map((t) => [t.name, t.version, t.status])).toEqual([
        ['gbrain-postgres', '16', 'up'],
        ['nomos', null, 'down'],
      ])
      expect(result.problem).toBeNull()
    })

    it('prints the target first, then the tools, and still exits 0 with one down', async () => {
      state([{ name: 'nomos', probe: { type: 'tcp', host: '127.0.0.1', port: await closedPort() } }])
      const r = run()
      expect(r.status).toBe(0)
      expect(r.stdout).toMatch(/^local-power\n {2}nomos: down \(no answer from 127\.0\.0\.1:\d+ in 500 ms\)\n$/)
      const json = JSON.parse(run({}, '--json').stdout)
      expect(json.target).toBe('local-power')
      expect(json.tools[0]).toMatchObject({ name: 'nomos', status: 'down' })
    })

    it('answers http on loopback: up for a response, down for none', async () => {
      const port = await listen()
      server!.on('connection', (socket) => socket.once('data', () => socket.end('HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n')))
      expect(await probeTool({ name: 'nomos', probe: { type: 'http', url: `http://127.0.0.1:${port}/healthz` } })).toMatchObject({ status: 'up' })
      await stop()
      expect(await probeTool({ name: 'nomos', probe: { type: 'http', url: `http://127.0.0.1:${port}/healthz` } })).toMatchObject({ status: 'down' })
    })

    it('gives up on a port that accepts nothing, in about the timeout', async () => {
      // A listener that never answers HTTP: the connection opens and nothing comes back.
      const port = await listen()
      const started = Date.now()
      const result = await probeTool({ name: 'slow', probe: { type: 'http', url: `http://127.0.0.1:${port}/` } }, { timeoutMs: 200 })
      expect(result.status).toBe('down')
      expect(Date.now() - started).toBeLessThan(2000)
      expect(TIMEOUT_MS).toBe(500)
    })

    it('finds a command on PATH without running it, and says when it is missing', async () => {
      const marker = join(root, 'ran')
      const file = join(bin, process.platform === 'win32' ? 'faketool.cmd' : 'faketool')
      writeFileSync(file, process.platform === 'win32' ? `@echo off\r\necho ran> "${marker}"\r\n` : `#!/bin/sh\necho ran > "${marker}"\n`)
      chmodSync(file, 0o755)
      const env = { PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, PATHEXT: '.CMD;.EXE' }
      // Windows matches the extension whatever its case, and reports it as PATHEXT spells it.
      expect(findOnPath('faketool', env)?.toLowerCase()).toBe(file.toLowerCase())
      expect(await probeTool({ name: 'fake', probe: { type: 'command', command: 'faketool' } }, { env })).toMatchObject({ status: 'up' })
      expect(await probeTool({ name: 'fake', probe: { type: 'command', command: 'no-such-tool-here' } }, { env })).toMatchObject({ status: 'down', detail: "no-such-tool-here isn't on PATH" })
      expect(existsSync(marker), 'the tool itself never ran').toBe(false)
    })
  })

  describe('a state file it does not trust', () => {
    it.each([
      ['a host that is not loopback', { name: 'x', probe: { type: 'tcp', host: '192.0.2.10', port: 80 } }, /loopback/],
      ['a url that is not loopback', { name: 'x', probe: { type: 'http', url: 'http://example.com/' } }, /loopback/],
      ['a url with credentials', { name: 'x', probe: { type: 'http', url: 'http://user:pw@127.0.0.1:1/' } }, /credentials/],
      ['a url of another scheme', { name: 'x', probe: { type: 'http', url: 'file:///etc/passwd' } }, /http or https/],
      ['a command given as a path', { name: 'x', probe: { type: 'command', command: '../../bin/sh' } }, /bare name/],
      ['a command with arguments', { name: 'x', probe: { type: 'command', command: 'sh -c id' } }, /bare name/],
      ['a port out of range', { name: 'x', probe: { type: 'tcp', host: '127.0.0.1', port: 70000 } }, /1-65535/],
      ['a probe type it does not know', { name: 'x', probe: { type: 'exec', command: 'id' } }, /command, tcp, or http/],
      ['no probe', { name: 'x' }, /no probe/],
      ['a name that is not a plain word', { name: 'x; rm -rf ~', probe: { type: 'command', command: 'sh' } }, /name must be/],
      ['an entry that is not an object', 'mempalace', /name must be/],
    ])('refuses to probe %s', async (_label, tool, why) => {
      const result = await probeTool(tool)
      expect(result.status).toBe('invalid')
      expect(result.detail).toMatch(why)
    })

    it('probes a well-formed entry the same way (positive control for the refusals above)', async () => {
      expect((await probeTool({ name: 'x', probe: { type: 'tcp', host: '127.0.0.1', port: await listen() } })).status).toBe('up')
    })

    it.each([
      ['not JSON', '{ "tools": [', /not valid JSON/],
      ['no tools list', '{ "version": 1 }', /no "tools" list/],
      ['a list at the top', '[]', /no "tools" list/],
    ])('says so on stderr for a file that is %s, lists no tool, and still exits 0', (_label, text, why) => {
      state(text)
      expect(readState(root)).toMatchObject({ tools: [], problem: expect.stringMatching(why) })
      const r = run()
      expect(r.status).toBe(0)
      expect(r.stdout).toBe('local-power\n')
      expect(r.stderr).toMatch(why)
    })

    it('reads a state file saved with a byte order mark, as a Windows editor may', () => {
      state(String.fromCharCode(0xfeff) + JSON.stringify({ version: 1, tools: [] }))
      expect(readState(root)).toEqual({ tools: [], problem: null })
    })

    it('ignores an argument it does not know, on stderr, and still answers', () => {
      const r = run({}, '--frobnicate')
      expect(r.status).toBe(0)
      expect(r.stdout).toBe('core\n')
      expect(r.stderr).toContain('ignoring "--frobnicate"')
    })
  })
})
