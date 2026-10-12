#!/usr/bin/env node
// Carry the process assets — the prompts, the workflow skills, and the artifact skeletons under
// templates/project/ — into a target repo, so a project that isn't a fork of this template can
// run the prompts against local files. See usage() below, or run with no args.
//
// Layout in the target (everything the process owns lives under prompts/, plus the skills):
//   prompts/*.md                  the prompts, their README, and a fresh run log
//   prompts/skeletons/**          every skeleton, staged — NOT at its live path. A prompt run
//                                 copies the ones it needs to their real paths and fills them in.
//                                 Agent-instruction skeletons are named *.skeleton.md so no agent
//                                 loads an unfilled one as live instructions.
//   .agents/skills/<name>/**      the workflow skills (PROCESS_SKILLS), live: the Agent Skills
//                                 path Codex, Antigravity, Gemini CLI, Cursor, and Copilot read
//   .claude/skills/<name>/**      the same skills as Claude Code reads them (generated here by
//                                 scripts/build-skills.mjs). A target that got .claude/commands/
//                                 from an earlier run has them removed by the rule below for a
//                                 file the template dropped.
//   prompts/standards/**          the standards the target is held to: core/ always, plus each
//                                 pack named with --pack (remembered; --drop-pack forgets one)
//   prompts/.apply-manifest.json  per file, the hash of the template version last delivered or
//                                 offered, plus the template commit and the packs
//
// Re-running is safe and quiet. Comparing the target file, the manifest, and the template:
//   - template unchanged since last delivered/offered -> nothing, however much the target edited;
//   - template changed, target copy untouched -> updated in place;
//   - template changed AND target edited -> parked once as <name>.template (and recorded as
//     offered, so merging it and deleting the .template ends the matter). For a text file whose
//     last offered version is still in this checkout's history (at the manifest's templateCommit,
//     or, when this history doesn't hold that commit, as any version with the recorded hash), what's
//     parked is a three-way merge proposal, `git merge-file --diff3` of the target's copy,
//     that version, and the new one, with conflicts marked; otherwise the new version as is;
//   - target deleted a delivered file -> left deleted;
//   - template dropped a file -> removed if the target's copy is untouched, reported if edited;
//   - prompts/run-log.md is the target's own record -> never touched once it exists.
// Hashes ignore line-ending, BOM, and trailing-whitespace differences, so an autocrlf checkout
// or an editor's whitespace trim doesn't count as an edit. A reformatting pass does.
//
// --check writes nothing and exits 1 when the target has drifted: a re-apply would change a file,
// a parked .template is still there, or a delivered file holds a conflict marker.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { INSTRUCTION_PATHS, agentsHiddenFromClaude } from './check-instructions.mjs'
import { enginesNode, satisfies } from './runtime.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const MANIFEST = 'prompts/.apply-manifest.json'
const RUN_LOG = 'prompts/run-log.md'

// Explicit, so a maintainer-only prompt or command added to this repo doesn't ship to every
// target by accident. scripts/__tests__/apply-process.test.ts fails if a file in either
// directory is in neither list.
export const PROCESS_PROMPTS = [
  'README.md',
  'new-project.md',
  'existing-project.md',
  'discovery.md',
  'investigate.md',
  'review.md',
  'pre-pr.md',
  'verify.md',
  'plan-change.md',
  'template-update.md',
  'run-log.md',
]
export const PROCESS_SKILLS = ['bootstrap', 'complete', 'discovery', 'plan-change', 'root-cause', 'review-change', 'pre-pr', 'verify', 'template-update']
// The catalog lives in the template, so harvesting into it only makes sense here.
export const TEMPLATE_ONLY = { prompts: ['harvest.md'], skills: ['harvest'] }

/** The packs in the template's standards catalog, besides core, which is always delivered. */
export const PACKS = () =>
  readdirSync(join(ROOT, 'standards'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'core' && existsSync(join(ROOT, 'standards', e.name, 'README.md')))
    .map((e) => e.name)
    .sort()

function usage() {
  console.error(`Usage: node scripts/apply-process.mjs --target <path> [--pack <name>]... [--drop-pack <name>]... [--list | --check]

  --target     Path to the target repo root.
  --pack       Also deliver a pack's standards (${PACKS().join(', ')}). Remembered in the
               manifest, so later runs keep delivering it. core is always delivered.
  --drop-pack  Stop delivering a pack; its untouched files are removed.
  --list       Print what would happen, without writing anything.
  --check      Write nothing; exit 1 if the target has drifted from this template.

Delivers prompts/ (with skeletons staged under prompts/skeletons/ and the standards under
prompts/standards/) and the workflow skills in .agents/skills/ and .claude/skills/. Nothing the
target owns is ever overwritten; the header of this script says exactly how re-runs behave.
`)
}

function parseArgs(argv) {
  const args = { packs: [], dropPacks: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const [flag, inline] = arg.split(/=(.*)/s, 2)
    if (arg === '--list') args.list = true
    else if (arg === '--check') args.check = true
    else if (['--target', '--pack', '--drop-pack'].includes(flag)) {
      const value = inline ?? argv[++i]
      if (!value || value.startsWith('--')) return { error: `${flag} needs a value.` }
      if (flag === '--target') args.target = value
      else (flag === '--pack' ? args.packs : args.dropPacks).push(value.split('@')[0]) // a path is the config's business
    } else return { error: `Unknown argument: ${arg}` }
  }
  if (args.list && args.check) return { error: '--list and --check are different questions; give one.' }
  if (args.dropPacks.includes('core')) return { error: "core is always delivered; it can't be dropped." }
  const known = new Set(['core', ...PACKS()])
  // A pack to drop may be one the manifest records and this template no longer ships; main checks.
  const unknown = [...args.packs.filter((p) => !known.has(p)), ...args.dropPacks.filter((p) => !PACK_NAME.test(p))]
  if (unknown.length) return { error: `No pack ${unknown.join(', ')} in the template's standards/ (packs: ${PACKS().join(', ')}).` }
  return args
}

// --- Content helpers --------------------------------------------------------------------------

const normalize = (text) =>
  text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n*$/, '\n')
// Text is hashed normalized; a binary file (a skill's image, say) byte for byte.
const hash = (content) => createHash('sha256').update(typeof content === 'string' ? normalize(content) : content).digest('hex')
const isText = (bytes) => !bytes.includes(0) && Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes)
/** A file's content as delivered and compared: a string for UTF-8 text, the bytes otherwise. */
const contentOf = (abs) => {
  const bytes = readFileSync(abs)
  return isText(bytes) ? bytes.toString('utf8') : bytes
}
// Operating-system droppings that must never ship to a target.
const JUNK = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])

// The template's own run log accumulates the template's runs; a target starts with the header
// and the example row only.
function freshRunLog(text) {
  const lines = text.split('\n')
  const example = lines.findIndex((l) => l.startsWith('| _yyyy-mm-dd_'))
  if (example === -1) return text
  let end = example + 1
  while (end < lines.length && lines[end].startsWith('|')) end++
  return [...lines.slice(0, example + 1), ...lines.slice(end)].join('\n')
}

function collectFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) collectFiles(abs, out)
    else if (entry.isFile() && !JUNK.has(entry.name)) out.push(abs)
  }
  return out
}

const posixRel = (from, abs) => relative(from, abs).split(sep).join('/')

/**
 * Every file to deliver: { dest (relative, forward slashes), src (its path in the template, or
 * null when the delivered content isn't the file as committed), content }. `packs` are delivered
 * beside core.
 */
export function sources(packs = []) {
  const skeletonRoot = join(ROOT, 'templates', 'project')
  const list = [
    ...PROCESS_PROMPTS.map((f) => {
      const text = readFileSync(join(ROOT, 'prompts', f), 'utf8')
      return f === 'run-log.md' ? { dest: `prompts/${f}`, src: null, content: freshRunLog(text) } : { dest: `prompts/${f}`, src: `prompts/${f}`, content: text }
    }),
    ...PROCESS_SKILLS.flatMap((name) =>
      ['.agents', '.claude'].flatMap((home) => {
        const dir = join(ROOT, home, 'skills', name)
        return collectFiles(dir).map((abs) => ({ dest: `${home}/skills/${name}/${posixRel(dir, abs)}`, src: posixRel(ROOT, abs), content: contentOf(abs) }))
      }),
    ),
    ...collectFiles(skeletonRoot).map((abs) => ({ dest: `prompts/skeletons/${posixRel(skeletonRoot, abs)}`, src: posixRel(ROOT, abs), content: contentOf(abs) })),
    { dest: 'prompts/standards/README.md', src: 'templates/standards/README.md', content: contentOf(join(ROOT, 'templates/standards/README.md')) },
    ...['core', ...[...new Set(packs)].filter((p) => p !== 'core').sort()].flatMap((pack) => {
      const dir = join(ROOT, 'standards', pack)
      return collectFiles(dir).map((abs) => ({ dest: `prompts/standards/${pack}/${posixRel(dir, abs)}`, src: posixRel(ROOT, abs), content: contentOf(abs) }))
    }),
  ]
  return list.sort((a, b) => (a.dest < b.dest ? -1 : 1))
}

function templateCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null // not a git checkout (downloaded as an archive)
  }
}

function fail(message, code = 1) {
  console.error(message)
  process.exit(code)
}

/** A target whose manifest can't be read: re-applying would guess. */
export class ManifestError extends Error {}

// Where a delivery writes, or wrote (.claude/commands/, before skills): a manifest key outside
// these, or with a `.` or `..` segment, could make a re-apply write or delete outside the target,
// and a manifest is a file anyone can edit.
const DELIVERY_ROOTS = ['prompts/', '.agents/skills/', '.claude/skills/', '.claude/commands/']
const deliveredPath = (key) =>
  DELIVERY_ROOTS.some((r) => key.startsWith(r)) && !/[\\\0:]/.test(key) && key.split('/').every((seg) => seg && seg !== '.' && seg !== '..')
const PACK_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function readManifest(target) {
  const path = join(target, MANIFEST)
  if (!existsSync(path)) return { files: {} }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    parsed = null
  }
  const files = parsed?.files
  const valid =
    files !== null &&
    typeof files === 'object' &&
    !Array.isArray(files) &&
    Object.entries(files).every(([k, h]) => deliveredPath(k) && typeof h === 'string' && /^[0-9a-f]{64}$/.test(h)) &&
    (parsed.packs === undefined || (Array.isArray(parsed.packs) && parsed.packs.every((p) => typeof p === 'string' && PACK_NAME.test(p)))) &&
    (parsed.templateCommit === undefined || parsed.templateCommit === null || typeof parsed.templateCommit === 'string')
  if (!valid) {
    throw new ManifestError(
      `${MANIFEST} in the target is unreadable or malformed. Delete it to re-apply from scratch; ` +
        `every file that differs from the template will then be parked as .template for review.`,
    )
  }
  return parsed
}

// Files an apply from before the manifest existed may have left at live paths, still unfilled.
// Advisory only: this can't know whether a file is an old skeleton or the target's own work
// beyond the tell-tale placeholders the skeletons use.
function legacyLeftovers(target) {
  const livePaths = collectFiles(join(ROOT, 'templates', 'project')).map((abs) =>
    relative(join(ROOT, 'templates', 'project'), abs).split(sep).join('/').replace(/\.skeleton\.md$/, '.md'),
  )
  return livePaths.filter((p) => {
    const abs = join(target, p)
    if (!existsSync(abs)) return false
    const text = readFileSync(abs, 'utf8')
    return /\[(PROJECT|REPO|DATE|STACK SUMMARY|ONE-LINE SUMMARY[^\]]*)\]/.test(text) && text.includes('<!--')
  })
}

// --- Merge proposals ------------------------------------------------------------------------

// The version of `src` this checkout committed at `commit`, if it's still here and hashes to what
// the manifest says was delivered or offered; otherwise null, and the plain new version is parked.
function offeredVersion(commit, src, expected) {
  // A hash, never anything git would read as an option (`--output=...`): the manifest is editable.
  if (!/^[0-9a-f]{40,64}$/.test(commit ?? '') || !src) return null
  const text = showAt(commit, src)
  if (text !== null && hash(text) === expected) return text
  // Not at that commit: this history doesn't hold it (the target was applied from a copy of an
  // older history, such as an import) or the template was dirty then. Any version of the file
  // here with the recorded hash is the same text.
  return versionsOf(src).get(expected) ?? null
}

// A file at a commit of this checkout, or null when the commit or the file isn't here, or no git.
function showAt(commit, src) {
  try {
    return execFileSync('git', ['show', `${commit}:${src}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })
  } catch (error) {
    if (error.status !== undefined || error.code === 'ENOENT') return null
    throw error
  }
}

// Every version of a template file in this checkout's history up to HEAD, by hash.
const versionCache = new Map()
function versionsOf(src) {
  if (versionCache.has(src)) return versionCache.get(src)
  const found = new Map()
  let commits = []
  try {
    commits = execFileSync('git', ['log', '--format=%H', 'HEAD', '--', src], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean)
  } catch (error) {
    if (error.status === undefined && error.code !== 'ENOENT') throw error // else no history, or no git
  }
  for (const commit of commits) {
    const text = showAt(commit, src)
    if (text !== null) found.set(hash(text), text)
  }
  versionCache.set(src, found)
  return found
}

/**
 * A three-way merge of the target's copy and the new template version over the version last
 * offered, as git merge-file writes it: { text, conflicts }, or null when git can't run it.
 */
export function mergeProposal(mine, base, theirs, labels = ['your copy', 'template, last offered', 'template, now']) {
  const dir = mkdtempSync(join(tmpdir(), 'apply-merge-'))
  try {
    const files = ['mine', 'base', 'theirs'].map((name, i) => {
      const path = join(dir, name)
      writeFileSync(path, normalize([mine, base, theirs][i]))
      return path
    })
    const args = ['merge-file', '-p', '--diff3', ...labels.flatMap((l) => ['-L', l]), ...files]
    try {
      return { text: execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), conflicts: 0 }
    } catch (error) {
      // merge-file exits with the number of conflicts (capped at 127), and a negative status on error.
      if (typeof error.status === 'number' && error.status > 0 && error.status < 128 && typeof error.stdout === 'string') {
        return { text: error.stdout, conflicts: error.status }
      }
      if (error.code === 'ENOENT') return null
      throw error
    }
  } finally {
    // Best-effort cleanup of our own scratch directory; the proposal doesn't depend on it.
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- Plan -------------------------------------------------------------------------------------

/**
 * What a re-apply would do. `held` are packs the manifest records that this template doesn't
 * ship (it's older, or the pack was renamed): their files are left as they are, and stay recorded.
 */
function plan(target, previous, packs, held = []) {
  const actions = []
  const next = {}
  const delivered = sources(packs)

  for (const { dest, src, content } of delivered) {
    const sourceHash = hash(content)
    const destAbs = join(target, dest)
    const last = previous.files[dest]
    const present = existsSync(destAbs)
    const destHash = present ? hash(contentOf(destAbs)) : null

    if (!present) {
      if (last) {
        actions.push({ kind: 'kept-deleted', dest })
        next[dest] = last
      } else {
        actions.push({ kind: 'copy', dest, content })
        next[dest] = sourceHash
      }
    } else if (dest === RUN_LOG) {
      actions.push({ kind: 'current', dest })
      next[dest] = last ?? sourceHash
    } else if (destHash === sourceHash) {
      actions.push({ kind: 'current', dest })
      next[dest] = sourceHash
    } else if (last === sourceHash) {
      // Template unchanged since delivered/offered; the difference is the target's own edit.
      actions.push({ kind: 'target-edited', dest })
      next[dest] = last
    } else if (last && destHash === last) {
      actions.push({ kind: 'update', dest, content })
      next[dest] = sourceHash
    } else {
      // Both changed, or a file that predates any apply. Park once and record the offer: a merge
      // proposal where the version last offered is still in this checkout, the new version
      // otherwise.
      const mine = present ? contentOf(destAbs) : null
      const base = last && typeof content === 'string' && typeof mine === 'string' ? offeredVersion(previous.templateCommit, src, last) : null
      const proposal = base === null ? null : mergeProposal(mine, base, content)
      actions.push(
        proposal
          ? { kind: 'propose', dest, content: proposal.text, conflicts: proposal.conflicts }
          : { kind: last ? 'park' : 'park-unrecorded', dest, content },
      )
      next[dest] = sourceHash
    }
  }

  // Files the template no longer ships.
  const current = new Set(delivered.map((d) => d.dest))
  for (const [dest, last] of Object.entries(previous.files)) {
    if (current.has(dest)) continue
    if (held.some((p) => dest.startsWith(`prompts/standards/${p}/`))) {
      next[dest] = last
      continue
    }
    const destAbs = join(target, dest)
    if (!existsSync(destAbs)) continue // gone on both sides: forget it
    if (hash(contentOf(destAbs)) === last) {
      actions.push({ kind: 'remove', dest })
    } else {
      actions.push({ kind: 'orphaned', dest })
      next[dest] = last // keep reporting it until the target decides
    }
  }
  // Claude Code runs a skill instead of a command of the same name, so delivering
  // .claude/skills/<name>/ over a .claude/commands/<name>.md this run doesn't remove would
  // silently replace the target's command. Hold that skill back, report it, and leave it out of
  // the manifest so the next run offers it again.
  const removed = new Set(actions.filter((a) => a.kind === 'remove').map((a) => a.dest))
  for (const action of actions) {
    const skill = /^\.claude\/skills\/([^/]+)\//.exec(action.dest)?.[1]
    const command = skill && `.claude/commands/${skill}.md`
    if (!command || !existsSync(join(target, command)) || removed.has(command)) continue
    if (!WRITES.includes(action.kind)) continue
    action.kind = 'shadowed'
    action.command = command
    delete next[action.dest]
  }
  // A skill of the target's own by the same name, not a copy of the template's: Claude Code's
  // bundled /verify records its run recipe at .claude/skills/verify/SKILL.md, for one. Every
  // template skill, in every release, says it runs its prompt "exactly as written in
  // `prompts/<name>.md`", so an unrecorded SKILL.md that doesn't isn't an earlier delivery whose
  // manifest was lost. Delivering the template's beside it
  // would leave the two skill homes disagreeing, so it's held back, both copies, and offered again
  // next run.
  const skillOf = (dest) => /^\.(?:agents|claude)\/skills\/([^/]+)\//.exec(dest)?.[1]
  const own = new Set()
  for (const a of actions) {
    if (a.kind !== 'park-unrecorded' || !/\/SKILL\.md$/.test(a.dest) || typeof a.content !== 'string') continue
    const prompt = /prompts\/[\w-]+\.md/.exec(a.content)?.[0]
    const theirs = contentOf(join(target, a.dest))
    const runsPrompt = (text) => new RegExp(`exactly as written in\\s+\`${prompt?.replace('.', '\\.')}\``).test(text)
    if (prompt && typeof theirs === 'string' && !runsPrompt(theirs)) own.add(skillOf(a.dest))
  }
  for (const action of actions) {
    if (!own.has(skillOf(action.dest)) || !WRITES.includes(action.kind)) continue
    action.kind = 'own-skill'
    if (previous.files[action.dest]) next[action.dest] = previous.files[action.dest]
    else delete next[action.dest]
  }
  // Nothing is written or removed through a symlink that leads out of the target.
  for (const action of actions) {
    if (!(WRITES.includes(action.kind) || action.kind === 'remove') || !outsideTarget(target, action.dest, action.kind)) continue
    action.kind = 'outside'
    if (previous.files[action.dest]) next[action.dest] = previous.files[action.dest]
    else delete next[action.dest]
  }
  return { actions, next }
}

const isLink = (path) => {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false
    throw error
  }
}

// Whether a delivery, resolved through symlinks, leads out of the target: a symlinked prompts/
// or .claude/skills/ carries writes and removals with it, and a write follows a link at the file
// itself (`kind` says whether that's the file or its parked .template). A dangling link can't be
// followed to see where it leads, so it counts as out.
function outsideTarget(target, dest, kind) {
  const root = realpathSync.native(target)
  const out = (real) => real !== root && !real.startsWith(root + sep)
  let dir = dirname(join(target, dest))
  while (!existsSync(dir)) {
    if (isLink(dir)) return true
    dir = dirname(dir)
  }
  if (out(realpathSync.native(dir))) return true
  if (kind === 'remove') return false // removing a link removes the link, not what it points at
  const file = join(target, parked(kind) ? `${dest}.template` : dest)
  if (!isLink(file)) return false
  return !existsSync(file) || out(realpathSync.native(file))
}

// What a re-apply writes: a new file, an update, or something parked beside the target's copy.
const WRITES = ['copy', 'update', 'park', 'park-unrecorded', 'propose']
const parked = (kind) => kind.startsWith('park') || kind === 'propose'

// Delivered paths the target's git ignores: an apply writes them, and they're never committed.
function gitignored(target, paths) {
  if (!paths.length) return []
  try {
    const out = execFileSync('git', ['check-ignore', '--stdin', '-z'], { cwd: target, input: paths.join('\0'), encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] })
    return out.split('\0').filter(Boolean)
  } catch (error) {
    // 1: nothing ignored. 128: not a git repository. ENOENT: no git.
    if (error.status === 1 || error.status === 128 || error.code === 'ENOENT') return []
    throw error
  }
}

/**
 * How far the target has drifted from this template, without writing anything: { delivered,
 * changes (what a re-apply would do), leftovers (parked .template files, conflict markers) }.
 */
export function drift(target) {
  if (outsideTarget(target, MANIFEST, 'copy')) throw new ManifestError(`${MANIFEST} leads out of the target through a symlink.`)
  const previous = readManifest(target)
  const delivered = Object.keys(previous.files).length > 0
  const { known, held } = splitPacks(previous.packs ?? [])
  const { actions } = plan(target, previous, known, held)
  const changes = actions.filter((a) => WRITES.includes(a.kind) || a.kind === 'remove').map((a) => ({ kind: a.kind, dest: a.dest }))
  const heldBack = [...new Set(actions.filter((a) => a.kind === 'own-skill').map((a) => a.dest.split('/').slice(0, 3).join('/')))]
  const leftovers = actions.filter((a) => a.kind === 'outside').map((a) => `${a.dest} leads out of the target through a symlink`)
  for (const dest of Object.keys(previous.files)) {
    if (existsSync(join(target, `${dest}.template`))) leftovers.push(`${dest}.template is still parked: merge it into ${dest} and delete it`)
    const abs = join(target, dest)
    const text = existsSync(abs) ? contentOf(abs) : null
    if (typeof text === 'string' && /^<{7} /m.test(text) && /^>{7} /m.test(text)) leftovers.push(`${dest} holds a merge conflict marker`)
  }
  return { delivered, templateCommit: previous.templateCommit ?? null, ahead: notInHistory(previous.templateCommit), held, heldBack, changes, leftovers }
}

/** Recorded packs this template ships, and those it doesn't. */
function splitPacks(recorded) {
  const shipped = new Set(PACKS())
  return { known: recorded.filter((p) => shipped.has(p)), held: recorded.filter((p) => p !== 'core' && !shipped.has(p)) }
}

const shallow = () => {
  try {
    return execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === 'true'
  } catch (error) {
    if (error.status !== undefined || error.code === 'ENOENT') return true // can't tell: don't claim ahead
    throw error
  }
}

// A target applied from a commit this checkout doesn't contain (a newer template, another branch,
// or the history this one was copied from): what a re-apply here would "update" could be a
// downgrade. False when it can't tell.
function notInHistory(commit) {
  if (!/^[0-9a-f]{40,64}$/.test(commit ?? '') || !templateCommit()) return false // nothing to look up, or no history here
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: ROOT, stdio: 'ignore' })
    return false
  } catch (error) {
    if (error.status === 1) return true // in history, but not behind HEAD
    if (error.status === 128) return !shallow() // not here at all: newer or elsewhere, unless the clone is shallow
    if (error.code === 'ENOENT') return false
    throw error
  }
}

// --- Main -------------------------------------------------------------------------------------

// Where a commit missing from this history can come from. Only someone who knows the target's
// history can tell the three apart, so each stays a warning.
const ELSEWHERE = 'a newer template, another branch, or a repository this template was copied from without its history'

function check(target) {
  const { delivered, templateCommit: from, ahead, held, heldBack, changes, leftovers } = drift(target)
  if (!delivered) {
    console.log(`Not delivered: ${target} has no ${MANIFEST}. Run process:apply first.`)
    process.exit(1)
  }
  const here = templateCommit()
  console.log(`Process drift: ${target}\nDelivered from ${from?.slice(0, 12) ?? 'an unknown commit'}; this template is at ${here?.slice(0, 12) ?? 'an unknown commit'}.\n`)
  if (ahead) console.log(`! ${from.slice(0, 12)} isn't in this template checkout's history (${ELSEWHERE}): a re-apply from here could take files back. Check with the checkout it came from.\n`)
  if (held.length) console.log(`! The manifest records pack(s) this template doesn't ship: ${held.join(', ')}. Their files are left as they are.\n`)
  if (heldBack.length) console.log(`! The target's own skill(s) hold the template's back: ${heldBack.join(', ')} (not a copy of the template's; see process:apply's report).\n`)
  if (changes.length) {
    console.log(`A re-apply would change ${changes.length} file(s):`)
    for (const c of changes.slice(0, 20)) console.log(`  ${c.kind === 'remove' ? 'x' : parked(c.kind) ? '~' : c.kind === 'copy' ? '+' : '↑'} ${c.dest} (${c.kind})`)
    if (changes.length > 20) console.log(`  ... and ${changes.length - 20} more`)
    console.log('')
  }
  for (const l of leftovers) console.log(`! ${l}`)
  if (leftovers.length) console.log('')
  const drifted = changes.length > 0 || leftovers.length > 0
  console.log(drifted ? '✗ Drifted: re-run process:apply, merge what it parks, and commit.' : '✓ Current with this template.')
  process.exit(drifted ? 1 : 0)
}

function main() {
  // Before anything is written: on an unsupported Node a later step can fail halfway (the report
  // uses Object.groupBy), after files are copied and the manifest is saved.
  const engines = enginesNode()
  if (!satisfies(process.versions.node, engines)) {
    console.error(`process:apply needs Node ${engines} (package.json engines); this is ${process.versions.node}. Nothing was written.`)
    process.exit(2)
  }
  const args = parseArgs(process.argv.slice(2))
  if (args.error || !args.target) {
    if (args.error) console.error(args.error)
    usage()
    process.exit(args.error ? 2 : 1)
  }
  const target = resolve(args.target)
  if (!existsSync(target) || !statSync(target).isDirectory()) fail(`Target is not an existing directory: ${target}`)
  // realpath.native returns the on-disk case, and case-insensitive filesystems are compared as
  // such, so a differently-cased path to this repo can't slip past.
  const insensitive = process.platform === 'darwin' || process.platform === 'win32'
  const canon = (p) => (insensitive ? realpathSync.native(p).toLowerCase() : realpathSync.native(p))
  if (canon(target) === canon(ROOT) || canon(target).startsWith(canon(ROOT) + sep)) {
    fail('Target is this repo or inside it — these files already live here.')
  }

  // The manifest is the one file every run reads and writes: through a link out of the target,
  // it would be another directory's (a shared prompts/ in a monorepo).
  if (outsideTarget(target, MANIFEST, 'copy')) fail(`${MANIFEST} leads out of the target through a symlink (prompts/ or the file itself). Nothing was read or written.`)
  let previous
  try {
    previous = readManifest(target)
  } catch (error) {
    if (error instanceof ManifestError) fail(error.message)
    throw error
  }
  if (args.check) return check(target)
  const split = splitPacks(previous.packs ?? [])
  const unknownDrop = args.dropPacks.filter((p) => !PACKS().includes(p) && !split.held.includes(p))
  if (unknownDrop.length) fail(`No pack ${unknownDrop.join(', ')} in the template's standards/ or the target's manifest.`, 2)
  const held = split.held.filter((p) => !args.dropPacks.includes(p)) // a dropped one's files go the usual way
  const packs = [...new Set([...split.known, ...args.packs])].filter((p) => p !== 'core' && !args.dropPacks.includes(p)).sort()
  const { actions, next } = plan(target, previous, packs, held)
  const list = args.list === true

  let recorded = false
  if (!list) {
    for (const { kind, dest, content } of actions) {
      if (kind === 'remove') {
        rmSync(join(target, dest))
        // And each directory that leaves empty, up to the target.
        for (let dir = dirname(join(target, dest)); dir !== target && readdirSync(dir).length === 0; dir = dirname(dir)) rmSync(dir, { recursive: true })
      }
      if (!WRITES.includes(kind)) continue
      const out = join(target, parked(kind) ? `${dest}.template` : dest)
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, content)
    }
    // Keys are sorted, and the file is rewritten only when what it records changed, so a no-op
    // re-run (from any OS) leaves the target's working tree clean.
    const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => (a < b ? -1 : 1)))
    const recordedPacks = [...packs, ...held].sort()
    const packsChanged = JSON.stringify(recordedPacks) !== JSON.stringify(previous.packs ?? [])
    if (JSON.stringify(sorted) !== JSON.stringify(previous.files) || packsChanged) {
      const record = {
        template: 'agent-ready-template',
        templateCommit: templateCommit(),
        appliedAt: new Date().toISOString(),
        ...(recordedPacks.length ? { packs: recordedPacks } : {}),
        files: sorted,
      }
      mkdirSync(dirname(join(target, MANIFEST)), { recursive: true })
      writeFileSync(join(target, MANIFEST), `${JSON.stringify(record, null, 2)}\n`)
      recorded = true
    }
  }

  // --- Report ---
  const byKind = Object.groupBy(actions, (a) => a.kind)
  const files = (kind) => (byKind[kind] ?? []).map((a) => a.dest)
  const sections = [
    ['copy', list ? 'Would copy' : 'Copied', '+'],
    ['update', `${list ? 'Would update' : 'Updated'} in place (template changed; target copy untouched)`, '↑'],
    ['park', `${list ? 'Would park' : 'Parked'} the new version alongside (template changed, and so did the target's copy)`, '~'],
    ['park-unrecorded', `${list ? 'Would park' : 'Parked'} the template version alongside (the target has its own file here and no record of an earlier apply, so it can't tell an old delivery from your edit — if you never edited it, delete it and re-run)`, '~'],
    ['propose', `${list ? 'Would park' : 'Parked'} a merge proposal alongside (template changed, and so did the target's copy): your edits and the template's, merged over the version last offered`, '~'],
    ['remove', `${list ? 'Would remove' : 'Removed'} (no longer in the template; target copy was untouched)`, 'x'],
    ['orphaned', 'No longer in the template, but edited in the target — left in place; delete it when you no longer need it', '?'],
    ['kept-deleted', 'Left deleted (removed in the target after an earlier apply)', '-'],
    ['shadowed', `${list ? 'Would hold' : 'Held'} back: in Claude Code this skill would silently replace the target's command of the same name (.claude/commands/<name>.md). Move what you need from that command into .agents/skills/<name>/SKILL.md, delete the command, and re-run`, '!'],
    ['own-skill', `${list ? 'Would hold' : 'Held'} back: the target has a skill of its own by this name, not a copy of the template's (Claude Code's /verify records its run recipe at .claude/skills/verify/SKILL.md, for one). Yours is left as it is. To take the template's, fold what yours does into it, delete yours, and re-run`, '!'],
    ['outside', `${list ? 'Would skip' : 'Skipped'}: the path leads out of the target through a symlink, so nothing is written or removed there`, '!'],
  ]
  console.log(`${list ? 'Dry run: ' : ''}process assets -> ${target}\n`)
  let changed = false
  for (const [kind, title, mark] of sections) {
    if (!files(kind).length) continue
    if (!['kept-deleted', 'orphaned', 'shadowed', 'own-skill', 'outside'].includes(kind)) changed = true
    console.log(`${title}:`)
    for (const a of byKind[kind]) {
      const note = a.kind === 'propose' ? (a.conflicts ? ` (${a.conflicts} conflict(s) marked)` : ' (merged cleanly)') : ''
      console.log(`  ${mark} ${a.dest}${parked(kind) ? `  ->  ${a.dest}.template${note}` : ''}`)
    }
    console.log('')
  }
  if (packs.length) console.log(`Standards delivered: core, ${packs.join(', ')} (prompts/standards/).\n`)
  if (held.length) console.log(`The manifest records pack(s) this template doesn't ship: ${held.join(', ')}. Their files are left as they are; apply from the template they came from to update them.\n`)
  if (notInHistory(previous.templateCommit)) {
    console.log(`! The target was last applied from ${previous.templateCommit.slice(0, 12)}, which isn't in this template checkout's history (${ELSEWHERE}): what this run updated could be older than what it replaced. Review the diff before committing.\n`)
  }
  const ignored = gitignored(target, [...actions.filter((a) => !['kept-deleted', 'remove', 'shadowed', 'own-skill', 'outside'].includes(a.kind)).map((a) => a.dest), MANIFEST])
  if (ignored.length) {
    const shown = ignored.slice(0, 5).map((f) => `  ! ${f}`).join('\n')
    console.log(
      `The target's .gitignore covers ${ignored.length} delivered file(s), so they'd never be committed:\n${shown}` +
        `${ignored.length > 5 ? `\n  ... and ${ignored.length - 5} more` : ''}\nAdd exceptions to .gitignore (for an ignored .claude/: \`.claude/*\` then \`!.claude/skills/\`), and re-run to confirm.\n`,
    )
  }
  // Named so the report accounts for every file it wrote.
  if (recorded) console.log(`Recorded ${MANIFEST}: what each delivered file was, so a re-apply can tell your edits from old deliveries.\n`)
  const edited = files('target-edited').length
  const upToDate = files('current').length + edited
  if (upToDate) console.log(`Up to date: ${upToDate} file(s)${edited ? ` (${edited} edited in the target, kept as-is)` : ''}.\n`)
  if (!changed && !recorded) console.log('Nothing to change.\n')

  const leftovers = legacyLeftovers(target)
  const instructions = INSTRUCTION_PATHS.filter((p) => existsSync(join(target, p)) && !leftovers.includes(p))
  if (leftovers.length) {
    console.log(
      `These live files look like unfilled skeletons from an apply that predates prompts/skeletons/:\n` +
        leftovers.map((p) => `  ! ${p}`).join('\n') +
        `\nIf they're still unfilled, delete them; the skeletons are staged under prompts/skeletons/ now.\n`,
    )
  }
  // CLAUDE.local.md is personal and usually untracked: never the place to merge shared rules.
  const existing = instructions.find((p) => p !== 'CLAUDE.local.md')
  if (instructions.length) {
    let advice = ''
    if (existing === 'AGENTS.md') advice = 'Merge the rules from prompts/skeletons/AGENTS.skeleton.md into AGENTS.md.'
    else if (existing) {
      advice =
        `An existing project (/complete) merges the rules from prompts/skeletons/AGENTS.skeleton.md ` +
        `into ${existing}; a new one (/bootstrap) folds ${existing} into a new AGENTS.md.`
    }
    console.log(
      `The target already has agent instructions: ${instructions.join(', ')}.\n` +
        (advice ? `Don't add a second set of rules. ${advice}\n` : ''),
    )
  }
  const hidden = agentsHiddenFromClaude(target)
  if (hidden) console.log(`${hidden.file}: ${hidden.detail}\n`)

  const steps = []
  const first = Object.keys(previous.files).length === 0
  const parkedCount = files('park').length + files('park-unrecorded').length + files('propose').length
  const delivered = !list && first && files('copy').length > 0
  // Before the commit: a pre-commit formatter would otherwise rewrite the delivery as it's committed.
  if (delivered) {
    steps.push(`If this repo runs a formatter, a pre-commit one included, exclude prompts/, .agents/skills/,
     and .claude/skills/ from it (for Prettier, add those three lines to .prettierignore). A reformat
     makes every delivered file look edited, and re-applies then park the template's updates
     instead of applying them.`)
  }
  if (recorded) {
    const leaveOut = parkedCount ? ' Leave the *.template files out of it.' : ''
    steps.push(
      first
        ? `Commit this delivery as it is, with ${MANIFEST}, before any prompt run, so the run's own diff
     stays reviewable.${leaveOut}`
        : `Commit the updated files with ${MANIFEST}, as their own commit.${leaveOut}`,
    )
  }
  if (delivered) {
    steps.push(
      `Pick the workflow: a new or empty repo -> the bootstrap skill (prompts/new-project.md);
     existing code -> the complete skill (prompts/existing-project.md). Invoke a skill as
     /complete in Claude Code or Antigravity, $complete in Codex, or by name in another agent;
     an agent without skills can open the prompt file and follow it. prompts/README.md explains
     them all.`,
      `The skeletons are staged under prompts/skeletons/. The prompt run copies each one it needs
     to its real path and fills it in; nothing there is live until then.`,
      'Record the project prompt run in prompts/run-log.md.',
      `For day-to-day work afterwards, the skills discovery (prompts/discovery.md) before the next
     piece of work, plan-change (prompts/plan-change.md) to plan a large change, root-cause
     (prompts/investigate.md) for a defect, review-change
     (prompts/review.md) for a review, pre-pr (prompts/pre-pr.md) before a PR, and verify
     (prompts/verify.md) before each commit, which Claude Code runs on its own.`,
    )
  }
  if (!list && parkedCount) {
    steps.push(`Merge each *.template into the file beside it by hand, then delete the .template (don't commit
     them). A merge proposal is the merged file already: read it, resolve any conflict markers, and
     move it over the file. Each is offered once: the next run won't re-park it unless the template
     changes again. \`process:apply --check\` reports any left behind.`)
  }
  if (steps.length) {
    console.log('Next steps, in the target repo:')
    steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`))
    console.log('')
  }
}

// Run only when executed directly, so the tests can import the delivery lists.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main()
