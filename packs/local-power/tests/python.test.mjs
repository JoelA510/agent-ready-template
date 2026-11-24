import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkRetrieval, install } from '../recipes/python.mjs'

const pack = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = async name => JSON.parse(await readFile(join(pack, 'integrations', name + '.manifest.json'), 'utf8'))

test('both Python installs select isolated hash-checked binary graphs and expose private launchers', async () => {
  const dir = await mkdtemp(join(tmpdir(), "local-power-python-'"))
  try {
    for (const name of ['mempalace', 'skillevaluator']) {
      const calls = [], assets = [], root = join(dir, name), home = join(root, 'home')
      await mkdir(home, { recursive: true })
      const spec = await manifest(name)
      const installed = await install({ name, dir: root, home, data: join(root, 'data'), pack, manifest: spec,
        tool: async tool => tool, run: async (...args) => calls.push(args), asset: async (...args) => assets.push(args) })
      const args = calls.find(call => call[1][0] === 'pip' && call[1][1] === 'sync')[1]
      assert.ok(args.includes('--require-hashes'))
      assert.equal(args[args.indexOf('--only-binary') + 1], ':all:')
      assert.equal(args.at(-1), join(pack, 'locks/python313-' + name + '.txt'))
      const lock = await readFile(args.at(-1), 'utf8')
      assert.match(lock, new RegExp('^' + name + '==' + spec.version.replaceAll('.', '\\.') + ' ', 'm'))
      assert.ok(lock.includes('--hash=' + spec.wheel))
      assert.ok(!/(?!^$)^[^-\s#][^\n]*(@ |https?:\/\/|git\+)/m.test(lock))
      const text = await readFile(join(root, installed.commands[name]), 'utf8')
      assert.match(text, /export HOME=/)
      assert.match(text, /"\$@"\n$/)
      if (name === 'mempalace') {
        assert.deepEqual(installed.mcp, { command: 'mempalace-mcp', args: [] })
        assert.equal(assets[0][0].sha256, '913d7300ceae3b2dbc2c50d1de4baacab4be7b9380491c27fab7418616a16ec3')
        assert.match(text, /MEMPALACE_PALACE_PATH=/)
      } else {
        assert.ok(!installed.mcp && !assets.length)
        assert.ok(installed.commands['qualify-tier2'])
      }
    }
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('MCP retrieval needs the server, tool, drawer and saved source rather than an echo of the query', () => {
  const marker = 'the sapphire courtyard marker is beside the archive desk'
  const source = '/private/fixture/docs/courtyard.md'
  const messages = [
    { id: 1, result: { serverInfo: { name: 'mempalace', version: '3.12.0' }, protocolVersion: '2025-03-26' } },
    { id: 2, result: { tools: [{ name: 'mempalace_search' }] } },
    { id: 3, result: { content: [{ type: 'text', text: JSON.stringify({ results: [{ drawer_id: 'drawer-one', text: marker, source_file: 'courtyard.md', source_path: source }] }) }] } },
  ]
  const encode = rows => rows.map(row => JSON.stringify({ jsonrpc: '2.0', ...row })).join('\n')
  const check = msgs => checkRetrieval(encode(msgs), source, '3.12.0')
  check(messages)
  assert.throws(() => check([...messages, messages[1]]))
  assert.throws(() => check([messages[0], messages[2]]))
  assert.throws(() => checkRetrieval(encode(messages), '/wrong/source', '3.12.0'))
  assert.throws(() => checkRetrieval(encode(messages), source, '3.11.0'))
  assert.throws(() => check([...messages.slice(0, 2), { ...messages[2], result: { isError: true, ...messages[2].result } }]))
  assert.throws(() => check([...messages.slice(0, 2), { id: 3, result: { content: [{ type: 'text', text: JSON.stringify({ query: marker, results: [] }) }] } }]))
})
