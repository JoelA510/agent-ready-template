import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const NPM = { url: 'https://registry.npmjs.org/npm/-/npm-11.19.0.tgz', sha256: '31e9770f7dc71119a58509353b27917557aaf0ac9b5ef1a0465ee7d8ec67ae75' }
const SHA = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'"
const mkdir = (path) => mkdirSync(path, { recursive: true, mode: 0o700 })

// Absolute, immutable paths: each old launcher still addresses its own release on rollback.
function launcher(ctx, name, argv, env = {}) {
  const path = 'bin/' + name
  mkdir(join(ctx.dir, 'bin'))
  const vars = Object.entries(env).map(([key, value]) => key + '=' + quote(value))
  writeFileSync(join(ctx.dir, path), ['#!/bin/sh', 'exec env ' + [...vars, ...argv.map(quote), '"$@"'].join(' '), ''].join('\n'), { flag: 'wx', mode: 0o700 })
  return path
}

async function installNpm(ctx) {
  const dir = join(ctx.dir, 'npm-tools')
  mkdir(dir)
  const lockDir = join(ctx.pack, 'locks', ctx.name)
  for (const file of ['package.json', 'package-lock.json']) copyFileSync(join(lockDir, file), join(dir, file))
  const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8')).packages
  const pkg = ctx.name === 'ecc' ? 'ecc-universal' : 'ecc-agentshield'
  const locked = lock['node_modules/' + pkg]
  if (locked.integrity !== ctx.manifest.pin || locked.version !== ctx.manifest.version || locked.resolved !== ctx.manifest.source) throw Error('npm integration pin differs from its lock')
  for (const [path, entry] of Object.entries(lock)) {
    if (path && (!entry.resolved?.startsWith('https://registry.npmjs.org/') || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity))) throw Error('Expected integral registry packages in the local lock')
  }
  const archive = join(ctx.dir, 'npm.tgz')
  const release = join(ctx.dir, 'npm-release')
  mkdir(release)
  await ctx.asset(NPM, archive)
  ctx.run('tar', ['-xzf', archive, '--no-same-owner', '-C', release])
  rmSync(archive)
  ctx.run(process.execPath, [join(release, 'package/bin/npm-cli.js'), 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: dir, env: { NPM_CONFIG_CACHE: join(ctx.home, '.npm'), NPM_CONFIG_ALLOW_GIT: 'none', NPM_CONFIG_ALLOW_REMOTE: 'none' },
  })
  return join(dir, 'node_modules', pkg)
}

const ECC_SKILLS = {
  claude: { dir: 'skills/tdd-workflow', sha: '8887afa786ef30de834e7567115d3df71934b343c3d9d849714f8ea43f979ee0' },
  codex: { dir: '.agents/skills/tdd-workflow', sha: 'e9507695657b05f26dd62127f1d6ff58e4015d624df65dd4d7e07f6470317393' },
}

function withSkillName(bytes, original, name) {
  const end = bytes.indexOf('\n---\n', 4)
  const field = '\nname: ' + original + '\n'
  if (!bytes.startsWith('---\n') || end < 0 || !(bytes.slice(0, end) + '\n').includes(field)) throw Error('Expected published skill name ' + original)
  return bytes.replace(field, '\nname: ' + name + '\n')
}

// The native name comes from frontmatter. Keep a namespaced projection alongside the exact
// upstream bytes so tools and built-in commands with names such as "review" can coexist.
function projectSkill(ctx, harness, source, original, name) {
  const path = 'profiles/' + harness + '/' + name
  const dest = join(ctx.dir, path)
  mkdir(dirname(dest))
  cpSync(source, dest, { recursive: true, verbatimSymlinks: true })
  const skill = join(dest, 'SKILL.md')
  if (!lstatSync(skill).isFile()) throw Error('Expected a regular skill descriptor: ' + name)
  writeFileSync(skill, withSkillName(readFileSync(skill, 'utf8'), original, name))
  return { harness, name, path }
}

async function installEcc(ctx) {
  await installNpm(ctx)
  const root = 'npm-tools/node_modules/ecc-universal'
  const skills = Object.entries(ECC_SKILLS).map(([harness, skill]) =>
    projectSkill(ctx, harness, join(ctx.dir, root, skill.dir), 'tdd-workflow', 'ecc-tdd-workflow'))
  return { commands: { ecc: launcher(ctx, 'ecc', [process.execPath, join(ctx.dir, root, 'scripts/ecc.js')], { HOME: ctx.home }) }, skills }
}

async function installAgentShield(ctx) {
  const pkg = await installNpm(ctx)
  const scan = join(ctx.dir, 'agentshield-scan.mjs')
  copyFileSync(join(ctx.pack, 'recipes/agentshield-scan.mjs'), scan)
  const path = launcher(ctx, 'agentshield', [process.execPath, scan, join(pkg, 'dist/index.js')], { HOME: ctx.home })
  return { commands: { agentshield: path } }
}

async function installGstack(ctx) {
  const bun = await ctx.tool('bun')
  const src = ctx.checkout(ctx.manifest.source, ctx.manifest.pin, join(ctx.dir, 'source'))
  if (SHA(join(src, 'bun.lock')) !== ctx.manifest.bunLockSha256) throw Error('gstack bun.lock digest mismatch')
  if (!/^\/[A-Za-z0-9_.@+/-]+$/.test(src)) throw Error('The gstack native renderer requires an absolute install root without spaces or shell metacharacters')
  // Refuse the mutable dependency fallback in upstream setup. The product skills use the
  // frozen checkout plus this exact lock. The renderer writes into private output directories.
  ctx.run(bun, ['install', '--frozen-lockfile', '--ignore-scripts'], { cwd: src, env: { BUN_INSTALL_CACHE_DIR: join(ctx.home, 'bun-cache') } })
  const skills = []
  for (const harness of ['claude', 'codex']) {
    const render = 'render-' + harness
    const out = join(ctx.dir, render)
    ctx.run(bun, ['--no-install', '--no-env-file', '--config=/dev/null', join(src, 'scripts/gen-skill-docs.ts'),
      '--host', harness, '--out-dir', out, '--link-root', out, '--install-root', src], { cwd: src })
    for (const name of ['review', 'eval-plan', 'context-save', 'context-restore', harness === 'claude' ? 'codex' : 'claude-code']) {
      const path = harness === 'claude' ? render + '/' + name : render + '/.agents/skills/gstack-' + name
      skills.push(projectSkill(ctx, harness, join(ctx.dir, path), name, 'gstack-' + name))
    }
  }
  const env = { HOME: ctx.home, GSTACK_STATE_ROOT: ctx.data, PATH: dirname(bun) + ':' + ctx.env.PATH }
  ctx.run(join(src, 'bin/gstack-config'), ['set', 'update_check', 'false'], { cwd: src, env })
  return { commands: {
    bun: launcher(ctx, 'bun', [bun]),
    'gstack-eval-plan': launcher(ctx, 'gstack-eval-plan', [bun, '--no-install', '--no-env-file', '--config=/dev/null', join(src, 'bin/gstack-eval-plan')], env),
  }, skills }
}

async function installGbrain(ctx) {
  const bin = join(ctx.dir, 'gbrain-linux-x64')
  await ctx.asset({ url: ctx.manifest.source, sha256: ctx.manifest.pin }, bin)
  chmodSync(bin, 0o700)
  // An application checkout may export its own DATABASE_URL or load it from .env.
  const env = { HOME: ctx.home, GBRAIN_HOME: ctx.data, GBRAIN_DATABASE_URL: '', DATABASE_URL: '' }
  // GBRAIN_HOME points to the parent of .gbrain. Keep a separate parent for the PG profile.
  if (!existsSync(join(ctx.data, '.gbrain/config.json'))) {
    ctx.run(bin, ['init', '--pglite', '--no-embedding'], { env })
    ctx.run(bin, ['config', 'set', 'self_upgrade.mode', 'off'], { env })
  }
  mkdir(join(ctx.dir, 'postgres'))
  for (const path of ctx.manifest.locks) copyFileSync(join(ctx.pack, path), join(ctx.dir, path))
  return { commands: {
    gbrain: launcher(ctx, 'gbrain', [bin], env),
    'gbrain-pg': launcher(ctx, 'gbrain-pg', [process.execPath, join(ctx.dir, 'postgres/profile.mjs'), ctx.dir, ctx.data, bin], { HOME: ctx.home }),
  }, mcp: { command: 'gbrain', args: ['serve', '--surface', 'verbs'] } }
}

const installers = { gstack: installGstack, ecc: installEcc, agentshield: installAgentShield, gbrain: installGbrain }
export async function install(ctx) { return installers[ctx.name](ctx) }

function smokeGstack(ctx, scratch) {
  if (ctx.installed.skills.length !== 10) throw Error('Expected five native gstack skills per harness')
  for (const { path, name } of ctx.installed.skills) {
    const text = readFileSync(join(ctx.dir, path, 'SKILL.md'), 'utf8')
    if (!text.includes(join(ctx.dir, 'source')) || !text.includes('\nname: ' + name + '\n')) throw Error('gstack skill has the wrong name or runtime root: ' + path)
  }
  const sections = ['Bars', 'Arms', 'Decoys', 'Stop rules', 'Held-out exposure']
  const fixture = join(scratch, 'prereg.md')
  writeFileSync(fixture, sections.map((s) => '## ' + s + '\n- One deterministic, offline trial.').join('\n') +
    '\n## Comparison\nstack: none\nwhy: one local validator\n')
  const argv = ['prereg', '--check', fixture, '--json']
  const bin = join(ctx.dir, ctx.installed.commands['gstack-eval-plan'])
  const verdict = JSON.parse(ctx.run(bin, argv, { cwd: scratch }))
  if (verdict.ok !== true || verdict.missing?.length !== 0) throw Error('gstack rejected the complete preregistration')
  writeFileSync(fixture, '## Bars\n- Missing the remaining sections.\n')
  try { ctx.run(bin, argv, { cwd: scratch }) } catch (error) {
    if (/\(1\)$/.test(error.message)) return 'Both harnesses have their named workflow skills. The pinned preregistration CLI accepted the complete plan and rejected its incomplete control.'
    throw error
  }
  throw Error('gstack accepted an incomplete preregistration')
}

function smokeAgentShield(ctx, scratch) {
  for (const planted of [false, true]) {
    const dir = join(scratch, planted ? 'permission' : 'clean')
    mkdir(join(dir, '.claude'))
    writeFileSync(join(dir, '.claude/settings.json'), JSON.stringify({ permissions: { allow: [planted ? 'Bash(*)' : 'Read(src/**)'], deny: ['Read(.env)'] } }))
    const output = join(dir, 'result.sarif')
    try {
      ctx.run(join(ctx.dir, ctx.installed.commands.agentshield), ['scan', '--path', dir, '--output', output])
      if (planted) throw Error('AgentShield accepted the planted permission')
    } catch (error) {
      if (!planted || !/\(1\)$/.test(error.message)) throw error
    }
    const [{ results, properties }] = JSON.parse(readFileSync(output, 'utf8')).runs
    if (properties.filesScanned !== 1 || (planted ? !results.some(r => r.ruleId === 'permissions-permissive-Bash(*)' && r.properties?.severity === 'critical') : results.length !== 0)) throw Error('AgentShield missed its expected scan target or finding')
  }
  return 'Offline scan examined both settings files and rejected the wildcard permission.'
}

function smokeGbrain(ctx, scratch) {
  const bin = join(ctx.dir, 'gbrain-linux-x64')
  const opts = { cwd: scratch, env: { HOME: scratch, GBRAIN_HOME: scratch } }
  const docs = join(scratch, 'docs')
  mkdir(docs)
  writeFileSync(join(docs, 'wingplan.md'), '# Wingplan\n\nThe orangesaffron workshop opens tomorrow.\n')
  if (ctx.run(join(ctx.dir, ctx.installed.commands.gbrain), ['--version']).trim() !== 'gbrain ' + ctx.manifest.version) throw Error('gbrain version mismatch')
  ctx.run(bin, ['init', '--pglite', '--no-embedding'], opts)
  const imported = JSON.parse(ctx.run(bin, ['import', docs, '--no-embed', '--json'], opts))
  const rows = JSON.parse(ctx.run(bin, ['search', 'orangesaffron', '--json'], opts))
  if (imported.imported !== 1 || imported.errors !== 0 || !rows.some(r => r.slug === 'wingplan' && r.keyword_hit === true && r.chunk_text.includes('orangesaffron'))) throw Error('gbrain did not retrieve the imported fixture')
  return 'Keyless embedded import added one page and keyword search retrieved its exact content.'
}

export async function smoke(ctx) {
  if (ctx.name === 'ecc') {
    for (const { harness, name, path } of ctx.installed.skills) {
      const source = join(ctx.dir, 'npm-tools/node_modules/ecc-universal', ECC_SKILLS[harness].dir, 'SKILL.md')
      if (SHA(source) !== ECC_SKILLS[harness].sha || readFileSync(join(ctx.dir, path, 'SKILL.md'), 'utf8') !==
          withSkillName(readFileSync(source, 'utf8'), 'tdd-workflow', name)) throw Error('ECC native skill content differs from the published source for ' + harness)
    }
    if (ctx.installed.skills.length !== 2) throw Error('Expected both ECC native skill projections')
    return 'Both published tdd-workflow skills match their pinned harness-specific hashes.'
  }
  const scratch = mkdtempSync(join(tmpdir(), 'local-power-smoke-'))
  try { return { gstack: smokeGstack, agentshield: smokeAgentShield, gbrain: smokeGbrain }[ctx.name](ctx, scratch) }
  finally { rmSync(scratch, { recursive: true, force: true }) }
}
