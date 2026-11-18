#!/usr/bin/env node
// Says where this session is running, so an agent uses what the machine has and nothing it
// lacks (docs/system/agent-targets.md, ADR 0022). One word on the first line:
//
//   cloud        Claude Code on the web: CLAUDE_CODE_REMOTE is "true", the one signal a vendor
//                documents (code.claude.com/docs/en/cloud-environments, read 2026-11-17).
//   local-power  this checkout has .local-power/state.json, which the local-power pack writes
//                (packs/local-power/README.md). Each tool the file lists is then probed, and the
//                lines after the first say which answer right now.
//   core         neither. The committed baseline is all there is. Codex cloud lands here too: it
//                documents no signal, and a fresh clone has no state file, so it gets the same
//                baseline a cloud session does without being detected.
//
// The state file is this machine's own and untracked, and still read as untrusted input: a tool
// with a shape this doesn't know is reported `invalid` and never probed, a command is a bare
// name looked up on PATH (never run), and a tcp or http probe only reaches loopback, so the file
// can't point the probe at another host. Each probe gives up after 500 ms.
//
//   { "version": 1,
//     "tools": [ { "name": "mempalace", "version": "3.12.0", "probe": { "type": "command", "command": "mempalace-mcp" } },
//                { "name": "gbrain-postgres", "probe": { "type": "tcp", "host": "127.0.0.1", "port": 5434 } },
//                { "name": "nomos", "probe": { "type": "http", "url": "http://127.0.0.1:9901/healthz" } } ] }
//
// Run: node scripts/agent-target.mjs [--root <checkout>] [--json]   (npm run agent:target)
//   Always exits 0: this informs a session and must never stop one. A state file it can't read,
//   or an argument it doesn't know, is said on stderr.
import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs'
import { connect } from 'node:net'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
export const STATE_FILE = '.local-power/state.json'
export const TIMEOUT_MS = 500
const LOOPBACK = new Set(['127.0.0.1', '::1', '[::1]', 'localhost'])
const NAME = /^[\w.-]{1,64}$/

/** `cloud`, `local-power`, or `core`, from the environment and the checkout at `root`. */
export function detectTarget({ env = process.env, root = ROOT } = {}) {
  if (env.CLAUDE_CODE_REMOTE === 'true') return 'cloud'
  return existsSync(join(root, STATE_FILE)) ? 'local-power' : 'core'
}

/**
 * The tools the state file lists, as written: { tools, problem }. `problem` says why the file
 * couldn't be read as a list (and `tools` is then empty); a single malformed entry is kept, and
 * probeTool reports it `invalid`.
 */
export function readState(root = ROOT) {
  let data
  try {
    data = JSON.parse(readFileSync(join(root, STATE_FILE), 'utf8').replace(/^\uFEFF/, ''))
  } catch (error) {
    // Unreadable or not JSON: both leave nothing to probe. Anything else is a bug here.
    if (!(error instanceof SyntaxError) && error?.code === undefined) throw error
    return { tools: [], problem: `${STATE_FILE} couldn't be read (${error.code ?? 'not valid JSON'})` }
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.tools)) {
    return { tools: [], problem: `${STATE_FILE} has no "tools" list` }
  }
  return { tools: data.tools, problem: null }
}

/** The file `command` names on PATH, or null. Looked up, never run. */
export function findOnPath(command, env = process.env) {
  const extensions = process.platform === 'win32' ? ['', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)] : ['']
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const file = join(dir, command + extension)
      try {
        if (!statSync(file).isFile()) continue
        if (process.platform !== 'win32') accessSync(file, constants.X_OK)
        return file
      } catch (error) {
        // Not there, not a file we may run, or a PATH entry that isn't a directory: keep looking.
        if (!['ENOENT', 'EACCES', 'ENOTDIR', 'EPERM'].includes(error?.code)) throw error
      }
    }
  }
  return null
}

function tcpAnswers(host, port, timeoutMs) {
  return new Promise((done) => {
    const socket = connect({ host: host.replace(/^\[|\]$/g, ''), port })
    const finish = (up) => {
      socket.destroy()
      done(up)
    }
    socket.setTimeout(timeoutMs, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false)) // refused or unreachable: down, which is the answer
  })
}

async function httpAnswers(url, timeoutMs) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' })
    return response.status < 500
  } catch (error) {
    // No listener, or no answer in time: down. A bug in this file would throw something else.
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError' || error instanceof TypeError) return false
    throw error
  }
}

/**
 * One tool's state: { name, version, status, detail }, status `up`, `down`, or `invalid` (an
 * entry this can't probe, with why).
 */
export async function probeTool(tool, { env = process.env, timeoutMs = TIMEOUT_MS } = {}) {
  const name = typeof tool?.name === 'string' && NAME.test(tool.name) ? tool.name : null
  const version = typeof tool?.version === 'string' && NAME.test(tool.version) ? tool.version : null
  const invalid = (detail) => ({ name: name ?? '(unnamed)', version, status: 'invalid', detail })
  if (!name) return invalid('its name must be 1-64 letters, digits, dots, hyphens, or underscores')
  const probe = tool.probe
  if (!probe || typeof probe !== 'object') return invalid('it has no probe')

  if (probe.type === 'command') {
    if (typeof probe.command !== 'string' || !NAME.test(probe.command)) return invalid('its command must be a bare name, not a path')
    const found = findOnPath(probe.command, env)
    return { name, version, status: found ? 'up' : 'down', detail: found ? `${probe.command} is on PATH` : `${probe.command} isn't on PATH` }
  }
  if (probe.type === 'tcp') {
    if (!LOOPBACK.has(probe.host)) return invalid('its host must be loopback (127.0.0.1, ::1, or localhost)')
    if (!Number.isInteger(probe.port) || probe.port < 1 || probe.port > 65535) return invalid('its port must be 1-65535')
    const up = await tcpAnswers(probe.host, probe.port, timeoutMs)
    return { name, version, status: up ? 'up' : 'down', detail: up ? `${probe.host}:${probe.port} accepts connections` : `no answer from ${probe.host}:${probe.port} in ${timeoutMs} ms` }
  }
  if (probe.type === 'http') {
    let url
    try {
      url = new URL(probe.url)
    } catch (error) {
      if (!(error instanceof TypeError)) throw error
      return invalid('its url is not a URL')
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return invalid('its url must be http or https')
    if (!LOOPBACK.has(url.hostname)) return invalid('its url must be on loopback (127.0.0.1, ::1, or localhost)')
    if (url.username || url.password) return invalid('its url must not carry credentials')
    const up = await httpAnswers(url, timeoutMs)
    return { name, version, status: up ? 'up' : 'down', detail: up ? `${url.host} answers` : `no answer from ${url.host} in ${timeoutMs} ms` }
  }
  return invalid(`its probe type must be command, tcp, or http`)
}

/** The whole report: { target, tools, problem }. Tools are probed together, so it takes one timeout. */
export async function report({ env = process.env, root = ROOT, timeoutMs = TIMEOUT_MS } = {}) {
  const target = detectTarget({ env, root })
  if (target !== 'local-power') return { target, tools: [], problem: null }
  const { tools, problem } = readState(root)
  return { target, tools: await Promise.all(tools.map((tool) => probeTool(tool, { env, timeoutMs }))), problem }
}

async function main(argv) {
  let root = ROOT
  let json = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') json = true
    else if (argv[i] === '--root' && argv[i + 1]) root = resolve(argv[++i])
    else console.error(`agent-target: ignoring "${argv[i]}"; usage: node scripts/agent-target.mjs [--root <checkout>] [--json]`)
  }
  const result = await report({ root })
  if (result.problem) console.error(`agent-target: ${result.problem}, so no tool is listed. Re-run the pack's bootstrap, or delete .local-power/ to go back to the baseline.`)
  if (json) {
    console.log(JSON.stringify(result))
    return
  }
  console.log(result.target)
  for (const tool of result.tools) console.log(`  ${tool.name}${tool.version ? ` ${tool.version}` : ''}: ${tool.status} (${tool.detail})`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Never a non-zero exit: an agent that can't learn where it is takes the baseline path.
  main(process.argv.slice(2)).catch((error) => {
    console.error(`agent-target: couldn't finish (${error?.message ?? error}); treat this session as core.`)
    console.log('core')
  })
}
