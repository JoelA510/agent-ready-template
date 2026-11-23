import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function install(ctx) {
  const source = join(ctx.dir, 'upstream')
  ctx.checkout(ctx.manifest.source, ctx.manifest.pin, source)
  const config = join(ctx.dir, 'nomos')
  cpSync(join(ctx.pack, 'nomos'), config, { recursive: true })
  const lock = JSON.parse(readFileSync(join(config, 'deployment.lock.json'), 'utf8'))
  for (const [path, expected] of Object.entries(lock.upstream)) {
    const actual = createHash('sha256').update(readFileSync(join(source, path))).digest('hex')
    if (actual !== expected) throw new Error(`Nomos upstream lock mismatch: ${path}`)
  }
  const uv = await ctx.tool('uv')
  const python = await ctx.tool('python')
  ctx.run(uv, ['sync', '--frozen', '--no-dev', '--extra', 'grpc', '--no-editable', '--python', python], {
    cwd: source, env: { UV_PROJECT_ENVIRONMENT: join(ctx.dir, 'venv') }, timeout: 600000,
  })
  // The upstream council image installs an unpinned uv. The qualified build uses the pack binary.
  copyFileSync(uv, join(source, '.local-power-uv'))
  chmodSync(join(source, '.local-power-uv'), 0o755)
  mkdirSync(join(ctx.dir, 'bin'), { recursive: true })
  mkdirSync(ctx.data, { recursive: true, mode: 0o700 })
  writeFileSync(join(config, 'state-path.json'), JSON.stringify(ctx.data), { mode: 0o600 })
  const commands = {}
  for (const [name, script] of [['nomos-receipt', 'receipt.py'], ['nomos-operator', 'operator_cli.py']]) {
    commands[name] = `bin/${name}`
    writeFileSync(join(ctx.dir, commands[name]), `#!/bin/sh
set -eu
entry=$(readlink -f -- "$0")
root=$(CDPATH= cd -- "$(dirname -- "$entry")/.." && pwd)
exec "$root/venv/bin/python" -I "$root/nomos/${script}" "$@"
`, { mode: 0o700 })
  }
  return { commands }
}

export async function smoke(ctx) {
  ctx.run(join(ctx.dir, 'venv/bin/python'), ['-I', join(ctx.dir, 'nomos/test_deployment.py')])
  const result = ctx.run(join(ctx.dir, ctx.installed.commands['nomos-receipt']), ['self-test'])
  const controls = JSON.parse(result)
  if (controls.offline_receipts !== 'passed' || controls.denials < 1) throw new Error('Nomos receipt controls failed')
  return `Signed receipt matched its enrolled keys and ${controls.denials} negative receipt controls passed. Live deployment and execution require separate operator enrollment.`
}
