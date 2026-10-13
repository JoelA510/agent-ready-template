import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadCatalog } from '../check-conformance.mjs'
import { SETTINGS, checkSettings, formatSettings, githubApi, slugFromUrl } from '../check-settings.mjs'

// GitHub's API, as a table of responses by path; anything else is a 404. Nothing here reaches the
// network, so what's verified is the logic over GitHub's documented responses, not the live API.
type Route = { status: number; body?: unknown; headers?: Record<string, string> }
const SLUG = 'acme/app'
function api(routes: Record<string, Route>) {
  const fetch = async (url: string) => {
    const r = routes[url.replace('https://api.github.com', '')] ?? { status: 404, body: { message: 'Not Found' } }
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers })
  }
  return githubApi({ token: 't', fetch: fetch as typeof globalThis.fetch })
}
const repo = (overrides: object = {}): Route => ({
  status: 200,
  body: {
    private: false,
    default_branch: 'main',
    permissions: { admin: true },
    security_and_analysis: { secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' } },
    ...overrides,
  },
})
const GOOD: Record<string, Route> = {
  [`/repos/${SLUG}`]: repo(),
  [`/repos/${SLUG}/actions/permissions/workflow`]: { status: 200, body: { default_workflow_permissions: 'read', can_approve_pull_request_reviews: false } },
  [`/repos/${SLUG}/vulnerability-alerts`]: { status: 204 },
  [`/repos/${SLUG}/automated-security-fixes`]: { status: 200, body: { enabled: true, paused: false } },
  [`/repos/${SLUG}/rules/branches/main`]: { status: 200, body: [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'Build, lint, typecheck, test' }] } }] },
  [`/repos/${SLUG}/private-vulnerability-reporting`]: { status: 200, body: { enabled: true } },
}
const score = async (routes: Record<string, Route>) => checkSettings(SLUG, { get: api(routes), today: '2026-10-07' })
const status = (card: Awaited<ReturnType<typeof checkSettings>>, id: string) => card.results.find((r) => r.id === id)

describe('the settings standards', () => {
  it('has a probe for every settings standard and a settings standard for every probe', () => {
    const ids = loadCatalog().standards.filter((s) => s.enforcement === 'settings').map((s) => s.id)
    expect(ids.length).toBeGreaterThan(0) // positive control
    expect(ids.sort()).toEqual(Object.keys(SETTINGS).sort())
  })

  it('passes a repository with every setting on', async () => {
    const card = await score(GOOD)
    expect(card.results.map((r) => [r.id, r.status]).sort()).toEqual(Object.keys(SETTINGS).map((id) => [id, 'pass']).sort())
    expect(card.exitCode).toBe(0)
    expect(formatSettings(card)).toContain('5 pass.')
  })

  it('token-read-only: a write token, or workflows that can approve, fail', async () => {
    const card = await score({ ...GOOD, [`/repos/${SLUG}/actions/permissions/workflow`]: { status: 200, body: { default_workflow_permissions: 'write', can_approve_pull_request_reviews: true } } })
    expect(status(card, 'core.settings-token-read-only')).toMatchObject({
      status: 'fail',
      evidence: [expect.stringContaining('can write'), 'workflows can create and approve pull requests', expect.stringContaining('Workflow permissions')],
    })
    expect(card.exitCode).toBe(1)
  })

  it('dependabot-alerts: a 404 is "off" only for a token with admin access', async () => {
    const off = await score({ ...GOOD, [`/repos/${SLUG}/vulnerability-alerts`]: { status: 404, body: { message: 'Not Found' } }, [`/repos/${SLUG}/automated-security-fixes`]: { status: 200, body: { enabled: true, paused: true } } })
    expect(status(off, 'core.settings-dependabot-alerts')?.evidence.slice(0, 2)).toEqual(['Dependabot alerts are off', 'Dependabot security updates are paused'])
    const notAdmin = await score({ ...GOOD, [`/repos/${SLUG}`]: repo({ permissions: { admin: false }, security_and_analysis: undefined }) })
    expect(status(notAdmin, 'core.settings-dependabot-alerts')?.status).toBe('skipped')
    expect(status(notAdmin, 'core.settings-token-read-only')?.status).toBe('skipped')
    expect(status(notAdmin, 'core.settings-secret-scanning')?.status).toBe('skipped')
  })

  it('branch-protected: a ruleset or classic protection that requires a check; n/a where Free can\'t enforce it', async () => {
    const none = { ...GOOD, [`/repos/${SLUG}/rules/branches/main`]: { status: 200, body: [] } }
    expect(status(await score(none), 'core.settings-branch-protected')?.evidence[0]).toBe('no active ruleset or branch protection requires a status check on main')
    // The remedy names where the ruleset is in a target, not a path only the template has.
    expect(status(await score(none), 'core.settings-branch-protected')?.evidence[1]).toContain('prompts/skeletons/.github/rulesets/main.json where process:apply delivered it')
    const classic = { ...none, [`/repos/${SLUG}/branches/main/protection`]: { status: 200, body: { required_status_checks: { contexts: ['ci'] } } } }
    expect(status(await score(classic), 'core.settings-branch-protected')).toMatchObject({ status: 'pass', evidence: ['branch protection requires status checks on main: ci'] })
    const noChecks = { ...none, [`/repos/${SLUG}/branches/main/protection`]: { status: 200, body: { enforce_admins: { enabled: true } } } }
    expect(status(await score(noChecks), 'core.settings-branch-protected')?.status).toBe('fail')
    const free = {
      ...none,
      [`/repos/${SLUG}`]: repo({ private: true }),
      [`/repos/${SLUG}/branches/main/protection`]: { status: 403, body: { message: 'Upgrade to GitHub Pro or make this repository public to enable this feature.' } },
    }
    expect(status(await score(free), 'core.settings-branch-protected')?.status).toBe('n/a')
    // A ruleset stored on a Free private repository isn't enforced: asked of the classic endpoint first.
    const stored = { ...free, [`/repos/${SLUG}/rules/branches/main`]: GOOD[`/repos/${SLUG}/rules/branches/main`] }
    expect(status(await score(stored), 'core.settings-branch-protected')?.status).toBe('n/a')
  })

  it('a 404 a token without admin also gets is never read as "off"', async () => {
    const notAdmin = await score({
      ...GOOD,
      [`/repos/${SLUG}`]: repo({ permissions: { admin: false } }),
      [`/repos/${SLUG}/rules/branches/main`]: { status: 200, body: [] },
      [`/repos/${SLUG}/private-vulnerability-reporting`]: { status: 404, body: { message: 'Not Found' } },
    })
    expect(status(notAdmin, 'core.settings-branch-protected')?.status).toBe('skipped')
    expect(status(notAdmin, 'core.settings-private-reporting')?.status).toBe('skipped')
    expect(notAdmin.exitCode).toBe(0)
    // A 422 is one GitHub documents for private reporting: unknown, not "couldn't check" for the card.
    const unprocessable = await score({ ...GOOD, [`/repos/${SLUG}/private-vulnerability-reporting`]: { status: 422, body: { message: 'Validation Failed' } } })
    expect(status(unprocessable, 'core.settings-private-reporting')?.status).toBe('skipped')
  })

  it('private-reporting and secret-scanning: public repositories only', async () => {
    const off = await score({
      ...GOOD,
      [`/repos/${SLUG}`]: repo({ security_and_analysis: { secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'disabled' } } }),
      [`/repos/${SLUG}/private-vulnerability-reporting`]: { status: 200, body: { enabled: false } },
    })
    expect(status(off, 'core.settings-private-reporting')?.status).toBe('fail')
    expect(status(off, 'core.settings-secret-scanning')?.evidence[0]).toBe('secret scanning push protection is off')
    const privateRepo = await score({ ...GOOD, [`/repos/${SLUG}`]: repo({ private: true, security_and_analysis: null }) })
    expect(status(privateRepo, 'core.settings-private-reporting')?.status).toBe('n/a')
    expect(status(privateRepo, 'core.settings-secret-scanning')?.status).toBe('n/a')
  })

  it("can't check with a refused token, an invisible repository, or a server error", async () => {
    await expect(score({ [`/repos/${SLUG}`]: { status: 401, body: { message: 'Bad credentials' } } })).rejects.toThrow('refused the token')
    await expect(score({})).rejects.toThrow("can't see acme/app")
    await expect(score({ ...GOOD, [`/repos/${SLUG}/vulnerability-alerts`]: { status: 502 } })).rejects.toThrow('GitHub returned 502')
    const limited = { status: 403, body: { message: 'API rate limit exceeded' }, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1791331200' } }
    await expect(score({ ...GOOD, [`/repos/${SLUG}/actions/permissions/workflow`]: limited })).rejects.toThrow("rate limit is spent")
    // A secondary limit, with the primary one unspent, isn't a setting that's off.
    const secondary = { status: 429, body: { message: 'You have exceeded a secondary rate limit' }, headers: { 'x-ratelimit-remaining': '4000', 'retry-after': '60' } }
    await expect(score({ ...GOOD, [`/repos/${SLUG}/vulnerability-alerts`]: secondary })).rejects.toThrow('rate-limited')
    await expect(score({ ...GOOD, [`/repos/${SLUG}/vulnerability-alerts`]: { ...secondary, status: 403 } })).rejects.toThrow('rate-limited')
    await expect(score({ ...GOOD, [`/repos/${SLUG}/vulnerability-alerts`]: { status: 422, body: { message: 'Unprocessable' } } })).rejects.toThrow('GitHub returned 422')
  })

  it("can't check when GitHub can't be reached", async () => {
    const offline = (async () => {
      throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND api.github.com') })
    }) as typeof globalThis.fetch
    await expect(checkSettings(SLUG, { get: githubApi({ token: 't', fetch: offline }), today: '2026-10-07' })).rejects.toThrow("Couldn't reach GitHub")
  })
})

describe('the CLI', () => {
  const SCRIPT = resolve(__dirname, '../check-settings.mjs')
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } })

  it('needs a token and a repository, and says so with exit 2', () => {
    const noToken = run(['--repo', 'acme/app'])
    expect(noToken.status).toBe(2)
    expect(noToken.stderr).toContain('No token')
    expect(run(['--repo', 'not a repo'], { GITHUB_TOKEN: 't' }).stderr).toContain('Not a repository name')
    expect(run(['--bogus'], { GITHUB_TOKEN: 't' }).status).toBe(2)
  })

  it.each([
    ['https://github.com/acme/app.git', 'acme/app'],
    ['git@github.com:acme/app.git', 'acme/app'],
    ['ssh://git@github.com/acme/app', 'acme/app'],
    ['https://gitlab.com/acme/app.git', null],
  ])('reads %s as %s', (url, slug) => {
    expect(slugFromUrl(url)).toBe(slug)
  })
})
