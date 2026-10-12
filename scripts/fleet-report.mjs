#!/usr/bin/env node
// Scores every repository in a fleet file against the standards catalog, with
// check-conformance.mjs's conform(), and writes one markdown report: a row per repository, then
// each failing standard with the repositories it fails in, then each repository's failures with
// their first line of evidence (with the first few items it introduces, when it ends in a colon).
// The fleet file's shape is standards/fleet.example.json; the statuses are in standards/README.md.
//
// A repository is a local path (resolved from the fleet file's directory) or a git URL, cloned
// shallow into a temporary directory that's removed afterwards. Cloning uses git's own
// credentials; in a CI workflow, check the repositories out first and list them by path. An entry's
// `packs` and `visibility` override the repository's own config, whose baseline and waivers still
// apply.
//
// Each repository also gets its process drift (what a `process:apply` re-run would change, from
// apply-process.mjs) and, with --settings and a token in GITHUB_TOKEN or GH_TOKEN, its GitHub
// settings scored by check-settings.mjs (a repository with no github.com remote is skipped).
//
// Run: node scripts/fleet-report.mjs --fleet <file> [--settings] [--out <file.md>] [--json <file>] [--today YYYY-MM-DD]
//   Exit 0 when every repository conforms, 1 when any fails, 2 on an invalid fleet file or a
//   repository that couldn't be checked (a failed clone, an invalid config, a probe error, a
//   settings check that couldn't run).
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ManifestError, drift } from './apply-process.mjs'
import { CheckError, conform, loadCatalog } from './check-conformance.mjs'
import { checkSettings, githubApi, slugFromRemote, slugFromUrl } from './check-settings.mjs'
import { MISSING_DEPENDENCY } from './template-dependency.mjs'

/** The repositories in a fleet file, validated: [{ name, path?, url?, ref?, visibility?, packs? }]. */
export function readFleet(path) {
  if (!existsSync(path)) throw new CheckError(`Fleet file not found: ${path}`)
  let data
  try {
    data = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    throw new CheckError(`${path} isn't valid JSON: ${error.message}`)
  }
  if (!Array.isArray(data?.repos) || !data.repos.length) throw new CheckError(`${path}: expected { "repos": [ ... ] } with at least one repository`)
  const problems = []
  const names = new Set()
  data.repos.forEach((r, i) => {
    const where = `repos[${i}]`
    if (!r || typeof r !== 'object' || Array.isArray(r)) return problems.push(`${where}: must be an object`)
    for (const key of Object.keys(r)) {
      if (!['name', 'path', 'url', 'ref', 'visibility', 'packs'].includes(key)) problems.push(`${where}: "${key}" isn't a fleet field`)
    }
    if (typeof r.name !== 'string' || !r.name.trim()) problems.push(`${where}: "name" is required`)
    else if (names.has(r.name)) problems.push(`${where}: a second repository named ${r.name}`)
    names.add(r.name)
    for (const key of ['path', 'url', 'ref']) {
      if (r[key] !== undefined && (typeof r[key] !== 'string' || !r[key].trim())) problems.push(`${where}: "${key}" must be a non-empty string`)
    }
    if (['path', 'url'].filter((k) => r[k] !== undefined).length !== 1) problems.push(`${where}: give exactly one of "path" and "url"`)
    if (r.ref !== undefined && r.url === undefined) problems.push(`${where}: "ref" is a branch or tag, and only goes with "url"`)
    if (r.visibility !== undefined && !['public', 'private'].includes(r.visibility)) problems.push(`${where}: "visibility" must be public or private`)
    if (r.packs !== undefined && (!Array.isArray(r.packs) || !r.packs.length)) problems.push(`${where}: "packs" must be a non-empty list (leave it out to detect them)`)
  })
  if (problems.length) throw new CheckError(`Invalid fleet file ${path}:\n  ${problems.join('\n  ')}`)
  return data.repos
}

const CLONE_TIMEOUT_MS = 10 * 60 * 1000

/** A URL as the report records it: without a username or password, which --json would write out. */
export function withoutCredentials(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch (error) {
    if (error instanceof TypeError) return url // scp-style (git@host:owner/repo) carries no password
    throw error
  }
  if (!parsed.username && !parsed.password) return url
  parsed.username = ''
  parsed.password = ''
  return parsed.href
}

// What a process:apply re-run would do here: { status, changes, leftovers }.
function processDrift(root) {
  try {
    const d = drift(root)
    if (!d.delivered) return { status: 'not delivered', changes: 0, leftovers: 0 }
    // Applied from a commit this template doesn't have: its "changes" could be downgrades.
    if (d.ahead) return { status: 'from a commit not in this template', changes: d.changes.length, leftovers: d.leftovers.length }
    return { status: d.changes.length || d.leftovers.length ? 'behind' : 'current', changes: d.changes.length, leftovers: d.leftovers.length }
  } catch (error) {
    if (!(error instanceof ManifestError)) throw error
    return { status: 'manifest unreadable', changes: 0, leftovers: 0 }
  }
}

// The repository's settings, when asked: { card } | { skipped } | { error }.
async function settingsOf(repo, root, options) {
  const slug = repo.url !== undefined ? slugFromUrl(repo.url) : slugFromRemote(root)
  if (!slug) return { skipped: 'no github.com remote' }
  try {
    return { card: await checkSettings(slug, { get: options.get, catalog: options.catalog, today: options.today }) }
  } catch (error) {
    if (!(error instanceof CheckError)) throw error
    return { error: error.message }
  }
}

// Scores one repository; a repository that can't be checked is reported, not thrown.
async function scoreOne(repo, base, options) {
  const source = repo.url !== undefined ? withoutCredentials(repo.url) : repo.path
  let root = repo.url === undefined ? resolve(base, repo.path) : null
  let scratch = null
  try {
    if (repo.url !== undefined) {
      scratch = mkdtempSync(join(tmpdir(), 'fleet-'))
      root = join(scratch, 'repo')
      try {
        execFileSync('git', ['clone', '--quiet', '--depth', '1', ...(repo.ref ? ['--branch', repo.ref] : []), '--', repo.url, root], {
          stdio: ['ignore', 'ignore', 'pipe'],
          encoding: 'utf8',
          timeout: CLONE_TIMEOUT_MS,
          // Fail a private URL without credentials instead of waiting at a password prompt.
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        })
      } catch (error) {
        if (error.code === 'ENOENT') throw new CheckError("git isn't installed here: clone the repositories yourself and list them by path")
        if (error.code === 'ETIMEDOUT') return { name: repo.name, source, error: `git clone took longer than ${CLONE_TIMEOUT_MS / 60_000} minutes` }
        if (typeof error.status !== 'number') throw error
        return { name: repo.name, source, error: `git clone failed: ${String(error.stderr ?? '').trim() || `exit ${error.status}`}` }
      }
    } else if (!existsSync(root) || !statSync(root).isDirectory()) {
      return { name: repo.name, source, error: `not a directory: ${root}` }
    }
    const card = conform(root, { packs: repo.packs, visibility: repo.visibility, today: options.today, catalog: options.catalog })
    const drifted = processDrift(root)
    const settings = options.get ? await settingsOf(repo, root, options) : undefined
    return { name: repo.name, source, card, process: drifted, ...(settings ? { settings } : {}) }
  } catch (error) {
    if (!(error instanceof CheckError)) throw error
    return { name: repo.name, source, error: error.message }
  } finally {
    // Best-effort cleanup of our own scratch clone; the report doesn't depend on it.
    if (scratch) rmSync(scratch, { recursive: true, force: true })
  }
}

/**
 * Scores every repository in the fleet: { checked, template, repos: [{ name, source, card,
 * process, settings? } | { name, source, error }] }. `get` (a githubApi client) adds settings.
 */
export async function scoreFleet(fleetPath, options = {}) {
  const path = resolve(fleetPath)
  const repos = readFleet(path)
  const catalog = loadCatalog()
  if (catalog.problems.length) throw new CheckError(`The standards catalog is invalid:\n  ${catalog.problems.join('\n  ')}`)
  const today = options.today ?? new Date().toISOString().slice(0, 10)
  const results = []
  for (const r of repos) results.push(await scoreOne(r, dirname(path), { today, catalog, get: options.get }))
  const template = results.find((r) => r.card)?.card.template ?? null
  return { checked: today, template, repos: results }
}

const SEVERITY = ['blocker', 'high', 'medium', 'low']
const cell = (text) => String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ')
const outcome = (r) =>
  r.error || r.card.exitCode === 2 || r.settings?.error ? "couldn't check" : r.card.exitCode === 1 || r.settings?.card?.exitCode === 1 ? 'fails' : 'conforms'
const processCell = (p) => (!p ? '' : p.status === 'behind' ? `${p.changes} to update${p.leftovers ? `, ${p.leftovers} left over` : ''}` : p.status)
const settingsCell = (s) => {
  if (!s) return ''
  if (s.error) return "couldn't check"
  if (s.skipped) return 'skipped'
  const { pass = 0, fail = 0, skipped = 0 } = s.card.summary
  return `${pass} pass, ${fail} fail${skipped ? `, ${skipped} skipped` : ''}`
}

/** The fleet as markdown. */
export function formatFleet(fleet) {
  const out = []
  const counts = { conforms: 0, fails: 0, "couldn't check": 0 }
  for (const r of fleet.repos) counts[outcome(r)]++
  out.push(`# Standards conformance, ${fleet.checked}`, '')
  const template = fleet.template ? `Template ${fleet.template.version}${fleet.template.commit ? ` (${fleet.template.commit})` : ''}. ` : ''
  out.push(
    `${template}${fleet.repos.length} repositories: ${counts.conforms} conform, ${counts.fails} fail, ${counts["couldn't check"]} couldn't be checked.`,
    '',
  )
  const withSettings = fleet.repos.some((r) => r.settings)
  out.push(
    `| Repository | Packs | Pass | Fail | Waived | Baseline | Not checked | Process |${withSettings ? ' Settings |' : ''} Result |`,
    `| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |${withSettings ? ' --- |' : ''} --- |`,
  )
  for (const r of fleet.repos) {
    if (r.error) {
      out.push(`| ${cell(r.name)} | | | | | | | |${withSettings ? ' |' : ''} couldn't check |`)
      continue
    }
    const s = r.card.summary
    const packs = r.card.packs.filter((p) => p.pack !== 'core').map((p) => (p.path === '.' ? p.pack : `${p.pack}@${p.path}`))
    const notChecked = (s.skipped ?? 0) + (s.error ?? 0)
    const extra = withSettings ? ` ${cell(settingsCell(r.settings))} |` : ''
    out.push(`| ${cell(r.name)} | ${cell(packs.join(', ') || 'core only')} | ${s.pass ?? 0} | ${s.fail ?? 0} | ${s.waived ?? 0} | ${s.baseline ?? 0} | ${notChecked} | ${cell(processCell(r.process))} |${extra} ${outcome(r)} |`)
  }

  const failing = new Map()
  for (const r of fleet.repos.filter((x) => x.card)) {
    for (const res of [...r.card.results, ...(r.settings?.card?.results ?? [])].filter((x) => x.status === 'fail')) {
      const entry = failing.get(res.id) ?? { id: res.id, severity: res.severity, repos: [] }
      entry.repos.push(res.path === '.' ? r.name : `${r.name} (${res.path})`)
      failing.set(res.id, entry)
    }
  }
  if (failing.size) {
    out.push('', '## Failing standards', '', 'Most-failed first; severity breaks ties.', '', '| Standard | Severity | Fails in |', '| --- | --- | --- |')
    const sorted = [...failing.values()].sort(
      (a, b) => b.repos.length - a.repos.length || SEVERITY.indexOf(a.severity) - SEVERITY.indexOf(b.severity) || a.id.localeCompare(b.id),
    )
    for (const f of sorted) out.push(`| \`${f.id}\` | ${f.severity} | ${f.repos.length}: ${cell(f.repos.join(', '))} |`)
  }

  // A line ending in a colon introduces a list; without its items it says nothing.
  const firstEvidence = ([first, ...rest]) => {
    if (!first?.endsWith(':') || !rest.length) return first
    // Long evidence is already capped with a "... and N more" line: count what it stands for.
    const capped = /^\.\.\. and (\d+) more$/.exec(rest.at(-1))
    const items = capped ? rest.slice(0, -1) : rest
    const more = items.length - 3 + (capped ? Number(capped[1]) : 0)
    return `${first} ${items.slice(0, 3).join('; ')}${more > 0 ? `; and ${more} more` : ''}`
  }
  out.push('', '## By repository')
  for (const r of fleet.repos) {
    out.push('', `### ${r.name}`, '')
    if (r.error) {
      out.push(`Couldn't be checked: ${r.error}`)
      continue
    }
    const shown = [...r.card.results, ...(r.settings?.card?.results ?? [])].filter((x) => ['fail', 'error', 'skipped'].includes(x.status))
    shown.sort((a, b) => SEVERITY.indexOf(a.severity) - SEVERITY.indexOf(b.severity) || a.key.localeCompare(b.key))
    for (const x of shown) out.push(`- ${x.status === 'fail' ? '' : `${x.status}: `}\`${x.key}\` (${x.severity}): ${cell(firstEvidence(x.evidence) ?? x.title)}`)
    for (const p of r.card.problems) out.push(`- config: ${cell(p)}`)
    if (r.card.undeclared.length) out.push(`- detected but not declared: ${r.card.undeclared.join(', ')}`)
    if (r.process?.status === 'behind') out.push(`- process: a \`process:apply\` re-run would change ${r.process.changes} file(s)${r.process.leftovers ? `, and ${r.process.leftovers} parked file(s) or conflict marker(s) are left over` : ''}`)
    if (r.settings?.error) out.push(`- settings couldn't be checked: ${cell(r.settings.error)}`)
    if (!shown.length && !r.card.problems.length && !r.settings?.error) out.push('Conforms.')
  }
  return `${out.join('\n')}\n`
}

const exitCode = (fleet) => (fleet.repos.some((r) => outcome(r) === "couldn't check") ? 2 : fleet.repos.some((r) => outcome(r) === 'fails') ? 1 : 0)

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s, 2)
    if (flag === '--settings' && inline === undefined) {
      args.settings = true
      continue
    }
    if (!['--fleet', '--out', '--json', '--today'].includes(flag)) throw new CheckError(`Unknown argument: ${argv[i]}`)
    const value = inline ?? argv[++i]
    if (value === undefined || value === '' || value.startsWith('--')) throw new CheckError(`${flag} needs a value.`)
    args[flag.slice(2)] = value
  }
  if (!args.fleet) throw new CheckError('--fleet <file> is required.')
  return args
}

async function main(argv, env = process.env) {
  const args = parseArgs(argv)
  const token = env.GITHUB_TOKEN || env.GH_TOKEN
  if (args.settings && !token) throw new CheckError('--settings needs a token in GITHUB_TOKEN or GH_TOKEN, with admin read on the repositories.')
  const get = args.settings ? githubApi({ token, apiUrl: env.GITHUB_API_URL || undefined }) : undefined
  const fleet = await scoreFleet(args.fleet, { today: args.today, get })
  const markdown = formatFleet(fleet)
  if (args.out) writeFileSync(resolve(args.out), markdown)
  else process.stdout.write(markdown)
  if (args.json) writeFileSync(resolve(args.json), `${JSON.stringify(fleet, null, 2)}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown)
  const code = exitCode(fleet)
  console.error(code === 0 ? '✓ Every repository conforms.' : code === 1 ? '✗ At least one repository fails a standard.' : "✗ At least one repository couldn't be checked.")
  return code
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((status) => process.exit(status))
    .catch((error) => {
      if (error instanceof CheckError) {
        console.error(`✗ ${error.message}\nUsage: node scripts/fleet-report.mjs --fleet <file> [--settings] [--out <file.md>] [--json <file>] [--today YYYY-MM-DD]`)
      } else if (error?.code === MISSING_DEPENDENCY) console.error(error.message)
      // A defect here, not a finding: printed in full, exit 2 because nothing was checked.
      else console.error(error?.stack ?? error)
      process.exit(2)
    })
}
