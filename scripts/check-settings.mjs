#!/usr/bin/env node
// Scores a GitHub repository's settings against the catalog's `enforcement: settings` standards,
// over the REST API: what no file in the repository can show. Read-only: it changes nothing, and
// for each failure says what to change and where.
//
// The token comes from GITHUB_TOKEN or GH_TOKEN. Most settings are admin-only (a fine-grained
// token or GitHub App with Administration: read on the repository); GITHUB_TOKEN in a workflow
// can't read them. Two answers are ambiguous on purpose, and handled here: a 404 from an
// admin-only endpoint means "off" only when the token is known to have admin access (otherwise
// it's `skipped`), and branch rules on a private repository under GitHub Free are stored but not
// enforced, which the API reports by refusing the classic protection endpoint with "Upgrade to
// GitHub Pro" (that's `n/a`, as the prompts treat it: an operating rule instead of a setting).
//
// Run: node scripts/check-settings.mjs [--repo owner/name | --root <path>] [--json <file>|-]
//   Without --repo, the repository is read from --root's `origin` remote (default: the current
//   directory). Exit 0 when nothing fails, 1 on a failure, 2 when it couldn't check (no token, a
//   repository it can't see, an API error).
import { execFileSync } from 'node:child_process'
import { realpathSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CheckError, loadCatalog } from './check-conformance.mjs'
import { MISSING_DEPENDENCY } from './template-dependency.mjs'

const API_VERSION = '2022-11-28'
// Where the template's ruleset is in a repository: at its live path in one built from the template,
// staged under prompts/skeletons/ in one process:apply delivered to. This script reads neither.
const RULESET_REMEDY =
  "add a ruleset requiring the CI job in Settings -> Rules -> Rulesets; the template's is .github/rulesets/main.json in a repository built from it, prompts/skeletons/.github/rulesets/main.json where process:apply delivered it (name its required checks after your CI jobs)"

/** A GitHub API client over `fetch`: get(path) -> { status, body, message }. */
export function githubApi({ token, fetch = globalThis.fetch, apiUrl = 'https://api.github.com' }) {
  return async (path) => {
    let response
    try {
      response = await fetch(`${apiUrl}${path}`, {
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': API_VERSION, 'User-Agent': 'check-settings' },
      })
    } catch (error) {
      if (!(error instanceof TypeError)) throw error // fetch's network failure
      throw new CheckError(`Couldn't reach GitHub for ${path}: ${error.cause?.message ?? error.message}`)
    }
    const text = await response.text()
    let body = null
    if (text) {
      try {
        body = JSON.parse(text)
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
      }
    }
    if (response.status === 401) throw new CheckError('GitHub refused the token (401): check GITHUB_TOKEN or GH_TOKEN.')
    const message = typeof body?.message === 'string' ? body.message : ''
    if ((response.status === 403 || response.status === 429) && response.headers.get('x-ratelimit-remaining') === '0') {
      throw new CheckError(`GitHub's rate limit is spent until ${new Date(Number(response.headers.get('x-ratelimit-reset')) * 1000).toISOString()}.`)
    }
    // A secondary limit leaves the primary one unspent: a 429, or a 403 that says so.
    if (response.status === 429 || (response.status === 403 && /rate limit/i.test(message))) {
      throw new CheckError(`GitHub rate-limited ${path} (${response.status}${response.headers.get('retry-after') ? `, retry after ${response.headers.get('retry-after')}s` : ''}).`)
    }
    if (response.status >= 500) throw new CheckError(`GitHub returned ${response.status} for ${path}.`)
    return { path, status: response.status, body, message }
  }
}

const pass = (...evidence) => ({ status: 'pass', evidence })
const fail = (...evidence) => ({ status: 'fail', evidence })
const notApplicable = (why) => ({ status: 'n/a', evidence: [why] })
const skip = (why) => ({ status: 'skipped', evidence: [why] })
const needsAdmin = skip('needs a token with admin read on the repository (Administration: read for a fine-grained token or a GitHub App)')
// A 403 for a missing permission, as opposed to a feature the plan doesn't have.
const upgrade = (r) => r.status === 403 && /upgrade to github pro/i.test(r.message)
const forbidden = (r) => r.status === 403 && !upgrade(r)
// A status the endpoint isn't documented to return is GitHub misbehaving, not a setting that's off.
const unexpected = (r) => new CheckError(`GitHub returned ${r.status} for ${r.path}${r.message ? `: ${r.message}` : ''}.`)

/** One probe per settings standard: async ({ get, repo, slug }) => { status, evidence }. */
export const SETTINGS = {
  'core.settings-token-read-only': async ({ get, slug, repo }) => {
    if (!repo.permissions?.admin) return needsAdmin
    const r = await get(`/repos/${slug}/actions/permissions/workflow`)
    if (forbidden(r) || r.status === 404) return needsAdmin
    if (r.status !== 200) throw unexpected(r)
    const problems = []
    if (r.body?.default_workflow_permissions !== 'read') problems.push(`the default GITHUB_TOKEN can write (default_workflow_permissions: ${r.body?.default_workflow_permissions})`)
    if (r.body?.can_approve_pull_request_reviews) problems.push('workflows can create and approve pull requests')
    if (!problems.length) return pass('the default GITHUB_TOKEN is read-only, and workflows can\'t approve pull requests')
    return fail(...problems, 'change it in Settings -> Actions -> General -> Workflow permissions')
  },

  'core.settings-dependabot-alerts': async ({ get, slug, repo }) => {
    if (!repo.permissions?.admin) return needsAdmin // a 404 below would mean "can't see", not "off"
    const alerts = await get(`/repos/${slug}/vulnerability-alerts`)
    const updates = await get(`/repos/${slug}/automated-security-fixes`)
    if (forbidden(alerts) || forbidden(updates)) return needsAdmin
    if (![204, 404].includes(alerts.status)) throw unexpected(alerts)
    if (![200, 404].includes(updates.status)) throw unexpected(updates)
    const problems = []
    if (alerts.status !== 204) problems.push('Dependabot alerts are off')
    if (updates.status !== 200 || !updates.body?.enabled) problems.push('Dependabot security updates are off')
    else if (updates.body.paused) problems.push('Dependabot security updates are paused')
    if (!problems.length) return pass('Dependabot alerts and security updates are on')
    return fail(...problems, 'turn them on in Settings -> Advanced Security (Code security on older accounts)')
  },

  'core.settings-branch-protected': async ({ get, slug, repo }) => {
    const branch = repo.default_branch
    const classicPath = `/repos/${slug}/branches/${encodeURIComponent(branch)}/protection`
    const unenforced = notApplicable(`GitHub Free doesn't enforce branch rules on a private repository: keep "merge only when CI is green" as an operating rule, and record it as a settings item`)
    // On GitHub Free, a private repository's rules are stored but not enforced, and only the
    // classic endpoint says so: ask it first there, so a stored ruleset doesn't pass.
    let classic = repo.private ? await get(classicPath) : null
    if (classic && upgrade(classic)) return unenforced
    const rules = await get(`/repos/${slug}/rules/branches/${encodeURIComponent(branch)}`)
    if (forbidden(rules)) return needsAdmin
    if (rules.status !== 200) throw unexpected(rules)
    const checks = (Array.isArray(rules.body) ? rules.body : []).filter((x) => x?.type === 'required_status_checks')
    if (checks.length) {
      const names = checks.flatMap((x) => x.parameters?.required_status_checks ?? []).map((c) => c.context).filter(Boolean)
      return pass(`an active ruleset requires status checks on ${branch}${names.length ? `: ${names.join(', ')}` : ''}`)
    }
    classic ??= await get(classicPath)
    if (upgrade(classic)) return unenforced
    if (forbidden(classic)) return needsAdmin
    if (classic.status === 200) {
      const contexts = classic.body?.required_status_checks?.contexts ?? []
      if (classic.body?.required_status_checks) return pass(`branch protection requires status checks on ${branch}${contexts.length ? `: ${contexts.join(', ')}` : ''}`)
      return fail(`${branch} is protected, but no status check is required: CI can be red at merge`)
    }
    if (classic.status !== 404) throw unexpected(classic)
    if (!repo.permissions?.admin) return needsAdmin // the 404 a token without admin sees, too
    return fail(`no active ruleset or branch protection requires a status check on ${branch}`, RULESET_REMEDY)
  },

  'core.settings-private-reporting': async ({ get, slug, repo }) => {
    if (repo.private) return notApplicable('GitHub offers private vulnerability reporting on public repositories only')
    if (!repo.permissions?.admin) return needsAdmin // the endpoint needs admin read
    const r = await get(`/repos/${slug}/private-vulnerability-reporting`)
    if (forbidden(r) || r.status === 404) return needsAdmin
    if (r.status === 422) return skip(`GitHub couldn't say whether private vulnerability reporting is on (422${r.message ? `: ${r.message}` : ''})`)
    if (r.status !== 200) throw unexpected(r)
    if (r.body?.enabled === true) return pass('private vulnerability reporting is on')
    return fail('private vulnerability reporting is off, so SECURITY.md has nowhere private to send a report', 'turn it on in Settings -> Advanced Security')
  },

  'core.settings-secret-scanning': async ({ repo }) => {
    if (repo.private) return notApplicable("secret scanning isn't offered on a user's private repository without a paid add-on")
    const sa = repo.security_and_analysis
    if (!sa) return needsAdmin // the block is shown only to admins
    const off = ['secret_scanning', 'secret_scanning_push_protection'].filter((k) => sa[k]?.status !== 'enabled')
    if (!off.length) return pass('secret scanning and push protection are on')
    return fail(`${off.map((k) => k.replaceAll('_', ' ')).join(' and ')} ${off.length > 1 ? 'are' : 'is'} off`, 'turn it on in Settings -> Advanced Security')
  },
}

/** The repository `owner/name` from a checkout's `origin` remote on github.com, or null. */
export function slugFromRemote(root) {
  let url
  try {
    url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch (error) {
    if (error.status !== undefined || error.code === 'ENOENT') return null
    throw error
  }
  return slugFromUrl(url)
}

/** `owner/name` from a github.com URL in https, ssh, or scp form, or null. */
export function slugFromUrl(url) {
  const m = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url)
  return m ? `${m[1]}/${m[2]}` : null
}

/** Scores `slug`'s settings: { repo, checked, results, summary, exitCode }. */
export async function checkSettings(slug, { get, catalog = loadCatalog(), today = new Date().toISOString().slice(0, 10) }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(slug ?? '')) throw new CheckError(`Not a repository name: ${slug} (owner/name)`)
  const standards = catalog.standards.filter((s) => s.enforcement === 'settings')
  const repoResponse = await get(`/repos/${slug}`)
  if (repoResponse.status === 404 || repoResponse.status === 403) throw new CheckError(`The token can't see ${slug} (${repoResponse.status}).`)
  const repo = repoResponse.body
  const results = []
  for (const s of standards) {
    const probe = SETTINGS[s.id]
    if (!probe) throw new CheckError(`${s.id} has enforcement: settings, but check-settings.mjs has no probe for it`)
    const outcome = await probe({ get, slug, repo })
    results.push({ key: s.id, id: s.id, pack: s.pack, path: '.', title: s.title, severity: s.severity, enforcement: s.enforcement, auditArea: s.auditArea, ...outcome })
  }
  const summary = {}
  for (const r of results) summary[r.status] = (summary[r.status] ?? 0) + 1
  return { repo: slug, private: Boolean(repo.private), checked: today, results, summary, exitCode: summary.fail ? 1 : 0 }
}

const MARK = { fail: '✗', skipped: '?', pass: '✓', 'n/a': '-' }
const ORDER = ['fail', 'skipped', 'pass', 'n/a']

export function formatSettings(card) {
  const lines = [`Repository settings: ${card.repo} (${card.private ? 'private' : 'public'})`, '']
  for (const r of [...card.results].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.key.localeCompare(b.key))) {
    lines.push(`${MARK[r.status]} ${r.status.padEnd(8)} ${r.key} (${r.severity}, area ${r.auditArea}): ${r.title}`)
    if (r.status !== 'pass') for (const e of r.evidence) lines.push(`      ${e}`)
  }
  const counts = ORDER.filter((s) => card.summary[s]).map((s) => `${card.summary[s]} ${s}`)
  lines.push('', `${counts.join(', ')}. ${card.checked}.`)
  return lines.join('\n')
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s, 2)
    if (!['--repo', '--root', '--json'].includes(flag)) throw new CheckError(`Unknown argument: ${argv[i]}`)
    const value = inline ?? argv[++i]
    if (value === undefined || value === '' || (value.startsWith('--') && value !== '-')) throw new CheckError(`${flag} needs a value.`)
    args[flag.slice(2)] = value
  }
  return args
}

async function main(argv, env = process.env) {
  const args = parseArgs(argv)
  const slug = args.repo ?? slugFromRemote(resolve(args.root ?? '.'))
  if (!slug) throw new CheckError(`No GitHub repository: pass --repo owner/name, or run it in a checkout whose origin is on github.com.`)
  const token = env.GITHUB_TOKEN || env.GH_TOKEN
  if (!token) throw new CheckError('No token: set GITHUB_TOKEN or GH_TOKEN (admin read on the repository; GITHUB_TOKEN in a workflow is not enough).')
  const card = await checkSettings(slug, { get: githubApi({ token, apiUrl: env.GITHUB_API_URL || undefined }) })
  if (args.json === '-') console.log(JSON.stringify(card, null, 2))
  else {
    if (args.json) writeFileSync(resolve(args.json), `${JSON.stringify(card, null, 2)}\n`)
    ;(card.exitCode === 0 ? console.log : console.error)(formatSettings(card))
  }
  return card.exitCode
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      if (error instanceof CheckError) console.error(`✗ ${error.message}\nUsage: node scripts/check-settings.mjs [--repo owner/name | --root <path>] [--json <file>|-]`)
      else if (error?.code === MISSING_DEPENDENCY) console.error(error.message)
      // A defect here, not a finding: printed in full, exit 2 because nothing was checked.
      else console.error(error?.stack ?? error)
      process.exit(2)
    })
}
