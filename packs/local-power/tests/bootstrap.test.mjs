import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { operate, parse } from '../bootstrap.mjs'
const pack = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function fixture(t) {
  const repo = mkdtempSync(join(tmpdir(), 'local-power-test-'))
  t.after(() => rmSync(repo, { force:true, recursive:true }))
  let version = '1', installs = 0, fail = false
  const args = { repo, pack, env: {}, platform: 'linux-x64',
    describe: (_, name) => ({ manifest: { name, version, capabilities:['fixture'] }, fingerprint: version }),
    recipe: async () => ({
      async install({dir, data}) {
        installs++
        writeFileSync(join(dir,'demo'), '#!/bin/sh\nexit 0\n', {mode:0o700})
        writeFileSync(join(data,'marker'), 'preserved')
        return { commands: { demo:'demo' }, mcp:{ command:'demo', args:[] } }
      },
      async smoke() { if (fail) throw Error('planted smoke failure'); return 'fixture answered' }
    }) }
  return { repo, args, run: (...a) => operate(parse(a), args), installs: () => installs, update: () => { version='2' }, fail: () => { fail=true } }
}

test('explicit opt-in, fail closed on unknown names and hosted activation', async t => {
  const f = fixture(t)
  assert.throws(() => parse(['--with','constructor']))
  assert.throws(() => parse(['--rollback','ecc','--with','gbrain']))
  assert.equal((await f.run('--plan','--with','ecc')).length,1)
  assert.equal(existsSync(join(f.repo,'.local-power')),false)
  f.args.env.CI = 'true'
  await assert.rejects(f.run('--with','ecc'), /local session/)
  assert.equal(f.installs(),0)
})

test('one pointer activates both native clients, idempotent install, rollback and disable keep data', async t => {
  const f = fixture(t)
  const state = join(f.repo,'.local-power')
  const current = join(state,'current')
  const link = () => realpathSync(current)
  await f.run('--with','ecc')
  const first = link()
  assert.match(readFileSync(join(current,'codex/config.toml'),'utf8'), /mcp_servers\.ecc/)
  assert.ok(existsSync(JSON.parse(readFileSync(join(current,'claude/mcp.json'))).mcpServers.ecc.command))
  await f.run('--check')
  await f.run('--with','ecc')
  assert.equal(f.installs(),1)
  assert.equal(link(),first)
  f.update()
  await assert.rejects(f.run('--check'),/pin/)
  await f.run('--with','ecc')
  await f.run('--rollback','ecc')
  assert.equal(JSON.parse(readFileSync(join(state,'state.json'))).tools[0].version,'1')
  await f.run('--disable','ecc')
  assert.equal(existsSync(join(state,'state.json')),false)
  assert.equal(readFileSync(join(state,'data/ecc/marker'),'utf8'),'preserved')
  await f.run('--rollback','ecc')
  assert.ok(existsSync(join(current,'bin/demo')))
})

test('partial install, failed smoke, foreign state, concurrent or symlinked writes cannot activate', async t => {
  const f=fixture(t), state=join(f.repo,'.local-power')
  mkdirSync(state)
  writeFileSync(join(state,'state.json'),'{}')
  await assert.rejects(f.run('--with','ecc'),/another setup/)
  rmSync(join(state,'state.json'))
  await f.run('--with','ecc')
  const active = realpathSync(join(state,'current'))
  mkdirSync(join(state,'bootstrap.lock'))
  await assert.rejects(f.run('--with','ecc'), /EEXIST/)
  rmSync(join(state,'bootstrap.lock'),{recursive:true})
  f.update(); f.fail()
  await assert.rejects(f.run('--with','ecc,gbrain'),/planted/)
  assert.equal(realpathSync(join(state,'current')),active)
  symlinkSync(f.repo,join(state,'data/gbrain'))
  await assert.rejects(f.run('--with','gbrain'),/private directory/)
  assert.equal(realpathSync(join(state,'current')),active)
})
