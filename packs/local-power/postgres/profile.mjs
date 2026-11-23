import { createHash, randomBytes } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [release, data, binary, action, ...args] = process.argv.slice(2)
const usage = 'Usage: gbrain-pg up [--port PORT] | check | run GBRAIN_ARGS... | down'
if (!['up', 'check', 'run', 'down'].includes(action) ||
    (action === 'up' && args.length && !(args.length === 2 && args[0] === '--port' && /^\d+$/.test(args[1]))) ||
    (action === 'run' ? !args.length : action !== 'up' && args.length)) throw Error(usage)
const key = createHash('sha256').update(data).digest()
const profile = join(data, 'postgres')
const ownerFile = join(profile, 'owner-password')
const appFile = join(profile, 'app-password')
const portFile = join(profile, 'port')
function initializeFile(file, value) {
  try { writeFileSync(file, value, { flag: 'wx', mode: 0o600 }) }
  catch (e) { if (e.code !== 'EEXIST') throw e }
}
function readPrivate(file) {
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw Error('Expected an owner-only profile file: ' + file)
  return readFileSync(file, 'utf8').trim()
}
{
  // The child locks this open file description. The parent retains it until exit, even
  // during credential cleanup. A killed process leaves no stale filesystem lock to clear.
  const fd = openSync(data, 'r')
  process.on('exit', () => closeSync(fd))
  const lock = spawnSync('flock', ['-n', action === 'up' || action === 'down' ? '-x' : '-s', '3'], { stdio: ['ignore', 'ignore', 'ignore', fd] })
  if (lock.error) throw lock.error
  if (lock.status !== 0) throw Error('Another PostgreSQL lifecycle operation is in progress')
}
if (action === 'up') {
  const desired = Number(args[1] ?? 12000 + key.readUInt16BE() % 40000)
  if (!Number.isInteger(desired) || desired < 1024 || desired > 65535) throw Error('Port must be between 1024 and 65535')
  mkdirSync(profile, { recursive: true, mode: 0o700 })
  const parent = lstatSync(profile)
  if (!parent.isDirectory() || parent.uid !== process.getuid() || (parent.mode & 0o077)) throw Error('Expected an owner-only postgres directory')
  initializeFile(portFile, String(desired))
  initializeFile(ownerFile, randomBytes(32).toString('hex'))
  initializeFile(appFile, randomBytes(32).toString('hex'))
}
if (!existsSync(portFile)) throw Error('This checkout has no PostgreSQL profile. Run gbrain-pg up first.')
const port = readPrivate(portFile)
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535 || (args[0] === '--port' && Number(port) !== Number(args[1]))) throw Error('Requested port differs from the saved profile or is invalid')
const password = readPrivate(appFile)
if (!/^[a-f0-9]{64}$/.test(password) || !/^[a-f0-9]{64}$/.test(readPrivate(ownerFile))) throw Error('Invalid private database credential files')
const composeEnv = { PATH: process.env.PATH, HOME: process.env.HOME, GBRAIN_PG_PORT: port, GBRAIN_PG_SECRETS_DIR: profile }
// A local socket and explicit project separate this database from remote contexts and other checkouts.
const compose = ['--host', 'unix:///var/run/docker.sock', 'compose', '--project-name', 'gbrain-' + key.toString('hex').slice(0, 14),
  '--file', join(release, 'docker-compose.local-agents.yml'), '--profile', 'gbrain-pg']
const docker = (...argv) => execFileSync('docker', [...compose, ...argv], { encoding: 'utf8', env: composeEnv, timeout: 300000 })
const admin = (sql) => execFileSync('docker', [...compose, 'exec', '-T', '--user', 'postgres', 'gbrain-db', 'psql',
  '-X', '-U', 'postgres', '-d', 'gbrain', '-v', 'ON_ERROR_STOP=1'], { input: sql, stdio: ['pipe','ignore','ignore'], env: composeEnv, timeout: 30000 })
const brainEnv = { ...process.env, HOME: profile, GBRAIN_HOME: profile, GBRAIN_DATABASE_URL: 'postgresql://gbrain_app:' + password + '@127.0.0.1:' + port + '/gbrain' }
// Snapshot only settings. The canonical writer identity and worktree stay in this
// persistent home in both phases. A retry can recover an interrupted settings swap.
const snapshot = join(profile, 'pre-migration-config.json')
const configDir = join(profile, '.gbrain')
const configFile = join(configDir, 'config.json')
function atomicPrivate(file, bytes) {
  const temp = file + '.' + randomBytes(12).toString('hex')
  try {
    writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 })
    renameSync(temp, file)
  } finally { rmSync(temp, { force: true }) }
}
function restoreConfig() {
  const original = JSON.parse(readPrivate(snapshot))
  if (original !== null && typeof original !== 'string') throw Error('Invalid migration settings snapshot')
  if (existsSync(configDir) && !lstatSync(configDir).isDirectory()) throw Error('Expected a private gbrain directory')
  if (original === null) rmSync(configFile, { force: true })
  else atomicPrivate(configFile, Buffer.from(original, 'base64'))
  rmSync(snapshot)
}
if (existsSync(snapshot) && action !== 'down') {
  if (action !== 'up') throw Error('An interrupted schema migration needs gbrain-pg up')
  restoreConfig()
}
if (action === 'down') {
  docker('down')
  console.log('PostgreSQL stopped. The project volume and credentials are retained.')
} else if (action === 'run') {
  execFileSync(binary, args, { stdio: 'inherit', env: brainEnv })
} else {
  if (action === 'up') {
    docker('up', '--detach', '--wait', '--wait-timeout', '150', 'gbrain-db')
    const stamp = join(profile, 'schema-' + createHash('sha256').update(release).digest('hex'))
    if (!existsSync(stamp)) {
      if (existsSync(configDir) && !lstatSync(configDir).isDirectory()) throw Error('Expected a private gbrain directory')
      if (existsSync(configFile)) readPrivate(configFile)
      atomicPrivate(snapshot, JSON.stringify(existsSync(configFile) ? readFileSync(configFile).toString('base64') : null))
      const credential = randomBytes(32).toString('hex')
      try {
        // Credential is sent via stdin and expires even if this process is killed mid-migration.
        const expires = new Date(Date.now() + 10 * 60_000).toISOString()
        // v120 hardens the event-trigger function's search_path as its owner.
        admin("BEGIN; ALTER FUNCTION public.auto_enable_rls() OWNER TO gbrain_schema; ALTER ROLE gbrain_schema LOGIN PASSWORD '" + credential + "' VALID UNTIL '" + expires + "'; COMMIT;")
        const scoped = { ...brainEnv, GBRAIN_DATABASE_URL: 'postgresql://gbrain_schema:' + credential + '@127.0.0.1:' + port + '/gbrain' }
        execFileSync(binary, ['init', '--non-interactive', '--no-embedding'], { env: scoped, stdio: 'ignore', timeout: 300000 })
        admin('BEGIN; ALTER FUNCTION public.auto_enable_rls() OWNER TO postgres; REASSIGN OWNED BY gbrain_schema TO gbrain_app; COMMIT;')
      } finally {
        try { admin('BEGIN; ALTER ROLE gbrain_schema NOLOGIN PASSWORD NULL; ALTER FUNCTION public.auto_enable_rls() OWNER TO postgres; COMMIT;') }
        finally { restoreConfig() }
      }
      execFileSync(binary, ['init', '--non-interactive', '--no-embedding'], { env: brainEnv, stdio: 'ignore', timeout: 300000 })
      execFileSync(binary, ['config', 'set', 'self_upgrade.mode', 'off'], { env: brainEnv, stdio: 'ignore' })
      initializeFile(stamp, 'qualified')
    }
  }
  const sql = "SELECT (SELECT NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb FROM pg_roles WHERE rolname=current_user) AND (SELECT NOT rolcanlogin FROM pg_roles WHERE rolname='gbrain_schema') AND current_user='gbrain_app' AND (SELECT v FROM (VALUES ('[1,1]'::vector), ('[9,9]'::vector)) t(v) ORDER BY v <-> '[0,0]'::vector LIMIT 1)='[1,1]'::vector;"
  const result = docker('exec', '-T', 'gbrain-db', 'sh', '-ec',
    'export PGPASSWORD="$(cat /run/gbrain-secrets/app)"; exec psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U gbrain_app -d gbrain -tAc "$1"', 'sh', sql)
  if (result.trim() !== 't') throw Error('Failed vector retrieval or application role check')
  const listing = JSON.parse(execFileSync(binary, ['sources', 'list', '--json'], { env: brainEnv, encoding: 'utf8', timeout: 60000, stdio: ['ignore','pipe','ignore'] }))
  if (!Array.isArray(listing.sources) || !listing.sources.some(source => source.id === 'default')) throw Error('gbrain could not find its canonical default source')
  const writer = JSON.parse(execFileSync(binary, ['sources', 'writer', 'status', '--source', 'default', '--json'], {
    env: brainEnv, encoding: 'utf8', timeout: 60000, stdio: ['ignore','pipe','ignore'],
  }))
  if (!writer.local_host_id || !writer.bindings?.some(entry => entry.source_id === 'default' && entry.state === 'active' &&
      entry.owner_host_id === writer.local_host_id && entry.local_path && existsSync(entry.local_path))) throw Error('The canonical default writer is not active in this local profile')
  console.log('Verified local gbrain writer and pgvector distance ordering as gbrain_app on 127.0.0.1:' + port)
}
