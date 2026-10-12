// Listing a repo's files the way the check scripts need to: what git knows about (tracked, or
// untracked and not ignored), with paths exactly as on disk, and only files that exist, leaving
// out a symlink that leads out of the repo. Shared
// by check-instructions.mjs and check-env.mjs so a fix to one reaches both.
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

// Build output, dependencies, and tool caches: never instructions or source worth checking.
export const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'storybook-static', '.next', '.expo'])

// A skeleton directory holds copies waiting to be filled in at their real paths, not the repo's
// own files, so the checks leave it out, as agents do. Each one has an AGENTS.skeleton.md at its
// top: where process:apply stages them in a target (prompts/skeletons/, under the target path in
// a monorepo), and templates/project/ in the template and its forks. Only a marked directory is
// skipped, so a repo's own prompts/skeletons/ code is still checked.
export const SKELETON_MARKER = 'AGENTS.skeleton.md'

/** The skeleton directories among `files` (relative, forward slashes), each ending in `/`. */
export function skeletonDirs(files) {
  return files
    .filter((p) => p.endsWith(`/${SKELETON_MARKER}`))
    .map((p) => p.slice(0, -SKELETON_MARKER.length))
}

/** A predicate: whether a relative path lies inside one of `dirs`. */
export const inSkeletonDir = (dirs) => (relPath) => dirs.some((d) => relPath.startsWith(d))

export const toPosix = (p) => p.split(sep).join('/')

/** Every file under `abs` (or `abs` itself if it's a file), as absolute paths, skipping SKIP_DIRS. */
export function walk(abs, out = []) {
  if (statSync(abs).isFile()) {
    out.push(abs)
    return out
  }
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) walk(join(abs, entry.name), out)
    else if (entry.isFile()) out.push(join(abs, entry.name))
  }
  return out
}

/**
 * Every file under root that git knows (tracked, or untracked and not ignored), relative to root
 * with forward slashes. NUL-separated, so a name with non-ASCII characters arrives as written
 * rather than quoted and escaped; a tracked file deleted from the working tree is left out.
 * Falls back to a walk only when root isn't in a git work tree or git isn't installed.
 */
export function listRepoFiles(root) {
  let listed
  try {
    listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\0')
      .filter(Boolean)
  } catch (error) {
    // 128: not a git repository. ENOENT: no git. Anything else (a buffer overflow, a crash) is
    // a real failure and must not quietly turn into a walk that ignores .gitignore.
    if (error.status !== 128 && error.code !== 'ENOENT') throw error
    return walk(root).map((p) => toPosix(relative(root, p)))
  }
  const realRoot = realpathSync(root)
  // A symlink that leads out of the repo isn't its content: reading one could put any file on this
  // machine into a report, and writing through one would change something outside.
  const inside = (p) => {
    const abs = join(root, p)
    if (!lstatSync(abs).isSymbolicLink()) return true
    const target = realpathSync(abs) // exists: checked first
    return target === realRoot || target.startsWith(`${realRoot}${sep}`)
  }
  return [...new Set(listed)].filter((p) => existsSync(join(root, p)) && inside(p))
}
