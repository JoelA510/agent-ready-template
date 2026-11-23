import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { is_current, status, verify_chain } from '../../continuity/gate.mjs'
import { fixtureGit } from './fixture-git'

const script = resolve(__dirname, '../../continuity/gate.mjs')
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
let root: string
const git = fixtureGit(() => root)
const ledger = () => join(root, 'continuity', 'ledger')
const recordPath = (id: string) => join(ledger(), id + '.json')
const records = () => existsSync(ledger()) ? readdirSync(ledger()).filter((name) => /^[a-f0-9]{64}\.json$/.test(name)) : []

function gate(...args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args, '--root', root], { cwd: root, encoding: 'utf8' })
  if (result.error) throw result.error
  return { exit: result.status, output: result.stdout + result.stderr }
}

function ok(...args: string[]) {
  const { exit, output } = gate(...args)
  expect(exit, output).toBe(0)
  return output
}

function rejected(...args: string[]) {
  const { exit, output } = gate(...args)
  expect([1, 2], output).toContain(exit)
  return output
}

function newRecord(...args: string[]) {
  const before = new Set(records())
  const output = ok(...args)
  const added = records().filter((name) => !before.has(name))
  expect(added, output).toHaveLength(1)
  const id = added[0].slice(0, -5)
  expect(output).toContain(id)
  return id
}

function decision(...extra: string[]) {
  return newRecord('append', '--workstream', 'core', '--title', 'Architecture', '--statement', 'Use the reviewed architecture.', '--cite', 'architecture.txt', ...extra)
}

function receipt(id: string, outcome = 'held', method = 'Compared test fixture with reviewed design') {
  return newRecord('revalidate', id, '--outcome', outcome, '--method', method)
}

function commit(message: string) {
  git('add', '-A')
  git('commit', '--no-verify', '-qm', message)
  return git('rev-parse', 'HEAD').trim()
}

function pr(base: string, body = '', stale = 'warn') {
  const event = join(root, '.git', 'pr-event.json')
  writeFileSync(event, JSON.stringify({ action: 'edited', pull_request: { body } }))
  return gate('check', '--base', base, '--tree', 'HEAD', '--event-file', event, '--stale', stale)
}

function expectPolicy(result: ReturnType<typeof gate>, pass: boolean, detail?: RegExp) {
  if (pass) expect(result.exit, result.output).toBe(0)
  else expect([1, 2], result.output).toContain(result.exit)
  if (detail) expect(result.output).toMatch(detail)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'continuity-gate-'))
  git('init', '-q', '-b', 'main')
  git('config', 'core.autocrlf', 'false')
  writeFileSync(join(root, 'architecture.txt'), 'approved architecture\n')
  commit('source snapshot')
})

afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('continuity content and Git provenance', { timeout: 60_000 }, () => {
  it('rejects a changed record byte by id and leaves the committed view intact', () => {
    rejected('verify')
    const id = decision()
    receipt(id)
    const base = commit('reviewed chain')
    ok('verify', '--tree', base)
    const raw = readFileSync(recordPath(id), 'utf8')
    expect(sha256(raw.slice(0, -1))).toBe(id)
    writeFileSync(recordPath(id), raw.replace('Architecture', 'architecture'))
    expect(rejected('verify')).toMatch(/hash|digest|filename|content.address/i)
    ok('verify', '--tree', base)
    const tree = commit('changed byte under original name')
    rejected('verify', '--base', base, '--tree', tree)
  })

  it('accepts an internally consistent replacement graph alone and rejects it against the protected base', () => {
    const original = decision()
    receipt(original)
    const base = commit('protected history')
    // Recompute both the decision identity and the downstream receipt's causal edge.
    for (const name of records()) rmSync(join(ledger(), name))
    const replacement = newRecord('append', '--workstream', 'core', '--title', 'Replacement', '--statement', 'A different decision.', '--cite', 'architecture.txt')
    expect(replacement).not.toBe(original)
    receipt(replacement)
    const tree = commit('replacement history with valid hashes')
    ok('verify', '--tree', tree)
    const result = rejected('verify', '--base', base, '--tree', tree)
    expect(result).toMatch(/base|append.only|removed|deleted|rewrite/i)
    expectPolicy(pr(base), false)
  })

  it('requires a canonical disk representation, valid parent DAG, strict schema and exactly one genesis', () => {
    const id = decision()
    const original = readFileSync(recordPath(id), 'utf8')
    const bytes = original.slice(0, -1)
    const variants = [
      bytes,
      bytes + '\r\n',
      bytes.replace('"v":1', '"v":1,"v":1') + '\n',
      bytes.replace('"v":1', '"v":2') + '\n',
      bytes.replace('"prev":[]', '"prev":["' + 'f'.repeat(64) + '"]') + '\n',
      bytes.replace('"title":', '"private_payload":true,"title":') + '\n',
    ]
    rmSync(recordPath(id))
    for (const raw of variants) {
      expect(raw).not.toBe(original)
      const name = recordPath(sha256(raw.endsWith('\n') ? raw.slice(0, -1) : raw))
      writeFileSync(name, raw)
      rejected('verify')
      rmSync(name)
    }
    writeFileSync(recordPath(id), original)
    const second = bytes.replace('Architecture', 'Other root')
    writeFileSync(recordPath(sha256(second)), second + '\n')
    rejected('verify')
  })

  it('hashes indexed bytes across checkout line endings and refuses unstaged evidence', () => {
    writeFileSync(join(root, '.gitattributes'), '*.txt text eol=crlf\n')
    writeFileSync(join(root, 'architecture.txt'), 'line one\r\nline two\r\n')
    commit('normalize the cited blob')
    const id = decision()
    const entry = JSON.parse(readFileSync(recordPath(id), 'utf8'))
    expect(entry.cites).toEqual([{ kind: 'git-file', path: 'architecture.txt', mode: '100644', sha256: sha256('line one\nline two\n') }])
    commit('record the decision before selecting its committed snapshot')
    writeFileSync(join(root, 'architecture.txt'), 'unreviewed change\r\n')
    rejected('revalidate', id, '--outcome', 'held', '--method', 'unreviewed worktree')
    const historical = newRecord('revalidate', id, '--outcome', 'held', '--method', 'immutable snapshot', '--tree', 'HEAD')
    expect(JSON.parse(readFileSync(recordPath(historical), 'utf8')).cites).toEqual(entry.cites)
  })

  it('has reproducible canonical UTF-8 bytes with nested citations and escaped characters', () => {
    const now = '2026-11-01T08:00:00Z'
    const title = 'Café "Ω"'
    const id = newRecord('append', '--now', now, '--workstream', 'core', '--title', title, '--statement', 'A \\ B', '--cite', 'architecture.txt')
    const canonical = '{"cites":[{"kind":"git-file","mode":"100644","path":"architecture.txt","sha256":"' +
      sha256('approved architecture\n') + '"}],"prev":[],"statement":"A \\\\ B","title":"Café \\"Ω\\"","ts":"2026-11-01T08:00:00Z","type":"decision","v":1,"workstream":"core"}'
    expect(readFileSync(recordPath(id))).toEqual(Buffer.from(canonical + '\n'))
    expect(id).toBe(sha256(canonical))
    expect(verify_chain({ root })).toBe(1)
    expect(is_current(id, { root })).toBe(false)
    receipt(id)
    expect(status(id, { root })).toBe('HELD')
  })

  it('binds external evidence to a tracked proof and expires it even when the Git tree is unchanged', () => {
    const now = '2026-11-01T08:00:00Z'
    const expiry = '2026-11-02T08:00:00Z'
    const path = join(root, '.git', 'ref.json')
    const ref = { kind: 'ref', uri: 'urn:example:review-1', expires_at: expiry, sha256: sha256('external document'), proof_path: 'architecture.txt', proof_sha256: sha256('approved architecture\n') }
    writeFileSync(path, JSON.stringify({ ...ref, proof_sha256: 'a'.repeat(64) }))
    const args = ['append', '--workstream', 'external', '--title', 'Reviewed source', '--statement', 'A source was checked.', '--ref-file', path, '--now', now]
    rejected(...args)
    writeFileSync(path, JSON.stringify(ref))
    const id = newRecord(...args)
    rejected('revalidate', id, '--outcome', 'held', '--method', 'missing observation')
    rejected('revalidate', id, '--outcome', 'held', '--method', 'duplicate observation', '--ref-file', path, '--ref-file', path)
    newRecord('revalidate', id, '--outcome', 'held', '--method', 'compared retained proof', '--ref-file', path, '--now', now)
    const tree = commit('observed external citation')
    expect(is_current(id, { root, tree, now })).toBe(true)
    expect(status(id, { root, tree, now: expiry })).toBe('STALE')
    writeFileSync(join(root, 'architecture.txt'), 'different proof\n')
    git('add', 'architecture.txt')
    expect(status(id, { root, now })).toBe('STALE')
  })

  it('preserves a public Nomos receipt link and refuses undeclared fields and unqualified ledger hashes', () => {
    const id = decision()
    const path = join(root, '.git', 'attestation.json')
    const metadata = { system: 'nomos', kind: 'ledger-entry', artifact_id: 'council-fixture/4', format_version: 'v1', artifact_sha256: sha256('synthetic ledger entry'), sequence: 4, ledger_hash: 'sha256:' + sha256('synthetic native content') }
    const args = ['revalidate', id, '--outcome', 'held', '--method', 'verified locally using fixture trust configuration', '--attest-file', path]
    for (const invalid of [{ ...metadata, bearer: 'not-allowed' }, { ...metadata, ledger_hash: metadata.artifact_sha256 }]) {
      writeFileSync(path, JSON.stringify(invalid))
      rejected(...args)
    }
    writeFileSync(path, JSON.stringify(metadata))
    const observed = newRecord(...args)
    expect(JSON.parse(readFileSync(recordPath(observed), 'utf8')).attestations).toEqual([metadata])
    ok('verify')
  })

  it('rejects a correctly rehashed receipt for a different workstream or incomplete coverage', () => {
    const id = decision()
    const observed = receipt(id)
    const body = readFileSync(recordPath(observed), 'utf8').slice(0, -1)
    rmSync(recordPath(observed))
    for (const changed of [
      body.replace('"workstream":"core"', '"workstream":"other"'),
      body.replace('"path":"architecture.txt"', '"path":"different.txt"'),
    ]) {
      expect(changed).not.toBe(body)
      const name = recordPath(sha256(changed))
      writeFileSync(name, changed + '\n')
      rejected('verify')
      rmSync(name)
    }
  })

  it('rejects unsafe and duplicate citations, unsupported Git modes and unavailable selectors', () => {
    for (const path of ['../escape', '.git/HEAD', 'continuity/ledger/x.json', '/absolute.txt', 'missing.txt']) {
      rejected('append', '--workstream', 'core', '--title', 'unsafe', '--statement', 'Bad input', '--cite', path)
    }
    rejected('append', '--workstream', 'core', '--title', 'duplicate', '--statement', 'Bad input', '--cite', 'architecture.txt', '--cite', 'architecture.txt')
    const id = decision()
    commit('genesis')
    rejected('verify', '--base', 'f'.repeat(40), '--tree', 'HEAD')
    rejected('is-current', 'bad-id')
    rejected('status', 'f'.repeat(64))
    const blob = git('rev-parse', 'HEAD:architecture.txt').trim()
    git('update-index', '--add', '--cacheinfo', '120000,' + blob + ',symbolic')
    git('commit', '--no-verify', '-qm', 'synthetic symlink entry')
    rejected('append', '--workstream', 'core', '--title', 'link', '--statement', 'Reject links.', '--cite', 'symbolic', '--tree', 'HEAD')
    ok('verify', '--tree', 'HEAD')
    expect(ok('status', id)).toMatch(/UNCHECKED/i)
  })
})

describe('continuity PR evidence selection and causal state', { timeout: 60_000 }, () => {
  it('enforces UNCHECKED and FAILED in both phases while permitting an evidence-only failure record', () => {
    const id = decision()
    const base = commit('unchecked decision')
    expect(gate('is-current', id).exit).toBe(1)
    expectPolicy(pr(base, 'continuity:' + id), false, /UNCHECKED/i)
    expectPolicy(pr(base, 'continuity:' + id, 'block'), false, /UNCHECKED/i)
    receipt(id)
    commit('held')
    ok('is-current', id.slice(0, 12))
    expectPolicy(pr(base, 'continuity:' + id), true)
    receipt(id, 'failed')
    commit('document a negative result')
    expectPolicy(pr(base), true)
    expectPolicy(pr(base, 'continuity:' + id), false, /FAILED/i)
    expectPolicy(pr(base, 'continuity:' + id, 'block'), false, /FAILED/i)
    expect(gate('is-current', id).exit).toBe(1)
    expect(ok('report', '--tree', 'HEAD', '--json')).toMatch(/failed/i)
    expectPolicy(gate('check', '--base', base, '--tree', 'HEAD', '--stale', 'warn', '--all'), false, /FAILED/i)
  })

  it('selects changed, renamed and missing cited files without markers; only STALE receives rollout grace', () => {
    const id = decision()
    receipt(id)
    const base = commit('current evidence')
    writeFileSync(join(root, 'architecture.txt'), Buffer.from([0, 255, 37, 13]))
    commit('binary input change')
    expectPolicy(pr(base), true, /STALE/i)
    expectPolicy(pr(base, '', 'block'), false, /STALE/i)
    expect(gate('is-current', id).exit).toBe(1)
    git('mv', 'architecture.txt', 'renamed.bin')
    commit('move cited input')
    expectPolicy(pr(base, '', 'block'), false, /STALE/i)
    rejected('revalidate', id, '--outcome', 'held', '--method', 'cannot observe absent file')
    const failure = receipt(id, 'failed', 'path disappeared')
    expect(JSON.parse(readFileSync(recordPath(failure), 'utf8')).cites).toEqual([{ kind: 'missing', path: 'architecture.txt' }])
  })

  it('checks added diff markers and edited PR bodies while ignoring deleted markers and template comments', () => {
    const id = decision()
    writeFileSync(join(root, 'old.txt'), 'continuity:' + id + '\n')
    mkdirSync(join(root, '.github'))
    const template = join(root, '.github', 'pull_request_template.md')
    writeFileSync(template, '<!-- Example citation\nexample\n-->\n')
    const base = commit('prior citation')
    rmSync(join(root, 'old.txt'))
    writeFileSync(template, '<!-- Example citation\ncontinuity:' + id + '\n-->\nordinary change\n')
    commit('remove the old citation')
    expectPolicy(pr(base, '<!-- continuity:' + id + ' -->'), true)
    expectPolicy(pr(base, 'continuity:' + 'f'.repeat(64)), false)
    expectPolicy(pr(base, 'continuity:not-a-hash'), false)
    expectPolicy(pr(base, 'continuity:' + id), false, /UNCHECKED/i)
    writeFileSync(join(root, 'notes.txt'), 'ordinary change\ncontinuity:' + id + '\n')
    commit('rely on unchecked decision')
    expectPolicy(pr(base), false, /UNCHECKED/i)
  })

  it('keeps conflicted branch evidence failed until a receipt follows both heads', () => {
    const id = decision()
    const base = commit('shared genesis')
    git('checkout', '-qb', 'other')
    const failed = receipt(id, 'failed')
    commit('negative independent check')
    git('checkout', '-q', 'main')
    const held = receipt(id)
    commit('positive independent check')
    git('merge', '-q', '--no-edit', 'other')
    ok('verify', '--base', base, '--tree', 'HEAD')
    expect(ok('status', id)).toMatch(/FAILED/i)
    const merged = receipt(id, 'held', 'reconciled the conflicting evidence')
    expect(JSON.parse(readFileSync(recordPath(merged), 'utf8')).prev).toEqual([failed, held].sort())
    ok('is-current', id)
  })

  it('folds divergent held observations to STALE and treats an executable-bit change as an input change', () => {
    const id = decision()
    const base = commit('shared decision')
    git('checkout', '-qb', 'executable')
    git('update-index', '--chmod=+x', 'architecture.txt')
    // Apply the synthetic index mode to this fixture's worktree on Unix too.
    git('checkout-index', '--force', '--', 'architecture.txt')
    git('commit', '--no-verify', '-qm', 'same bytes, executable evidence')
    newRecord('revalidate', id, '--outcome', 'held', '--method', 'reviewed executable', '--tree', 'HEAD')
    // Stage only the ledger, preserving the executable bit on filesystems without Unix modes.
    git('add', 'continuity/ledger')
    git('commit', '--no-verify', '-qm', 'observed executable')
    git('checkout', '-q', 'main')
    receipt(id)
    commit('reviewed ordinary file')
    git('merge', '-q', '--no-edit', 'executable')
    ok('verify', '--base', base, '--tree', 'HEAD')
    expect(status(id, { root, tree: 'HEAD' })).toBe('STALE')
    expectPolicy(pr(base, '', 'block'), false, /STALE/i)
    newRecord('revalidate', id, '--outcome', 'held', '--method', 'reviewed merged modes', '--tree', 'HEAD')
    expect(is_current(id, { root })).toBe(true)
  })

  it('keeps workstream outcomes independent and superseded decisions out of implicit selection', () => {
    const old = decision()
    receipt(old, 'failed')
    writeFileSync(join(root, 'local.txt'), 'local evidence\n')
    git('add', 'local.txt')
    const local = newRecord('append', '--workstream', 'local', '--title', 'Local policy', '--statement', 'Evaluate separately.', '--cite', 'local.txt')
    receipt(local)
    const next = newRecord('append', '--workstream', 'core', '--title', 'Revised', '--statement', 'Use a new input.', '--cite', 'local.txt', '--supersedes', old)
    receipt(next)
    const base = commit('two streams and a correction')
    writeFileSync(join(root, 'architecture.txt'), 'obsolete evidence\n')
    commit('touch only the superseded input')
    expectPolicy(pr(base, '', 'block'), true)
    expectPolicy(pr(base, 'continuity:' + old, 'block'), false, /STALE/i)
    ok('is-current', local)
    ok('is-current', next)
  })
})
