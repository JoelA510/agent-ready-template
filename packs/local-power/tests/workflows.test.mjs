import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { install, smoke } from '../recipes/workflows.mjs'

const pack = fileURLToPath(new URL('../', import.meta.url))
function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'workflow-recipe-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('a mismatched direct npm pin stops before downloading the installer', async (t) => {
  const dir = scratch(t)
  let downloaded = false
  const manifest = JSON.parse(readFileSync(join(pack, 'integrations/ecc.manifest.json'), 'utf8'))
  await assert.rejects(install({ name: 'ecc', dir, pack, manifest: { ...manifest, pin: 'unrelated' },
    asset: () => { downloaded = true } }), /differs from its lock/)
  assert.equal(downloaded, false)
})

test('an empty native skill selection cannot qualify either harness', async () => {
  for (const name of ['gstack', 'ecc']) {
    await assert.rejects(smoke({ name, installed: { skills: [] } }), /Expected/)
  }
})

test('local static scanner rejects incomplete SARIF, findings, reused output and extra options', (t) => {
  const dir = scratch(t)
  const cli = join(dir, 'scanner.mjs')
  const run = { tool: { driver: { name: 'AgentShield' } }, invocations: [{ executionSuccessful: true }], properties: { filesScanned: 1 }, results: [] }
  writeFileSync(cli, [
    "import { readFileSync, writeFileSync } from 'node:fs'",
    "const target = process.argv[process.argv.indexOf('--path') + 1]",
    "const out = process.argv[process.argv.indexOf('--output') + 1]",
    "writeFileSync(out, readFileSync(target + '/fixture.json'))",
  ].join('\n'))
  function check(name, candidate, extra = []) {
    writeFileSync(join(dir, 'fixture.json'), JSON.stringify({ runs: [candidate] }))
    return spawnSync(process.execPath, [join(pack, 'recipes/agentshield-scan.mjs'), cli, 'scan', '--path', dir,
      '--output', join(dir, name), ...extra], { encoding: 'utf8' })
  }
  assert.equal(check('clean', run).status, 0)
  assert.match(check('clean', run).stderr, /new report path/)
  assert.match(check('empty', { ...run, properties: { filesScanned: 0 } }).stderr, /incomplete scan/)
  const blocked = check('finding', { ...run, results: [{ properties: { severity: 'critical' } }] })
  assert.equal(blocked.status, 1)
  assert.equal(JSON.parse(blocked.stdout).highOrCritical, 1)
  assert.match(check('unexpected', run, ['--fix']).stderr, /Usage:/)
})

test('a profile with a saved port rejects malformed connection arguments before invoking Compose', { skip: process.platform !== 'linux' }, (t) => {
  const data = scratch(t)
  const profile = join(data, 'postgres')
  mkdirSync(profile, { mode: 0o700 })
  writeFileSync(join(profile, 'port'), 'invalid', { mode: 0o600 })
  const result = spawnSync(process.execPath, [join(pack, 'postgres/profile.mjs'), data, data, 'gbrain', 'check'], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /port differs from the saved profile or is invalid/)
})

test('a migrated DB cannot qualify while another host owns the canonical source', { skip: process.platform !== 'linux' }, (t) => {
  const dir = scratch(t)
  const profile = join(dir, 'postgres')
  mkdirSync(profile, { mode: 0o700 })
  for (const [name, bytes] of [['port', '15439'], ['owner-password', 'a'.repeat(64)], ['app-password', 'b'.repeat(64)]]) {
    writeFileSync(join(profile, name), bytes, { mode: 0o600 })
  }
  writeFileSync(join(dir, 'docker'), '#!/bin/sh\nprintf "t\\n"\n', { mode: 0o700 })
  const binary = join(dir, 'gbrain')
  const writer = join(dir, 'writer.json')
  writeFileSync(binary, [
    '#!/bin/sh',
    'if [ "$2" = list ]; then echo \'{"sources":[{"id":"default"}]}\'; else cat "$TEST_WRITER"; fi',
    '',
  ].join('\n'), { mode: 0o700 })
  const check = () => spawnSync(process.execPath, [join(pack, 'postgres/profile.mjs'), dir, dir, binary, 'check'], {
    encoding: 'utf8', env: { ...process.env, PATH: dir + ':/usr/bin:/bin', TEST_WRITER: writer },
  })
  const state = { local_host_id: 'runtime', bindings: [{ source_id: 'default', owner_host_id: 'migration', state: 'active', local_path: dir }] }
  writeFileSync(writer, JSON.stringify(state))
  assert.match(check().stderr, /canonical default writer is not active/)
  state.bindings[0].owner_host_id = 'runtime'
  writeFileSync(writer, JSON.stringify(state))
  assert.equal(check().status, 0)
  writeFileSync(join(profile, 'pre-migration-config.json'), 'null', { mode: 0o600 })
  assert.match(check().stderr, /interrupted schema migration needs gbrain-pg up/)
})
