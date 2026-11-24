import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, createWriteStream, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, unlinkSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export function inside(root, path) {
  const part = relative(root, resolve(path))
  if (!part || part === '..' || part.startsWith('..' + sep) || isAbsolute(part)) throw Error('Path leaves its private directory')
  return path
}

export function privateDir(path) {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 })
  if (!lstatSync(path).isDirectory() || realpathSync(path) !== path) throw Error('Expected a private directory: ' + path)
  chmodSync(path, 0o700)
  return path
}

function childCommand(executable, args, { cwd, env, input, timeout = 300000 }) {
  try {
    return execFileSync(executable, args, { cwd, env, input, timeout, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (e) {
    // Upstream diagnostics can contain environment values and model responses.
    throw Error('Local command ' + executable.split('/').pop() + ' failed (' + (e.code ?? e.signal ?? e.status) + ')')
  }
}

async function asset({ url, sha256 }, dest) {
  if (new URL(url).protocol !== 'https:' || !/^[a-f0-9]{64}$/.test(sha256)) throw Error('Expected an HTTPS SHA-256 asset')
  const tmp = dest + '.' + randomUUID()
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(600000) })
    if (!response.ok || new URL(response.url).protocol !== 'https:') throw Error('Asset download failed: HTTP ' + response.status)
    const digest = createHash('sha256')
    await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, _, next) { digest.update(chunk); next(null, chunk) } }),
      createWriteStream(tmp, { flags: 'wx', mode: 0o600 }))
    if (digest.digest('hex') !== sha256) throw Error('Asset checksum mismatch')
    renameSync(tmp, dest)
  } finally { if (existsSync(tmp)) unlinkSync(tmp) }
}

export function createContext({ repo, pack, state, name, dir, manifest, tools, installed }) {
  const home = privateDir(join(dir, 'home'))
  const data = privateDir(join(state, 'data', name))
  const env = { HOME: home, PATH: dirname(process.execPath) + ':/usr/local/bin:/usr/bin:/bin',
    LANG: 'C.UTF-8', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
    UV_NO_CONFIG: '1', PYTHONNOUSERSITE: '1', NPM_CONFIG_USERCONFIG: '/dev/null' }
  const run = (cmd, args, opts = {}) => childCommand(cmd, args, { ...opts, cwd: opts.cwd ?? dir, env: { ...env, ...opts.env } })
  function checkout(url, pin, dest) {
    if (new URL(url).protocol !== 'https:' || !/^[a-f0-9]{40}$/.test(pin)) throw Error('Expected a Git commit and HTTPS source')
    inside(dir, dest)
    run('git', ['init', '-q', dest])
    const git = (...args) => run('git', ['-c', 'core.hooksPath=/dev/null', '-C', dest, ...args])
    git('fetch', '-q', '--depth=1', url, pin)
    git('checkout', '-q', '--detach', 'FETCH_HEAD')
    if (git('rev-parse', 'HEAD').trim() !== pin) throw Error('Git pin mismatch')
    return dest
  }
  async function tool(id) {
    if (!manifest.toolchains.includes(id) || !Object.hasOwn(tools, id)) throw Error('Undeclared toolchain: ' + id)
    const lock = tools[id]
    const cache = join(state, 'toolchains', lock.sha256)
    if (!existsSync(cache)) {
      const scratch = mkdtempSync(join(state, 'toolchains', '.candidate-'))
      const archive = join(scratch, 'archive')
      await asset(lock, archive)
      if (lock.url.endsWith('.zip')) run('unzip', ['-qo', archive, '-d', scratch])
      else run('tar', ['-xzf', archive, '--no-same-owner', '-C', scratch])
      unlinkSync(archive)
      inside(scratch, realpathSync(join(scratch, lock.entry)))
      renameSync(scratch, cache)
    }
    return inside(cache, realpathSync(join(cache, lock.entry)))
  }
  return { name, manifest, dir, home, data, pack, repo, env, run, checkout, tool, installed,
    asset: (lock, dest) => asset(lock, inside(dir, dest)) }
}

export function digestInputs(pack, paths) {
  const hash = createHash('sha256')
  for (const p of [...new Set(paths)].sort()) {
    hash.update(p + '\0').update(createHash('sha256').update(readFileSync(inside(pack, realpathSync(join(pack, p))))).digest())
  }
  return hash.digest('hex')
}
