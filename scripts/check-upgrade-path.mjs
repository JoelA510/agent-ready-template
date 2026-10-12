#!/usr/bin/env node
// Proves a repository that took the last release's process can take this commit's, cleanly: the
// upgrade every target makes, run on a fixture before the release ships instead of in someone's
// repository after. It checks out the latest release tag behind HEAD in a temporary worktree,
// applies that release's process to an empty git repository, commits it, applies this commit's
// process over it, and fails if the second apply exits non-zero, parks anything (a file nobody
// edited must update in place), leaves an orphaned file, or isn't current afterwards by
// `process:apply --check`.
//
// It needs the release tags (in CI, a checkout with fetch-depth: 0). With none behind HEAD it
// exits 2: there was nothing to upgrade from, and that's never a pass. The one exception is a
// repository that has never released: a full clone with no v* tag at all, such as a new template
// before its first release or a project made with GitHub's "Use this template", which copies no
// tags. That exits 0 and says so. A shallow clone with no tags still exits 2, since the tags may
// just not have been fetched. It applies with no --pack, since a release from before --pack
// existed can't take one: pack standards aren't upgraded here.
//
// Run: node scripts/check-upgrade-path.mjs [--from <tag>]
//   Exit 0 on a clean upgrade, 1 on one that isn't, 2 when it couldn't check.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

class CheckError extends Error {}

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.error?.code === 'ENOENT') throw new CheckError("git isn't installed here")
  if (r.error) throw r.error
  if (r.status !== 0) throw new CheckError(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout).trim()}`)
  return r.stdout.trim()
}

/**
 * The latest release tag (v*) that HEAD contains and isn't HEAD itself, or null. A prerelease
 * sorts before its release (v1.0.0-rc.1 before v1.0.0), as semver orders them; git's version sort
 * puts suffixes after unless versionsort.suffix says otherwise.
 */
export function previousRelease(root = ROOT) {
  const head = git(root, ['rev-parse', 'HEAD'])
  const tags = git(root, ['-c', 'versionsort.suffix=-', 'tag', '--merged', 'HEAD', '--sort=-v:refname', '--list', 'v*']).split('\n').filter(Boolean)
  return tags.find((t) => git(root, ['rev-list', '-n', '1', t]) !== head) ?? null
}

/**
 * True when this repository has never released: no v* tag anywhere, in a clone that isn't shallow.
 * A shallow clone may simply lack the tags, so it never counts.
 */
export function neverReleased(root = ROOT) {
  if (git(root, ['rev-parse', '--is-shallow-repository']) === 'true') return false
  return git(root, ['tag', '--list', 'v*']) === ''
}

const apply = (script, target, ...args) => spawnSync(process.execPath, [script, '--target', target, ...args], { encoding: 'utf8' })

function walk(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    if (name === '.git') return []
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p, base) : [relative(base, p).split('\\').join('/')]
  })
}

/** Upgrades a fixture from `from` to HEAD: { from, problems, summary }. */
export function checkUpgrade(from) {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'upgrade-path-')))
  const old = join(scratch, 'old')
  const target = join(scratch, 'target')
  let worktree = false
  try {
    git(ROOT, ['worktree', 'add', '--quiet', '--detach', old, from])
    worktree = true
    git(scratch, ['init', '--quiet', target])
    writeFileSync(join(target, 'README.md'), '# A project that took the process\n')
    const first = apply(join(old, 'scripts/apply-process.mjs'), target)
    if (first.status !== 0) throw new CheckError(`${from}'s process:apply failed on an empty repository (exit ${first.status}):\n${first.stdout}${first.stderr}`)
    const id = ['-c', 'user.name=upgrade-path', '-c', 'user.email=upgrade-path@example.com']
    git(target, ['add', '-A'])
    git(target, [...id, 'commit', '--quiet', '--no-verify', '-m', `process from ${from}`])

    const second = apply(join(ROOT, 'scripts/apply-process.mjs'), target)
    const problems = []
    if (second.status !== 0) problems.push(`this commit's process:apply exited ${second.status}:\n${second.stdout}${second.stderr}`)
    const parked = walk(target).filter((f) => f.endsWith('.template'))
    if (parked.length) problems.push(`parked ${parked.length} file(s) nobody edited, which should have updated in place: ${parked.join(', ')}`)
    if (/^No longer in the template, but edited/m.test(second.stdout)) problems.push('reported a file as edited in the target, which nobody edited')
    const check = apply(join(ROOT, 'scripts/apply-process.mjs'), target, '--check')
    if (check.status !== 0) problems.push(`process:apply --check isn't current afterwards:\n${check.stdout}${check.stderr}`)
    const counts = ['Copied', 'Updated in place', 'Removed'].map((h) => `${(second.stdout.split(`\n${h}`)[1]?.split('\n\n')[0].match(/^ {2}\S/gm) ?? []).length} ${h.toLowerCase()}`)
    return { from, problems, summary: counts.join(', ') }
  } finally {
    // Best-effort cleanup of our own worktree and scratch directory.
    if (worktree) spawnSync('git', ['worktree', 'remove', '--force', old], { cwd: ROOT })
    rmSync(scratch, { recursive: true, force: true })
  }
}

function main(argv) {
  let from = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--from' && argv[i + 1] && !argv[i + 1].startsWith('--')) from = argv[++i]
    else throw new CheckError(`Unknown argument: ${argv[i]}\nUsage: node scripts/check-upgrade-path.mjs [--from <tag>]`)
  }
  from ??= previousRelease()
  if (!from) {
    if (neverReleased()) {
      console.log('✓ No release yet: this full clone has no v* tag, so there is nothing to upgrade from. The first release tag starts this check.')
      return 0
    }
    throw new CheckError('No release tag behind HEAD to upgrade from. In CI, check out with fetch-depth: 0 so the tags come too.')
  }
  const commit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
  const { problems, summary } = checkUpgrade(from)
  if (problems.length) {
    console.error(`✗ The upgrade from ${from} to ${commit} isn't clean:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
    return 1
  }
  console.log(`✓ A repository with ${from}'s process takes ${commit}'s cleanly: ${summary}; nothing parked or left over.`)
  return 0
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let status
  try {
    status = main(process.argv.slice(2))
  } catch (error) {
    if (!(error instanceof CheckError)) throw error
    console.error(error.message)
    status = 2
  }
  process.exit(status)
}
