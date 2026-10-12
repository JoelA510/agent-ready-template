#!/usr/bin/env node
// Proposes this template's process to every repository in a fleet file, one pull request each.
// For each repository: clone it, run process:apply against the clone (with the packs its manifest
// records, plus the fleet entry's), and, when that changed anything, commit the result on a branch
// named for the template commit, push it, and open a pull request. Files both sides changed are
// committed as the apply parks them (`<name>.template`, a merge proposal where it can build one):
// the pull request says to merge each into the file beside it and delete it, and
// `process:apply --check` fails until that's done.
//
// Nothing from a repository runs: the clone has no hooks, the commit skips them, and no package
// script is called. A repository whose branch for this template commit already exists gets no new
// push: a re-run opens the pull request only if that branch has none yet (a run that pushed and
// then failed to open one). A repository with an earlier update's pull request still open is left
// waiting, since both would rewrite the manifest. A clone checked out at a tag or commit (a fleet
// `ref` that isn't a branch) has nothing to merge into, and is refused before anything is pushed.
// What process:apply warns about (a .gitignore that would keep delivered files out, a target last
// applied from a newer template) goes into the pull request; delivered files the target ignores
// are committed anyway, so the manifest never names a file the branch doesn't have.
//
// The fleet file's shape is standards/fleet.example.json; a `path` entry is proposed to through
// its `origin` remote. Pushes use git's own credentials (in the hub workflow, the app token's
// url.insteadOf); the pull request needs a token in GITHUB_TOKEN or GH_TOKEN that can write
// contents and pull requests.
//
// Run: node scripts/fleet-update.mjs --fleet <file> [--apply] [--json <file>]
//   Without --apply, a dry run: everything but the commit, push, and pull request, saying what each
//   repository would get. Exit 0 when no repository failed (each is current, proposed, already
//   proposed, would be, or waiting on an earlier update); 2 on an invalid fleet file or a
//   repository that couldn't be proposed to (a failed clone, apply, push, or request).
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CheckError } from './check-conformance.mjs'
import { slugFromUrl } from './check-settings.mjs'
import { readFleet, withoutCredentials } from './fleet-report.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const APPLY = join(ROOT, 'scripts', 'apply-process.mjs')
const API_VERSION = '2022-11-28'
const TIMEOUT_MS = 10 * 60 * 1000

/** Runs git, returning stdout; a failure is a CheckError carrying git's own message. */
function git(cwd, args, { allow = [] } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  if (r.error?.code === 'ENOENT') throw new CheckError("git isn't installed here")
  if (r.error) throw r.error
  if (r.status !== 0 && !allow.includes(r.status)) throw new CheckError(`git ${args[0]} failed: ${(r.stderr || r.stdout).trim() || `exit ${r.status}`}`)
  return { out: r.stdout.trim(), status: r.status }
}

function templateCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch (error) {
    if (error.status !== undefined || error.code === 'ENOENT') return null
    throw error
  }
}

/** The pull request for one repository's update. */
function prBody({ commit, changed = null, parked = [], warnings = [] }) {
  const lines = [
    `This updates the process files (prompts, skills, skeletons, standards) to the template at \`${commit.slice(0, 12)}\`, with \`process:apply\`.${changed ? ` It changes ${changed.length} file(s).` : ''}`,
    '',
  ]
  if (warnings.length) lines.push('**`process:apply` warned:**', '', '```text', ...warnings, '```', '')
  if (parked.length) {
    lines.push(
      `**${parked.length} file(s) changed on both sides**, so the update is parked beside your copy as \`<name>.template\` (a merge proposal where the version last delivered could be found). Before merging: merge each into the file beside it, resolve any conflict markers, delete the \`.template\`, and push to this branch. \`process:apply --check\` fails until none is left.`,
      '',
      ...parked.map((f) => `- \`${f}\``),
      '',
    )
  }
  if (changed) lines.push('<details><summary>Every file this changes</summary>', '', ...changed.map((c) => `- ${c}`), '', '</details>', '')
  lines.push("Read the template's CHANGELOG from the version this repository last took, and do what its entries ask; the `template-update` skill (`prompts/template-update.md`) walks through it.")
  return lines.join('\n')
}

/** One GitHub API call: { status, data }, or a CheckError when GitHub can't be reached. */
async function github({ fetch, token }, path, { method = 'GET', body } = {}) {
  let response
  try {
    response = await fetch(`https://api.github.com${path}`, {
      method,
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': API_VERSION, 'User-Agent': 'fleet-update' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch (error) {
    if (!(error instanceof TypeError)) throw error // fetch's network failure
    throw new CheckError(`couldn't reach GitHub: ${error.cause?.message ?? error.message}`)
  }
  const text = await response.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
  }
  return { status: response.status, data }
}
const detailOf = (data) => [data?.message, ...(Array.isArray(data?.errors) ? data.errors.map((e) => e?.message ?? '') : [])].filter(Boolean).join('; ')

/** The repository's pull requests from template/process-* branches: [{ branch, state, url }]. */
async function templatePullRequests(options, slug, query) {
  const all = []
  for (let page = 1; page <= 10; page++) {
    const { status, data } = await github(options, `/repos/${slug}/pulls?${query}&per_page=100&page=${page}`)
    if (status !== 200 || !Array.isArray(data)) throw new CheckError(`GitHub wouldn't list the pull requests (${status}${detailOf(data) ? `: ${detailOf(data)}` : ''})`)
    all.push(...data)
    if (data.length < 100) break
    if (page === 10) throw new CheckError('GitHub listed more than 1,000 pull requests; fleet:update reads no further, so it can\'t tell whether an update is open')
  }
  return all
    .filter((p) => typeof p?.head?.ref === 'string' && p.head.ref.startsWith('template/process-'))
    .map((p) => ({ branch: p.head.ref, state: p.merged_at ? 'merged' : p.state, url: p.html_url }))
}

async function openPullRequest(options, { slug, head, base, title, body }) {
  const { status, data } = await github(options, `/repos/${slug}/pulls`, { method: 'POST', body: { title, head, base, body, maintainer_can_modify: true } })
  if (status === 201 && typeof data?.html_url === 'string') return data.html_url
  const detail = detailOf(data)
  throw new CheckError(`GitHub refused the pull request (${status}${detail ? `: ${detail}` : ''}); branch ${head} is pushed, and a re-run opens it`)
}

/** process:apply's warnings: each paragraph of its report with a "!" line. */
const applyWarnings = (stdout) => stdout.split(/\n\s*\n/).filter((p) => /^\s*! /m.test(p)).map((p) => p.trim())

/** One repository: { name, source, status, state?, branch?, changed?, parked?, warnings?, url?, error? }. */
async function updateOne(repo, base, options) {
  const source = repo.url !== undefined ? withoutCredentials(repo.url) : repo.path
  let scratch = null
  try {
    let url = repo.url
    if (url === undefined) {
      const local = resolve(base, repo.path)
      if (!existsSync(local)) return { name: repo.name, source, status: 'failed', error: `not a directory: ${local}` }
      url = git(local, ['remote', 'get-url', 'origin'], { allow: [2] }).out
      if (!url) return { name: repo.name, source, status: 'failed', error: 'no origin remote to propose to' }
    }
    const slug = options.slugOf(url)
    if (options.apply && !slug) return { name: repo.name, source, status: 'failed', error: `${withoutCredentials(url)} isn't a github.com repository, so there's nowhere to open a pull request` }
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'fleet-update-')))
    const clone = join(scratch, 'repo')
    git(scratch, ['clone', '--quiet', '--depth', '1', '--no-tags', ...(repo.ref ? ['--branch', repo.ref] : []), '--', url, clone])
    const baseBranch = git(clone, ['rev-parse', '--abbrev-ref', 'HEAD']).out
    if (baseBranch === 'HEAD') {
      return { name: repo.name, source, status: 'failed', error: `"ref" ${repo.ref} is a tag or a commit, and a pull request needs a branch to merge into: name a branch, or drop "ref" for the default branch` }
    }
    const branch = `template/process-${options.commit.slice(0, 12)}`
    const title = `Update the process from the template (${options.commit.slice(0, 12)})`
    const pushed = git(clone, ['ls-remote', '--exit-code', '--heads', 'origin', branch], { allow: [2] }).status === 0
    if (pushed && !options.apply) return { name: repo.name, source, status: 'already proposed', branch }
    if (pushed) {
      const [pr] = await templatePullRequests(options, slug, `state=all&head=${encodeURIComponent(`${slug.split('/')[0]}:${branch}`)}`)
      // Proposed already, and still open, merged, or declined: a declined one isn't reopened.
      if (pr) return { name: repo.name, source, status: 'already proposed', state: pr.state, branch, url: pr.url }
      // Pushed by a run that couldn't open the pull request: open it now, for what's on the branch.
      const url = await openPullRequest(options, { slug, head: branch, base: baseBranch, title, body: prBody({ commit: options.commit }) })
      return { name: repo.name, source, status: 'proposed', branch, url }
    }
    const packs = (repo.packs ?? []).map((p) => (typeof p === 'string' ? p.split('@')[0] : p.pack))
    const apply = spawnSync(process.execPath, [APPLY, '--target', clone, ...packs.flatMap((p) => ['--pack', p])], { encoding: 'utf8', timeout: TIMEOUT_MS })
    if (apply.status !== 0) {
      // Its error comes first; the usage text it prints after would hide it.
      const cause = apply.stderr.split('\n').find((l) => l.trim()) ?? `${apply.stdout}`.trim().split('\n').slice(-1)[0] ?? ''
      return { name: repo.name, source, status: 'failed', error: `process:apply exited ${apply.status ?? apply.signal}: ${cause.trim()}` }
    }
    const warnings = applyWarnings(apply.stdout)
    const changed = git(clone, ['status', '--porcelain', '--untracked-files=all']).out.split('\n').filter(Boolean)
    if (!changed.length) return { name: repo.name, source, status: 'current', ...(warnings.length ? { warnings } : {}) }
    const parked = changed.map((l) => l.slice(3)).filter((f) => f.endsWith('.template'))
    // Both would rewrite the manifest, so the later one waits for the earlier to be merged or
    // closed. A dry run checks too when it has a token to ask with, and says when it couldn't.
    let unchecked = null
    if (slug && options.token) {
      let open
      try {
        open = (await templatePullRequests(options, slug, 'state=open')).find((p) => p.branch !== branch)
      } catch (error) {
        if (!(error instanceof CheckError) || options.apply) throw error
        unchecked = `couldn't check for an earlier update still open: ${error.message}`
      }
      if (open) return { name: repo.name, source, status: 'waiting', branch, error: `an earlier update is still open (${open.url}): merge or close it, then run again`, url: open.url }
    }
    if (!options.apply) return { name: repo.name, source, status: 'would propose', branch, changed, parked, warnings, ...(unchecked ? { error: unchecked } : {}) }

    git(clone, ['switch', '--quiet', '-c', branch])
    git(clone, ['add', '-A'])
    // Delivered files the target's .gitignore covers go in too (apply's warning says so), or the
    // committed manifest would name files the branch doesn't have.
    const manifest = 'prompts/.apply-manifest.json'
    const delivered = [manifest, ...Object.keys(JSON.parse(readFileSync(join(clone, manifest), 'utf8')).files ?? {})].filter((f) => existsSync(join(clone, f)))
    if (delivered.length) git(clone, ['add', '--force', '--', ...delivered])
    const who = git(clone, ['config', 'user.email'], { allow: [1] }).out ? [] : ['-c', 'user.name=fleet-update', '-c', 'user.email=fleet-update@users.noreply.github.com']
    git(clone, [...who, 'commit', '--quiet', '--no-verify', '-m', title])
    git(clone, ['push', '--quiet', 'origin', branch])
    const prUrl = await openPullRequest(options, { slug, head: branch, base: baseBranch, title, body: prBody({ commit: options.commit, changed, parked, warnings }) })
    return { name: repo.name, source, status: 'proposed', branch, changed, parked, warnings, url: prUrl }
  } catch (error) {
    if (!(error instanceof CheckError)) throw error
    return { name: repo.name, source, status: 'failed', error: error.message }
  } finally {
    // Best-effort cleanup of our own scratch clone; the result doesn't depend on it.
    if (scratch) rmSync(scratch, { recursive: true, force: true })
  }
}

/**
 * Proposes the template's process to every repository in the fleet: { commit, apply, repos }.
 * `apply` false is a dry run. `fetch` and `slugOf` are for tests.
 */
export async function updateFleet(fleetPath, { apply = false, token, fetch = globalThis.fetch, slugOf = slugFromUrl } = {}) {
  const path = resolve(fleetPath)
  const repos = readFleet(path)
  const commit = templateCommit()
  if (!commit) throw new CheckError("This template checkout has no git history, so there's no commit to name the update by.")
  if (apply && !token) throw new CheckError('--apply opens pull requests: set GITHUB_TOKEN or GH_TOKEN (contents and pull requests: write).')
  const results = []
  for (const repo of repos) results.push(await updateOne(repo, dirname(path), { apply, token, fetch, slugOf, commit }))
  return { commit, apply, repos: results }
}

/** The run as markdown. */
export function formatUpdate(run) {
  const out = [`# Process update, template ${run.commit.slice(0, 12)}${run.apply ? '' : ' (dry run)'}`, '', '| Repository | Result | Files | Parked | Warnings |', '| --- | --- | ---: | ---: | ---: |']
  // A cell is one line: a multi-line git error would end the table.
  const cell = (text) => String(text).replace(/\s+/g, ' ').replace(/\|/g, '\\|')
  for (const r of run.repos) {
    const status = r.state && r.state !== 'open' ? `${r.status} (${r.state === 'closed' ? 'declined' : r.state})` : r.status
    const linked = r.url && r.status !== 'failed' ? `[${status}](${r.url})` : status
    const result = r.error ? `${linked}: ${r.error}` : linked
    out.push(`| ${cell(r.name)} | ${cell(result)} | ${r.changed?.length ?? ''} | ${r.parked?.length ?? ''} | ${r.warnings?.length || ''} |`)
  }
  const warned = run.repos.filter((r) => r.warnings?.length)
  for (const r of warned) out.push('', `## ${r.name}: process:apply warned`, '', '```text', ...r.warnings, '```')
  return `${out.join('\n')}\n`
}

const USAGE = 'Usage: node scripts/fleet-update.mjs --fleet <file> [--apply] [--json <file>]'

async function main(argv, env = process.env) {
  const args = { apply: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') args.apply = true
    else if (a === '--fleet' || a === '--json') {
      const v = argv[++i]
      if (!v || v.startsWith('--')) throw new CheckError(`${a} needs a value.\n${USAGE}`)
      args[a.slice(2)] = v
    } else throw new CheckError(`Unknown argument: ${a}\n${USAGE}`)
  }
  if (!args.fleet) throw new CheckError(USAGE)
  const run = await updateFleet(args.fleet, { apply: args.apply, token: env.GITHUB_TOKEN || env.GH_TOKEN })
  process.stdout.write(formatUpdate(run))
  if (args.json) writeFileSync(args.json, `${JSON.stringify(run, null, 2)}\n`)
  return run.repos.some((r) => r.status === 'failed') ? 2 : 0
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((status) => process.exit(status))
    .catch((error) => {
      if (error instanceof CheckError) console.error(error.message)
      else console.error(error?.stack ?? error)
      process.exit(2)
    })
}
