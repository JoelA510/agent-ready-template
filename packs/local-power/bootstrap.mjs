import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, renameSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { createContext, digestInputs, inside, privateDir } from './runtime.mjs'

const recipes = {
  workflows: () => import('./recipes/workflows.mjs'),
  python: () => import('./recipes/python.mjs'),
  nomos: () => import('./recipes/nomos.mjs'),
}

const packDir = dirname(fileURLToPath(import.meta.url))
const sources = { gstack: 'workflows', ecc: 'workflows', agentshield: 'workflows', gbrain: 'workflows', mempalace: 'python', skillevaluator: 'python', nomos: 'nomos' }
const names = Object.keys(sources)
const safeName = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/
const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const save = (p, value) => writeFileSync(p, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
const shell = (s) => "'" + s.replaceAll("'", "'\\''") + "'"

export function parse(argv) {
  if (!argv.length) return { mode: 'plan', names }
  let mode, selected
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (['--plan','--check','--rollback','--disable'].includes(key)) {
      if (mode) throw Error('Select one operation')
      mode = key.slice(2)
    }
    if (['--with','--disable','--rollback'].includes(key)) {
      if (selected) throw Error('Select tools once')
      selected = (argv[++i] ?? '').split(',')
      if (selected.some(n => !Object.hasOwn(sources, n)) || new Set(selected).size !== selected.length) throw Error('Unknown or duplicate integration')
    } else if (!['--plan','--check'].includes(key)) throw Error('Unknown option ' + key)
  }
  return { mode: mode ?? 'install', names: selected ?? (mode === 'plan' ? names : []) }
}

function readManifest(pack, name) {
  const file = 'integrations/' + name + '.manifest.json'
  const manifest = read(join(pack, file))
  if (manifest.name !== name || !safeName.test(manifest.version) || !manifest.license || !/^(?:[0-9a-f]{40}|[0-9a-f]{64}|sha512-[A-Za-z0-9+/]{86}==)$/.test(manifest.pin) || new URL(manifest.source).protocol !== 'https:' ||
      !manifest.platforms?.includes('linux-x64') || !Array.isArray(manifest.locks) || !Array.isArray(manifest.toolchains) ||
      !manifest.capabilities?.length || !manifest.smoke || !manifest.rollback) throw Error('Incomplete manifest for ' + name)
  const inputs = [file, 'bootstrap.mjs', 'runtime.mjs', 'toolchains.lock.json', 'recipes/' + sources[name] + '.mjs', 'claude/settings.local.json.tmpl', 'codex/local-power.config.toml.tmpl', ...manifest.locks]
  if (name === 'skillevaluator') inputs.push('skills/skill-lift/SKILL.md')
  const shared = manifest.sharedLocks ?? []
  const allowed = 'evals/skill-lift/evaluator.requirements.txt'
  if (shared.length && (name !== 'skillevaluator' || shared.length !== 1 || shared[0] !== allowed)) throw Error('Unknown shared runtime lock')
  const fingerprint = digestInputs(pack, inputs) + (shared.length ? '.' + digestInputs(resolve(pack,'../..'), shared) : '')
  return { manifest, fingerprint }
}

function render(gen, pack, registry, state) {
  const paths = ['bin', 'claude', 'claude/skills', 'codex', 'codex/skills']
  for (const path of paths) privateDir(join(gen, path))
  const claude = {}
  const tools = []
  let config = ''
  for (const [name, item] of Object.entries(registry.active)) {
    const dir = withinInstall(state, item.dir)
    const { commands, mcp, probe, skills = [] } = item.installed
    const commandPath = (key) => {
      if (!Object.hasOwn(commands, key)) throw Error('Unregistered command ' + key)
      return inside(dir, realpathSync(join(dir, commands[key])))
    }
    if (!Object.keys(commands).length) throw Error('No commands for ' + name)
    for (const key of Object.keys(commands)) {
      if (!safeName.test(key)) throw Error('Invalid command ' + key)
      symlinkSync(commandPath(key), join(gen, 'bin', key))
    }
    if (mcp) {
      const command = commandPath(mcp.command)
      if (!Array.isArray(mcp.args) || mcp.args.some(s => typeof s !== 'string')) throw Error('Invalid MCP arguments')
      claude[name] = { type: 'stdio', command, args: mcp.args }
      config += '\n[mcp_servers.' + name + ']\ncommand = ' + JSON.stringify(command) + '\nargs = ' + JSON.stringify(mcp.args) + '\nrequired = false\n'
    }
    for (const skill of skills) {
      if (!['claude','codex'].includes(skill.harness) || !safeName.test(skill.name)) throw Error('Invalid skill registration')
      const path = inside(dir, realpathSync(join(dir, skill.path)))
      inside(dir, realpathSync(join(path, 'SKILL.md')))
      symlinkSync(path, join(gen, skill.harness, 'skills', skill.name))
    }
    tools.push({ name, version: item.version, probe: probe ?? { type: 'command', command: Object.keys(commands)[0] } })
  }
  if (registry.active.skillevaluator) {
    for (const harness of ['claude','codex']) {
      const path = privateDir(join(gen, harness, 'skills', 'skill-lift'))
      writeFileSync(join(path,'SKILL.md'), readFileSync(join(pack,'skills/skill-lift/SKILL.md')), { mode: 0o600 })
    }
  }
  save(join(gen, 'registry.json'), registry)
  if (tools.length) save(join(gen, 'state.json'), { version: 1, tools })
  save(join(gen, 'claude', 'mcp.json'), { mcpServers: claude })
  writeFileSync(join(gen, 'codex', 'config.toml'), config, { mode: 0o600 })
  writeFileSync(join(gen, 'codex', 'local-power.config.toml'), readFileSync(join(pack, 'codex/local-power.config.toml.tmpl')), { mode: 0o600 })
  for (const harness of ['claude','codex']) {
    const root = join(gen, harness)
    if (harness === 'claude') writeFileSync(join(root, 'settings.json'), readFileSync(join(pack, 'claude/settings.local.json.tmpl')), { mode: 0o600 })
    const args = harness === 'codex' ? ' --profile local-power' : ' --mcp-config ' + shell(join(root,'mcp.json'))
    const runtimeEnv = registry.active.gstack ? 'export GSTACK_STATE_ROOT=' + shell(join(state, 'data', 'gstack')) + '\n' : ''
    const variable = harness === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR'
    writeFileSync(join(gen, 'bin', harness + '-local-power'), '#!/bin/sh\n' + runtimeEnv + 'export ' + variable + '=' + shell(root) + '\nexport PATH=' + shell(join(gen,'bin')) + ':"$PATH"\nexec ' + harness + args + ' "$@"\n', { mode: 0o700, flag: 'wx' })
  }
}

function withinInstall(state, path) {
  const dir = join(state, 'installs', path)
  if (basename(path) !== path || !safeName.test(path) || realpathSync(dir) !== dir) throw Error('Unexpected install directory')
  return dir
}

export async function operate(op, { repo = resolve(packDir, '../..'), pack = packDir, env = process.env, platform = process.platform + '-' + process.arch,
  describe = readManifest, recipe = (name) => recipes[sources[name]](), context = createContext } = {}) {
  const result = []
  if (op.mode === 'plan') return op.names.map(name => {
    const { manifest } = describe(pack, name)
    return name + ' ' + manifest.version + ' — ' + manifest.capabilities.join(', ')
  })
  if (env.CLAUDE_CODE_REMOTE === 'true' || env.CI || env.GITHUB_ACTIONS || env.CODEX_CLOUD) throw Error('Local operations require a local session')
  if (platform !== 'linux-x64') throw Error('Use Linux x86-64 or WSL2')
  const state = join(realpathSync(repo), '.local-power')
  if (op.mode === 'check' && !existsSync(state)) throw Error('No active local installation')
  privateDir(state)
  const lock = join(state, 'bootstrap.lock')
  mkdirSync(lock, { mode: 0o700 })
  try {
    writeFileSync(join(lock, 'owner'), process.pid + '\n', { mode: 0o600 })
    const current = join(state, 'current'), publicState = join(state,'state.json')
    const old = existsSync(current) ? realpathSync(current) : null
    if (old) inside(join(state,'generations'), old)
    if (lstatSync(publicState, { throwIfNoEntry: false }) && (!lstatSync(publicState).isSymbolicLink() || readlinkSync(publicState) !== 'current/state.json')) throw Error('Existing state.json belongs to another setup. Move it aside before enabling the pack.')
    const registry = old ? read(join(old,'registry.json')) : { active: {}, previous: {} }
    for (const sub of ['installs','data','toolchains','generations']) privateDir(join(state, sub))
    const tools = read(join(pack, 'toolchains.lock.json'))
    let changed = false
    const selected = op.names.length ? op.names : Object.keys(registry.active)
    if (!selected.length && op.mode === 'check') throw Error('No active tools to check')
    for (const name of selected) {
      const active = registry.active[name]
      if (op.mode === 'disable') {
        if (active) { registry.previous[name] = active; delete registry.active[name]; changed = true }
        continue
      }
      if (op.mode === 'rollback') {
        const prior = registry.previous[name]
        if (!prior) throw Error('No previous activation for ' + name)
        registry.active[name] = prior
        if (active) registry.previous[name] = active
        else delete registry.previous[name]
        changed = true
        continue
      }
      const { manifest, fingerprint } = describe(pack, name)
      if (op.mode === 'check' && active?.fingerprint !== fingerprint) throw Error('Missing or different installed pin for ' + name)
      const reuse = active?.fingerprint === fingerprint
      const dir = reuse ? withinInstall(state, active.dir) : mkdtempSync(join(state, 'installs', name + '-'))
      const handler = await recipe(name)
      const ctx = context({ state, dir, name, repo, pack, tools, manifest, installed: reuse ? active.installed : undefined })
      if (!reuse) ctx.installed = await handler.install(ctx)
      const evidence = await handler.smoke(ctx)
      if (typeof evidence !== 'string' || !evidence.trim()) throw Error('Empty smoke evidence for ' + name)
      result.push(name + ': ' + evidence)
      if (!reuse) {
        if (active) registry.previous[name] = active
        registry.active[name] = { dir: basename(dir), version: manifest.version, fingerprint, installed: ctx.installed }
        changed = true
      }
    }
    if (changed) {
      const gen = mkdtempSync(join(state, 'generations','profile-'))
      render(gen, pack, registry, state)
      const link = join(state, '.next-' + randomUUID())
      symlinkSync(relative(state, gen), link)
      if (!lstatSync(publicState, { throwIfNoEntry: false })) symlinkSync('current/state.json', publicState)
      renameSync(link, current)
      result.push('Published ' + relative(state, gen))
    }
    return result
  } finally { unlinkSync(join(lock,'owner')); rmdirSync(lock) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  operate(parse(process.argv.slice(2))).then(lines => console.log(lines.join('\n'))).catch(e => { console.error(e.message); process.exitCode = 1 })
}
