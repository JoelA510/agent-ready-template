import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

// Only recipe-owned launcher arguments go into the script. The shell passes the caller's argv unchanged.
const quote = (text) => "'" + text.replaceAll("'", "'\\''") + "'"

export async function install(ctx) {
  const { name, dir, home, data, manifest } = ctx
  const uv = await ctx.tool('uv')
  const python = await ctx.tool('python')
  const venv = join(dir, 'venv')
  const env = { UV_NO_CONFIG: '1', UV_PYTHON_DOWNLOADS: 'never', UV_CACHE_DIR: join(home, '.cache/uv') }
  await ctx.run(uv, ['venv', '--python', python, venv], { env })
  await ctx.run(uv, ['pip', 'sync', '--python', join(venv, 'bin/python'), '--require-hashes', '--only-binary', ':all:',
    '--index-url', 'https://pypi.org/simple', join(ctx.pack, manifest.locks[0])], { env, timeout: 1200000 })
  await ctx.run(uv, ['pip', 'check', '--python', join(venv, 'bin/python')], { env })

  const commands = {}
  const bin = join(dir, 'bin')
  await mkdir(bin, { recursive: true, mode: 0o700 })
  const setup = ['#!/bin/sh', 'set -eu', 'export HOME=' + quote(home)]
  async function launcher(command, ...argv) {
    commands[command] = 'bin/' + command
    await writeFile(join(bin, command), [...setup, 'exec ' + argv.map(quote).join(' ') + ' "$@"', ''].join('\n'), { mode: 0o700 })
  }
  if (name === 'mempalace') {
    const archive = join(home, '.cache/chroma/onnx_models/all-MiniLM-L6-v2/onnx.tar.gz')
    await mkdir(dirname(archive), { recursive: true, mode: 0o700 })
    await ctx.asset(manifest.model, archive)
    await mkdir(join(data, 'config'), { recursive: true, mode: 0o700 })
    // An explicit override lets a rehearsal use disposable data with exactly the installed launchers.
    setup.push('export MEMPALACE_CONFIG_DIR="${MEMPALACE_CONFIG_DIR:-}"',
      '[ -n "$MEMPALACE_CONFIG_DIR" ] || export MEMPALACE_CONFIG_DIR=' + quote(join(data, 'config')),
      'export MEMPALACE_PALACE_PATH="${MEMPALACE_PALACE_PATH:-}"',
      '[ -n "$MEMPALACE_PALACE_PATH" ] || export MEMPALACE_PALACE_PATH=' + quote(join(data, 'palace')),
      'export ANONYMIZED_TELEMETRY=False')
    for (const command of ['mempalace', 'mempalace-mcp', 'mempalace-light-mcp']) await launcher(command, join(venv, 'bin', command))
    return { commands, mcp: { command: 'mempalace-mcp', args: [] } }
  }
  if (name !== 'skillevaluator') throw new Error('Unknown Python integration')
  await launcher(name, join(venv, 'bin', name))
  // A local copy keeps the command tied to the enrolled recipe if the template checkout changes.
  const qualify = join(dir, 'qualify-tier2.py')
  await copyFile(join(ctx.pack, 'recipes', 'qualify-tier2.py'), qualify)
  await launcher('qualify-tier2', join(venv, 'bin/python'), qualify)
  return { commands }
}

const marker = 'the sapphire courtyard marker is beside the archive desk'

// Validate the JSON-RPC exchange and the file-backed result. An echo of the query alone cannot pass.
export function checkRetrieval(output, source, version) {
  const replies = new Map()
  for (const line of output.trim().split(/\r?\n/)) {
    const msg = JSON.parse(line)
    if (msg.jsonrpc !== '2.0' || msg.error || !msg.result || replies.has(msg.id)) throw new Error('Invalid MemPalace MCP response')
    replies.set(msg.id, msg.result)
  }
  const server = replies.get(1), tools = replies.get(2)?.tools, result = replies.get(3)
  if (replies.size !== 3 || server?.protocolVersion !== '2025-03-26' || server.serverInfo?.name !== 'mempalace' ||
    server.serverInfo.version !== version || !tools?.some(tool => tool.name === 'mempalace_search') || result?.isError ||
    !Array.isArray(result?.content)) throw new Error('MemPalace MCP negotiation or tool discovery failed')
  const found = result.content.filter(item => item.type === 'text').some(item =>
    JSON.parse(item.text).results?.some(row => row.source_path === source && row.source_file === 'courtyard.md' &&
      typeof row.drawer_id === 'string' && row.drawer_id.length > 0 && row.text?.includes(marker)))
  if (!found) throw new Error('MemPalace MCP did not retrieve the saved fixture')
}

async function smokePalace(ctx, scratch) {
  const docs = join(scratch, 'docs'), palace = join(scratch, 'palace'), source = join(docs, 'courtyard.md')
  await mkdir(docs)
  await writeFile(source, '# Courtyard archive\nIn our records ' + marker + '. Inspect the courtyard inventory to confirm its location.\n')
  const options = { cwd: scratch, env: { MEMPALACE_CONFIG_DIR: join(scratch, 'config'), MEMPALACE_PALACE_PATH: palace } }
  const command = join(ctx.dir, ctx.installed.commands.mempalace)
  await ctx.run(command, ['init', docs, '--palace', palace, '--backend', 'chroma', '--yes', '--auto-mine', '--no-llm', '--embedding-model', 'minilm'], options)
  const query = 'sapphire courtyard inventory'
  const text = await ctx.run(command, ['search', query, '--results', '1'], options)
  if (!text.includes('courtyard.md') || !text.includes(marker)) throw new Error('MemPalace CLI did not retrieve the saved fixture')
  const requests = [
    { id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'local-power-smoke', version: '1' } } },
    { method: 'notifications/initialized' },
    { id: 2, method: 'tools/list' },
    { id: 3, method: 'tools/call', params: { name: 'mempalace_search', arguments: { query, limit: 1 } } },
  ]
  const input = requests.map(msg => JSON.stringify({ jsonrpc: '2.0', ...msg })).join('\n') + '\n'
  const output = await ctx.run(join(ctx.dir, ctx.installed.commands['mempalace-mcp']), [], { ...options, input })
  checkRetrieval(output, source, ctx.manifest.version)
  return { cli: 'retrieved fixture', mcp: 'fresh server retrieved the same source and content', embedding: 'minilm' }
}

async function smokeEvaluator(ctx, scratch) {
  const executable = join(ctx.dir, ctx.installed.commands.skillevaluator)
  const python = join(ctx.dir, 'venv/bin/python')
  const versions = JSON.parse(await ctx.run(python, ['-c', 'import json, importlib.metadata as m; print(json.dumps([m.version("skillevaluator"), m.version("harbor")]))']))
  if (versions[0] !== ctx.manifest.version || versions[1] !== '0.25.0') throw new Error('Unexpected evaluator or Harbor build')
  const skill = join(scratch, 'catalog-lookup')
  await mkdir(join(skill, 'evals'), { recursive: true })
  await writeFile(join(skill, 'SKILL.md'), '---\nname: catalog-lookup\ndescription: Look up an archive reference in the inventory.\n---\nRead the inventory and return its reference number.\n')
  const evals = [
    { id: 'lookup', prompt: 'The inventory lists the courtyard record as 212. What is its reference number?', expected_output: 'The courtyard record is 212.', assertions: ['Returns 212.'] },
    { id: 'unrelated', prompt: 'What is two plus two?', expected_output: 'Four.', assertions: ['Returns four.'], should_trigger: false },
  ]
  await writeFile(join(skill, 'evals/evals.json'), JSON.stringify({ skill_name: 'catalog-lookup', evals }))
  const validation = JSON.parse(await ctx.run(executable, ['tier3', 'validate', skill, '--strict', '--json'], { cwd: scratch }))
  if (!Array.isArray(validation) || !validation.length || validation.some(item => item.status !== 'ok') ||
    !validation.some(item => item.coverage?.case_count === 2)) throw new Error('Strict Tier 3 dataset validation was incomplete')
  let tier1 = 'unavailable (Docker daemon required)'
  let docker
  try { docker = await ctx.run('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 10000 }) }
  catch { /* Docker is optional for the Python installation. The live scanner itself must succeed when available. */ }
  if (docker?.trim()) {
    const workflow = await readFile(join(ctx.repo, '.github/workflows/skill-eval-ci.yml'), 'utf8')
    const image = /^  TIER1_IMAGE: (ghcr\.io\/nvidia\/skillevaluator-tier1@sha256:[a-f0-9]{64})\s*$/m.exec(workflow)?.[1]
    if (!image) throw new Error('The shared Tier 1 gate has no qualified scanner image')
    await ctx.run(process.execPath, [join(ctx.repo, 'scripts/ci/skill-tier1.mjs'), 'selftest', join(scratch, 'controls')],
      { cwd: ctx.repo, timeout: 1200000, env: { TIER1_IMAGE: image } })
    tier1 = 'clean, malformed and security controls passed with ' + image
  }
  return { evaluator: versions[0], harbor: versions[1], tier1, tier2: 'requires authorized embedding and chat endpoints (qualify-tier2)',
    tier3: 'strict fixture validated; paired live runs require the benchmark authorization and budget' }
}

export async function smoke(ctx) {
  const scratch = await mkdtemp(join(ctx.dir, 'qualification-'))
  try {
    const evidence = ctx.name === 'mempalace' ? await smokePalace(ctx, scratch) : await smokeEvaluator(ctx, scratch)
    return JSON.stringify(evidence)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}
