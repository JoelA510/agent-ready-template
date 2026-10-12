#!/usr/bin/env node
// Scores a repository against the standards catalog (standards/), the deterministic half of the
// existing-project audit, so any repository's state reads in a minute and compares with every
// other's. Each standard has a stable ID (`<pack>.<name>`), lives in standards/<pack>/<name>.md,
// and says how it's enforced: by a probe here (`enforcement: check`) or by a person
// (`enforcement: audit`, listed and never scored). standards/README.md is the user's guide; this
// header is the contract.
//
// Packs: `core` applies to every repository. Another pack applies where one of its markers
// (standards/<pack>/README.md, `detect`) is found at the root, or where the repository's config
// or --pack names it, optionally at a path below the root (`node@mobile-app`). A declared list
// replaces detection; a detected pack it leaves out is reported, not applied.
//
// Statuses, per standard and per pack path: pass; fail; n/a (doesn't apply here, with why);
// skipped (needs an input it wasn't given, which it names); audit (a person checks it); error (the
// probe couldn't run, which is never a pass); and, for a failure the repository's config accounts
// for, waived (a current, reasoned waiver) or baseline (recorded when the repository adopted the
// standards).
//
// The config (docs/standards/conformance.json in the repository, or --config) is held to the bar
// it enforces: a waiver needs a reason of 40 characters or more, an owner, and an expiry within
// MAX_WAIVER_DAYS; an expired waiver covers nothing; a waiver or baseline entry whose standard no
// longer fails is stale and fails the run, so neither list can outlive its purpose. A baseline
// only shrinks: --write-baseline records the current failures when there's none, and afterwards
// only drops the fixed ones, refusing to add a new failure (fix it or waive it).
//
// Probes read files and git, never the network. Three run the template's own checks as they ship:
// core.instructions-resolve (check-instructions.mjs), and vite-spa.client-env and expo.client-env
// (check-env.mjs).
//
// Run: node scripts/check-conformance.mjs [--root <repo>] [--config <file>] [--pack <name[@path]>]...
//        [--visibility public|private] [--json <file|->] [--write-baseline] [--today YYYY-MM-DD]
//   Exit 0 conformant; 1 on a failure, an expired or stale waiver, a stale baseline entry, or a
//   baseline --write-baseline refused to grow; 2 on bad arguments, an invalid catalog or config, a
//   probe that couldn't run, or the template's dependencies not installed.
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SKIP_DIRS, inSkeletonDir, listRepoFiles, skeletonDirs, toPosix } from './repo-files.mjs'
import { floor, satisfies } from './runtime.mjs'
import { MISSING_DEPENDENCY, templateDependency } from './template-dependency.mjs'

const TEMPLATE = dirname(dirname(fileURLToPath(import.meta.url)))
export const CATALOG = join(TEMPLATE, 'standards')
export const CONFIG = 'docs/standards/conformance.json'
export const MAX_WAIVER_DAYS = 90
const SEVERITIES = ['blocker', 'high', 'medium', 'low']
const ENFORCEMENTS = ['check', 'audit', 'settings']
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Couldn't check: bad arguments, an invalid catalog or config. Exit 2. */
export class CheckError extends Error {}

// Loaded on first use, so a missing install surfaces as MISSING_DEPENDENCY in main(), with how to
// fix it, rather than as a stack trace at import.
let yaml
let ts
let toml
let json5
const loadYaml = () => (yaml ??= templateDependency('yaml'))
const loadTs = () => (ts ??= templateDependency('typescript'))
const loadToml = () => (toml ??= templateDependency('smol-toml'))
const loadJson5 = () => (json5 ??= templateDependency('json5'))

const read = (path) => readFileSync(path, 'utf8').replace(/^\uFEFF/, '') // npm and git accept a BOM
const isDir = (path) => existsSync(path) && statSync(path).isDirectory()
function isSymlink(path) {
  try {
    return lstatSync(path).isSymbolicLink() // a dangling one too, which existsSync calls missing
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}
const list = (items, max = 10) => (items.length > max ? [...items.slice(0, max), `... and ${items.length - max} more`] : items)

// --- The catalog -------------------------------------------------------------------------------

function frontmatter(text, where) {
  const source = text.replace(/^\uFEFF/, '')
  const match = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(source)
  if (!match) return { problem: `${where}: no YAML frontmatter between --- lines` }
  let data
  try {
    data = loadYaml().parse(match[1] ?? '')
  } catch (error) {
    if (!(error instanceof loadYaml().YAMLError)) throw error
    return { problem: `${where}: frontmatter isn't valid YAML: ${error.message.split('\n')[0]}` }
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return { problem: `${where}: frontmatter must be "key: value" fields` }
  return { data, body: source.slice(match[0].length) }
}

/**
 * The catalog under `dir`: { packs: Map<name, { name, title, detect }>, standards: [...],
 * problems: string[] }. Problems make every run exit 2, so a malformed catalog never scores.
 */
export function loadCatalog(dir = CATALOG) {
  const problems = []
  const packs = new Map()
  const standards = []
  if (!isDir(dir)) return { packs, standards, problems: [`no standards catalog at ${dir}`] }
  const packDirs = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
  for (const pack of packDirs) {
    const readme = join(dir, pack, 'README.md')
    if (!NAME.test(pack)) problems.push(`${pack}/: a pack name is a-z, 0-9, and single hyphens`)
    if (!existsSync(readme)) {
      problems.push(`${pack}/: no README.md defining the pack`)
      continue
    }
    const fm = frontmatter(read(readme), `${pack}/README.md`)
    if (fm.problem) {
      problems.push(fm.problem)
      continue
    }
    const { data } = fm
    if (data.pack !== pack) problems.push(`${pack}/README.md: "pack" must be "${pack}", its directory`)
    if (typeof data.title !== 'string' || !data.title.trim()) problems.push(`${pack}/README.md: "title" is required`)
    if (pack === 'core') {
      if (data.detect !== undefined) problems.push('core/README.md: core applies everywhere, so it takes no "detect"')
    } else if (!Array.isArray(data.detect) || !data.detect.length) {
      problems.push(`${pack}/README.md: "detect" must list at least one marker ({ file: <glob> } or { dependency: <name> })`)
    } else {
      data.detect.forEach((m, i) => {
        const keys = m && typeof m === 'object' && !Array.isArray(m) ? Object.keys(m) : []
        const ok = keys.length === 1 && ['file', 'dependency'].includes(keys[0]) && typeof m[keys[0]] === 'string' && m[keys[0]].trim()
        if (!ok) problems.push(`${pack}/README.md: detect[${i}] must be { file: <glob> } or { dependency: <name> }`)
      })
    }
    packs.set(pack, { name: pack, title: data.title, detect: pack === 'core' ? [] : (data.detect ?? []) })

    const files = readdirSync(join(dir, pack)).filter((f) => f.endsWith('.md') && f !== 'README.md').sort()
    for (const file of files) {
      const name = file.slice(0, -'.md'.length)
      const where = `${pack}/${file}`
      const parsed = frontmatter(read(join(dir, pack, file)), where)
      if (parsed.problem) {
        problems.push(parsed.problem)
        continue
      }
      const d = parsed.data
      const id = `${pack}.${name}`
      if (!NAME.test(name)) problems.push(`${where}: a standard's file name is a-z, 0-9, and single hyphens`)
      if (d.id !== id) problems.push(`${where}: "id" must be "${id}", its path`)
      if (typeof d.title !== 'string' || !d.title.trim()) problems.push(`${where}: "title" is required`)
      if (!SEVERITIES.includes(d.severity)) problems.push(`${where}: "severity" must be one of ${SEVERITIES.join(', ')}`)
      if (!ENFORCEMENTS.includes(d.enforcement)) problems.push(`${where}: "enforcement" must be check, audit, or settings`)
      if (!Number.isInteger(d['audit-area']) || d['audit-area'] < 1 || d['audit-area'] > 12) {
        problems.push(`${where}: "audit-area" must be the existing-project audit area it belongs to, 1-12`)
      }
      if (!parsed.body.trim()) problems.push(`${where}: the body must say what the standard requires and why`)
      standards.push({ id, pack, name, title: d.title, severity: d.severity, enforcement: d.enforcement, auditArea: d['audit-area'], file: where })
    }
  }
  if (!packs.has('core')) problems.push('no core/ pack: core holds what every repository is held to')
  for (const s of standards) {
    if (s.enforcement === 'check' && !PROBES[s.id]) problems.push(`${s.file}: enforcement is "check", but PROBES has no ${s.id}`)
  }
  for (const id of Object.keys(PROBES)) {
    if (!standards.some((s) => s.id === id && s.enforcement === 'check')) problems.push(`PROBES.${id} has no "check" standard in the catalog`)
  }
  return { packs, standards, problems }
}

// --- Reading a repository ------------------------------------------------------------------------

// The checkout's root as a workflow names it: the expression, which Actions evaluates in any field
// and any shell, and the variable, which only a POSIX shell expands (not working-directory or an
// action's input, and not PowerShell, where it's $env:GITHUB_WORKSPACE).
const ROOT_EXPRESSION = /^\$\{\{\s*github\.workspace\s*\}\}(?=\/|$)/
const ROOT_VARIABLE = /^(?:\$\{GITHUB_WORKSPACE\}|\$GITHUB_WORKSPACE(?!\w))(?=\/|$)/

/**
 * A path a workflow writes from the checkout's root, as a repository path (null when it leaves the
 * repository), or undefined when it doesn't start at the root.
 */
function fromWorkspace(target, { posix = false } = {}) {
  const quoted = /^(["'])(.*)\1$/.exec(String(target))
  const t = quoted ? quoted[2] : String(target)
  // Actions substitutes the expression before any shell runs; single quotes keep a variable literal.
  const root = ROOT_EXPRESSION.exec(t) ?? (posix && quoted?.[1] !== "'" ? ROOT_VARIABLE.exec(t) : null)
  return root ? joinDir('.', `.${t.slice(root[0].length)}`) : undefined
}

/** The index of the `)` that closes the `(` at `open`, or -1. Quotes inside aren't parsed. */
function closingParen(text, open) {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')' && --depth === 0) return i
  }
  return -1
}

/**
 * The directory an expansion at the start of `text` names, and the text after it, or null. Only
 * the ones a script uses to find its way: the repository's root (`$(git rev-parse
 * --show-toplevel)`, `$GITHUB_WORKSPACE`, `${{ github.workspace }}`), the running script's own
 * directory (`$(dirname "$0")`, or bash's BASH_SOURCE), `$(pwd)` and `$PWD`, `$(cd <dir> && pwd)`,
 * and a variable set to one of those. Outside a POSIX shell, only the expression.
 */
function leadingDir(text, cwd, shell) {
  const expression = /^\$\{\{\s*github\.workspace\s*\}\}/.exec(text)
  if (expression) return ['.', text.slice(expression[0].length)]
  // PowerShell has $(...) and $PWD too, but its quoting isn't read here: unknown, never a guess.
  if (shell.posix === false) return null
  if (text.startsWith('$(')) {
    const end = closingParen(text, 1)
    if (end < 0) return null
    const inner = text.slice(2, end).trim()
    const self = /^dirname\s+(?:--\s+)?("?)(?:\$0|\$\{0\}|\$BASH_SOURCE|\$\{BASH_SOURCE(?:\[0\])?\})\1$/.test(inner)
    const cd = /^cd\s+(.+?)\s*(?:&&|;)\s*pwd(?:\s+-[LP])?$/s.exec(inner)
    const dir = /^git\s+rev-parse\s+--show-toplevel$/.test(inner)
      ? '.'
      : /^pwd(?:\s+-[LP])?$/.test(inner)
        ? cwd
        : self
          ? (shell.scriptDir ?? null)
          : cd
            ? cdTarget(cdArgument(cd[1]), cwd, shell)
            : undefined
    return dir === undefined ? null : [dir, text.slice(end + 1)]
  }
  const variable = /^\$(?:\{(\w+)\}|(\w+)(?!\w))/.exec(text)
  const name = variable && (variable[1] ?? variable[2])
  if (name === 'PWD') return [cwd, text.slice(variable[0].length)]
  if (name === 'GITHUB_WORKSPACE') return ['.', text.slice(variable[0].length)]
  return name && shell.vars?.has(name) ? [shell.vars.get(name), text.slice(variable[0].length)] : null
}

/** The directory a word that starts with an expansion names (`"$(dirname "$0")/.."`), or null. */
function expandedDir(word, cwd, shell) {
  const opened = word.startsWith('"')
  const lead = leadingDir(opened ? word.slice(1) : word, cwd, shell)
  if (!lead) return null
  const [base, tail] = lead
  const closed = opened ? /^([^"]*)"(.*)$/.exec(tail) : ['', '', tail]
  if (!closed || base === null) return null
  const path = closed[1] + closed[2].replace(/^"(.*)"$/, '$1')
  return /^(\/[^\s'"$`\\]*)?$/.test(path) ? joinDir(base, `.${path}`) : null
}

/** A cd's argument without what doesn't change where it goes: `-P`, `-L`, `--`, and redirections. */
const cdArgument = (text) =>
  text
    .replace(/\s+(?:\d*>>?|&>>?)\s*(?!&)\S+|\s+\d*>&\d+/g, '')
    .replace(/^(?:-[LP]+(?:\s+|$))*(?:--(?:\s+|$))?/, '')
    .trim()

/**
 * Where `cd <argument>` leaves a shell that was at `cwd`, as a repository path; null when that
 * can't be known or is outside the repository. `shell` says whether it's a POSIX shell, the running
 * script's directory when the commands come from a script in the repository, and the variables
 * set to a directory so far.
 */
function cdTarget(argument, cwd, shell) {
  const plain = /^(["']?)(\$\{\{\s*github\.workspace\s*\}\}[^'"\s]*|[^'"\s]+)\1$/.exec(argument)
  if (plain) {
    const rooted = fromWorkspace(`${plain[1]}${plain[2]}${plain[1]}`, shell)
    if (rooted !== undefined) return rooted
    if (!plain[2].startsWith('$') || plain[1] === "'" || shell.posix === false) return joinDir(cwd, plain[2])
  }
  return expandedDir(argument, cwd, shell)
}

/** A posix path joined onto `base`, or null when it leaves the repository or can't be known. */
function joinDir(base, target) {
  const rooted = typeof target === 'string' ? fromWorkspace(target) : undefined
  if (rooted !== undefined) return rooted
  if (base === null || !target || /^[/~]/.test(target) || /[$`<>]/.test(target)) return null // an expansion or a redirection
  const joined = posix.normalize(posix.join(base, target)).replace(/\/$/, '') || '.'
  return joined === '..' || joined.startsWith('../') ? null : joined
}

/** A glob (`*`, `**`, `?`; a trailing `/` matches a directory) as a predicate on relative paths. */
export function globMatcher(pattern) {
  const dirOnly = pattern.endsWith('/')
  const body = pattern
    .replace(/\/$/, '')
    .split(/(\*\*\/|\*\*|\*|\?)/)
    .map((part) =>
      part === '**/' ? '(?:.*/)?' : part === '**' ? '.*' : part === '*' ? '[^/]*' : part === '?' ? '[^/]' : part.replace(/[.+^${}()|[\]\\]/g, '\\$&'),
    )
    .join('')
  const re = new RegExp(dirOnly ? `^${body}/` : `^${body}$`)
  return (path) => re.test(path)
}

function readWorkflows(root, files) {
  const Y = loadYaml()
  return files
    .filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f))
    .sort()
    .map((file) => {
      let doc
      try {
        doc = Y.parse(read(join(root, file)))
      } catch (error) {
        if (!(error instanceof Y.YAMLError)) throw error
        return { file, error: error.message.split('\n')[0], events: new Set(), jobs: [] }
      }
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { file, error: 'not a mapping', events: new Set(), jobs: [] }
      const on = doc.on ?? doc[true] // YAML 1.1 readers turn a bare `on` into true
      const events = new Set(typeof on === 'string' ? [on] : Array.isArray(on) ? on : on && typeof on === 'object' ? Object.keys(on) : [])
      const coe = (v) => v === true || (typeof v === 'string' && v.trim() !== 'false')
      const never = (v) => v === false || (typeof v === 'string' && /^\s*(\$\{\{\s*false\s*\}\}|false)\s*$/.test(v)) // if: false
      const declared = on && typeof on === 'object' && !Array.isArray(on) ? on.workflow_call?.inputs : undefined
      // A called workflow's inputs, at their defaults; the caller's `with` overrides them.
      const inputs = Object.fromEntries(Object.entries(declared && typeof declared === 'object' ? declared : {}).map(([k, v]) => [k, v?.default]))
      const workflowDir = doc.defaults?.run?.['working-directory']
      const workflowShell = doc.defaults?.run?.shell
      const jobs = Object.entries(doc.jobs && typeof doc.jobs === 'object' ? doc.jobs : {}).map(([id, job]) => ({
        id,
        uses: typeof job?.uses === 'string' ? job.uses : undefined,
        permissions: job?.permissions,
        text: JSON.stringify(job ?? {}), // for the secrets it names
        with: job?.with && typeof job.with === 'object' ? job.with : {}, // a called workflow's inputs
        continueOnError: coe(job?.['continue-on-error']),
        never: never(job?.if),
        runsOn: typeof job?.['runs-on'] === 'string' ? job['runs-on'] : '',
        dir: job?.defaults?.run?.['working-directory'] ?? workflowDir,
        shell: job?.defaults?.run?.shell ?? workflowShell,
        matrix: job?.strategy?.matrix && typeof job.strategy.matrix === 'object' ? job.strategy.matrix : {},
        steps: (Array.isArray(job?.steps) ? job.steps : []).map((s, i) => ({
          name: typeof s?.name === 'string' ? s.name : `step ${i + 1}`,
          run: typeof s?.run === 'string' ? s.run : undefined,
          uses: typeof s?.uses === 'string' ? s.uses : undefined,
          with: s?.with && typeof s.with === 'object' ? s.with : {},
          continueOnError: coe(s?.['continue-on-error']),
          never: never(s?.if),
          dir: s?.['working-directory'],
          shell: s?.shell,
        })),
      }))
      return { file, events, jobs, inputs, permissions: doc.permissions, env: JSON.stringify(doc.env ?? {}) }
    })
}

// --- Reading shell -------------------------------------------------------------------------------

/**
 * Shell text as lists ([{ pipelines }]) of and-or lists of pipelines ({ op, stages }), op being
 * the `&&` or `||` that joins one to the one before. It splits only outside quotes, `$( )`,
 * backticks, and `( )` or `{ }` groups, drops comments and heredoc bodies, and carries a list on
 * past a newline that follows `&&`, `||`, or `|`, as bash does.
 */
function parseShell(text) {
  const lists = []
  let pipelines = []
  let stages = []
  let word = ''
  let op = null
  let afterOperator = false // a newline here continues the list
  let heredocs = [] // delimiters whose bodies start at the next newline
  const stack = [] // what's open: '"', "'", '`', ')' for $( ) and ( ), '}' for a { } group
  const endStage = () => {
    stages.push(word.trim())
    word = ''
  }
  const endPipeline = (next) => {
    endStage()
    const kept = stages.filter(Boolean)
    if (kept.length) pipelines.push({ op, stages: kept })
    stages = []
    op = next
  }
  const endList = () => {
    endPipeline(null)
    if (pipelines.length) lists.push({ pipelines })
    pipelines = []
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const open = stack.at(-1)
    if (open === "'") {
      word += c
      if (c === "'") stack.pop()
      continue
    }
    if (c === '\\') {
      word += c + (text[++i] ?? '')
      continue
    }
    if (open === '"') {
      word += c
      if (c === '"') stack.pop()
      else if (c === '`') stack.push('`')
      else if (c === '$' && text[i + 1] === '(') {
        stack.push(')')
        word += text[++i]
      }
      continue
    }
    const code = open !== '`' // outside quotes: a comment or a heredoc can start here
    if (code && c === '#' && (!word || /\s$/.test(word))) {
      while (i + 1 < text.length && text[i + 1] !== '\n') i++
      continue
    }
    const heredoc = code && c === '<' && /^<<(-?)\s*(['"]?)([A-Za-z_][\w-]*)\2/.exec(text.slice(i, i + 80))
    if (heredoc && text[i + 2] !== '<') {
      heredocs.push(heredoc[3])
      word += heredoc[0]
      i += heredoc[0].length - 1
      continue
    }
    if (code && c === '\n' && heredocs.length) {
      if (!stack.length) endList()
      else word += c
      // The body is data, not commands: skip it through each delimiter line.
      for (const end of heredocs) {
        while (i < text.length) {
          const next = text.indexOf('\n', i + 1)
          const line = text.slice(i + 1, next === -1 ? text.length : next)
          i = next === -1 ? text.length : next
          if (line.trim() === end) break
        }
      }
      heredocs = []
      continue
    }
    if (c === '`' && open === '`') stack.pop()
    else if (c === '"' || c === "'" || c === '`') stack.push(c)
    else if (c === '(') stack.push(')')
    else if (c === ')' && open === ')') stack.pop()
    else if (c === '{' && !word.trim() && /\s/.test(text[i + 1] ?? '')) stack.push('}')
    else if (c === '}' && open === '}' && /(^|[\s;])$/.test(word)) stack.pop()
    else if (!stack.length) {
      if (c === '\n' && afterOperator) {
        word += ' '
        continue
      }
      if (c === '\n' || c === ';') {
        endList()
        continue
      }
      if ((c === '&' || c === '|') && text[i + 1] === c) {
        endPipeline(c + c)
        afterOperator = true
        i++
        continue
      }
      if (c === '|') {
        endStage()
        afterOperator = true
        if (text[i + 1] === '&') i++ // |& pipes stderr too
        continue
      }
      if (c === '&' && !/[<>]$/.test(word) && text[i + 1] !== '>') {
        endList() // cmd & runs in the background; a later `wait` may still collect its status
        continue
      }
    }
    if (!/\s/.test(c)) afterOperator = false
    word += c
  }
  endList()
  return lists
}

// What a pipeline does when it runs, for following a failure through `&&` and `||`.
function outcome(stages) {
  if (stages.length !== 1) return 'unknown'
  const [t] = stages
  if (/^(true|:|exit\s+0)$/.test(t) || /^(echo|printf)(\s|$)/.test(t)) return 'ok'
  if (/^(exit|return)(\s+[1-9]\d*)?$/.test(t) || /^[({][\s\S]*\b(exit|return)\s+[1-9]\d*\s*;?\s*[)}]$/.test(t)) return 'exit'
  return t === 'false' ? 'fail' : 'unknown'
}

/**
 * Why a failure of pipeline k can't fail the snippet, or null when it can. The failure is
 * followed through what runs after it in its and-or list: `|| true` or `|| echo` swallows it,
 * `|| exit 1` keeps it, and any other command after `||` is assumed to fail as well. Bash's errexit
 * stops only on the final command of a list (`false && true; echo` carries on), and a shell
 * without it goes by the last list's status alone.
 */
function ignoredFailure(pipelines, k, { last, errexit }) {
  let failing = true
  let ran = k
  let swallowed = null
  for (let j = k + 1; j < pipelines.length; j++) {
    const { op, stages } = pipelines[j]
    if (op === '&&' ? failing : !failing) continue // not run
    const o = outcome(stages)
    if (o === 'exit') return null
    if (o === 'unknown') {
      if (!failing) return swallowed // it runs either way, so it decides alone
      ran = j // assume it fails too, and keep following: `|| retry || true` still swallows
      continue
    }
    if (failing && o === 'ok') swallowed = `its failure goes to "|| ${stages[0]}"`
    failing = o === 'fail'
    ran = j
  }
  if (!failing) return swallowed
  if (last) return null
  if (!errexit) return "not the last command, in a shell that doesn't stop on a failure"
  return ran === pipelines.length - 1 ? null : 'not the last of its && or || list, where bash -e lets a failure pass'
}

/**
 * The commands in a shell snippet, with `cd` followed and `( )` and `{ }` groups opened. One whose
 * failure can't fail the snippet says why in `silenced` (ignoredFailure, or a pipe stage before
 * the last without pipefail). A `set` line changes errexit and pipefail from there on, unless
 * `fixedErrexit` keeps errexit as given. An `if` or `while` condition counts: what follows it may
 * well exit on a failure.
 */
export function shellCommands(text, dir = '.', options = {}) {
  let { errexit = true, pipefail = false } = options
  const posix = options.posix !== false
  const out = []
  let cwd = dir
  let previous = null // `cd -` goes back to it; a shell that hasn't moved has nowhere to go back to
  const vars = new Map(options.vars) // a subshell starts with its parent's, and keeps its own
  // A keyword that opens a body isn't a command: `then npm test` runs npm test, `fi` runs nothing.
  const lists = parseShell(text.replace(/\r\n?/g, '\n').replace(/\\\n/g, ' '))
    .map((list) => ({
      pipelines: list.pipelines
        .map((p) => ({ ...p, stages: p.stages.map((stage) => stage.replace(/^(then|else|do)\s+/, '')).filter((stage) => !/^(then|else|do|done|fi|esac)$/.test(stage)) }))
        .filter((p) => p.stages.length),
    }))
    .filter((list) => list.pipelines.length)
  lists.forEach(({ pipelines }, li) => {
    const first = pipelines[0].stages[0]
    if (pipelines.length === 1 && pipelines[0].stages.length === 1 && /^set\s/.test(first)) {
      const set = setOptions(first, { errexit, pipefail })
      ;({ pipefail } = set)
      if (!options.fixedErrexit) ({ errexit } = set)
      return
    }
    const condition = /^(if|elif|while|until)\s/.test(first)
    pipelines.forEach(({ stages }, k) => {
      const exits = outcome(stages) === 'exit' // ends the shell whatever its settings
      const fate = condition || exits ? null : ignoredFailure(pipelines, k, { last: li === lists.length - 1, errexit })
      stages.forEach((stage, si) => {
        const silenced = si < stages.length - 1 && !pipefail ? 'piped into another command, without pipefail' : fate
        const group = /^\(([\s\S]*)\)$/.exec(stage) ?? /^\{\s([\s\S]*?);?\s*\}$/.exec(stage)
        if (group) {
          for (const c of shellCommands(group[1], cwd, { ...options, errexit, pipefail, vars })) out.push(silenced && !c.silenced ? { ...c, silenced } : c)
          return
        }
        if (/^cd(\s|$)/.test(stage)) {
          // A cd it can't read leaves the directory unknown, not where it was.
          const argument = cdArgument(/^cd\s+(.+)$/s.exec(stage)?.[1] ?? '')
          const from = cwd
          cwd = argument === '-' ? previous : argument ? cdTarget(argument, cwd, { posix, scriptDir: options.scriptDir, vars }) : null
          previous = from
        } else {
          // A variable set to a directory a later `cd "$ROOT/web"` can name; set to anything else, unknown.
          const assignment = posix && /^(?:export\s+|readonly\s+|local\s+)?([A-Za-z_]\w*)=(.*)$/s.exec(stage)
          if (assignment) {
            const word = /^(["']?)(\$\{\{\s*github\.workspace\s*\}\}[^'"\s]*|[^'"\s]+)\1$/.test(assignment[2])
            const rooted = word ? fromWorkspace(assignment[2], { posix }) : undefined
            const dir = rooted !== undefined ? rooted : expandedDir(assignment[2], cwd, { posix, scriptDir: options.scriptDir, vars })
            if (dir === null) vars.delete(assignment[1])
            else vars.set(assignment[1], dir)
          }
          const shell = posix ? {} : { posix: false } // said only when it isn't a POSIX shell
          out.push(silenced ? { text: stage, dir: cwd, ...shell, silenced } : { text: stage, dir: cwd, ...shell })
        }
      })
    })
  })
  return out
}

/** The errexit and pipefail a snippet's own `set` lines leave on (`set -euo pipefail`, `set +e`). */
export function setOptions(text, base) {
  const options = { ...base }
  for (const m of text.matchAll(/^\s*set\s+([^\n;#]*)/gm)) {
    const words = m[1].trim().split(/\s+/)
    for (let i = 0; i < words.length; i++) {
      const on = words[i].startsWith('-')
      if (!on && !words[i].startsWith('+')) continue
      const flags = words[i].slice(1)
      if (flags.includes('e')) options.errexit = on
      if (flags.includes('o')) {
        const name = words[++i]
        if (name === 'pipefail') options.pipefail = on
        if (name === 'errexit') options.errexit = on
      }
    }
  }
  return options
}

/** How a `run` step's shell treats a failure: GitHub runs `bash -e`, and `shell: bash` adds pipefail. */
export function stepShell(shell) {
  if (shell === undefined || shell === null) return { errexit: true, pipefail: false }
  const s = String(shell).trim()
  if (s === 'bash') return { errexit: true, pipefail: true }
  if (s === 'sh') return { errexit: true, pipefail: false }
  if (/^(pwsh|powershell|cmd)\b/.test(s)) return { errexit: false, pipefail: false, posix: false } // only the last exit code counts
  return { errexit: /(^|\s)-\w*e/.test(s) || /\berrexit\b/.test(s), pipefail: /\bpipefail\b/.test(s) }
}

// A shell script may check each status itself (`if ! deno test ...; then exit 1`, or `set +e` and
// collect them), which this can't follow, so its commands count as if errexit were always on.
const scriptShell = { errexit: true, pipefail: false, fixedErrexit: true }

// What makes the words after it arguments rather than programs: a package manager's install or
// lookup verb (`npm install eslint`, `yarn global add eslint`, `npm ls eslint`), a lookup anywhere
// (`command -v eslint`, `echo vitest`), or a program that only handles files and text (`grep -q
// vitest package.json`, `git commit -m "fix eslint"`).
const INSTALLER = /^(npm|pnpm|yarn|bun|pip[0-9.]*|pipx|pipenv|uv|poetry|pdm|conda|mamba|micromamba|apt|apt-get|brew|gem|cargo|go|deno|corepack)$/
const MANAGER_VERB = /^(install|i|add|ci|remove|rm|uninstall|upgrade|update|up|sync|ls|list|view|info|why|explain|outdated|show)$/
const LOOKUP = /^(which|type|hash|whereis|echo|printf)$/
const NOT_A_RUNNER = /^(grep|egrep|test|\[|\[\[|chmod|chown|cp|mv|rm|ln|mkdir|touch|cat|ls|git|gh|curl|wget|sed|awk|jq|tar|unzip)$/
// Options whose next word is their value, never a program (`npx -p eslint prettier`, `uv run --with pytest`).
const VALUE_OPTIONS = new Set(['-p', '--package', '--with', '--filter', '-F', '-C', '--dir', '-w', '--workspace', '--prefix', '--cwd', '-r', '--reporter', '-u', '--python', '-e', '--env-file', '-c', '--config', '--server-args'])

/**
 * A command read from each word that could be the program it runs, so a tool counts behind any
 * wrapper (`cross-env NODE_ENV=test jest`, `pnpm --filter web exec tsc`, `timeout 15m npx vitest`),
 * but never as an argument: not after an install verb (`npm install eslint`), a lookup
 * (`command -v eslint`, `echo vitest`), or an option that takes a value.
 */
export function commandForms(text) {
  const raw = text.trim().split(/\s+/)
  const words = raw.map((w, i) =>
    VALUE_OPTIONS.has(raw[i - 1]) || w.startsWith('-')
      ? w // an option, or its value (`pnpm --filter @acme/mobile`, `--filter=@acme/mobile`), stays whole
      : w
          .replace(/^(?:\.\/)?node_modules\/\.bin\//, '')
          .replace(/^(@[^/\s]+\/)?([^@\s]+)@\S+$/, '$1$2') // npx supabase@2
          .replace(/^@[^/\s]+\//, ''), // npx @biomejs/biome
  )
  const forms = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (LOOKUP.test(w) || (w === 'command' && /^-[vV]$/.test(words[i + 1] ?? ''))) break
    if (MANAGER_VERB.test(w) && words.slice(0, i).some((x) => INSTALLER.test(x))) break
    if (i > 0 && VALUE_OPTIONS.has(words[i - 1])) continue
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) continue // FOO=bar
    if (!forms.length && NOT_A_RUNNER.test(w)) break // the program is a file or text tool
    forms.push(words.slice(i).join(' '))
  }
  return forms
}

/**
 * The package scripts a command runs, as [{ name, dir, workspace }]: `dir` from --prefix, --cwd,
 * or -C; `workspace` (a package name or path) from `npm -w`, `pnpm --filter`, `yarn workspace`.
 */
export function scriptCalls(command) {
  const t = command.split(/\s+/)
  let i = 0
  while (i < t.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[i])) i++ // FOO=bar npm test
  const tool = t[i]
  const rest = t.slice(i + 1)
  // npm-run-all's commands run each named script (a `*` matches within a `:` segment).
  if (['run-s', 'run-p', 'npm-run-all'].includes(tool)) {
    return rest
      .filter((w) => !w.startsWith('-') && !/^\d+$/.test(w))
      .map((w) => ({ name: w.replace(/^(['"])(.*)\1$/, '$2'), dir: null, workspace: null }))
  }
  let dir = null
  let workspace = null
  const words = []
  const dirFlags = { npm: ['--prefix'], yarn: ['--cwd'], pnpm: ['-C', '--dir'], bun: ['--cwd'] }[tool]
  if (!dirFlags) return []
  const workspaceFlags = { npm: ['-w', '--workspace'], pnpm: ['--filter', '-F'] }[tool] ?? []
  for (let j = 0; j < rest.length; j++) {
    const w = rest[j]
    const inline = (flags) => flags.map((f) => `${f}=`).find((f) => w.startsWith(f))
    if (dirFlags.includes(w)) dir = rest[++j] ?? null
    else if (inline(dirFlags)) dir = w.slice(inline(dirFlags).length)
    else if (workspaceFlags.includes(w)) workspace = rest[++j] ?? null
    else if (inline(workspaceFlags)) workspace = w.slice(inline(workspaceFlags).length)
    // Every workspace at once isn't one package's scripts; this doesn't resolve those.
    else if (/^(--workspaces|-ws|-r|--recursive)(=|$)/.test(w)) return []
    else if (tool === 'npm' && ['--loglevel', '--registry', '--userconfig', '--cache'].includes(w)) j++ // and its value
    else if (!w.startsWith('-')) words.push(w)
  }
  if (tool === 'yarn' && words[0] === 'workspace') {
    workspace = words[1] ?? null
    words.splice(0, 2)
  }
  const [sub, next] = words
  if (!sub) return []
  if (['run', 'run-script', 'rum', 'urn'].includes(sub)) return next ? [{ name: next, dir, workspace }] : []
  if (['test', 't', 'tst'].includes(sub) && tool !== 'bun') return [{ name: 'test', dir, workspace }]
  if (sub === 'start' && tool !== 'bun') return [{ name: 'start', dir, workspace }]
  // `yarn lint`, `pnpm lint`: a script when the package has one by that name (the caller checks).
  if (tool === 'yarn' || tool === 'pnpm') return [{ name: sub, dir, workspace }]
  return []
}

/** Shared, lazily computed facts about one repository, for every probe of one run. */
function repository(root, files) {
  const cache = new Map()
  const listed = new Set(files)
  const memo = (key, compute) => {
    if (!cache.has(key)) cache.set(key, compute())
    return cache.get(key)
  }
  const repo = {
    root,
    files,
    // Only what git lists counts: a gitignored file on disk isn't in a fresh clone.
    has: (path) => listed.has(path),
    read: (path) => (listed.has(path) ? read(join(root, path)) : null),
    workflows: () => memo('workflows', () => readWorkflows(root, files)),
    /** The directory of the workspace package a CLI flag names: by package name, else as a path. */
    workspaceDir: (name) =>
      memo(`ws:${name}`, () => {
        const manifests = files.filter((f) => /(^|\/)package\.json$/.test(f) && f !== 'package.json' && !f.split('/').includes('node_modules'))
        for (const f of manifests) {
          const dir = posix.dirname(f)
          const pkg = repo.pkg(dir)
          if (pkg && !pkg.invalid && pkg.name === name) return dir
        }
        const asPath = joinDir('.', name)
        return asPath && manifests.includes(`${asPath}/package.json`) ? asPath : null
      }),
    pkg: (dir) =>
      memo(`pkg:${dir}`, () => {
        const text = repo.read(posix.join(dir, 'package.json'))
        if (text === null) return null
        try {
          return JSON.parse(text)
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error
          return { invalid: error.message }
        }
      }),
    /**
     * Every command the workflows triggered by any of `events` run, with what they call expanded
     * (package scripts with their pre and post scripts, and the repository's own shell scripts),
     * as { commands, ignored, reached }: [{ text, dir, where }] for steps that can fail the run,
     * the same for steps and jobs marked continue-on-error, and the scripts the first kind reach.
     */
    ci: (events) =>
      memo(`ci:${events.join(',')}`, () => {
        const workflows = repo.workflows()
        const byFile = new Map(workflows.map((w) => [w.file, w]))
        const queue = []
        // `${{ inputs.<name> }}` in a called workflow, where its value is plain text; anything else
        // stays an expression, which leaves the directory unknown.
        const withInputs = (text, inputs) =>
          inputs
            ? text.replace(/\$\{\{\s*inputs\.([\w-]+)\s*\}\}/g, (all, name) => {
                const v = inputs[name]
                return (typeof v === 'string' && !v.includes('${{')) || typeof v === 'number' || typeof v === 'boolean' ? String(v) : all
              })
            : text
        const visit = (w, job, depth, inputs) => {
          const where = `${w.file} (job ${job.id})`
          if (job.uses) {
            // A local reusable workflow, one level deep; another repository's isn't readable here.
            const local = /^\.\/(\.github\/workflows\/[^@]+\.ya?ml)$/.exec(job.uses)
            const called = local && byFile.get(local[1])
            if (called && depth === 0) {
              const given = { ...called.inputs, ...job.with }
              for (const j of called.jobs) visit(called, { ...j, continueOnError: j.continueOnError || job.continueOnError, never: j.never || job.never }, 1, given)
            }
            return
          }
          for (const step of job.steps) {
            if (!step.run) continue
            const off = job.never || step.never
            const silenced = off || job.continueOnError || step.continueOnError
            const base = joinDir('.', withInputs(String(step.dir ?? job.dir ?? '.'), inputs))
            const at = `${where} step "${step.name}"${off ? ', if: false, so it never runs' : silenced ? ', continue-on-error' : ''}`
            const shell = step.shell ?? job.shell ?? (/windows/i.test(job.runsOn) ? 'pwsh' : undefined) // a Windows runner's default
            for (const c of shellCommands(withInputs(step.run, inputs), base, stepShell(shell))) {
              queue.push({ text: c.text, dir: c.dir, posix: c.posix, where: c.silenced && !silenced ? `${at} (${c.silenced})` : at, silenced: silenced || Boolean(c.silenced) })
            }
          }
        }
        for (const w of workflows.filter((x) => events.some((e) => x.events.has(e)))) for (const job of w.jobs) visit(w, job, 0, null)
        // Expanded in place; each kind keeps its own record of what it reached, so a silenced
        // step's scripts are traced too (to say what they hide) without counting as run.
        const reached = { true: new Set(), false: new Set() }
        for (let k = 0; k < queue.length; k++) {
          const c = queue[k]
          if (c.dir === null) continue
          const seen = reached[c.silenced]
          // Each command a script or file holds, silenced as its own shell would leave it.
          const expand = (commands, at) => {
            for (const s of commands) queue.push({ text: s.text, dir: s.dir, where: s.silenced && !c.silenced ? `${at} (${s.silenced})` : at, silenced: c.silenced || Boolean(s.silenced) })
          }
          // Read from each word that could be the program, so a wrapper or an `if !` in front
          // (`timeout 20m npm test`) still reaches the script.
          const forms = commandForms(c.text)
          for (const form of forms) {
            // A shell script in the repository (`bash scripts/x.sh`, `./x.sh`) is read like a step.
            const sh = /^(?:(?:ba|z)?sh\s+(?:-\w+\s+)*)?(['"]?)((?:\.{0,2}\/)?[\w./-]+\.(?:sh|bash))\1(?:\s|$)/.exec(form)
            const shPath = sh && (sh[2].includes('/') || /^(?:ba|z)?sh\s/.test(form)) ? joinDir(c.dir, sh[2]) : null
            if (shPath && !seen.has(`${shPath}\0sh`) && repo.has(shPath)) {
              seen.add(`${shPath}\0sh`)
              expand(shellCommands(repo.read(shPath), c.dir, { ...scriptShell, scriptDir: posix.dirname(shPath) }), `${c.where} -> ${shPath}`)
            }
          }
          for (const call of forms.flatMap(scriptCalls)) {
            const rooted = call.dir ? fromWorkspace(call.dir, { posix: c.posix !== false }) : undefined
            const dir = call.workspace ? repo.workspaceDir(call.workspace) : rooted !== undefined ? rooted : call.dir ? joinDir(c.dir, call.dir.replace(/^(["'])(.*)\1$/, '$2')) : c.dir
            const scripts = dir === null ? null : repo.pkg(dir)?.scripts
            if (!scripts || typeof scripts !== 'object') continue
            const names = call.name.includes('*') ? Object.keys(scripts).filter((k) => scriptGlob(call.name).test(k)) : [call.name]
            for (const name of names.flatMap((n) => [`pre${n}`, n, `post${n}`])) {
              if (typeof scripts[name] !== 'string' || seen.has(`${dir}\0${name}`)) continue
              seen.add(`${dir}\0${name}`)
              expand(shellCommands(scripts[name], dir, { errexit: false, pipefail: false }), `${c.where} -> script "${name}"`)
            }
          }
        }
        return { commands: queue.filter((c) => !c.silenced), ignored: queue.filter((c) => c.silenced), reached: reached.false }
      }),
  }
  return repo
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// npm-run-all's script patterns: `*` within a `:` segment, `**` across them.
const scriptGlob = (pattern) => new RegExp(`^${pattern.split(/(\*\*|\*)/).map((p) => (p === '**' ? '.*' : p === '*' ? '[^:]*' : escapeRegExp(p))).join('')}$`)

// Commands that apply to a pack at `path`: all of them at the root, otherwise the ones run in that
// directory or naming it as a whole path (`web`, `./web/`, not `website`).
const forPath = (commands, path) => {
  if (path === '.') return commands.filter((c) => c.dir !== null) // run somewhere it can't know
  const named = new RegExp(`(^|[\\s='"])(\\./)?${escapeRegExp(path)}(/|[\\s'"]|$)`)
  return commands.filter((c) => c.dir === path || c.dir?.startsWith(`${path}/`) || named.test(c.text))
}
const matching = (commands, re) => commands.filter((c) => commandForms(c.text).some((form) => re.test(form)))
// A command a probe found missing that does run, only where it can't fail the run: said in the failure.
const silencedCopies = (ignored, re) => [...new Set(matching(ignored, re).map((c) => `"${c.text}" in ${c.where}, which can't fail the run`))]

// --- Probes ------------------------------------------------------------------------------------

const pass = (...evidence) => ({ status: 'pass', evidence })
const fail = (...evidence) => ({ status: 'fail', evidence })
const notApplicable = (why) => ({ status: 'n/a', evidence: [why] })
const skip = (why) => ({ status: 'skipped', evidence: [why] })
const errored = (why) => ({ status: 'error', evidence: [why] })

const PR = ['pull_request']
// Each matches a program as commandForms reads it, so a tool counts only where it runs.
const LINT = /^(eslint|oxlint|xo|standard)(\s|$)|^biome\s+(lint|check|ci)\b|^next\s+lint\b/
const TYPECHECK = /^(tsc|vue-tsc|svelte-check)(\s|$)|^astro\s+check\b/
const TEST_RUNNER = /^(vitest|jest|mocha|ava)(\s|$)|^playwright\s+test\b|^bddgen\b|^cypress\s+run\b|^node\s(?:.*\s)?--test\b/
const AUDIT = /^(npm|pnpm|bun)\s+audit\b|^yarn\s+(npm\s+)?audit\b|^(audit-ci|osv-scanner|better-npm-audit)\b|^node\s+\S*check-audit\b/
// What Dependabot or Renovate can update: package manifests across ecosystems, and Dockerfiles.
const MANIFEST =
  /(^|\/)(package\.json|requirements[^/]*\.txt|pyproject\.toml|Pipfile|Cargo\.toml|go\.mod|Gemfile|composer\.json|[^/]+\.(cs|fs|vb)proj|packages\.config|Directory\.Packages\.props|pom\.xml|build\.gradle(\.kts)?|pubspec\.yaml|Package\.swift|Podfile|mix\.exs|deno\.jsonc?|Dockerfile)$/
const NODE_IN_CI = /(^|[\s/])(node|npm|npx|yarn|pnpm|corepack)(\s|$)/
const deps = (pkg) => ({ ...pkg?.dependencies, ...pkg?.devDependencies })
const hasDep = (d, name) => Object.hasOwn(d, name)

// Runs one of the template's own checks against the repository, as shipped.
function runTemplateCheck(script, root) {
  const result = spawnSync(process.execPath, [join(TEMPLATE, 'scripts', script), '--root', root], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) throw result.error // couldn't start Node itself: not a finding about the repo
  const lines = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean)
  return { status: result.status, out: lines(result.stdout), err: lines(result.stderr) }
}

// The line a template check ends a clean run with (✓ ...), for a pass's evidence.
const summaryLine = (run) => [...run.out, ...run.err].find((l) => l.startsWith('✓')) ?? 'clean'

function packageAt(ctx) {
  const pkg = ctx.repo.pkg(ctx.path)
  if (pkg === null) return { result: fail(`no package.json at ${ctx.path === '.' ? 'the root' : ctx.path}`) }
  if (pkg.invalid) return { result: fail(`${posix.join(ctx.path, 'package.json')} isn't valid JSON: ${pkg.invalid}`) }
  return { pkg }
}

// A root package.json that's a workspace root, or has no dependencies, usually wraps the real
// project in a directory below it, which the config has to name. Said in a failure, as a hint.
function pathHint(ctx, pkg) {
  if (ctx.path !== '.' || !pkg) return []
  const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : Array.isArray(pkg.workspaces?.packages) ? pkg.workspaces.packages : []
  const below = workspaces.length
    ? workspaces.filter((w) => typeof w === 'string' && !w.includes('*'))
    : Object.keys(deps(pkg)).length
      ? []
      : ctx.repo.files.filter((f) => /^[^/]+\/package\.json$/.test(f)).map((f) => f.split('/')[0])
  if (!below.length) return []
  return [`the project may live below the root (${below.join(', ')}): if so, declare { "pack": "node", "path": "${below[0]}" } in ${CONFIG}`]
}

function nodePin(ctx) {
  for (const dir of [...new Set([ctx.path, '.'])]) {
    for (const file of ['.nvmrc', '.node-version']) {
      const path = posix.join(dir, file)
      const text = ctx.repo.read(path)
      if (text !== null) return { file: path, value: text.trim().split(/\s+/)[0] ?? '' }
    }
    const tvLine = /^\s*(?:nodejs|node)\s+(\S+)/m.exec(ctx.repo.read(posix.join(dir, '.tool-versions')) ?? '')
    if (tvLine) return { file: posix.join(dir, '.tool-versions'), value: tvLine[1] }
    for (const file of ['mise.toml', '.mise.toml']) {
      const line = /^\s*node\s*=\s*["']?([^"'\s]+)/m.exec(ctx.repo.read(posix.join(dir, file)) ?? '')
      if (line) return { file: posix.join(dir, file), value: line[1] }
    }
  }
  return null
}

const sameVersion = (a, b) => {
  const parts = (v) => String(v).trim().replace(/^v/, '').split('.').concat(['0', '0']).slice(0, 3).map(Number)
  const [x, y] = [parts(a), parts(b)]
  return x.every((n, i) => n === y[i])
}

// The tables a migration history leaves in the public schema, read as text (see the supabase pack's
// README for what that misses).
function stripSql(text) {
  let out = ''
  for (let i = 0; i < text.length; ) {
    const c = text[i]
    if (c === '-' && text[i + 1] === '-') {
      const end = text.indexOf('\n', i)
      i = end === -1 ? text.length : end
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? text.length : end + 2
      out += ' '
    } else if (c === "'") {
      let j = i + 1
      while (j < text.length && !(text[j] === "'" && text[j + 1] !== "'")) j += text[j] === "'" ? 2 : 1
      out += "''"
      i = j + 1
    } else if (c === '$' && /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.test(text.slice(i, i + 64))) {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i, i + 64))[0]
      const end = text.indexOf(tag, i + tag.length)
      i = end === -1 ? text.length : end + tag.length
      out += ' '
    } else {
      out += c
      i++
    }
  }
  return out
}

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)`
const QUALIFIED = String.raw`${IDENT}(?:\s*\.\s*${IDENT})?`
function tableName(raw) {
  const parts = [...raw.trim().matchAll(new RegExp(IDENT, 'g'))].map(([p]) => (p.startsWith('"') ? p.slice(1, -1) : p.toLowerCase()))
  return parts.length === 1 ? `public.${parts[0]}` : `${parts[0]}.${parts[1]}`
}
const tableList = (text) =>
  text
    .split(',')
    .map((t) => t.trim().replace(/^(?:table|only)\s+/i, ''))
    .filter((t) => new RegExp(`^${QUALIFIED}$`).test(t))
    .map(tableName)

export function migrationTables(migrations) {
  const tables = new Map()
  let defaultGrant = false
  const re = {
    create: new RegExp(String.raw`^create\s+(?:(?:global|local)\s+)?(temp|temporary|unlogged\s+)?\s*table\s+(?:if\s+not\s+exists\s+)?(${QUALIFIED})`, 'i'),
    alter: new RegExp(String.raw`^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(${QUALIFIED})\s+([\s\S]*)$`, 'i'),
    drop: /^drop\s+table\s+(?:if\s+exists\s+)?([\s\S]+?)(?:\s+(?:cascade|restrict))?$/i,
    grant: /^(?:grant|revoke)\s+(?:grant\s+option\s+for\s+)?[\s\S]+?\s+on\s+([\s\S]+?)\s+(?:to|from)\s+/i,
    defaults: /^alter\s+default\s+privileges\b([\s\S]*?)\bgrant\b[\s\S]*?\bon\s+tables\b/i,
  }
  for (const { file, text } of migrations) {
    const version = /^(\d{14})/.exec(file.split('/').pop())?.[1] ?? ''
    for (const statement of stripSql(text).split(';').map((s) => s.trim().replace(/\s+/g, ' '))) {
      let m
      if ((m = re.create.exec(statement))) {
        if (m[1] && !/unlogged/i.test(m[1])) continue // a temporary table
        const name = tableName(m[2])
        if (!tables.has(name)) tables.set(name, { file, version, rls: false, exposure: false, defaultGrant })
      } else if ((m = re.defaults.exec(statement))) {
        if (!/\bin\s+schema\b/i.test(m[1]) || /\bin\s+schema\s+[^;]*\bpublic\b/i.test(m[1])) defaultGrant = true
      } else if ((m = re.alter.exec(statement))) {
        const name = tableName(m[1])
        const entry = tables.get(name)
        if (!entry) continue
        if (/\benable\s+row\s+level\s+security\b/i.test(m[2])) entry.rls = true
        if (/\bdisable\s+row\s+level\s+security\b/i.test(m[2])) entry.rls = false
        const rename = new RegExp(String.raw`^rename\s+to\s+(${IDENT})`, 'i').exec(m[2])
        if (rename) {
          tables.delete(name)
          tables.set(`${name.split('.')[0]}.${tableName(rename[1]).split('.')[1]}`, entry)
        }
      } else if ((m = re.drop.exec(statement))) {
        for (const name of tableList(m[1])) tables.delete(name)
      } else if ((m = re.grant.exec(statement))) {
        const all = /^all\s+tables\s+in\s+schema\s+([\s\S]+)$/i.exec(m[1])
        if (all) {
          const schemas = all[1].split(',').map((s) => s.trim().replace(/^"|"$/g, '').toLowerCase())
          for (const [name, entry] of tables) if (schemas.includes(name.split('.')[0])) entry.exposure = true
        } else if (!/^(function|procedure|routine|sequence|schema|database|type|domain|foreign|language|large|tablespace|all\s+(functions|sequences|procedures|routines))\b/i.test(m[1])) {
          for (const name of tableList(m[1])) if (tables.has(name)) tables.get(name).exposure = true
        }
      }
    }
  }
  return tables
}

const GRANTS_FROM = '20261030000000'

function migrations(ctx) {
  const dir = posix.join(ctx.path, 'supabase/migrations')
  // The CLI reads only .sql files there; a .gitkeep or a README isn't a migration.
  const files = ctx.repo.files.filter((f) => posix.dirname(f) === posix.normalize(dir) && f.endsWith('.sql')).sort()
  return { dir, files }
}

function supabaseTables(ctx) {
  const { files } = migrations(ctx)
  const sql = files.filter((f) => f.endsWith('.sql')).map((file) => ({ file, text: ctx.repo.read(file) }))
  return { count: sql.length, tables: [...migrationTables(sql)].filter(([name]) => name.startsWith('public.')) }
}

function tsConfigs(path, seen = new Set(), out = []) {
  const T = loadTs()
  if (seen.has(path)) return out
  seen.add(path)
  const message = (d) => T.flattenDiagnosticMessageText(d.messageText, ' ')
  const raw = T.readConfigFile(path, T.sys.readFile)
  if (raw.error) {
    out.push({ path, problem: message(raw.error) })
    return out
  }
  const parsed = T.parseJsonConfigFileContent(raw.config, T.sys, dirname(path), undefined, path)
  // 6053: a file `extends` names isn't there, usually a package (`expo/tsconfig.base`) in a checkout
  // with no install. Its options are then unknown, so the config can't be judged. Other errors (an
  // option this TypeScript version doesn't know) don't change what `strict` and `checkJs` say.
  const missing = parsed.errors.find((e) => e.code === 6053)
  out.push({ path, options: parsed.options, fileNames: parsed.fileNames, problem: missing && message(missing) })
  for (const ref of parsed.projectReferences ?? []) {
    const refPath = ref.path.endsWith('.json') ? ref.path : join(ref.path, 'tsconfig.json')
    if (existsSync(refPath)) tsConfigs(refPath, seen, out)
    else out.push({ path: refPath, problem: 'a referenced config that doesn\'t exist' })
  }
  return out
}

// --- Static hosting ------------------------------------------------------------------------------

// A header rule's pattern that reaches every page: Firebase `**`, Netlify and Cloudflare `/*`,
// Vercel `/(.*)`, or one for all HTML files.
const coversPages = (pattern) => ['**', '**/*', '/**', '/*', '*', '/(.*)', '/:path*', '(.*)'].includes(pattern) || /\*\.(@\()?html?\b/.test(pattern)

// JSON with // and /* */ comments, which firebase-tools accepts in firebase.json.
const withoutComments = (text) => text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, string) => string ?? '')

const parseJson = (text) => {
  try {
    return JSON.parse(text)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return null
  }
}

// The `[[headers]]` and `[build] publish` of a netlify.toml, read line by line (no TOML parser
// here): enough for `for = "/*"` and `Key = "value"` pairs, including a triple-quoted value.
function netlifyToml(text) {
  const rules = []
  let table = ''
  let publish = null
  let base = null
  let rule = null
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('#')) continue
    const header = /^\[\[?([^\]]+)\]\]?/.exec(line)
    if (header) {
      table = header[1].trim()
      if (line.startsWith('[[headers]]')) rules.push((rule = { pattern: null, headers: new Map() }))
      continue
    }
    const kv = /^("?)([\w.-]+)\1\s*=\s*(.*)$/.exec(line)
    if (!kv) continue
    let value = kv[3].trim()
    const triple = /^("""|''')/.exec(value)?.[1]
    if (triple) {
      let body = value.slice(3)
      while (!body.includes(triple) && i + 1 < lines.length) body += ` ${lines[++i].trim()}`
      value = body.slice(0, body.indexOf(triple)).trim()
    } else if (!value.startsWith('{')) value = value.replace(/^(["'])(.*)\1.*$/, '$2')
    if (table === 'build' && kv[2] === 'publish') publish = value
    else if (table === 'build' && kv[2] === 'base') base = value
    else if (table === 'headers' && kv[2] === 'for' && rule) rule.pattern = value
    else if (table === 'headers' && kv[2] === 'values' && rule && value.startsWith('{')) {
      // An inline table: values = { X-Frame-Options = "DENY", "Referrer-Policy" = "no-referrer" }
      for (const m of value.matchAll(/(["']?)([\w.-]+)\1\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) rule.headers.set(m[2].toLowerCase(), m[3] ?? m[4])
    }
    else if (table === 'headers.values' && rule) rule.headers.set(kv[2].toLowerCase(), value)
  }
  // Netlify reads publish relative to base.
  return { rules: rules.filter((r) => r.pattern), publish: publish === null ? null : posix.join(base ?? '.', publish) }
}

// A `_headers` file (Netlify, Cloudflare Pages): a path on its own line, then indented headers.
function headersFile(text) {
  const rules = []
  let rule = null
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    if (!/^\s/.test(raw)) rules.push((rule = { pattern: raw.trim(), headers: new Map() }))
    else if (rule) {
      const m = /^\s+([\w-]+)\s*:\s*(.*)$/.exec(raw)
      if (m) rule.headers.set(m[1].toLowerCase(), m[2].trim())
    }
  }
  return rules
}

const headerMap = (list) => new Map((Array.isArray(list) ? list : []).filter((h) => typeof h?.key === 'string').map((h) => [h.key.toLowerCase(), String(h.value ?? '')]))
const servedDir = (path, dir) => posix.normalize(posix.join(path, dir)).replace(/\/$/, '') || '.'

/**
 * What the repository's static hosts are told: the configs found, their header rules
 * ([{ file, pattern, headers }]), and the directory served (a repository path, or null).
 */
function hostConfig(ctx) {
  const at = (f) => posix.join(ctx.path, f)
  const configs = []
  const rules = []
  let served = null
  const firebase = parseJson(withoutComments(ctx.repo.read(at('firebase.json')) ?? 'null'))
  const sites = firebase?.hosting === undefined ? [] : [firebase.hosting].flat().filter((h) => h && typeof h === 'object')
  if (sites.length) configs.push(at('firebase.json'))
  for (const site of sites) {
    if (served === null && typeof site.public === 'string') served = servedDir(ctx.path, site.public)
    for (const r of Array.isArray(site.headers) ? site.headers : []) rules.push({ file: at('firebase.json'), pattern: r?.source ?? r?.glob ?? r?.regex ?? '', headers: headerMap(r?.headers) })
  }
  const toml = ctx.repo.read(at('netlify.toml'))
  if (toml !== null) {
    configs.push(at('netlify.toml'))
    const netlify = netlifyToml(toml)
    rules.push(...netlify.rules.map((r) => ({ file: at('netlify.toml'), ...r })))
    if (served === null && netlify.publish) served = servedDir(ctx.path, netlify.publish)
  }
  for (const f of [at('_headers'), at('public/_headers'), at('static/_headers'), ...(served ? [posix.join(served, '_headers')] : [])]) {
    const text = ctx.repo.read(f)
    if (text === null || configs.includes(f)) continue
    configs.push(f)
    rules.push(...headersFile(text).map((r) => ({ file: f, ...r })))
  }
  const swa = parseJson(ctx.repo.read(at('staticwebapp.config.json')) ?? 'null')
  if (swa && typeof swa === 'object') {
    configs.push(at('staticwebapp.config.json'))
    const globals = swa.globalHeaders && typeof swa.globalHeaders === 'object' ? swa.globalHeaders : {}
    rules.push({ file: at('staticwebapp.config.json'), pattern: '*', headers: new Map(Object.entries(globals).map(([k, v]) => [k.toLowerCase(), String(v)])) })
  }
  const vercel = parseJson(ctx.repo.read(at('vercel.json')) ?? 'null')
  if (vercel && Array.isArray(vercel.headers)) {
    configs.push(at('vercel.json'))
    for (const r of vercel.headers) rules.push({ file: at('vercel.json'), pattern: r?.source ?? '', headers: headerMap(r?.headers) })
  }
  return { configs, rules, served }
}

// A CSP set in the page itself, which counts for everything but frame-ancestors.
function metaCsp(ctx, served) {
  for (const f of [posix.join(ctx.path, 'index.html'), ...(served ? [posix.join(served, 'index.html')] : [])]) {
    const html = (ctx.repo.read(f) ?? '').replace(/<!--[\s\S]*?-->/g, '') // a commented-out tag sets nothing
    const m = /<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/i.exec(html)
    if (m) return /content\s*=\s*["']([^"']*)["']/i.exec(m[0])?.[1] ?? 'set'
  }
  return undefined
}

// Action steps (`uses:`) in workflows that `events` trigger, where they can fail the run, and
// whose inputs `fails(with, uses, file)` says let them fail on a finding.
function actionSteps(ctx, events, re, fails = () => true) {
  const out = []
  for (const w of ctx.repo.workflows().filter((x) => events.some((e) => x.events.has(e)))) {
    for (const job of w.jobs.filter((j) => !j.never && !j.continueOnError)) {
      for (const st of job.steps.filter((x) => !x.never && !x.continueOnError && re.test(x.uses ?? '') && fails(x.with, x.uses, w.file))) {
        out.push({ uses: st.uses, with: st.with, where: `${w.file} (job ${job.id}) step "${st.name}"` })
      }
    }
  }
  return out
}
const off = (v) => v === false || String(v).trim() === 'false'
// An action's major version, as text: from its ref (`@v4`), or, for a step pinned by commit, from
// the comment beside it (`@<sha> # v4.2.0`), which YAML drops; undefined when neither says.
const actionMajor = (ctx, uses, file) =>
  /@v(\d+)/.exec(uses)?.[1] ?? new RegExp(`${escapeRegExp(uses)}["']?\\s*#\\s*v?(\\d+)`).exec(ctx.repo.read(file) ?? '')?.[1]

// check-env.mjs at the pack's path, for the packs whose bundles inline a public env prefix.
function clientEnv(ctx) {
  const run = runTemplateCheck('check-env.mjs', join(ctx.repo.root, ctx.path))
  if (run.status === 0) return pass(summaryLine(run))
  if (run.status === 1) return fail(...list(run.out), ...run.err.slice(-1))
  if (run.err.some((l) => l.startsWith('No environment variables found'))) return notApplicable('no environment variables anywhere')
  return errored(`check-env couldn't run: ${run.err.join(' ')}`)
}

/**
 * A Tauri 2 app's config, as { config, file }, or { result } when there's nothing to read: a
 * config in JSON5 or TOML (no parser here), a Tauri 1 config, or none at all.
 */
function tauriConfig(ctx) {
  const dirs = [posix.join(ctx.path, 'src-tauri'), ctx.path]
  const file = dirs.flatMap((d) => ['tauri.conf.json', 'tauri.conf.json5', 'Tauri.toml'].map((n) => posix.join(d, n))).find((f) => ctx.repo.has(f))
  if (!file) return { result: fail(`no tauri.conf.json, tauri.conf.json5, or Tauri.toml in ${dirs.map((d) => `${d}/`).join(' or ')} (declare the pack with the app's path: tauri@<path>)`) }
  const config = parseConfigFile(file, ctx.repo.read(file))
  if (!config || typeof config !== 'object' || Array.isArray(config)) return { result: fail(`${file} isn't a valid config object`) }
  if (config.tauri && !config.app) return { result: skip(`${file} is a Tauri 1 config; this pack reads Tauri 2's`) }
  return { config, file }
}

// A JSON, JSON5, or TOML file (Tauri reads all three), parsed, or null when it doesn't parse.
function parseConfigFile(file, text) {
  if (file.endsWith('.json')) return parseJson(text)
  const json5 = file.endsWith('.json5')
  try {
    return json5 ? loadJson5().parse(text) : loadToml().parse(text)
  } catch (error) {
    if (json5 ? error instanceof SyntaxError : error instanceof loadToml().TomlError) return null
    throw error
  }
}

// A key Tauri.toml may also spell in kebab-case (dangerous-disable-asset-csp-modification).
const tauriKey = (obj, camel) => obj?.[camel] ?? obj?.[camel.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)]

/**
 * The commands that check a Tauri app's Rust crate: those run in the crate's directory or naming
 * it, and those run from a Cargo workspace root whose members include it. Unscoped when there's
 * no config to find the crate by.
 */
function crateCommands(ctx, commands) {
  const t = tauriConfig(ctx)
  if (t.result) return commands
  const crate = posix.dirname(t.file)
  // The manifest a cargo command acts on: its --manifest-path, read from where the command runs (a
  // path from the workspace variable, from the root), or else the one where it runs; null when
  // that can't be known (an unknown directory, an absolute path, another variable).
  const manifestOf = (c) => {
    const flag = /\s--manifest-path[=\s]+(["']?)(\$\{\{\s*github\.workspace\s*\}\}[^\s"']*|[^\s"']+)\1/.exec(c.text)
    if (!flag) return c.dir === null ? null : posix.join(c.dir, 'Cargo.toml')
    const rooted = fromWorkspace(flag[2], { posix: c.posix !== false })
    return rooted !== undefined ? rooted : joinDir(c.dir, flag[2])
  }
  const own = posix.join(crate, 'Cargo.toml')
  const scoped = [...new Set([...forPath(commands, crate), ...commands.filter((c) => manifestOf(c) === own)])]
  const name = parseConfigFile('Cargo.toml', ctx.repo.read(own) ?? '')?.package?.name
  for (let dir = crate; dir !== '.' && dir !== ''; ) {
    dir = posix.dirname(dir)
    const manifest = parseConfigFile('Cargo.toml', ctx.repo.read(posix.join(dir, 'Cargo.toml')) ?? '')
    const ws = manifest?.workspace
    const rel = dir === '.' ? crate : crate.slice(dir.length + 1)
    const lists = (list) => Array.isArray(list) && list.some((m) => typeof m === 'string' && globMatcher(m.replace(/\/$/, ''))(rel))
    if (!lists(ws?.members) || lists(ws?.exclude)) continue
    // From the workspace root, which members a command reaches depends on the tool. cargo fmt
    // formats every member, and cargo audit reads the one Cargo.lock they share. cargo deny takes
    // every member of a virtual workspace. clippy, test, and the rest take the crate when told to
    // (--workspace, -p <its name>), or by default when it's a default member: default-members when
    // set, else every member of a virtual workspace, else only the root package.
    const byDefault = Array.isArray(ws['default-members']) ? lists(ws['default-members']) : !manifest.package
    const packageFlag = (c) => name !== undefined && new RegExp(`\\s(-p|--package)[=\\s]+["']?${escapeRegExp(name)}(@[\\w.+-]+)?(["'\\s]|$)`).test(c.text)
    const named = (c) => /\s--(workspace|all)(?=\s|$)/.test(c.text) || packageFlag(c)
    const reaches = (c) => {
      const forms = commandForms(c.text)
      // cargo fmt: --all formats every member; from the root with no package named and no
      // manifest given, it does too; otherwise only what it's pointed at.
      if (forms.some((f) => /^cargo\s+fmt\b/.test(f))) {
        if (/\s--all(?=\s|$)/.test(c.text)) return true
        if (/\s(-p|--package)[=\s]/.test(c.text)) return packageFlag(c)
        return !/\s--manifest-path[=\s]/.test(c.text)
      }
      if (forms.some((f) => /^cargo\s+audit\b|^cargo-audit\b/.test(f))) return true
      // cargo deny has no -p: --workspace, or a virtual manifest, takes every member; --exclude drops one.
      if (forms.some((f) => /^cargo\s+deny\b|^cargo-deny\b/.test(f))) {
        if (name !== undefined && new RegExp(`\\s--exclude[=\\s]+["']?${escapeRegExp(name)}(["'\\s]|$)`).test(c.text)) return false
        return !manifest.package || /\s--workspace(?=\s|$)/.test(c.text)
      }
      return byDefault || named(c)
    }
    const atRoot = posix.join(dir, 'Cargo.toml')
    return [...new Set([...scoped, ...commands.filter((c) => manifestOf(c) === atRoot && reaches(c))])]
  }
  return scoped
}

// Files too large or too binary to hold a key someone pasted: skipped by the secret-key search.
const BINARY = /\.(png|jpe?g|gif|webp|ico|icns|bmp|tiff?|svgz|woff2?|ttf|otf|eot|mp[34]|wav|ogg|webm|mov|zip|gz|tgz|xz|7z|rar|pdf|exe|dll|so|dylib|a|lib|wasm|bin|dmg|msi|deb|rpm|appimage|jar|class|pyc|node)$/i
function textFiles(ctx, maxBytes = 1_000_000) {
  return ctx.repo.files.filter((f) => {
    if (BINARY.test(f)) return false
    const s = statSync(join(ctx.repo.root, f))
    return s.isFile() && s.size <= maxBytes
  })
}

const RENOVATE = /^(?:\.github\/|\.gitlab\/)?(?:renovate\.json5?|\.renovaterc(?:\.json5?)?)$/

/**
 * Days from `today` to the calendar date a value names (text or a TOML date, read as written, so
 * the time zone the check runs in doesn't matter), or null when it names no date (a time alone).
 */
function daysUntil(value, today) {
  // A TOML date's toISOString() is its TOML text; a plain Date's is UTC.
  const text = value instanceof Date ? (Number.isNaN(value.getTime()) ? '' : value.toISOString()) : typeof value === 'string' ? value : ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text.trim())
  return m ? Math.round((Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - today.getTime()) / 86_400_000) : null
}

/** A Renovate duration ("3 days", "1 week", "12 hours") in days, or null when it isn't one. */
function durationDays(value) {
  if (typeof value !== 'string' || !/^\s*(\d+(\.\d+)?\s*[a-zA-Z]+\s*)+$/.test(value)) return null
  let days = 0
  // Each part as Renovate reads it ("1 week 2 days"); "M" is months there, "m" minutes.
  for (const [, n, unit] of value.matchAll(/(\d+(?:\.\d+)?)\s*([a-zA-Z]+)/g)) {
    const u = unit === 'M' ? 'month' : unit.toLowerCase()
    const per = /^(y|yrs?|years?)$/.test(u) ? 365 : /^(mo|months?)$/.test(u) ? 30 : /^(w|weeks?)$/.test(u) ? 7 : /^(d|days?)$/.test(u) ? 1 : /^(h|hrs?|hours?)$/.test(u) ? 1 / 24 : /^(m|mins?|minutes?)$/.test(u) ? 1 / 1440 : null
    if (per === null) return null
    days += Number(n) * per
  }
  return days
}

// --- Prose checks and their vocabularies (the writing pack) ------------------------------------

const PROSE_TOOLS = /^(markdownlint|markdownlint-cli2|cspell|vale|textlint|alex|write-good|proselint)(\s|$)/
const PROSE_OWN = /^(?:(?:python[0-9.]*|node|bash|sh)\s+)?((?:\.\/)?\S*\bcheck[_-][\w-]*\.(?:py|m?js|sh))\b/
// A run that checks nothing doesn't count: a version, help or init flag alone, or a subcommand
// that doesn't lint (vale sync, ls-*, test; cspell trace, suggestions, init, link, dictionaries).
const PROSE_NOT_A_CHECK =
  /^(?:vale\s+(?:sync|ls-[\w-]+|test)|cspell\s+(?:trace|suggestions|sug|init|link|dictionaries|help)|textlint\s+--init|\S+\s+(?:--version|-[vV]|--help|-h))(?:\s|$)/

/**
 * The prose checks pull requests run, as { failing, actions, idle, unresolved, ignored, re }:
 * the commands that can fail (the repository's own checker's with its `script` path), the actions
 * that can (each with its `tool`), and why the others don't count.
 */
function proseRuns(ctx) {
  const { commands, ignored } = ctx.repo.ci(PR)
  const re = new RegExp(`${PROSE_TOOLS.source}|${PROSE_OWN.source}`)
  // The repository's own checker counts when it reads prose: a check script of any other kind
  // (check-env.mjs, check-conformance.mjs) isn't a prose check.
  // A path from the workspace root ($GITHUB_WORKSPACE/tools/check_log.py) is a repository path.
  const WORKSPACE = /^(?:\$GITHUB_WORKSPACE|\$\{GITHUB_WORKSPACE\})\//
  const unresolved = []
  // null for a linter; for the repository's own checker, its path, or false when it isn't one.
  const ownScript = (c) => {
    const text = c.text.replace(/\$\{\{\s*github\.workspace\s*\}\}/g, '$GITHUB_WORKSPACE')
    const script = commandForms(text).map((f) => PROSE_OWN.exec(f)?.[1]).find(Boolean)?.replace(/^["']/, '')
    if (!script) return null
    const rel = script.replace(WORKSPACE, '')
    // Any other variable, or an expression the shell splitter broke up (`${{ env.TOOLS }}/x.py`).
    const path = /[${}]/.test(rel) ? null : rel !== script ? joinDir('.', rel) : c.dir === null ? null : joinDir(c.dir, rel)
    if (path === null) {
      unresolved.push(`"${c.text}" in ${c.where} runs ${script}, a path this check can't resolve`)
      return false
    }
    return /\.(md|mdx|markdown)\b|markdown/i.test(ctx.repo.read(path) ?? '') ? path : false
  }
  const checks = commands.filter((c) => commandForms(c.text).some((form) => re.test(form) && !PROSE_NOT_A_CHECK.test(form)))
  const idle = matching(commands, re).filter((c) => !checks.includes(c)).map((c) => `"${c.text}" in ${c.where} checks no prose`)
  // A run told not to exit non-zero can't fail; neither can an action told not to.
  const failing = []
  for (const c of checks.filter((x) => !/\s--no-exit(-code)?\b/.test(x.text))) {
    const script = ownScript(c)
    if (script !== false) failing.push(script ? { ...c, script } : c)
  }
  const valeFails = (w) => (w.fail_level !== undefined ? !/^\s*(none)?\s*$/i.test(String(w.fail_level)) : String(w.fail_on_error).trim() === 'true')
  const actions = [
    ...actionSteps(ctx, PR, /^DavidAnson\/markdownlint-cli2-action@/).map((a) => ({ ...a, tool: 'markdownlint' })),
    ...actionSteps(ctx, PR, /^streetsidesoftware\/cspell-action@/, (w) => !off(w.strict)).map((a) => ({ ...a, tool: 'cspell' })),
    ...actionSteps(ctx, PR, /^(vale-cli|errata-ai)\/vale-action@/, valeFails).map((a) => ({ ...a, tool: 'vale' })),
  ]
  return { failing, actions, idle, unresolved, ignored, re }
}

// A command-line option's value (`--config x`, `--config=x`, `-c x`), unquoted.
function optionValue(words, ...names) {
  for (let i = 0; i < words.length; i++) {
    for (const name of names) {
      if (words[i] === name && i + 1 < words.length) return words[i + 1].replace(/^(['"])(.*)\1$/, '$2')
      if (name.startsWith('--') && words[i].startsWith(`${name}=`)) return words[i].slice(name.length + 1).replace(/^(['"])(.*)\1$/, '$2')
    }
  }
  return undefined
}

// A vocabulary file's entries: lines that aren't blank or a comment.
const vocabEntries = (text, comment) => (text ?? '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !comment.test(l))

// cspell 10.3.6's search places, in its order (cspell-lib configLocations.js): the first that
// exists in a directory is the config, and package.json counts only with a "cspell" object.
const CSPELL_EXT = ['.json', '.jsonc', '.yaml', '.yml', '.mjs', '.cjs', '.js', '.toml', '.mts', '.ts', '.cts']
const CSPELL_PLACES = [
  ...new Set([
    'package.json',
    '.cspell.json', 'cspell.json', '.cSpell.json', 'cSpell.json', '.cspell.jsonc', 'cspell.jsonc',
    '.vscode/cspell.json', '.vscode/cSpell.json', '.vscode/.cspell.json',
    '.cspell.config.json', '.cspell.config.jsonc', '.cspell.config.yaml', '.cspell.config.yml',
    'cspell.config.json', 'cspell.config.jsonc', 'cspell.config.yaml', 'cspell.config.yml',
    ...CSPELL_EXT.map((e) => `cspell.config${e}`), ...CSPELL_EXT.map((e) => `.cspell.config${e}`),
    '.cspell.yaml', '.cspell.yml', 'cspell.yaml', 'cspell.yml',
    '.config/.cspell.json', '.config/cspell.json', '.config/.cSpell.json', '.config/cSpell.json', '.config/.cspell.jsonc', '.config/cspell.jsonc',
    ...CSPELL_EXT.map((e) => `.config/cspell.config${e}`), ...CSPELL_EXT.map((e) => `.config/.cspell.config${e}`),
    '.config/cspell.yaml', '.config/cspell.yml',
  ]),
]

// cspell's predefined pattern names (cspell-lib DefaultSettings.js, 10.3.6) other than Everything,
// which hides every word: these match code, hashes, URLs and directives, not a name in prose.
const CSPELL_PATTERNS = new Set([
  'CommitHash', 'CommitHashLink', 'CStyleHexValue', 'CSSHexValue', 'Urls', 'HexValues', 'SpellCheckerDisable', 'PublicKey', 'RsaCert', 'SshRsa',
  'EscapeCharacters', 'Base64', 'Base64SingleLine', 'Base64MultiLine', 'Email', 'SHA', 'HashStrings', 'UnicodeRef', 'UUID', 'href',
  'SpellCheckerDisableBlock', 'SpellCheckerDisableLine', 'SpellCheckerDisableNext', 'SpellCheckerIgnoreInDocSetting', 'PhpHereDoc', 'string', 'CStyleComment',
])
const CSPELL_MIN_WORD = 4 // cspell's default minWordLength
// Unregistered capitalized names of the lengths an ignore pattern might bound, longest first.
const CSPELL_SENTINELS = ['Mxyzptlk', 'Qaxbrel', 'Zorwen', 'Plimb', 'Daxo']
const MARKDOWN = /\.(md|mdx|markdown)$/i
const under = (dir, path) => dir === '.' || path.startsWith(`${dir}/`)
const relTo = (dir, path) => (dir === '.' ? path : path.slice(dir.length + 1))
const strings = (v) => (Array.isArray(v) ? v : []).filter((x) => typeof x === 'string')

// A micromatch-style glob (cspell's) as a regex on a relative path: `*` and `?` stop at `/`, `**`
// crosses it, `{a,b}` alternatives, `[...]` a class (`!` or `^` negates). null for an extglob
// (`!(...)`, `@(...)` and the like) or a pattern that doesn't compile: this check doesn't follow it.
const GLOBS = new Map()
function globRegExp(pattern) {
  if (!GLOBS.has(pattern)) GLOBS.set(pattern, compileGlob(pattern))
  return GLOBS.get(pattern)
}
function compileGlob(pattern) {
  if (/[!@+*?]\(/.test(pattern)) return null
  let re = ''
  let depth = 0
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '*' && pattern[i + 1] === '*') {
      while (pattern[i + 1] === '*') i++
      if (pattern[i + 1] === '/') {
        i++
        re += '(?:.*/)?'
      } else re += '.*'
    } else if (ch === '*') re += '[^/]*'
    else if (ch === '?') re += '[^/]'
    else if (ch === '{') {
      depth++
      re += '(?:'
    } else if (ch === '}' && depth) {
      depth--
      re += ')'
    } else if (ch === ',' && depth) re += '|'
    else if (ch === '[' && pattern.indexOf(']', i + 2) > i) {
      const end = pattern.indexOf(']', i + 2)
      re += `[${pattern.slice(i + 1, end).replace(/^[!^]/, '\0').replace(/[\\^]/g, '\\$&').replace('\0', '^')}]`
      i = end
    } else if (ch === '\\' && i + 1 < pattern.length) re += escapeRegExp(pattern[++i])
    else re += escapeRegExp(ch)
  }
  try {
    return new RegExp(`^${re}${')'.repeat(depth)}$`)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return null
  }
}

// A cspell settings glob (an override's filename, ignorePaths) against a file, relative to the
// config's glob root as in .gitignore: one without a slash matches a name at any depth. A file
// outside the root is reached only by a pattern that starts with **/ (run with cspell 10.3.6).
// null when the glob is one this check doesn't follow.
function cspellGlob(pattern, root, file) {
  const p = pattern.replace(/^\.?\//, '').replace(/\/$/, '')
  const rx = globRegExp(p)
  if (!rx) return null
  if (!under(root, file)) return /^\*\*\//.test(p) && rx.test(file)
  const parts = relTo(root, file).split('/')
  for (let i = parts.length; i > 0; i--) if (p.includes('/') ? rx.test(parts.slice(0, i).join('/')) : rx.test(parts[i - 1])) return true
  return false
}

// The files a run's path or glob arguments name, out of `docs` (repository paths), relative to
// `root`, each argument { text, quoted }: "." or a directory names everything under it, a file
// itself. A glob: the shell expands an unquoted one, which this check doesn't follow; a quoted one
// Vale lints as text (no file), and cspell matches from the root, skipping dot folders unless
// --dot or the glob names one. cspell's `!glob` and `exclude` take files out at any depth. null
// when an argument can't be followed (a variable, an absolute path, an extglob). Run with cspell
// 10.3.6 and Vale 3.24.0.
function argumentFiles(docs, root, args, { exclude = [], tool, dot = false } = {}) {
  const GLOB = /[*?[{]/
  const matcher = ({ text, quoted }) => {
    if (/[$`~]/.test(text) || text.startsWith('/')) return null
    const p = text.replace(/^\.\//, '').replace(/\/$/, '')
    if (p === '' || p === '.') return () => true
    if (!GLOB.test(p)) {
      const path = joinDir(root, p)
      return path === null ? null : (f) => f === path || under(path, f)
    }
    if (!quoted) return null
    if (tool === 'vale') return () => false
    const rx = globRegExp(p)
    return rx && ((f) => under(root, f) && rx.test(relTo(root, f)))
  }
  const include = args.filter((a) => !a.text.startsWith('!')).map(matcher)
  const leave = [...args.filter((a) => a.text.startsWith('!')).map((a) => a.text.slice(1)), ...exclude].map((g) => (/[$`~]/.test(g) ? null : (f) => cspellGlob(g, root, f)))
  if ([...include, ...leave].includes(null) || docs.some((f) => leave.some((m) => m(f) === null))) return null
  // cspell's globs skip a dot folder (.github/) unless --dot is given or an argument names one.
  const dotted = (f) => tool === 'cspell' && !dot && !args.some((a) => /(^|\/)\.[^./]/.test(a.text)) && /(^|\/)\./.test(relTo(root, f))
  return docs.filter((f) => (include.length ? include.some((m) => m(f)) : true) && !leave.some((m) => m(f)) && !dotted(f))
}

// A command's arguments that aren't options, an option's value, or a redirection, as
// { text, quoted }.
function positionals(words, valued) {
  const out = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (/^(?:\d*>>?|<|&>>?|\d*[<>]&)/.test(w)) {
      if (/^(?:\d*>>?|<|&>>?)$/.test(w)) i++ // the target is the next word
      continue
    }
    if (w.startsWith('-')) {
      if (!w.includes('=') && valued.includes(w)) i++
      continue
    }
    const m = /^(['"])(.*)\1$/.exec(w)
    out.push({ text: m ? m[2] : w, quoted: Boolean(m) })
  }
  return out
}

// A run fed its files by xargs or find -exec: they aren't on its command line.
const PIPED = /\bxargs\b[^|;&]*\b(?:cspell|vale)\b|-exec(?:dir)?\s+(?:\S+\s+)*?(?:cspell|vale)\b/
const EXEC_ARGS = new Set(['{}', "'{}'", '"{}"', '+', '\\;', ';', "';'"])

// Does an ignoreRegExpList entry hide an unregistered capitalized word? An entry is a /regex/, a
// name from `patterns` or cspell's own, or else a bare regex, which cspell compiles with "gimu". A
// word is hidden when what's left of it has no run of four letters (cspell's minWordLength).
function cspellHides(pattern, patterns, seen = new Set()) {
  if (Array.isArray(pattern)) return pattern.some((p) => cspellHides(p, patterns, seen))
  if (typeof pattern !== 'string') return false
  if (patterns.has(pattern) && !seen.has(pattern)) return cspellHides(patterns.get(pattern), patterns, new Set([...seen, pattern]))
  if (pattern === 'Everything') return true
  if (CSPELL_PATTERNS.has(pattern)) return false
  const m = /^\/(.+)\/([a-z]*)$/s.exec(pattern)
  try {
    const flags = m ? m[2].replace(/[^gimsuy]/g, '') : 'gimu'
    const rx = new RegExp(m ? m[1] : pattern, flags.includes('g') ? flags : `${flags}g`)
    return CSPELL_SENTINELS.some((word) => !/[A-Za-z]{4,}/.test(word.replace(rx, ' ')))
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return false
  }
}

// cspell lint's options that take a value (cspell 10.3.6 --help).
const CSPELL_VALUED = ['-c', '--config', '-e', '--exclude', '-r', '--root', '--report', '--file-list', '--file', '--locale', '--language-id', '--cache-location', '--cache-strategy', '--cache-format', '--reporter', '--issue-template', '--dictionary', '--disable-dictionary', '--max-file-size', '--gitignore-root', '--stop-config-search-at']

/**
 * What one cspell run reads: { accept, reject, problems, skipped, notes }, each a list of messages,
 * and `cover`, each Markdown file the run checks with whether an accept and a reject list reach it.
 */
function cspellVocabulary(ctx, run) {
  const out = { accept: [], reject: [], problems: [], skipped: [], notes: [], cover: new Map() }
  const at = `${run.form ? `"${run.text}"` : run.uses} in ${run.where}`
  const words = run.form ? run.form.split(/\s+/) : []
  const base = run.form ? (run.dir === undefined ? '.' : run.dir) : '.'
  const configArg = run.form ? optionValue(words, '-c', '--config') : run.with?.config
  const rootArg = run.form ? optionValue(words, '-r', '--root') : run.with?.root
  const report = run.form ? optionValue(words, '--report') : run.with?.report
  if (report !== undefined && String(report).trim() !== 'all') out.problems.push(`${at}: --report ${report} lets an unknown word pass; only "all" fails it`)
  const root = base === null ? null : joinDir(base, String(rootArg ?? '.'))
  if (root === null) {
    out.skipped.push(`${at}: its directory or root isn't a repository path this check can follow`)
    return out
  }
  if (words.some((w) => /^--file(-list)?(=|$)/.test(w))) {
    out.skipped.push(`${at}: --file-list or --file names files this check doesn't follow`)
    return out
  }
  // A config file as layers, the configs it imports first: { data, dir, file, root }, or { js } for
  // a JavaScript config, which this check doesn't run, or { broken } for one that doesn't parse.
  // A layer's glob root (cspell 10.3.6, resolveGlobRoot): its globRoot; the run's directory for a
  // version "0.1" config or a .vscode one with no version; the directory above .config/ or
  // .vscode/; else its own directory.
  const globRoot = (data, dir) => {
    if (typeof data.globRoot === 'string') return data.globRoot.startsWith('${cwd}') ? joinDir(base, data.globRoot.slice(6).replace(/^\//, '') || '.') : joinDir(dir, data.globRoot)
    if (data.version === '0.1' || (/(^|\/)\.vscode$/.test(dir) && data.version === undefined)) return base
    return /(^|\/)\.(vscode|config)$/.test(dir) ? posix.dirname(dir) : dir
  }
  const loaded = new Map()
  const load = (file, visiting = new Set()) => {
    if (loaded.has(file)) return loaded.get(file)
    if (visiting.has(file)) return [] // an import cycle
    visiting.add(file)
    let layers
    if (/\.(m?js|cjs|m?ts|cts)$/.test(file)) layers = [{ js: file }]
    else {
      const text = ctx.repo.read(file) ?? ''
      let data
      try {
        if (file.endsWith('package.json')) data = JSON.parse(text)?.cspell
        else if (/\.ya?ml$/.test(file)) data = loadYaml().parse(text, { uniqueKeys: false })
        else if (file.endsWith('.toml')) data = loadToml().parse(text)
        else data = loadJson5().parse(text)
      } catch (error) {
        // The YAML parser throws a ReferenceError for an alias with no anchor.
        if (!(error instanceof SyntaxError || error instanceof ReferenceError || error instanceof loadYaml().YAMLError || error instanceof loadToml().TomlError)) throw error
        out.problems.push(`${at}: ${file} doesn't parse, so cspell stops with an error`)
        layers = [{ broken: file }]
      }
      if (!layers) {
        const dir = posix.dirname(file)
        const ok = data && typeof data === 'object' && !Array.isArray(data)
        // A relative import is another config in the repository; a package's is a published one.
        const imports = ok ? strings([data.import].flat()).map((imp) => (/^\.\.?\//.test(imp) ? joinDir(dir, imp) : null)) : []
        layers = [...imports.filter((p) => p && ctx.repo.has(p)).flatMap((p) => load(p, visiting)), ...(ok ? [{ data, dir, file, root: globRoot(data, dir) }] : [])]
      }
    }
    loaded.set(file, layers)
    return layers
  }
  const near = new Map()
  const nearest = (from) => {
    if (near.has(from)) return near.get(from)
    let found = null
    for (let dir = from; dir !== null && !found; dir = dir === '.' ? null : posix.dirname(dir)) {
      found =
        CSPELL_PLACES.map((p) => joinDir(dir, p)).find((p) => {
          if (!p || !ctx.repo.has(p)) return false
          if (!p.endsWith('package.json')) return true
          const pkg = ctx.repo.pkg(posix.dirname(p))
          return Boolean(pkg && !pkg.invalid && pkg.cspell && typeof pkg.cspell === 'object')
        }) ?? null
    }
    near.set(from, found)
    return found
  }
  let rootConfig = null
  if (configArg) {
    rootConfig = joinDir(base, String(configArg))
    if (!rootConfig || !ctx.repo.has(rootConfig)) {
      out.problems.push(`${at}: its config ${configArg} isn't in the repository, so cspell stops with an error`)
      return out
    }
  } else rootConfig = nearest(root)
  // --no-config-search (or noConfigSearch) stops only the search up from each document; the root
  // config is still read, and a nearer one merges over it otherwise (cspell 10.3.6).
  const search = !words.includes('--no-config-search') && !(rootConfig ? load(rootConfig) : []).some((l) => l.data?.noConfigSearch === true)
  // The files the run checks: its glob arguments (the action's `files`), less --exclude; with none,
  // the root config's `files`, or every file when xargs or find -exec feeds them in. With none of
  // those cspell prints its usage and checks nothing.
  const all = ctx.repo.files.filter((f) => MARKDOWN.test(f) && under(root, f))
  const piped = Boolean(run.form && PIPED.test(run.text))
  let args = run.form
    ? positionals(words.slice(1), CSPELL_VALUED).filter((a, i) => !(i === 0 && /^(lint|check)$/.test(a.text)) && !(piped && EXEC_ARGS.has(a.text)))
    : String(run.with?.files ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((text) => ({ text, quoted: true }))
  if (run.form && !args.length && !piped) {
    const files = (rootConfig ? load(rootConfig) : []).flatMap((l) => strings(l.data?.files))
    if (!files.length) {
      out.notes.push(`${at}: it names no files and its config sets no "files", so cspell checks nothing`)
      return out
    }
    args = files.map((text) => ({ text, quoted: true }))
  }
  const excludes = run.form ? words.flatMap((w, i) => (w === '-e' || w === '--exclude' ? [words[i + 1] ?? ''] : w.startsWith('--exclude=') ? [w.slice(10)] : [])).map((w) => w.replace(/^(['"])(.*)\1$/, '$2')) : []
  const docs = argumentFiles(all, root, args, { exclude: excludes, tool: 'cspell', dot: words.includes('--dot') })
  if (docs === null) {
    out.skipped.push(`${at}: its file arguments (${[...args.map((a) => a.text), ...excludes].join(' ')}) name files this check can't follow (an unquoted glob is the shell's)`)
    return out
  }
  if (!docs.length) {
    out.notes.push(`${at}: it checks no Markdown file`)
    return out
  }
  // The settings one document gets, merged as cspell merges them: every layer's own settings, then
  // every layer's overrides that cover the file, then its languageSettings for Markdown. One
  // evaluation per distinct set of configs and matches.
  const take = (s, o, dir, file) => {
    s.words.push(...strings(o.words).filter((w) => w.trim()))
    s.flagWords.push(...strings(o.flagWords).filter((w) => w.trim()))
    s.ignoreWords.push(...strings(o.ignoreWords))
    s.dictionaries.push(...strings(o.dictionaries))
    for (const d of Array.isArray(o.dictionaryDefinitions) ? o.dictionaryDefinitions : []) {
      if (d && typeof d.name === 'string') s.definitions.set(d.name, { name: d.name, path: typeof d.path === 'string' ? joinDir(dir, d.path) : null, raw: d.path, file })
    }
    for (const p of Array.isArray(o.patterns) ? o.patterns : []) if (p && typeof p.name === 'string') s.patterns.set(p.name, p.pattern)
    s.ignore.push(...strings(o.ignoreRegExpList).map((pattern) => ({ pattern, file })))
    for (const k of ['unknownWords', 'enabled', 'minWordLength']) if (o[k] !== undefined) s[k] = o[k]
  }
  const markdownLanguage = (l) => (Array.isArray(l?.languageId) ? l.languageId : String(l?.languageId ?? '').split(',')).map((x) => String(x).trim()).some((id) => id === 'markdown' || id === '*')
  const entries = new Map()
  const dictionary = (path) => {
    if (!entries.has(path)) {
      const list = vocabEntries(ctx.repo.read(path), /^#/)
      entries.set(path, { listed: list.filter((e) => !e.startsWith('!')).length, flagged: list.filter((e) => e.startsWith('!')).length })
    }
    return entries.get(path)
  }
  const evaluate = (layers, matched, from) => {
    const s = { words: [], flagWords: [], ignoreWords: [], dictionaries: [], definitions: new Map(), patterns: new Map(), ignore: [] }
    for (const { data, dir, file } of layers) take(s, data, dir, file)
    layers.forEach(({ data, dir, file }, i) => (Array.isArray(data.overrides) ? data.overrides : []).forEach((o, j) => matched[i][j] && take(s, o, dir, file)))
    for (const { data, dir, file } of layers) for (const l of Array.isArray(data.languageSettings) ? data.languageSettings : []) if (markdownLanguage(l)) take(s, l, dir, file)
    const problems = []
    if (s.enabled === false) return { off: true, problems }
    if (s.unknownWords !== undefined && s.unknownWords !== 'report-all') problems.push(`${at}: unknownWords "${s.unknownWords}" in ${from} lets an unknown word pass`)
    if (typeof s.minWordLength === 'number' && s.minWordLength > CSPELL_MIN_WORD) problems.push(`${at}: minWordLength ${s.minWordLength} in ${from} lets an unknown word shorter than ${s.minWordLength} letters pass`)
    for (const { pattern, file } of s.ignore) if (cspellHides(pattern, s.patterns)) problems.push(`${at}: ignoreRegExpList ${pattern} in ${file} hides a capitalized word, so a name can pass unregistered`)
    const ignoredWords = new Set(s.ignoreWords.map((w) => w.toLowerCase()))
    const lower = new Map(s.words.map((w) => [w.toLowerCase(), w]))
    for (const flag of s.flagWords) {
      if (/\s/.test(flag.trim())) problems.push(`${at}: flagWords "${flag}" is a phrase, which cspell ignores; flag one word, or use a Vale rule`)
      const word = lower.get(flag.toLowerCase())
      if (flag === flag.toLowerCase() && word) problems.push(`${at}: flagWords "${flag}" is all lowercase, so it flags every casing, the registered "${word}" too`)
      if (ignoredWords.has(flag.toLowerCase())) problems.push(`${at}: ignoreWords in ${from} holds the flagged "${flag}", so it's never reported`)
    }
    const enabled = new Set(s.dictionaries.filter((d) => !d.startsWith('!')))
    for (const d of s.dictionaries.filter((x) => x.startsWith('!'))) enabled.delete(d.slice(1))
    let listed = 0
    let flagged = 0
    for (const d of [...enabled].map((name) => s.definitions.get(name)).filter(Boolean)) {
      if (!d.path || !ctx.repo.has(d.path)) {
        problems.push(`${at}: dictionary "${d.name}" (${d.file}) names ${d.raw ?? 'no path'}, which isn't in the repository, so cspell stops with an error`)
        continue
      }
      listed += dictionary(d.path).listed
      flagged += dictionary(d.path).flagged
    }
    return { off: false, problems, accepted: s.words.length + listed, rejected: s.flagWords.length + flagged }
  }
  const profiles = new Map()
  const problems = new Set()
  const skipped = new Set()
  const counts = { accept: new Map(), reject: new Map() }
  const left = { off: new Set(), ignored: new Set() }
  let configured = false
  for (const doc of docs) {
    const configs = [...new Set([rootConfig, search ? nearest(posix.dirname(doc)) : null].filter(Boolean))]
    configured ||= configs.length > 0
    const layers = configs.flatMap((c) => load(c))
    const js = layers.find((l) => l.js)
    if (js) {
      skipped.add(`${at}: ${js.js} is a JavaScript cspell config, which this check doesn't run`)
      continue
    }
    if (layers.some((l) => l.broken)) continue
    // Which ignorePaths and overrides reach this file; a glob this check can't follow skips the run.
    const ignoredBy = layers.find((l) => strings(l.data.ignorePaths).some((g) => cspellGlob(g, l.root, doc)))
    const matched = layers.map((l) => (Array.isArray(l.data.overrides) ? l.data.overrides : []).map((o) => (o && typeof o === 'object' ? strings([o.filename].flat()).map((g) => cspellGlob(g, l.root, doc)) : [false])))
    const unknown = layers.flatMap((l) => [...strings(l.data.ignorePaths), ...(Array.isArray(l.data.overrides) ? l.data.overrides : []).flatMap((o) => strings([o?.filename].flat()))].filter((g) => l.root === null || cspellGlob(g, l.root, doc) === null).map((g) => `${g} in ${l.file}`))
    if (unknown.length) {
      skipped.add(`${at}: ${unknown[0]} is a glob this check doesn't follow`)
      continue
    }
    if (ignoredBy) {
      left.ignored.add(ignoredBy.file)
      continue
    }
    const hits = matched.map((m) => m.map((o) => o.some(Boolean)))
    const key = `${configs.join('|')}#${JSON.stringify(hits)}`
    if (!profiles.has(key)) profiles.set(key, evaluate(layers, hits, configs.join(', ')))
    const r = profiles.get(key)
    if (r.off) {
      left.off.add(configs.join(', '))
      continue
    }
    r.problems.forEach((p) => problems.add(p))
    const from = configs.join(', ')
    if (r.accepted) counts.accept.set(from, Math.max(counts.accept.get(from) ?? 0, r.accepted))
    if (r.rejected) counts.reject.set(from, Math.max(counts.reject.get(from) ?? 0, r.rejected))
    out.cover.set(doc, { accept: r.accepted > 0, reject: r.rejected > 0 })
  }
  out.problems.push(...problems)
  out.skipped.push(...skipped)
  if (!configured) out.notes.push(`${at}: no cspell config from ${root} up, so it reads only the dictionaries`)
  else if (!out.cover.size && !skipped.size && (left.off.size || left.ignored.size)) {
    const why = [...[...left.off].map((f) => `enabled: false in ${f}`), ...[...left.ignored].map((f) => `ignorePaths in ${f}`)].join('; ')
    out.problems.push(`${at}: it checks no Markdown file (${why})`)
  }
  for (const [from, n] of counts.accept) out.accept.push(`${at}: ${n} accepted word(s) (${from})`)
  for (const [from, n] of counts.reject) out.reject.push(`${at}: ${n} rejected word(s) (${from})`)
  return out
}

const VALE_CONFIGS = ['.vale.ini', '_vale.ini', 'vale.ini', '.vale', '_vale']
const VALE_LEVELS = { suggestion: 0, warning: 1, error: 2 }
const VALE_LEVEL_NAMES = ['suggestion', 'warning', 'error']
// vale-action's fail_level, as the lowest alert level that fails the run.
const VALE_FAIL_LEVELS = { any: 'suggestion', info: 'suggestion', suggestion: 'suggestion', warning: 'warning', error: 'error' }
// The vale options that take a value.
const VALE_VALUED = ['--config', '--filter', '--glob', '--minAlertLevel', '--output', '--ext']

/**
 * A Vale glob (a section, --glob) as a predicate on paths relative to where Vale runs: `*` and `**`
 * cross `/`, `?` is one character, `{a,b}` alternatives, `[...]` a class that `!` negates (`^` is
 * a plain character) (run with Vale 3.24.0).
 */
function valeGlob(pattern) {
  let re = ''
  let depth = 0
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '*' && pattern[i + 1] === '*' && pattern.slice(i).match(/^\*+\//)) {
      i += pattern.slice(i).match(/^\*+\//)[0].length - 1
      re += '(?:.*/)?' // **/ matches no folder too
    } else if (ch === '*') {
      while (pattern[i + 1] === '*') i++
      re += '.*'
    } else if (ch === '?') re += '.'
    else if (ch === '{') {
      depth++
      re += '(?:'
    } else if (ch === '}' && depth) {
      depth--
      re += ')'
    } else if (ch === ',' && depth) re += '|'
    else if (ch === '[' && pattern.indexOf(']', i + 2) > i) {
      const end = pattern.indexOf(']', i + 2)
      re += `[${pattern.slice(i + 1, end).replace(/^!/, '\0').replace(/[\\\]^]/g, '\\$&').replace('\0', '^')}]`
      i = end
    } else if (ch === '\\' && i + 1 < pattern.length) re += escapeRegExp(pattern[++i])
    else re += escapeRegExp(ch)
  }
  try {
    const rx = new RegExp(`^${re}${')'.repeat(depth)}$`)
    return (path) => rx.test(path)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return (path) => path === pattern
  }
}

/**
 * What one Vale run reads: { accept, reject, problems, skipped, notes }, each a list of messages,
 * and `cover`, each Markdown file the run lints with whether an accept and a reject list reach it.
 */
function valeVocabulary(ctx, run) {
  const out = { accept: [], reject: [], problems: [], skipped: [], notes: [], cover: new Map() }
  const at = `${run.form ? `"${run.text}"` : run.uses} in ${run.where}`
  const base = run.form ? (run.dir === undefined ? '.' : run.dir) : joinDir('.', String(run.with?.workdir ?? '.'))
  const flags = run.form ?? String(run.with?.vale_flags ?? '')
  const option = (name) => {
    const m = new RegExp(`--${name}(?:=|\\s+)(?:(["'])(.*?)\\1|(\\S+))`).exec(flags)
    return m ? (m[2] ?? m[3]) : undefined
  }
  const input = (name) => (run.form || run.with?.[name] === undefined ? undefined : String(run.with[name]).trim() || undefined)
  const configArg = option('config') ?? input('config')
  const filter = [option('filter'), input('filter')].filter((f) => f && String(f).trim()).join(' ')
  if (/Vale\.(?:\w+\.)?(?:Spelling|Terms|Avoid)\b/.test(filter)) {
    out.problems.push(`${at}: its --filter names a vocabulary rule (${filter.trim()}), so that rule's alerts never fail the run`)
    return out
  }
  if (filter) {
    out.skipped.push(`${at}: its --filter (${filter.trim()}) is an expression this check doesn't evaluate`)
    return out
  }
  const glob = option('glob') ?? input('glob')
  const failLevel = run.form ? 'error' : (VALE_FAIL_LEVELS[String(run.with?.fail_level ?? '').trim().toLowerCase()] ?? 'error')
  if (base === null) {
    out.skipped.push(`${at}: its working directory isn't a repository path this check can follow`)
    return out
  }
  if (input('files') !== undefined && input('files') !== 'all') {
    out.skipped.push(`${at}: its files input (${input('files')}) narrows the run in a way this check doesn't follow`)
    return out
  }
  if (!configArg && ctx.repo.workflows().some((w) => (ctx.repo.read(w.file) ?? '').includes('VALE_CONFIG_PATH'))) {
    out.skipped.push(`${at}: a workflow names the config through VALE_CONFIG_PATH, which this check doesn't follow`)
    return out
  }
  let config = null
  if (configArg) {
    config = joinDir(base, String(configArg))
    if (!config || !ctx.repo.has(config)) {
      out.problems.push(`${at}: its config ${configArg} isn't in the repository, so Vale stops with an error`)
      return out
    }
  }
  for (let dir = base; !config && dir !== null; dir = dir === '.' ? null : posix.dirname(dir)) {
    config = VALE_CONFIGS.map((n) => joinDir(dir, n)).find((p) => p && ctx.repo.has(p)) ?? null
  }
  if (!config) {
    out.notes.push(`${at}: no Vale config (.vale.ini) from ${base} up, so it reads no vocabulary`)
    return out
  }
  // The INI, as go-ini reads it for Vale: core keys before the first section, then [glob] sections
  // (a repeated one merged into its first place). A key ends at the first "=" or ":", and a value
  // or a header loses an inline comment (" #" or " ;") and its quotes.
  const core = new Map()
  const sections = []
  let current = null
  for (const raw of (ctx.repo.read(config) ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || /^[#;]/.test(line)) continue
    const head = /^\[(.+)\](?:\s+[#;].*)?$/.exec(line)
    if (head) {
      const glob = head[1].trim()
      current = sections.find((s) => s.glob === glob) ?? null
      if (!current) sections.push((current = { glob, keys: new Map(), matches: valeGlob(glob) }))
      continue
    }
    const split = /^([^=:]+)[=:](.*)$/.exec(line)
    if (split) {
      const value = split[2].replace(/\s+[#;].*$/, '').trim().replace(/^(["'])(.*)\1$/, '$2')
      ;(current?.keys ?? core).set(split[1].trim(), value)
    }
  }
  const list = (v) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  // An alert below MinAlertLevel isn't reported, so it can't fail the run either.
  const minAlert = String(option('minAlertLevel') ?? input('min_alert_level') ?? core.get('MinAlertLevel') ?? 'suggestion').toLowerCase()
  const threshold = Math.max(VALE_LEVELS[failLevel], VALE_LEVELS[minAlert] ?? 0)
  const fails = (level) => level !== null && VALE_LEVELS[level] >= threshold
  const named = [...new Set([...list(core.get('Vocab')), ...sections.flatMap((s) => list(s.keys.get('Vocab')))])]
  const styles = core.has('StylesPath') ? joinDir(posix.dirname(config), core.get('StylesPath')) : null
  if (named.length && !styles) {
    out.problems.push(`${at}: ${config} sets Vocab without a StylesPath to find it in`)
    return out
  }
  const vocab = new Map()
  for (const name of named) {
    const dir = posix.join(styles, 'config/vocabularies', name)
    if (!ctx.repo.files.some((f) => f.startsWith(`${dir}/`))) {
      const old = ctx.repo.files.some((f) => f.startsWith(`${posix.join(styles, 'Vocab', name)}/`))
      out.problems.push(`${at}: Vocab = ${name}, but ${dir}/ isn't in the repository, so Vale stops with an error${old ? " (that's Vale 2's place; Vale 3 reads config/vocabularies/)" : ''}`)
      continue
    }
    vocab.set(name, { accept: vocabEntries(ctx.repo.read(`${dir}/accept.txt`), /^#(\s|$)/), reject: vocabEntries(ctx.repo.read(`${dir}/reject.txt`), /^#(\s|$)/) })
  }
  // Vale.Avoid skips a rejected phrase that holds an accepted term, a regex entry's match too (run
  // with Vale 3.24.0). An entry is a Go regex, case-sensitive unless it starts with (?i); one that
  // JavaScript reads only without the u flag (Kimmy\-Lee) is tried that way.
  const accepted = [...vocab.values()].flatMap((v) => v.accept)
  const acceptRx = accepted.map((a) => {
    const ci = a.startsWith('(?i)')
    const source = `(?:^|\\W)(?:${ci ? a.slice(4) : a})(?:\\W|$)`
    for (const flags of [ci ? 'iu' : 'u', ci ? 'i' : '']) {
      try {
        return new RegExp(source, flags)
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
      }
    }
    return null
  })
  for (const r of [...vocab.values()].flatMap((v) => v.reject).filter((e) => !/[\\^$.|?*+()[\]{}]/.test(e))) {
    const holds = accepted.find((a, i) => a !== r && acceptRx[i]?.test(r))
    if (holds) out.problems.push(`${at}: reject.txt's "${r}" holds the accepted "${holds}", so Vale never reports it; write it as a rule with vocab: false`)
  }
  // The Markdown files the run lints, relative to where it runs (what section globs match): its
  // path arguments, under its directory, narrowed by --glob.
  const all = ctx.repo.files.filter((f) => MARKDOWN.test(f) && under(base, f))
  // A command with no path reads standard input, unless xargs or find -exec feeds it files; the
  // action lints its working directory.
  const piped = Boolean(run.form && PIPED.test(run.text))
  const args = run.form ? positionals(run.form.split(/\s+/).slice(1), VALE_VALUED).filter((a) => !(piped && EXEC_ARGS.has(a.text))) : [{ text: '.', quoted: true }]
  const files = args.length ? argumentFiles(all, base, args, { tool: 'vale' }) : piped ? all : []
  if (files === null) {
    out.skipped.push(`${at}: its path arguments (${args.map((a) => a.text).join(' ')}) name files this check can't follow (an unquoted glob is the shell's)`)
    return out
  }
  const docs = files.map((f) => relTo(base, f))
  const linted = glob ? docs.filter((d) => (glob.startsWith('!') ? !valeGlob(glob.slice(1))(d) : valeGlob(glob)(d))) : docs
  if (!linted.length) {
    if (docs.length) out.problems.push(`${at}: its --glob ${glob} leaves out every Markdown file`)
    else out.notes.push(`${at}: it lints no Markdown file`)
    return out
  }
  // Per file, as Vale 3.24.0 applies a config: [*] first wherever it sits, then the sections that
  // match, in order. The last BasedOnStyles wins; a rule's own setting outlasts a later
  // BasedOnStyles. A rule's value is YES, NO, UNSET or a lowercase level; anything else switches it
  // off (W101). A core Vocab's rules (Vale.Terms, Vale.Avoid) are the Vale style's; a section's
  // Vocab adds Vale.<Name>.Terms and Vale.<Name>.Avoid, on whatever the styles.
  // "Vale.<Name>.Terms = NO" counts as off, as Vale's docs say, though 3.24.0 ignores it.
  const active = new Set()
  const used = { accept: new Set(), reject: new Set() }
  const spelled = new Set()
  for (const doc of linted) {
    const hit = sections.filter((s) => s.matches(doc))
    const ordered = [...hit.filter((s) => s.glob === '*'), ...hit.filter((s) => s.glob !== '*')]
    const keys = new Map(ordered.flatMap((s) => [...s.keys]))
    const valeOn = list(keys.get('BasedOnStyles')).includes('Vale')
    const level = (rule, fallback) => {
      const v = keys.get(rule)
      return v === undefined || v === 'UNSET' ? fallback : v === 'NO' ? null : v === 'YES' ? 'error' : v in VALE_LEVELS ? v : null
    }
    const spelling = level('Vale.Spelling', valeOn ? 'error' : null)
    const here = [
      ...list(core.get('Vocab')).map((name) => ({ name, terms: level('Vale.Terms', valeOn ? 'error' : null), avoid: level('Vale.Avoid', valeOn ? 'error' : null) })),
      ...[...new Set(hit.flatMap((s) => list(s.keys.get('Vocab'))))].map((name) => ({ name, terms: level(`Vale.${name}.Terms`, 'error'), avoid: level(`Vale.${name}.Avoid`, 'error') })),
    ].filter((v) => vocab.has(v.name))
    const cover = { accept: false, reject: false }
    for (const v of here) {
      const { accept, reject } = vocab.get(v.name)
      active.add(v.name)
      if (accept.length && (fails(spelling) || fails(v.terms))) used.accept.add(v.name)
      if (accept.length && fails(spelling)) {
        spelled.add(v.name)
        cover.accept = true
      }
      if (reject.length && fails(v.avoid)) {
        used.reject.add(v.name)
        cover.reject = true
      }
    }
    out.cover.set(base === '.' ? doc : `${base}/${doc}`, cover)
  }
  if (!active.size) {
    out.notes.push(`${at}: ${config} gives no Markdown file a Vocab, so no accept.txt or reject.txt is read`)
    return out
  }
  const bar = VALE_LEVEL_NAMES[threshold]
  for (const name of active) {
    const { accept, reject } = vocab.get(name)
    if (accept.length && !used.accept.has(name)) {
      out.problems.push(`${at}: ${name}'s accept.txt is read, but in ${config} Vale.Spelling and its Terms rule are off or below "${bar}" for every Markdown file, so it does nothing`)
    }
    if (reject.length && !used.reject.has(name)) {
      out.problems.push(`${at}: ${name}'s reject.txt is read, but in ${config} its Avoid rule is off or below "${bar}" for every Markdown file, so a rejected term never fails the run`)
    }
  }
  const count = (names, key) => [...names].reduce((n, name) => n + vocab.get(name)[key].length, 0)
  if (spelled.size) out.accept.push(`${at}: ${count(spelled, 'accept')} accepted term(s) (${[...spelled].join(', ')} in ${styles}/config/vocabularies/)`)
  else if (used.accept.size) out.notes.push(`${at}: Vale.Spelling is off, so ${[...used.accept].join(', ')}'s accept.txt only fixes casing; the accept half needs a spell check that reads it`)
  if (used.reject.size) out.reject.push(`${at}: ${count(used.reject, 'reject')} rejected term(s) (${[...used.reject].join(', ')})`)
  return out
}

/** The lists a repository's own checker reads, as its config declares them. */
function ownVocabulary(ctx, declared, own) {
  const out = { accept: [], reject: [], problems: [], skipped: [], notes: [], own: true }
  const scripts = [...new Set(own.map((c) => c.script))]
  if (!scripts.length) {
    out.problems.push(`${CONFIG} declares a vocabulary, but no check of the repository's own runs on pull requests to read it`)
    return out
  }
  // The checker reads a list when it names it, or names a code file of its own that does (one
  // hop): by its file name, or by its module name (`import lists` for lists.py). A document that
  // names the list doesn't count: nothing runs it.
  const CODE = /\.(py|m?js|cjs|ts|sh)$/
  const names = (text, f) => {
    const stem = posix.basename(f).replace(CODE, '')
    return text.includes(posix.basename(f)) || (stem.length > 2 && new RegExp(`\\b${escapeRegExp(stem)}\\b`).test(text))
  }
  const reads = (script, file) => {
    const text = ctx.repo.read(script) ?? ''
    if (text.includes(file) || text.includes(posix.basename(file))) return true
    return ctx.repo.files.some((f) => CODE.test(f) && f !== script && names(text, f) && (ctx.repo.read(f) ?? '').includes(posix.basename(file)))
  }
  for (const half of ['accept', 'reject']) {
    for (const given of declared[half] ?? []) {
      const file = joinDir('.', given)
      if (!file || !ctx.repo.has(file)) {
        out.problems.push(`${CONFIG} vocabulary.${half}: ${given} isn't in the repository`)
        continue
      }
      const n = vocabEntries(ctx.repo.read(file), /^#/).length
      const by = scripts.find((s) => reads(s, file))
      if (!n) out.problems.push(`${file} (vocabulary.${half}) has no entries`)
      else if (!by) out.problems.push(`${file} (vocabulary.${half}) isn't read by the checker pull requests run (${scripts.join(', ')}): neither it nor a code file it names mentions ${posix.basename(file)}`)
      else out[half].push(`${file}: ${n} ${half}ed entr${n === 1 ? 'y' : 'ies'}, read by ${by}`)
    }
  }
  return out
}

/** One probe per checked standard: (ctx) => { status, evidence }. ctx: { repo, path, visibility, today, vocabulary }. */
export const PROBES = {
  'core.agent-rules': (ctx) => {
    const others = ['CLAUDE.md', '.cursor/rules/', '.agent/rules/', '.github/copilot-instructions.md', 'GEMINI.md'].filter((p) =>
      p.endsWith('/') ? ctx.repo.files.some((f) => f.startsWith(p)) : ctx.repo.has(p),
    )
    if (ctx.repo.has('AGENTS.md')) return pass('AGENTS.md at the root', ...(others.length ? [`also: ${others.join(', ')}`] : []))
    return fail('no AGENTS.md at the root', others.length ? `rules kept only in: ${others.join(', ')}` : 'no agent rules found anywhere')
  },

  'core.instructions-resolve': (ctx) => {
    const run = runTemplateCheck('check-instructions.mjs', ctx.repo.root)
    if (run.status === 0) return pass(summaryLine(run))
    if (run.status === 1) return fail(...list(run.out), ...run.err.slice(-1))
    if (run.err.some((l) => l.startsWith('No agent instruction files'))) return notApplicable('no agent instruction files to check')
    return errored(`check-instructions couldn't run: ${run.err.join(' ')}`)
  },

  'core.ci-on-pull-requests': (ctx) => {
    const workflows = ctx.repo.workflows()
    const broken = workflows.filter((w) => w.error).map((w) => `${w.file} doesn't parse, so GitHub can't run it: ${w.error}`)
    if (!workflows.length) {
      const other = ['.gitlab-ci.yml', '.circleci/config.yml', 'azure-pipelines.yml', '.travis.yml', 'bitbucket-pipelines.yml', 'Jenkinsfile'].filter((f) =>
        ctx.repo.has(f),
      )
      if (other.length) return skip(`CI isn't GitHub Actions (${other.join(', ')}); this check reads only .github/workflows/`)
      return fail('no GitHub Actions workflows (.github/workflows/)')
    }
    for (const w of workflows.filter((x) => !x.error && !x.jobs.length)) broken.push(`${w.file} has no jobs, so GitHub rejects it as invalid`)
    const pr = workflows.filter((w) => w.events.has('pull_request') && w.jobs.length).map((w) => w.file)
    if (broken.length) return fail(...broken)
    if (pr.length) return pass(`on pull_request: ${pr.join(', ')}`)
    const events = [...new Set(workflows.flatMap((w) => [...w.events]))]
    return fail(`no workflow runs on pull_request (workflows run on: ${events.join(', ') || 'nothing'})`)
  },

  'core.security-policy': (ctx) => {
    const found = ctx.repo.files.filter((f) => /^(?:\.github\/|docs\/)?security\.md$/i.test(f))
    return found.length ? pass(found.join(', ')) : fail('no SECURITY.md at the root, in .github/, or in docs/')
  },

  'core.license': (ctx) => {
    if (!ctx.visibility) return skip(`visibility unknown: set "visibility" in ${CONFIG} or pass --visibility public|private`)
    if (ctx.visibility === 'private') return notApplicable('a private repository')
    // LICENSE, LICENSE.md, LICENSE-Apache-2.0, COPYING.txt; not license-checker.json or copying.js.
    const found = ctx.repo.files.filter((f) => /^(?!.*\.(?:json|[cm]?[jt]sx?|py|ya?ml|toml|lock)$)(?:licen[cs]e|copying)(?:[.-][\w.-]+)?$/i.test(f))
    return found.length ? pass(found.join(', ')) : fail('a public repository with no LICENSE, LICENCE, or COPYING file at the root')
  },

  'core.lf-line-endings': (ctx) => {
    let out
    try {
      out = execFileSync('git', ['ls-files', '--eol', '-z'], { cwd: ctx.repo.root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
    } catch (error) {
      if (error.status !== 128 && error.code !== 'ENOENT') throw error
      return skip('not a git work tree, so there is no committed content to read')
    }
    const entries = out.split('\0').filter(Boolean)
    if (!entries.length) return notApplicable('nothing committed yet')
    const bad = entries
      .map((e) => e.split('\t'))
      .filter(([info]) => /^i\/(crlf|mixed)\b/.test(info))
      .map(([info, path]) => `${path} (${info.split(/\s+/)[0].slice(2)})`)
    if (bad.length) return fail(`${bad.length} of ${entries.length} tracked files have CRLF or mixed line endings:`, ...list(bad))
    return pass(`${entries.length} tracked files, none with CRLF in the index`)
  },

  'core.no-agent-workflows': (ctx) => {
    const found = ctx.repo.files.filter((f) => /^\.agents?\/workflows\//.test(f))
    if (!found.length) return pass('no .agent/workflows/ or .agents/workflows/')
    return fail(`${found.length} Antigravity workflow file(s), which stop working on 2026-10-19; /migrate-workflows converts them:`, ...list(found))
  },

  'core.dependency-updates': (ctx) => {
    const manifests = ctx.repo.files.filter((f) => MANIFEST.test(f) && !/(^|\/)(node_modules|\.?venv|vendor)\//.test(f))
    const actions = ctx.repo.workflows().some((w) => w.jobs.some((j) => j.uses || j.steps.some((s) => s.uses)))
    if (!manifests.length && !actions) return notApplicable('nothing to update: no package manifest, Dockerfile, or workflow action')
    const found = ctx.repo.files.filter((f) => /^\.github\/dependabot\.ya?ml$/.test(f) || RENOVATE.test(f))
    const pkg = ctx.repo.pkg('.')
    if (pkg && !pkg.invalid && pkg.renovate) found.push('package.json "renovate"')
    return found.length ? pass(found.join(', ')) : fail('no Dependabot (.github/dependabot.yml) or Renovate configuration')
  },

  'core.dependency-cooldown': (ctx) => {
    const dependabot = ['.github/dependabot.yml', '.github/dependabot.yaml'].find((f) => ctx.repo.has(f))
    const renovateFiles = ctx.repo.files.filter((f) => RENOVATE.test(f))
    const pkg = ctx.repo.pkg('.')
    const inPackage = pkg && !pkg.invalid && pkg.renovate && typeof pkg.renovate === 'object' ? pkg.renovate : null
    if (!dependabot && !renovateFiles.length && !inPackage) return notApplicable('no Dependabot or Renovate configuration (core.dependency-updates)')
    const problems = []
    const ok = []
    const unread = []
    if (dependabot) {
      let doc
      try {
        doc = loadYaml().parse(ctx.repo.read(dependabot))
      } catch (error) {
        if (!(error instanceof loadYaml().YAMLError)) throw error
        return fail(`${dependabot} doesn't parse: ${error.message.split('\n')[0]}`)
      }
      const updates = Array.isArray(doc?.updates) ? doc.updates : []
      if (!updates.length) problems.push(`${dependabot} has no updates entries`)
      for (const u of updates) {
        const c = u?.cooldown && typeof u.cooldown === 'object' ? u.cooldown : {}
        const days = c['default-days']
        const name = `${u?.['package-ecosystem'] ?? '?'} (${u?.directory ?? u?.directories ?? '/'})`
        const shorter = ['semver-major-days', 'semver-minor-days', 'semver-patch-days'].filter((k) => typeof c[k] === 'number' && c[k] < 3)
        if (!(typeof days === 'number' && days >= 3)) problems.push(`${dependabot}: ${name} sets no cooldown of 3 days or more (default-days${days === undefined ? ' unset' : `: ${days}`})`)
        else if (shorter.length) problems.push(`${dependabot}: ${name} waits ${days} days, but ${shorter.map((k) => `${k}: ${c[k]}`).join(', ')}`)
        else if ([c.exclude ?? []].flat().some((e) => String(e).trim() === '*')) problems.push(`${dependabot}: ${name} excludes every dependency from its cooldown (exclude: "*")`)
        else ok.push(`${dependabot}: ${name} waits ${days} days`)
      }
    }
    // Renovate: the age every update waits, from the top level and the rules that match every
    // package (matchPackageNames ["*"] alone), in order, a later one overriding. A rule scoped to
    // some packages (any other selector, or a preset's) can only lower it for them, so one that
    // sets less than 3 days is a finding.
    const everything = (r) => {
      const names = [r.matchPackageNames].flat()
      return !r.extends && Object.keys(r).filter((k) => /^(match|exclude)/.test(k)).join() === 'matchPackageNames' && names.length > 0 && names.every((n) => n === '*')
    }
    // Lock file maintenance has no release to age; Renovate's own waiting presets exempt it.
    const noRelease = (r) => Object.keys(r).filter((k) => /^(match|exclude)/.test(k)).join() === 'matchUpdateTypes' && [r.matchUpdateTypes].flat().every((t) => t === 'lockFileMaintenance')
    const scope = (r) => Object.keys(r).filter((k) => /^(match|exclude)/.test(k) || k === 'extends').map((k) => `${k}: ${JSON.stringify(r[k])}`).join(', ') || 'no selector'
    // Built-in presets that wait, and the manifests they cover.
    const PRESETS = {
      'config:best-practices': 'package.json',
      'security:minimumReleaseAgeNpm': 'package.json',
      'npm:unpublishSafe': 'package.json',
      ':unpublishSafe': 'package.json',
      'default:unpublishSafe': 'package.json',
      'security:minimumReleaseAgeCrate': 'Cargo.toml',
      'security:minimumReleaseAgePypi': 'a Python manifest',
    }
    // The ecosystems Renovate would update here: each kind of manifest outside the paths it skips.
    // Its default ignorePaths are node_modules and bower_components; :ignoreModulesAndTests, which
    // config:recommended (and so config:best-practices) extends, adds tests, fixtures, examples, and
    // vendored code; a config's own ignorePaths replaces either, matched as a glob or a substring.
    // The presets that extend :ignoreModulesAndTests, with the old names Renovate still resolves.
    const MODULES_AND_TESTS = [
      ...[':ignoreModulesAndTests', ':base', ':app', ':js-app', ':library'].flatMap((x) => [x, `default${x}`]),
      ...['recommended', 'base', 'best-practices', 'js-app', 'js-lib', 'base-js', 'application', 'library'].map((x) => `config:${x}`),
      'security:only-security-updates',
    ]
    // Its NuGet override skips everything else it does, but not tests.
    const NUGET = /(^|\/)(Directory\.Packages\.props|[^/]+\.(cs|fs|vb)proj)$/
    // Renovate matches each path as a substring, or as a minimatch glob, which takes `{a,b}` and
    // never matches a pattern that ends in a slash.
    const braces = (p) => {
      const m = /\{([^{}]*,[^{}]*)\}/.exec(p)
      return m ? m[1].split(',').flatMap((alt) => braces(p.slice(0, m.index) + alt + p.slice(m.index + m[0].length))) : [p]
    }
    const pathList = (list) => {
      const paths = list.filter((p) => typeof p === 'string' && p)
      const globs = paths.flatMap((p) => braces(p).filter((x) => !x.endsWith('/')).map(globMatcher))
      return (f) => paths.some((p) => f.includes(p)) || globs.some((g) => g(f))
    }
    const skipped = (config, presets) => {
      const modulesAndTests = presets.some((x) => MODULES_AND_TESTS.includes(x))
      const top = Array.isArray(config.ignorePaths)
        ? pathList(config.ignorePaths)
        : pathList(['**/node_modules/**', '**/bower_components/**', ...(modulesAndTests ? ['**/vendor/**', '**/examples/**', '**/__tests__/**', '**/test/**', '**/tests/**', '**/__fixtures__/**'] : [])])
      const nuget = Array.isArray(config.nuget?.ignorePaths)
        ? pathList(config.nuget.ignorePaths)
        : modulesAndTests
          ? pathList(['**/node_modules/**', '**/bower_components/**', '**/vendor/**', '**/examples/**', '**/__fixtures__/**'])
          : top
      return (f) => (NUGET.test(f) ? nuget(f) : top(f))
    }
    const kindOf = (f) =>
      /(^|\/)package\.json$/.test(f)
        ? 'package.json'
        : /(^|\/)Cargo\.toml$/.test(f)
          ? 'Cargo.toml'
          : /(^|\/)(pyproject\.toml|requirements[^/]*\.txt|Pipfile|setup\.py)$/.test(f)
            ? 'a Python manifest'
            : MANIFEST.test(f) && !/(^|\/)packages\.config$/.test(f) // Renovate's NuGet manager doesn't read it
              ? posix.basename(f).replace(/^.+\.(cs|fs|vb)proj$/, 'a .NET project')
              : null
    for (const [where, config] of [...renovateFiles.map((f) => [f, parseConfigFile(f.endsWith('.json') ? f : `${f}.json5`, ctx.repo.read(f))]), ...(inPackage ? [['package.json "renovate"', inPackage]] : [])]) {
      if (!config || typeof config !== 'object') {
        problems.push(`${where} doesn't parse`)
        continue
      }
      let age = durationDays(config.minimumReleaseAge) ?? 0
      const lowered = []
      for (const rule of Array.isArray(config.packageRules) ? config.packageRules : []) {
        if (!rule || typeof rule !== 'object' || !Object.hasOwn(rule, 'minimumReleaseAge')) continue
        const days = durationDays(rule.minimumReleaseAge) ?? 0
        if (everything(rule)) age = days
        else if (days < 3 && !noRelease(rule)) lowered.push(`${where}: a package rule (${scope(rule)}) sets minimumReleaseAge ${JSON.stringify(rule.minimumReleaseAge)}`)
      }
      const presets = [config.extends ?? []].flat().map(String)
      const waiting = presets.filter((x) => Object.hasOwn(PRESETS, x))
      const ignored = skipped(config, presets)
      const kinds = [...new Set(ctx.repo.files.filter((f) => !ignored(f)).map(kindOf).filter(Boolean))]
      const uncovered = kinds.filter((m) => !waiting.some((x) => PRESETS[x] === m))
      // A preset from elsewhere (github>, local>, a package, a URL) can't be read from here.
      const shared = presets.filter((x) => x.includes('>') || x.startsWith('@') || /^https?:/.test(x) || !x.includes(':'))
      if (lowered.length) problems.push(...lowered)
      // A shared preset's own package rules can lower whatever this file sets, so it's unread
      // even beside an age of 3 days.
      if (shared.length) unread.push(`${where} extends ${shared.join(', ')}, which this check can't read`)
      if (age >= 3) ok.push(`${where}: minimumReleaseAge of ${Math.round(age * 10) / 10} days`)
      else if (waiting.some((x) => kinds.includes(PRESETS[x])) && !uncovered.length) ok.push(`${where}: extends ${waiting.join(', ')}, which wait${waiting.length === 1 ? 's' : ''} for ${[...new Set(waiting.map((x) => PRESETS[x]))].join(' and ')} updates only`)
      else if (!shared.length) {
        problems.push(`${where} sets no minimumReleaseAge of 3 days or more for every package${waiting.length ? ` (${waiting.join(', ')} doesn't cover ${uncovered.length ? uncovered.join(' or ') : 'any manifest here'})` : ''}`)
      }
    }
    if (problems.length) return fail(...list(problems), ...ok, ...unread)
    if (unread.length) return skip([...unread, ...ok].join('; '))
    return pass(...list(ok))
  },

  'core.workflows-audited': (ctx) => {
    if (!ctx.repo.workflows().length) return notApplicable('no GitHub Actions workflows to audit')
    const { commands, ignored } = ctx.repo.ci(PR)
    const re = /^zizmor(\s|$)/
    // --no-exit-codes and SARIF output turn its finding exit codes off.
    const hit =
      matching(commands, re).find((c) => !/\s(--no-exit-codes|--format[=\s]+["']?sarif)\b/.test(c.text)) ??
      actionSteps(ctx, PR, /^zizmorcore\/zizmor-action@/, (w) => off(w?.['advanced-security']))[0]
    if (hit) return pass(`${hit.text ?? hit.uses} in ${hit.where}`)
    return fail('no pull_request workflow runs zizmor where a finding can fail it', ...silencedCopies(ignored, re))
  },

  'core.workflow-caches': (ctx) => {
    const workflows = ctx.repo.workflows().filter((w) => !w.error)
    if (!workflows.length) return notApplicable('no GitHub Actions workflows')
    // setup-node v5 and later cache npm on their own when the checkout's package.json names npm as
    // its package manager (devEngines.packageManager, one or a list, or packageManager), as it reads it.
    const pkg = ctx.repo.pkg('.')
    const NPM = /^(\^)?npm(@.*)?$/
    const dev = pkg && !pkg.invalid ? pkg.devEngines?.packageManager : undefined
    const npmNamed =
      Boolean(pkg && !pkg.invalid) &&
      ((dev ? [dev].flat() : []).some((o) => typeof o?.name === 'string' && NPM.test(o.name)) || (typeof pkg.packageManager === 'string' && NPM.test(pkg.packageManager)))
    // The action's major: from its ref, or from the comment beside a commit pin; a commit pin
    // without one counts as a current release.
    const major = (uses, file) => Number(actionMajor(ctx, uses, file) ?? Infinity)
    const on = (v) => v === true || String(v).trim() === 'true'
    const set = (v) => v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim() !== 'false'
    /** What a step restores from the Actions cache, or null. */
    const restores = (step, file) => {
      const u = step.uses ?? ''
      const w = step.with ?? {}
      if (/^actions\/cache(\/restore)?@/.test(u)) return 'actions/cache'
      if (/^Swatinem\/rust-cache@/.test(u)) return 'rust-cache'
      if (/^docker\/build-push-action@/.test(u) && /\btype=gha\b/.test(String(w['cache-from'] ?? ''))) return "docker's GitHub Actions cache (cache-from: type=gha)"
      if (/^actions\/setup-node@/.test(u)) {
        if (set(w.cache)) return `setup-node's ${w.cache} cache`
        if (npmNamed && major(u, file) >= 5 && !off(w['package-manager-cache'])) return "setup-node's npm cache (on by default, since package.json names npm)"
      }
      if (/^actions\/setup-(python|java)@/.test(u) && set(w.cache)) return `${u.split('@')[0]}'s ${w.cache} cache`
      if (/^actions\/setup-dotnet@/.test(u) && on(w.cache)) return "setup-dotnet's NuGet cache"
      if (/^actions\/setup-go@/.test(u) && major(u, file) >= 4 && !off(w.cache)) return "setup-go's module cache (on by default)"
      if (/^ruby\/setup-ruby@/.test(u) && on(w['bundler-cache'])) return "setup-ruby's bundler cache"
      if (/^gradle\/actions\/setup-gradle@/.test(u) && !on(w['cache-disabled'])) return "setup-gradle's cache (on by default)"
      if (/^oven-sh\/setup-bun@/.test(u) && !on(w['no-cache'])) return "setup-bun's cache (on by default)"
      if (/^astral-sh\/setup-uv@/.test(u) && (on(w['enable-cache']) || (String(w['enable-cache'] ?? 'auto').trim() === 'auto' && major(u, file) >= 6))) {
        return "setup-uv's cache (on by default on GitHub's runners)"
      }
      return null
    }
    // What publishes: a release, Pages, a registry, a container, a store.
    const PUBLISH_ACTION = /^(actions\/deploy-pages|softprops\/action-gh-release|ncipollo\/release-action|changesets\/action|pypa\/gh-action-pypi-publish|JS-DevTools\/npm-publish|peaceiris\/actions-gh-pages|JamesIves\/github-pages-deploy-action|tauri-apps\/tauri-action|cloudflare\/wrangler-action|goreleaser\/goreleaser-action)@/
    const PUBLISH_COMMAND =
      /(^|[\s;&|(])((npm|pnpm|bun|yarn( npm)?) publish|npx changeset publish|changeset publish|semantic-release|cargo publish|twine upload|uv publish|poetry publish|gh release (create|upload)|docker push|vsce publish|ovsx publish|eas (submit|update)|wrangler (deploy|publish)|firebase deploy|netlify deploy[^\n]*--prod|vercel[^\n]*--prod|goreleaser release)\b/
    const publishesItself = (w) =>
      w.events.has('release') ||
      w.jobs.some((j) => j.steps.some((st) => PUBLISH_ACTION.test(st.uses ?? '') || (st.run && PUBLISH_COMMAND.test(st.run)) || (/^docker\/build-push-action@/.test(st.uses ?? '') && set(st.with?.push))))
    const byFile = new Map(workflows.map((w) => [w.file, w]))
    const called = (job) => byFile.get(/^\.\/(\.github\/workflows\/[^@]+\.ya?ml)$/.exec(job.uses ?? '')?.[1])
    // A workflow publishes when it, or a local workflow it calls, does.
    const publishes = (w, seen = new Set([w.file])) =>
      publishesItself(w) || w.jobs.some((j) => { const c = called(j); return Boolean(c) && !seen.has(c.file) && (seen.add(c.file), publishes(c, seen)) })
    const SECRET = /\$\{\{\s*secrets\.(?!GITHUB_TOKEN\b)[A-Za-z_]/
    const writes = (perms) => perms === 'write-all' || (perms && typeof perms === 'object' && Object.values(perms).some((v) => String(v).trim() === 'write'))
    const problems = new Set()
    const fine = []
    // A called workflow's jobs run with what its caller gives it: the caller's publishing, its
    // secrets (`secrets: inherit` or named), and its token's permissions.
    // `chain` holds the workflows already on this call path: a cycle ends, and a chain of any
    // depth is followed.
    const evaluate = (w, given, via, chain) => {
      const release = given.release || publishes(w)
      for (const job of w.jobs) {
        const c = called(job)
        if (c) {
          if (!chain.has(c.file)) {
            const secret = given.secret || SECRET.test(job.text) || /"secrets":"inherit"/.test(job.text)
            evaluate(c, { release, secret, write: given.write || writes(job.permissions ?? w.permissions) }, `${via}${w.file} (job ${job.id}) -> `, new Set([...chain, c.file]))
          }
          continue
        }
        const why = release
          ? 'the workflow publishes'
          : given.secret || SECRET.test(job.text) || SECRET.test(w.env)
            ? 'the job is given a secret'
            : given.write || writes(job.permissions ?? w.permissions)
              ? "the job's token can write"
              : null
        const hits = job.steps.filter((st) => !st.never).map((st) => [st, restores(st, w.file)]).filter(([, r]) => r)
        for (const [st, r] of hits) {
          if (why) problems.add(`${via}${w.file} (job ${job.id}) step "${st.name}" restores ${r}, and ${why}`)
        }
        if (why && !hits.length && !via) fine.push(`${w.file} (job ${job.id})`)
      }
    }
    for (const w of workflows) evaluate(w, { release: false, secret: false, write: false }, '', new Set([w.file]))
    if (problems.size) return fail(...list([...problems]))
    return fine.length ? pass(`no cache in ${list(fine, 5).join(', ')}`) : pass('no job publishes, holds a secret, or has a token that can write')
  },

  'core.audit-waivers': (ctx) => {
    const problems = []
    let waived = 0
    const due = (value, where) => {
      const days = daysUntil(value, ctx.today)
      if (days === null) problems.push(`${where}: no expiry date`)
      else if (days < 0) problems.push(`${where}: expired ${-days} day(s) ago`)
      else if (days > MAX_WAIVER_DAYS) problems.push(`${where}: expires ${days} days out, more than ${MAX_WAIVER_DAYS}`)
    }
    const reasoned = (reason, where) => {
      if (typeof reason !== 'string' || reason.trim().length < 20) problems.push(`${where}: no reason (20 characters or more)`)
    }
    const kept = (re) => ctx.repo.files.filter((f) => re.test(f) && !/(^|\/)(node_modules|vendor|target)\//.test(f))
    let unreadable = 0
    for (const f of kept(/(^|\/)osv-scanner\.toml$/)) {
      const config = parseConfigFile(f, ctx.repo.read(f))
      if (!config) {
        unreadable++
        problems.push(`${f} doesn't parse, so its waivers can't be read`)
        continue
      }
      for (const v of Array.isArray(config.IgnoredVulns) ? config.IgnoredVulns : []) {
        waived++
        const where = `${f}: ${v?.id ?? 'an IgnoredVulns entry'}`
        reasoned(v?.reason, where)
        due(v?.ignoreUntil, where)
      }
      // A package override that ignores a package, or its vulnerabilities, waives every advisory in it.
      for (const o of Array.isArray(config.PackageOverrides) ? config.PackageOverrides : []) {
        if (o?.ignore !== true && o?.vulnerability?.ignore !== true) continue
        waived++
        const where = `${f}: the override for ${o?.name ?? 'every package'}${o?.version ? `@${o.version}` : ''}`
        reasoned(o?.reason, where)
        due(o?.effectiveUntil, where)
      }
    }
    for (const f of kept(/^docs\/security\/audit-waivers\.json$/)) {
      const data = parseJson(ctx.repo.read(f))
      if (!data || typeof data !== 'object') {
        unreadable++
        problems.push(`${f} doesn't parse, so its waivers can't be read`)
        continue
      }
      for (const w of Array.isArray(data?.waivers) ? data.waivers : []) {
        waived++
        const where = `${f}: ${w?.advisory ?? 'a waiver'}`
        reasoned(w?.reason, where)
        due(w?.expires, where)
      }
    }
    // cargo-deny's ignores can hold a reason but no expiry, so a reason is all they're held to.
    let noExpiry = 0
    for (const f of kept(/(^|\/)deny\.toml$/)) {
      const config = parseConfigFile(f, ctx.repo.read(f))
      if (!config) {
        unreadable++
        problems.push(`${f} doesn't parse, so its ignores can't be read`)
        continue
      }
      const ignore = config.advisories?.ignore
      for (const i of Array.isArray(ignore) ? ignore : []) {
        waived++
        noExpiry++
        const id = typeof i === 'string' ? i : (i?.id ?? i?.crate ?? 'an ignore')
        if (typeof i === 'string') problems.push(`${f}: ${id} is ignored with no reason (write { id = "${id}", reason = "..." })`)
        else reasoned(i?.reason, `${f}: ${id}`)
      }
    }
    for (const f of kept(/(^|\/)\.cargo\/audit\.toml$/)) {
      const config = parseConfigFile(f, ctx.repo.read(f))
      if (!config) {
        unreadable++
        problems.push(`${f} doesn't parse, so its ignores can't be read`)
        continue
      }
      const ignore = config.advisories?.ignore
      if (Array.isArray(ignore) && ignore.length) {
        waived += ignore.length
        problems.push(`${f} ignores ${ignore.join(', ')}, and can hold no reason or expiry: move them to deny.toml or osv-scanner.toml`)
      }
    }
    const events = [...new Set(ctx.repo.workflows().flatMap((w) => [...w.events]))]
    const { commands, ignored } = ctx.repo.ci(events)
    for (const c of matching([...commands, ...ignored], /^pip[-_]audit(\s|$)|^cargo\s+audit\b|^cargo-audit\b|^uv\s+audit\b|^safety\s+(check|scan)\b/)) {
      // Flags after the audit tool's own name, not a wrapper's (uvx -i is an index URL). -i is
      // safety's short --ignore, and uv's --index-url, so it counts only for safety.
      const form = commandForms(c.text).find((f) => /^(pip[-_]audit|cargo\s+audit|cargo-audit|uv\s+audit|safety)\b/.test(f)) ?? c.text
      const flags = /^safety\s/.test(form) ? /\s(?:--ignore|-i)[=\s]+(\S+)/g : /\s--ignore(?:-vuln|-until-fixed)?[=\s]+(\S+)/g
      const ids = [...` ${form}`.matchAll(flags)].map((m) => m[1])
      if (!ids.length) continue
      waived += ids.length
      problems.push(`"${c.text}" in ${c.where} ignores ${ids.join(', ')} on the command line, with no reason or expiry: move them to osv-scanner.toml`)
    }
    for (const w of ctx.repo.workflows()) {
      for (const job of w.jobs) {
        for (const st of job.steps.filter((x) => /^pypa\/gh-action-pip-audit@/.test(x.uses ?? '') && String(x.with?.['ignore-vulns'] ?? '').trim())) {
          const ids = String(st.with['ignore-vulns']).split(/[\s,]+/).filter(Boolean)
          waived += ids.length
          problems.push(`${w.file} (job ${job.id}) step "${st.name}" ignores ${ids.join(', ')} in ignore-vulns, with no reason or expiry: move them to osv-scanner.toml`)
        }
      }
    }
    if (!waived && !unreadable) return notApplicable('no advisory is waived anywhere')
    if (problems.length) return fail(...list(problems))
    const expiring = waived - noExpiry
    return pass(
      `${waived} waiver(s), each with a reason`,
      ...(expiring ? [`${expiring} with an expiry within ${MAX_WAIVER_DAYS} days`] : []),
      ...(noExpiry ? [`${noExpiry} in deny.toml, which can't hold an expiry: review them when you review the rest`] : []),
    )
  },

  'core.process-delivered': (ctx) => {
    const manifest = 'prompts/.apply-manifest.json'
    if (ctx.repo.has(manifest)) {
      let commit
      try {
        commit = JSON.parse(ctx.repo.read(manifest)).templateCommit
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
        return fail(`${manifest} isn't valid JSON, so a re-apply can't tell edits from deliveries`)
      }
      return pass(`delivered by process:apply${commit ? ` from template commit ${String(commit).slice(0, 12)}` : ''}`)
    }
    const pkg = ctx.repo.pkg('.')
    if (pkg && !pkg.invalid && pkg.templateVersion) return pass(`started from the template at ${pkg.templateVersion}`)
    // On disk, not in the file list: the template's skeletons directory is left out of that.
    const onDisk = (p) => existsSync(join(ctx.repo.root, p))
    if (onDisk('scripts/apply-process.mjs') && onDisk('templates/project/AGENTS.skeleton.md')) return pass('the template itself')
    return fail(`no ${manifest} and no templateVersion in package.json: the process was never delivered`)
  },

  'node.runtime-pinned': (ctx) => {
    const { pkg, result } = packageAt(ctx)
    if (result) return result
    const pin = nodePin(ctx)
    const range = typeof pkg.engines?.node === 'string' ? pkg.engines.node : null
    const problems = []
    if (!pin) problems.push('no .nvmrc, .node-version, .tool-versions, or mise.toml pin for Node')
    else if (!/^v?\d+(\.\d+){0,2}$/.test(pin.value)) problems.push(`${pin.file} says "${pin.value}", a floating alias, not a version`)
    if (!range) problems.push(`no engines.node in ${posix.join(ctx.path, 'package.json')}`)
    if (problems.length) return fail(...problems)
    try {
      if (!satisfies(pin.value, range)) return fail(`${pin.file} pins ${pin.value}, outside engines.node "${range}"`)
    } catch (error) {
      if (!(error instanceof Error) || !/^(Unsupported engines range|Not a version)/.test(error.message)) throw error
      return skip(`${pin.file} pins ${pin.value}; engines.node is "${range}", a form this check can't compare (it reads ^ and >= ranges, joined by ||)`)
    }
    return pass(`${pin.file} pins ${pin.value}, inside engines.node "${range}"`)
  },

  'node.ci-uses-pin': (ctx) => {
    const { pkg, result } = packageAt(ctx)
    if (result) return result
    const range = typeof pkg.engines?.node === 'string' ? pkg.engines.node : null
    let floorVersion = null
    let readable = true
    try {
      floorVersion = range ? floor(range) : null
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('Unsupported engines range')) throw error
      readable = false
    }
    const unreadable = `engines.node "${range}" is a form this check can't compare`
    const fits = (v) => {
      try {
        return range ? satisfies(String(v), range) : false
      } catch (error) {
        if (!(error instanceof Error)) throw error
        return false
      }
    }
    const ok = []
    const bad = []
    const unknown = []
    let steps = 0
    for (const w of ctx.repo.workflows()) {
      for (const job of w.jobs) {
        for (const step of job.steps.filter((s) => /^actions\/setup-node@/.test(s.uses ?? ''))) {
          steps++
          const where = `${w.file} (job ${job.id})`
          const file = step.with['node-version-file']
          const version = step.with['node-version']
          if (file) {
            if (ctx.repo.has(joinDir('.', String(file)))) ok.push(`${where}: node-version-file ${file}`)
            else bad.push(`${where}: node-version-file ${file}, which doesn't exist`)
          } else if (version === undefined || version === null || version === '') {
            bad.push(`${where}: setup-node with no version, so it uses the runner image's`)
          } else {
            const matrix = /^\$\{\{\s*matrix\.([\w-]+)\s*\}\}$/.exec(String(version).trim())
            if (matrix) {
              const values = job.matrix[matrix[1]]
              if (!Array.isArray(values) || !values.length || values.some((v) => typeof v !== 'string' && typeof v !== 'number')) {
                bad.push(`${where}: node-version ${version}, a matrix this check can't read`)
              } else if (!readable) unknown.push(`${where}: matrix ${values.join(', ')}; ${unreadable}`)
              else if (values.every(fits)) ok.push(`${where}: matrix ${values.join(', ')}, all inside engines.node`)
              else bad.push(`${where}: matrix ${values.join(', ')}, not all inside engines.node "${range ?? '(none)'}"`)
            } else if (String(version).includes('${{')) {
              bad.push(`${where}: node-version ${version}, an expression this check can't read; use node-version-file`)
            } else if (floorVersion && sameVersion(version, floorVersion)) {
              ok.push(`${where}: ${version}, exactly the engines floor`)
            } else if (!readable) {
              unknown.push(`${where}: node-version ${version}; it may be the engines floor, but ${unreadable}`)
            } else bad.push(`${where}: node-version ${version}, written into the workflow instead of read from the pin`)
          }
        }
      }
    }
    if (!steps) {
      const node = matching([...ctx.repo.ci(['pull_request', 'push']).commands], NODE_IN_CI)
      if (node.length) return fail(`CI runs Node with no actions/setup-node step, so it uses the runner image's version (${node[0].where})`)
      return notApplicable('no workflow runs Node')
    }
    if (bad.length) return fail(...list(bad), ...ok.slice(0, 3))
    return unknown.length ? { status: 'skipped', evidence: [...list(unknown), ...ok.slice(0, 3)] } : pass(...list(ok))
  },

  'node.ci-runs-gate': (ctx) => {
    const { pkg, result } = packageAt(ctx)
    if (result) return result
    const { commands, ignored, reached } = ctx.repo.ci(PR)
    const scoped = forPath(commands, ctx.path)
    const usesTs = hasDep(deps(pkg), 'typescript') || ctx.repo.has(posix.join(ctx.path, 'tsconfig.json'))
    const gates = [
      ['linter', LINT, true],
      ['type checker', TYPECHECK, usesTs],
      ['test runner', TEST_RUNNER, true],
    ]
    const missing = []
    const found = []
    for (const [what, re, needed] of gates) {
      if (!needed) continue
      const hit = matching(scoped, re)[0]
      if (hit) found.push(`${what}: "${hit.text}" in ${hit.where}`)
      else missing.push(`no ${what} runs in a pull_request workflow`, ...silencedCopies(forPath(ignored, ctx.path), re))
    }
    if (typeof pkg.scripts?.build === 'string') {
      if (reached.has(`${ctx.path}\0build`) || scoped.some((c) => c.text === pkg.scripts.build.trim())) found.push('the build script')
      else missing.push(`the build script ("${pkg.scripts.build}") never runs in a pull_request workflow`)
    }
    if (!ctx.repo.workflows().some((w) => w.events.has('pull_request'))) return fail('no pull_request workflow (core.ci-on-pull-requests)', ...pathHint(ctx, pkg))
    return missing.length ? fail(...missing, ...found, ...pathHint(ctx, pkg)) : pass(...found)
  },

  'node.test-suites-in-ci': (ctx) => {
    const { pkg, result } = packageAt(ctx)
    if (result) return result
    const d = deps(pkg)
    const playwrightConfig = ctx.repo.files.some((f) => posix.dirname(f) === ctx.path && /^playwright\.config\.[cm]?[jt]s$/.test(posix.basename(f)))
    const runners = [
      ['Vitest', hasDep(d, 'vitest'), /^vitest(\s|$)/],
      ['Jest', hasDep(d, 'jest') || hasDep(d, 'jest-expo'), /^jest(\s|$)/],
      ['Playwright Test', hasDep(d, '@playwright/test') || hasDep(d, 'playwright-bdd') || playwrightConfig, /^playwright\s+test\b|^bddgen\b/],
      ['Cypress', hasDep(d, 'cypress'), /^cypress\s+run\b/],
    ].filter(([, installed]) => installed)
    if (!runners.length) return notApplicable('no test runner installed')
    const { commands, ignored } = ctx.repo.ci(PR)
    const scoped = forPath(commands, ctx.path)
    const missing = []
    const found = []
    for (const [name, , re] of runners) {
      const hit = matching(scoped, re)[0]
      if (hit) found.push(`${name}: ${hit.where}`)
      else missing.push(`${name} is installed but no pull_request workflow runs it`, ...silencedCopies(forPath(ignored, ctx.path), re))
    }
    return missing.length ? fail(...missing, ...found) : pass(...found)
  },

  'node.install-guards': (ctx) => {
    const { pkg, result } = packageAt(ctx)
    if (result) return result
    // A workspace installs from its workspace root, whose package.json, lockfile, and .npmrc
    // decide (npm ignores a workspace's own .npmrc).
    // A glob ending in /** matches its own directory too (as `dir/`), for npm's and pnpm's globs.
    const matches = (glob) => globMatcher(glob)(ctx.path) || (glob.endsWith('/**') && globMatcher(glob)(`${ctx.path}/`))
    // npm's map-workspaces: an odd run of !s negates; a later pattern that an earlier negation
    // matches (as text) lifts it; the negations left drop the patterns they match as text, and
    // exclude the directories they match. pnpm excludes whatever a negation matches, wherever it
    // stands.
    const npmListed = (globs) => {
      // As text, a trailing / counts, as minimatch has it: apps/*/ matches apps/web/, not apps/**.
      const asText = (n, t) => (n.endsWith('/') ? t.endsWith('/') && globMatcher(n.slice(0, -1))(t.slice(0, -1)) : globMatcher(n)(t.replace(/\/$/, '')))
      const dir = (glob) => glob.replace(/\/$/, '')
      const include = []
      let exclude = []
      for (const raw of globs.filter((w) => typeof w === 'string')) {
        const bangs = /^!*/.exec(raw)[0].length
        const glob = raw.slice(bangs).replace(/^\.?\/+/, '')
        if (bangs % 2) exclude.push(glob)
        else {
          exclude = exclude.filter((n) => !asText(n, glob))
          include.push(glob)
        }
      }
      const kept = include.filter((glob) => !exclude.some((n) => asText(n, glob)))
      return kept.map(dir).some(matches) && !exclude.map(dir).some(matches)
    }
    const pnpmListed = (globs) => {
      const strip = (w) => w.replace(/^!/, '').replace(/^\.?\/+/, '').replace(/\/$/, '')
      const strings = globs.filter((w) => typeof w === 'string')
      return strings.some((w) => !w.startsWith('!') && matches(strip(w))) && !strings.some((w) => w.startsWith('!') && matches(strip(w)))
    }
    const rootPkg = ctx.path === '.' ? null : ctx.repo.pkg('.')
    let pnpmGlobs = []
    try {
      pnpmGlobs = [loadYaml().parse(ctx.repo.read('pnpm-workspace.yaml') ?? '')?.packages ?? []].flat()
    } catch (error) {
      if (!(error instanceof loadYaml().YAMLError)) throw error // the pnpm branch reports it
    }
    const npmGlobs = rootPkg && !rootPkg.invalid ? [rootPkg.workspaces ?? []].flat().concat(rootPkg.workspaces?.packages ?? []) : []
    const member = ctx.path !== '.' && (npmListed(npmGlobs) || pnpmListed(pnpmGlobs))
    const base = member ? '.' : ctx.path
    const owner = member && rootPkg && !rootPkg.invalid ? rootPkg : pkg
    const at = (f) => posix.join(base, f)
    const pm = typeof owner.packageManager === 'string' ? owner.packageManager : ''
    const dev = [owner.devEngines?.packageManager ?? []].flat().find((o) => typeof o?.name === 'string')
    const named = /^([a-z]+)@/.exec(pm)?.[1] ?? dev?.name
    const kind = named ?? (ctx.repo.has(at('pnpm-lock.yaml')) ? 'pnpm' : ctx.repo.has(at('yarn.lock')) ? 'yarn' : ctx.repo.has(at('bun.lock')) || ctx.repo.has(at('bun.lockb')) ? 'bun' : 'npm')
    if (kind !== 'npm' && kind !== 'pnpm') return skip(`${kind}: this check reads npm's and pnpm's settings only`)
    const DAYS = 3 // core.dependency-cooldown's bar
    if (kind === 'pnpm') {
      const file = at('pnpm-workspace.yaml')
      const text = ctx.repo.read(file)
      let config = {}
      if (text !== null) {
        try {
          config = loadYaml().parse(text) ?? {}
        } catch (error) {
          if (!(error instanceof loadYaml().YAMLError)) throw error
          return fail(`${file} doesn't parse: ${error.message.split('\n')[0]}`)
        }
      }
      const problems = []
      const age = config.minimumReleaseAge // minutes
      if (!(typeof age === 'number' && age >= DAYS * 1440)) problems.push(`${file} sets no minimumReleaseAge of ${DAYS * 1440} minutes (${DAYS} days) or more${age === undefined ? '' : ` (it's ${JSON.stringify(age)})`}`)
      if (config.blockExoticSubdeps !== true) problems.push(`${file} doesn't set blockExoticSubdeps: true, so a dependency can bring in a git or tarball dependency of its own`)
      return problems.length ? fail(...problems) : pass(`${file}: minimumReleaseAge ${age} minutes, blockExoticSubdeps`)
    }
    // Read as npm's ini parser reads it: an unquoted value ends at a ; or a #.
    const file = at('.npmrc')
    const settings = {}
    for (const line of (ctx.repo.read(file) ?? '').split(/\r?\n/)) {
      const m = /^\s*([^#;=\s][^=]*?)\s*=\s*(.*?)\s*$/.exec(line)
      if (m) settings[m[1]] = /^(["'])(.*)\1$/.exec(m[2])?.[2] ?? m[2].replace(/[;#].*$/, '').trim()
    }
    const version = /^npm@(\d+)\.(\d+)\.\d+/.exec(pm) ?? /^\D*(\d+)\.(\d+)\.\d+$/.exec(dev?.name === 'npm' ? String(dev.version ?? '') : '')
    const [major, minor] = version ? [Number(version[1]), Number(version[2])] : [null, null]
    const problems = []
    const days = Number(settings['min-release-age'])
    if (!(settings['min-release-age'] !== undefined && days >= DAYS)) {
      problems.push(`${file} sets no min-release-age of ${DAYS} days or more${settings['min-release-age'] === undefined ? '' : ` (it's ${settings['min-release-age']})`}`)
    }
    const git = settings['allow-git'] ?? (major !== null && major >= 12 ? 'none' : 'all') // npm 12 refuses git by default
    if (git !== 'root' && git !== 'none') problems.push(`${file} lets a dependency bring in a git dependency of its own (allow-git=${git}; set it to root or none)`)
    const remote = settings['allow-remote'] ?? (major !== null && major >= 12 ? 'none' : 'all') // and URL tarballs too
    if (remote !== 'root' && remote !== 'none') problems.push(`${file} lets a dependency bring in a tarball from any URL (allow-remote=${remote}; set it to root or none)`)
    if (major === null) problems.push('nothing pins npm 11.15 or later (packageManager, or devEngines.packageManager with an exact version), and an older npm ignores these settings')
    else if (major < 11 || (major === 11 && minor < 15)) problems.push(`npm ${major}.${minor} is pinned, which ignores min-release-age (npm 11.10), allow-git (11.9), or allow-remote (11.14, fixed in 11.15)`)
    return problems.length ? fail(...problems) : pass(`${file}: min-release-age=${settings['min-release-age']}, allow-git=${git}, allow-remote=${remote}, npm ${major}.${minor}`)
  },

  'node.audit-gate': (ctx) => {
    const { result } = packageAt(ctx)
    if (result) return result
    const pr = ctx.repo.ci(PR)
    const scheduled = ctx.repo.ci(['schedule'])
    const onPr = matching(forPath(pr.commands, ctx.path), AUDIT)[0]
    const onSchedule = matching(forPath(scheduled.commands, ctx.path), AUDIT)[0]
    const problems = []
    if (!onPr) problems.push('no dependency audit in a pull_request workflow step that can fail', ...silencedCopies(forPath(pr.ignored, ctx.path), AUDIT))
    if (!onSchedule) problems.push('no dependency audit in a workflow with a schedule trigger', ...silencedCopies(forPath(scheduled.ignored, ctx.path), AUDIT))
    const found = [onPr && `on pull requests: ${onPr.where}`, onSchedule && `on a schedule: ${onSchedule.where}`].filter(Boolean)
    return problems.length ? fail(...problems, ...found) : pass(...found)
  },

  'node.unused-code': (ctx) => {
    const { result } = packageAt(ctx)
    if (result) return result
    const { commands, ignored } = ctx.repo.ci(PR)
    const re = /^knip(\s|$)/
    // --no-exit-code reports and never fails.
    const hit = matching(forPath(commands, ctx.path), re).find((c) => !/\s--no-exit-code\b/.test(c.text))
    if (hit) return pass(`"${hit.text}" in ${hit.where}`)
    return fail('no pull_request workflow runs knip where it can fail the run', ...silencedCopies(forPath(ignored, ctx.path), re))
  },

  'node.strict-types': (ctx) => {
    const { result } = packageAt(ctx)
    if (result) return result
    const config = ['tsconfig.json', 'jsconfig.json'].map((f) => posix.join(ctx.path, f)).find((f) => ctx.repo.has(f))
    const base = config && join(ctx.repo.root, config)
    if (!base) return fail(`no tsconfig.json or jsconfig.json in ${ctx.path === '.' ? 'the root' : ctx.path}, so nothing typechecks the project`, ...pathHint(ctx, ctx.repo.pkg(ctx.path)))
    const rel = (p) => toPosix(relative(ctx.repo.root, p))
    const configs = tsConfigs(base)
    const unreadable = configs.filter((c) => c.problem)
    if (unreadable.length) {
      return skip(`couldn't read ${unreadable.map((c) => `${rel(c.path)} (${c.problem})`).join('; ')}; a config that extends a package needs the repository's dependencies installed`)
    }
    const problems = []
    const ok = []
    let compiled = 0
    for (const c of configs) {
      const files = c.fileNames.filter((f) => !f.split(/[\\/]/).includes('node_modules'))
      const tsFiles = files.filter((f) => /\.(ts|tsx|mts|cts)$/.test(f) && !/\.d\.[cm]?ts$/.test(f))
      const jsFiles = files.filter((f) => /\.(js|jsx|mjs|cjs)$/.test(f))
      if (!tsFiles.length && !jsFiles.length) continue
      compiled++
      if (tsFiles.length) {
        if (c.options.strict) ok.push(`${rel(c.path)}: strict (${tsFiles.length} TypeScript files)`)
        else problems.push(`${rel(c.path)}: strict is off for ${tsFiles.length} TypeScript files${jsFiles.length && c.options.checkJs ? ` (checkJs is on for its ${jsFiles.length} JavaScript files; the TypeScript ones still need strict)` : ''}`)
      } else if (c.options.checkJs) ok.push(`${rel(c.path)}: checkJs (${jsFiles.length} JavaScript files)`)
      else problems.push(`${rel(c.path)}: compiles ${jsFiles.length} JavaScript files with checkJs off`)
    }
    if (!compiled) return fail(`${rel(base)} and the configs it references compile no source files`)
    return problems.length ? fail(...problems, ...ok) : pass(...ok)
  },

  'vite-spa.client-env': clientEnv,

  'vite-spa.bundle-budget': (ctx) => {
    const { commands, ignored } = ctx.repo.ci(PR)
    const re = /^(size-limit|bundlesize|bundlewatch)(\s|$)|^node\s+(\S*\/)?check-bundle-size\.mjs\b/
    const hit = matching(forPath(commands, ctx.path), re)[0]
    if (hit) return pass(`"${hit.text}" in ${hit.where}`)
    // The size-limit action posts a comment; whether it fails the run isn't read here.
    const action = actionSteps(ctx, PR, /^andresz1\/size-limit-action@/)[0]
    if (action) return skip(`${action.uses} in ${action.where}: this check can't tell whether it fails the run`)
    return fail('no pull_request workflow checks the bundle against a size budget where it can fail the run', ...silencedCopies(forPath(ignored, ctx.path), re))
  },

  'supabase.migration-names': (ctx) => {
    const { dir, files } = migrations(ctx)
    if (!files.length) return notApplicable(`no migrations in ${dir}/ yet`)
    const bad = files.filter((f) => !/^\d{14}_[\w-]+\.sql$/.test(f.split('/').pop()))
    return bad.length ? fail(`${bad.length} of ${files.length} migration(s) the CLI can't order:`, ...list(bad)) : pass(`${files.length} migrations, all <timestamp>_<name>.sql`)
  },

  'supabase.rls-on-every-table': (ctx) => {
    const { count, tables } = supabaseTables(ctx)
    if (!tables.length) return notApplicable(count ? `${count} migrations create no public table` : 'no migrations yet')
    const open = tables.filter(([, t]) => !t.rls).map(([name, t]) => `${name} (created in ${t.file})`)
    return open.length ? fail(`${open.length} of ${tables.length} public tables without row-level security:`, ...list(open, 15)) : pass(`all ${tables.length} public tables enable row-level security`)
  },

  'supabase.explicit-grants': (ctx) => {
    const { tables } = supabaseTables(ctx)
    const late = tables.filter(([, t]) => t.version >= GRANTS_FROM)
    if (!late.length) return notApplicable(`no public table created by a migration dated ${GRANTS_FROM.slice(0, 8)} or later`)
    const silent = late.filter(([, t]) => !t.exposure && !t.defaultGrant).map(([name, t]) => `${name} (created in ${t.file})`)
    return silent.length ? fail(`${silent.length} new public table(s) with no grant or revoke, invisible to the Data API:`, ...list(silent)) : pass(`${late.length} new public tables, each with its grants`)
  },

  'supabase.db-tests-in-ci': (ctx) => {
    const dir = posix.join(ctx.path, 'supabase/tests/')
    const tests = ctx.repo.files.filter((f) => f.startsWith(posix.normalize(dir)) && f.endsWith('.sql'))
    if (!tests.length) return fail(`no SQL tests under ${dir}`)
    const { commands, ignored } = ctx.repo.ci(PR)
    const re = /^supabase\s+test\s+db\b|^pg_prove\b/
    const hit = matching(commands, re)[0]
    return hit
      ? pass(`${tests.length} SQL test file(s), run in ${hit.where}`)
      : fail(`${tests.length} SQL test file(s), but no pull_request workflow runs supabase test db or pg_prove`, ...silencedCopies(ignored, re))
  },

  'supabase.advisors-in-ci': (ctx) => {
    const all = ctx.repo.workflows().flatMap((w) => [...w.events])
    const { commands, ignored } = ctx.repo.ci([...new Set(all)])
    const re = /^supabase\s+db\s+(advisors|lint)\b/
    const lints = matching(commands, re)
    const failing = lints.find((c) => {
      const level = /--fail-on(?:=|\s+)(\S+)/.exec(c.text)?.[1]
      return level && level.replace(/['"]/g, '') !== 'none'
    })
    if (failing) return pass(`"${failing.text}" in ${failing.where}`)
    if (lints.length) return fail(...lints.map((c) => `"${c.text}" in ${c.where} has no --fail-on (or --fail-on none), so it reports and never fails`))
    return fail('no workflow runs supabase db advisors or supabase db lint', ...silencedCopies(ignored, re))
  },

  'supabase.function-tests-in-ci': (ctx) => {
    const dir = posix.normalize(posix.join(ctx.path, 'supabase/functions/'))
    const tests = ctx.repo.files.filter((f) => f.startsWith(dir) && /(\.test|_test)\.[cm]?[jt]sx?$/.test(f))
    if (!tests.length) return notApplicable('no Edge Function tests')
    const { commands, ignored } = ctx.repo.ci(PR)
    const hit = matching(commands, /^deno\s+test\b/)[0]
    return hit
      ? pass(`${tests.length} test file(s), run in ${hit.where}`)
      : fail(`${tests.length} Edge Function test file(s), but no pull_request workflow runs deno test:`, ...list(tests, 5), ...silencedCopies(ignored, /^deno\s+test\b/))
  },

  'python.locked-dependencies': (ctx) => {
    const at = (f) => posix.normalize(posix.join(ctx.path, f))
    const exists = (f) => ctx.repo.has(at(f))
    const lock = ['uv.lock', 'poetry.lock', 'pdm.lock', 'Pipfile.lock', 'pylock.toml'].find(exists)
    const problems = []
    const ok = []
    let declared = 0
    if (exists('pyproject.toml')) {
      const text = ctx.repo.read(at('pyproject.toml'))
      const pep621 = /^\s*dependencies\s*=\s*\[\s*["']/m.test(text)
      const poetry = /^\[tool\.poetry\.dependencies\][^[]*^(?!\s*python\s*=)\s*[\w.-]+\s*=/m.test(text)
      if (pep621 || poetry) {
        declared++
        if (lock) ok.push(`pyproject.toml dependencies locked by ${lock}`)
        else problems.push(`${at('pyproject.toml')} declares dependencies and there's no lockfile (uv.lock, poetry.lock, pdm.lock)`)
      }
    }
    if (exists('Pipfile')) {
      declared++
      if (exists('Pipfile.lock')) ok.push('Pipfile locked by Pipfile.lock')
      else problems.push(`${at('Pipfile')} with no Pipfile.lock`)
    }
    const prefix = ctx.path === '.' ? '' : `${ctx.path}/`
    const requirementsFile = (f) => f.startsWith(prefix) && /(^|\/)requirements[^/]*\.txt$/.test(f) && !/(^|\/)(\.?venv|site-packages|node_modules)\//.test(f)
    for (const file of ctx.repo.files.filter(requirementsFile)) {
      const lines = ctx.repo.read(file)
        .split(/\r?\n/)
        .map((l) => l.replace(/\s+#.*$/, '').trim())
        .filter((l) => l && !l.startsWith('#') && !l.startsWith('-'))
      if (!lines.length) continue
      declared++
      const loose = lines.filter((l) => !/===?/.test(l) && !/^(git\+|https?:|file:|\.{0,2}\/)/.test(l))
      if (loose.length) problems.push(`${file}: ${loose.length} of ${lines.length} requirement(s) not pinned with ==: ${list(loose, 5).join(', ')}`)
      else ok.push(`${file}: ${lines.length} requirement(s), all pinned`)
    }
    if (!declared) return notApplicable('no third-party dependencies declared')
    return problems.length ? fail(...problems, ...ok) : pass(...ok)
  },

  'python.audit-gate': (ctx) => {
    const at = (f) => posix.normalize(posix.join(ctx.path, f))
    const prefix = ctx.path === '.' ? '' : `${ctx.path}/`
    const text = (f) => ctx.repo.read(at(f)) ?? ''
    const declared =
      ['uv.lock', 'poetry.lock', 'pdm.lock', 'Pipfile.lock', 'pylock.toml', 'Pipfile'].some((f) => ctx.repo.has(at(f))) ||
      /^\s*dependencies\s*=\s*\[\s*["']/m.test(text('pyproject.toml')) ||
      // Poetry's dependencies table, past Python itself; a pyproject.toml that doesn't parse can't
      // be shown to declare none.
      (parseConfigFile('pyproject.toml', text('pyproject.toml')) === null && text('pyproject.toml').trim() !== '') ||
      Object.keys(parseConfigFile('pyproject.toml', text('pyproject.toml'))?.tool?.poetry?.dependencies ?? {}).some((k) => k !== 'python') ||
      ctx.repo.files.some(
        (f) =>
          f.startsWith(prefix) &&
          /(^|\/)requirements[^/]*\.txt$|(^|\/)requirements\/[^/]+\.txt$/.test(f) &&
          !/(^|\/)(\.?venv|site-packages|node_modules)\//.test(f) &&
          ctx.repo.read(f).split(/\r?\n/).some((l) => l.trim() && !/^\s*[#-]/.test(l)),
      )
    if (!declared) return notApplicable('no third-party dependencies declared')
    const re = /^pip[-_]audit(\s|$)|^uv\s+audit\b|^osv-scanner(\s|$)|^safety\s+(check|scan)\b/
    const action = /^(pypa\/gh-action-pip-audit|google\/osv-scanner-action(\/[\w./-]+)?)@/
    // Inputs that keep an audit from failing the run: the pip-audit action's escape hatch, and the
    // OSV reusable workflow's fail-on-vuln.
    const canFail = (inputs) => !/^\s*true\s*$/i.test(String(inputs?.['internal-be-careful-allow-failure'] ?? '')) && !off(inputs?.['fail-on-vuln'])
    const reusable = /^google\/osv-scanner-action\/\.github\/workflows\/[\w.-]+\.ya?ml@/
    const problems = []
    const found = []
    for (const [events, on, missing] of [
      [PR, 'on pull requests', 'no Python dependency audit in a pull_request workflow step that can fail'],
      [['schedule'], 'on a schedule', 'no Python dependency audit in a workflow with a schedule trigger'],
    ]) {
      const { commands, ignored } = ctx.repo.ci(events)
      const called = ctx.repo
        .workflows()
        .filter((w) => events.some((e) => w.events.has(e)))
        .flatMap((w) => w.jobs.filter((j) => !j.never && reusable.test(j.uses ?? '') && canFail(j.with)).map((j) => ({ uses: j.uses, where: `${w.file} (job ${j.id})` })))
      const hit = matching(commands, re)[0] ?? actionSteps(ctx, events, action, canFail)[0] ?? called[0]
      if (hit) found.push(`${on}: ${hit.text ?? hit.uses} in ${hit.where}`)
      else problems.push(missing, ...silencedCopies(ignored, re))
    }
    return problems.length ? fail(...problems, ...found) : pass(...found)
  },

  'python.tests-in-ci': (ctx) => {
    const prefix = ctx.path === '.' ? '' : `${ctx.path}/`
    const tests = ctx.repo.files.filter(
      (f) =>
        f.startsWith(prefix) &&
        f.endsWith('.py') &&
        !/(^|\/)(\.?venv|site-packages)\//.test(f) &&
        (/(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(f) || /(^|\/)tests?\//.test(f.slice(prefix.length))),
    )
    if (!tests.length) return fail(`no Python tests (test_*.py, *_test.py, or tests/) under ${ctx.path === '.' ? 'the root' : ctx.path}`)
    const { commands, ignored } = ctx.repo.ci(PR)
    const re = /^(pytest|tox|nox)(\s|$)|^python[0-9.]*\s+-m\s+(pytest|unittest)\b|^python[0-9.]*\s+\S*test\S*\.py\b/
    const hit = matching(commands, re)[0]
    return hit ? pass(`${tests.length} test file(s), run in ${hit.where}`) : fail(`${tests.length} test file(s), but no pull_request workflow runs them`, ...silencedCopies(ignored, re))
  },
  'static-site.security-headers': (ctx) => {
    const { configs, rules, served } = hostConfig(ctx)
    if (!configs.length) {
      const pages = ctx.repo.workflows().some((w) => w.jobs.some((j) => j.steps.some((st) => /^actions\/deploy-pages@/.test(st.uses ?? ''))))
      return pages ? skip("hosted on GitHub Pages, which can't set response headers") : notApplicable('no host config to set headers in')
    }
    const all = rules.filter((r) => coversPages(r.pattern))
    const header = (name) => all.map((r) => r.headers.get(name)).find((v) => v !== undefined)
    const missing = []
    if (!header('content-security-policy') && !metaCsp(ctx, served)) missing.push('Content-Security-Policy')
    if (!/nosniff/i.test(header('x-content-type-options') ?? '')) missing.push('X-Content-Type-Options: nosniff')
    if (!header('referrer-policy')) missing.push('Referrer-Policy')
    if (!/frame-ancestors/i.test(header('content-security-policy') ?? '') && !header('x-frame-options')) missing.push('frame-ancestors in the CSP, or X-Frame-Options')
    const where = configs.join(', ')
    if (missing.length) return fail(`no rule for every page in ${where} sets: ${missing.join('; ')}`)
    return pass(`${where} sets the CSP, nosniff, Referrer-Policy, and frame protection for every page`)
  },

  'static-site.served-files-deployed': (ctx) => {
    const { served } = hostConfig(ctx)
    if (served === null) return notApplicable('no host config names the directory it serves')
    if (served === ctx.path) return notApplicable('the host serves the repository as it is')
    const under = (f) => ctx.path === '.' || f.startsWith(`${ctx.path}/`)
    const problems = []
    const ok = []
    for (const name of ['robots.txt', 'sitemap.xml']) {
      const kept = ctx.repo.files.filter((f) => posix.basename(f) === name && under(f) && !f.split('/').includes('node_modules'))
      if (!kept.length) continue
      // The build's source dirs sit at the pack's root, or beside the served dir (Netlify's base).
      const sources = [ctx.path, posix.dirname(served)].flatMap((d) => [posix.join(d, 'public'), posix.join(d, 'static')])
      const home = [served, ...sources].map((d) => posix.join(d, name)).find((h) => ctx.repo.has(h))
      if (home) ok.push(`${name}: ${home}`)
      else problems.push(`${kept[0]} isn't in ${served}/, the directory the host serves, or in public/ or static/, which a build copies into it`)
    }
    if (!problems.length && !ok.length) return notApplicable('keeps no robots.txt or sitemap.xml')
    return problems.length ? fail(...problems, ...ok) : pass(...ok)
  },

  'static-site.html-checked-in-ci': (ctx) => {
    const { commands, ignored } = ctx.repo.ci(PR)
    const re = /^(html-validate|htmlhint|vnu|lychee|linkinator|htmltest|htmlproofer)(\s|$)|^java\s.*\bvnu\.jar\b/
    // lychee-action reports broken links and passes with `fail: false`, which is v1's default.
    const lycheeFails = (w, uses, file) => (actionMajor(ctx, uses, file) === '1' ? String(w.fail).trim() === 'true' : !off(w.fail))
    const hit =
      matching(commands, re).find((c) => !/\s--exit-zero(-always)?\b/.test(c.text)) ?? actionSteps(ctx, PR, /^lycheeverse\/lychee-action@/, lycheeFails)[0]
    if (hit) return pass(`${hit.text ?? hit.uses} in ${hit.where}`)
    return fail('no pull_request workflow validates the HTML or checks its links', ...silencedCopies(ignored, re))
  },

  'writing.prose-checks-in-ci': (ctx) => {
    const runs = proseRuns(ctx)
    const hit = runs.failing[0] ?? runs.actions[0]
    if (hit) return pass(`${hit.text ?? hit.uses} in ${hit.where}`)
    if (!ctx.repo.workflows().some((w) => w.events.has('pull_request'))) return fail('no pull_request workflow (core.ci-on-pull-requests), so nothing checks the prose on a change')
    return fail('no pull_request workflow runs a prose check', ...runs.idle, ...runs.unresolved, ...silencedCopies(runs.ignored, runs.re))
  },

  'writing.vocabulary-registered': (ctx) => {
    const runs = proseRuns(ctx)
    if (!runs.failing.length && !runs.actions.length) return notApplicable('no prose check runs on pull requests (writing.prose-checks-in-ci)')
    const read = []
    for (const c of runs.failing) {
      const form = commandForms(c.text).find((f) => /^(cspell|vale)(\s|$)/.test(f) && !PROSE_NOT_A_CHECK.test(f))
      if (form) read.push(form.startsWith('cspell') ? cspellVocabulary(ctx, { ...c, form }) : valeVocabulary(ctx, { ...c, form }))
    }
    for (const a of runs.actions) {
      if (a.tool === 'cspell') read.push(cspellVocabulary(ctx, a))
      if (a.tool === 'vale') read.push(valeVocabulary(ctx, a))
    }
    const own = runs.failing.filter((c) => c.script)
    if (ctx.vocabulary) read.push(ownVocabulary(ctx, ctx.vocabulary, own))
    if (!read.length) {
      if (own.length) {
        return skip(`the prose is checked by the repository's own checker (${own.map((c) => c.script).join(', ')}): name its lists in ${CONFIG} "vocabulary" ({ "accept": [...], "reject": [...] }) to have them checked`)
      }
      return fail(
        "the prose checks pull requests run read no vocabulary: markdownlint's proper-names rule only fixes the casing of the names it lists, and textlint's prh isn't counted. Run cspell or Vale with an accept and a reject list",
      )
    }
    const all = (k) => read.flatMap((v) => v[k] ?? [])
    const [accept, reject, problems, skips, notes] = [all('accept'), all('reject'), all('problems'), all('skipped'), all('notes')]
    // Each Markdown file a run checks gets both lists or neither: a list that reaches only some of
    // them lets a retired or an unregistered name through in the rest. The repository's own
    // checker's lists count for every file.
    const mine = read.find((v) => v.own)
    const cover = new Map()
    for (const [doc, c] of read.flatMap((v) => [...(v.cover ?? [])])) {
      const was = cover.get(doc) ?? { accept: Boolean(mine?.accept.length), reject: Boolean(mine?.reject.length) }
      cover.set(doc, { accept: was.accept || c.accept, reject: was.reject || c.reject })
    }
    const gaps = [
      ['accept', 'reject', 'an accept list but no reject list'],
      ['reject', 'accept', 'a reject list but no accept list'],
    ].flatMap(([has, lacks, what]) => {
      const docs = [...cover].filter(([, c]) => c[has] && !c[lacks]).map(([doc]) => doc)
      return docs.length ? [`${docs.length} Markdown file(s) get ${what}: ${docs.slice(0, 3).join(', ')}${docs.length > 3 ? ', ...' : ''}`] : []
    })
    if (problems.length) return fail(...problems, ...accept, ...reject)
    if (gaps.length && !skips.length) return fail(...gaps, ...accept, ...reject, ...notes)
    if (accept.length && reject.length && !gaps.length) return pass(...accept, ...reject)
    if (skips.length) return skip(skips.join('; '))
    // A run with no list of its own is no fault while another run holds the lists; it's said here.
    return fail(
      ...(accept.length ? [] : ['no accept list: the names the prose uses are registered nowhere the check reads']),
      ...(reject.length ? [] : ['no reject list: the dictionary knows common names, so a retired name or a banned spelling comes back without a sound']),
      ...accept,
      ...reject,
      ...notes,
    )
  },

  'godot.tests-in-ci': (ctx) => {
    const under = (f) => ctx.path === '.' || f.startsWith(`${ctx.path}/`)
    const files = ctx.repo.files.filter(under)
    const suite = /^\s*extends\s+(?:GutTest\b|GdUnitTestSuite\b|["']res:\/\/addons\/(?:gut\/test\.gd|gdUnit4\/src\/GdUnitTestSuite\.gd)["'])/m
    const suites = files.filter((f) => f.endsWith('.gd') && !/(^|\/)addons\//.test(f) && suite.test(ctx.repo.read(f) ?? ''))
    const projects = files.filter((f) => f.endsWith('.csproj') && /\b(xunit|nunit|MSTest|gdUnit4)\b/i.test(ctx.repo.read(f) ?? ''))
    if (!suites.length && !projects.length) return fail(`no tests under ${ctx.path === '.' ? 'the project' : ctx.path}: no GUT or gdUnit4 suites, and no .NET test project`)
    const { commands, ignored } = ctx.repo.ci(PR)
    const re = /gut_cmdln\.gd|\bruntest(\.sh|\.cmd)?\b|^dotnet\s+test\b/
    const hit = matching(forPath(commands, ctx.path), re)[0] ?? actionSteps(ctx, PR, /^(godot-gdunit-labs|MikeSchulze)\/gdUnit4-action@/)[0]
    const found = `${suites.length} GDScript suite(s), ${projects.length} .NET test project(s)`
    if (!hit) return fail(`${found}, but no pull_request workflow runs them`, ...silencedCopies(forPath(ignored, ctx.path), re))
    // On a fresh checkout GUT's classes aren't imported yet, and gut_cmdln.gd exits 0 having run
    // nothing: the import has to run in the same job. The engine is any program named for it
    // (godot, godot4, Godot_v4.3-stable_linux.x86_64).
    const job = (c) => c.where.slice(0, c.where.indexOf(')') + 1)
    const imports = /(?:^|[\s/$"'{])[\w.-]*godot[\w.-]*\}?["']?\s(?:[^|;&]*\s)?(?:--import\b|--editor\b[^|;&]*--quit\b)/i
    if (/gut_cmdln\.gd/.test(hit.text ?? '') && !commands.some((c) => job(c) === job(hit) && imports.test(c.text))) {
      return fail(`GUT runs in ${hit.where} with no \`godot --headless --import\` in its job: on a fresh checkout it exits 0 having run nothing`)
    }
    return pass(`${found}, run in ${hit.where}`)
  },

  'godot.engine-pinned': (ctx) => {
    const project = posix.join(ctx.path, 'project.godot')
    const text = ctx.repo.read(project)
    if (text === null) return fail(`no ${project}`)
    const features = /^config\/features\s*=\s*PackedStringArray\(([^)]*)\)/m.exec(text)?.[1] ?? ''
    const version = /"(\d+\.\d+)"/.exec(features)?.[1]
    if (!version) return fail(`${project} names no engine version in config/features`)
    const named = []
    const under = (f) => ctx.path === '.' || f.startsWith(`${ctx.path}/`)
    for (const f of ctx.repo.files.filter((x) => x.endsWith('.csproj') && under(x))) {
      const sdk = /Godot\.NET\.Sdk\/(\d+\.\d+(?:\.\d+)?)/.exec(ctx.repo.read(f) ?? '')?.[1]
      if (sdk) named.push({ where: f, value: sdk })
    }
    for (const w of ctx.repo.workflows()) {
      for (const job of w.jobs) {
        for (const st of job.steps) {
          const pin = /setup-godot@/.test(st.uses ?? '') ? st.with.version : /gdUnit4-action@/.test(st.uses ?? '') ? st.with['godot-version'] : undefined
          if (pin !== undefined && /^\d+\.\d+/.test(String(pin))) named.push({ where: `${w.file} (job ${job.id})`, value: String(pin) })
        }
      }
      for (const m of (ctx.repo.read(w.file) ?? '').matchAll(/godot-ci:(?:mono-)?(\d+\.\d+(?:\.\d+)?)/g)) named.push({ where: w.file, value: m[1] })
    }
    if (!named.length) return notApplicable(`nothing besides ${project} (${version}) names an engine version`)
    const minor = (v) => v.split('.').slice(0, 2).join('.')
    const mismatched = named.filter((n) => minor(n.value) !== version)
    const show = (xs) => xs.map((n) => `${n.where}: ${n.value}`)
    if (mismatched.length) return fail(`${project} names ${version}; these name another version:`, ...show(mismatched))
    return pass(`${project} names ${version}, and so does each pin:`, ...show(named))
  },

  'expo.update-environment': (ctx) => {
    const events = [...new Set(ctx.repo.workflows().flatMap((w) => [...w.events]))]
    const { commands, ignored } = ctx.repo.ci(events)
    const scripts = Object.entries(ctx.repo.pkg(ctx.path)?.scripts ?? {})
      .filter(([, text]) => typeof text === 'string')
      .flatMap(([name, text]) => shellCommands(text, ctx.path).map((c) => ({ ...c, where: `${posix.join(ctx.path, 'package.json')} script "${name}"` })))
    const updates = matching([...commands, ...ignored, ...scripts], /^eas(-cli)?\s+update\b/)
    if (!updates.length) return notApplicable('nothing runs eas update')
    const show = (c) => `"${c.text}" in ${c.where}`
    const envFlag = /\s--environment(=|\s)/
    // A script's eas update gets --environment from its callers when every command that runs the
    // script passes the flag to it: after its name, and for npm after a lone `--` (npm keeps the
    // flags before that for itself).
    const call = (c, name) => {
      for (const form of commandForms(c.text)) {
        if (!scriptCalls(form).some((x) => x.name === name)) continue
        const words = form.split(/\s+/)
        const after = words.includes(name) ? words.slice(words.indexOf(name) + 1) : []
        const given = words[0] === 'npm' ? after.slice(after.indexOf('--') + 1 || after.length) : after
        return { passes: given.some((w) => /^--environment(=|$)/.test(w)) }
      }
      return null
    }
    const passedIn = (c) => {
      const name = [...c.where.matchAll(/script "([^"]+)"/g)].at(-1)?.[1]
      const calls = name ? [...commands, ...ignored, ...scripts].map((x) => call(x, name)).filter(Boolean) : []
      return calls.length > 0 && calls.every((x) => x.passes)
    }
    const bare = [...new Set(updates.filter((c) => !envFlag.test(c.text) && !passedIn(c)).map(show))]
    if (bare.length) return fail(...list(bare.map((x) => `${x} has no --environment, so in CI it's built from the runner's env and .env files`)))
    return pass(...list([...new Set(updates.map(show))]))
  },

  'expo.runtime-version': (ctx) => {
    const configFile = ['app.json', 'app.config.json'].map((f) => posix.join(ctx.path, f)).find((f) => ctx.repo.has(f))
    const appJson = configFile ? parseJson(ctx.repo.read(configFile)) : null
    if (configFile && (!appJson || typeof appJson !== 'object')) return fail(`${configFile} isn't a JSON object`)
    const expo = appJson?.expo ?? appJson ?? {}
    const usesUpdates = hasDep(deps(ctx.repo.pkg(ctx.path)), 'expo-updates') || typeof expo.updates?.url === 'string'
    if (!usesUpdates) return notApplicable("no expo-updates, so there's nothing to version")
    const set = [['runtimeVersion', expo.runtimeVersion], ['ios.runtimeVersion', expo.ios?.runtimeVersion], ['android.runtimeVersion', expo.android?.runtimeVersion]]
    const perPlatform = expo.ios?.runtimeVersion !== undefined && expo.android?.runtimeVersion !== undefined
    if (expo.runtimeVersion === undefined && !perPlatform) {
      const code = ctx.repo.files.some((f) => posix.dirname(f) === ctx.path && /^app\.config\.[cm]?[jt]s$/.test(posix.basename(f)))
      if (code) return skip("runtimeVersion isn't in app.json, and app.config.* is code this check doesn't run")
      return fail(`expo-updates is installed but ${configFile ?? posix.join(ctx.path, 'app.json')} sets no runtimeVersion for every platform`)
    }
    const strings = set.filter(([, v]) => typeof v === 'string').map(([k, v]) => `${k} is the string "${v}"`)
    if (strings.length) return fail(...strings, 'a hand-written runtime version has to be bumped on every native change; use a policy ({ "policy": "appVersion" })')
    const POLICIES = ['appVersion', 'nativeVersion', 'fingerprint', 'sdkVersion']
    const isPolicy = (v) => v && typeof v === 'object' && POLICIES.includes(v.policy)
    const bad = set.filter(([, v]) => v !== undefined && !isPolicy(v)).map(([k, v]) => `${k} isn't one of Expo's policies (${POLICIES.join(', ')}): ${JSON.stringify(v)}`)
    if (bad.length) return fail(...bad)
    return pass(...set.filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: policy ${v.policy}`))
  },

  'expo.client-env': clientEnv,

  'expo.doctor-in-ci': (ctx) => {
    const { commands, ignored } = ctx.repo.ci(PR)
    const re = /^expo-doctor(\s|$)|^expo\s+install\s(.*\s)?--check\b/
    const hit = matching(forPath(commands, ctx.path), re)[0]
    if (hit) return pass(`"${hit.text}" in ${hit.where}`)
    return fail('no pull_request workflow runs expo-doctor or expo install --check', ...silencedCopies(forPath(ignored, ctx.path), re))
  },

  'tauri.csp': (ctx) => {
    const t = tauriConfig(ctx)
    if (t.result) return t.result
    const security = t.config.app?.security ?? {}
    const csp = security.csp
    if (csp === undefined || csp === null || (typeof csp === 'string' && !csp.trim()) || (typeof csp === 'object' && !Object.keys(csp).length)) {
      return fail(`${t.file} sets no app.security.csp, and Tauri enables CSP only when it's set`)
    }
    // A directive's sources, '' when it names none, undefined when it's absent.
    const directive = (name) => {
      if (typeof csp !== 'string') return csp[name] === undefined ? undefined : [csp[name]].flat().join(' ')
      const found = csp.split(';').map((d) => d.trim().split(/\s+/)).find(([n]) => n.toLowerCase() === name)
      return found ? found.slice(1).join(' ') : undefined
    }
    const problems = []
    if (directive('script-src') === undefined && directive('default-src') === undefined) problems.push('the CSP has neither script-src nor default-src, so it leaves scripts unrestricted')
    for (const name of ['script-src', 'default-src']) if (/'unsafe-eval'/i.test(directive(name) ?? '')) problems.push(`${name} allows 'unsafe-eval'`)
    const disabled = tauriKey(security, 'dangerousDisableAssetCspModification')
    if (disabled === true || (Array.isArray(disabled) && disabled.length)) problems.push('dangerousDisableAssetCspModification turns off the nonces and hashes Tauri adds to the CSP')
    return problems.length ? fail(...problems.map((p) => `${t.file}: ${p}`)) : pass(`${t.file} sets a CSP that restricts scripts, without unsafe-eval`)
  },

  'tauri.capabilities-scoped': (ctx) => {
    const t = tauriConfig(ctx)
    if (t.result) return t.result
    const dir = posix.join(posix.dirname(t.file), 'capabilities')
    const caps = []
    // A capability file holds one capability, a list of them, or { "capabilities": [...] }.
    for (const f of ctx.repo.files.filter((x) => x.startsWith(`${dir}/`) && /\.(json|json5|toml)$/.test(x))) {
      const c = parseConfigFile(f, ctx.repo.read(f))
      const list = Array.isArray(c) ? c : Array.isArray(c?.capabilities) ? c.capabilities : c && typeof c === 'object' ? [c] : null
      if (!list) return fail(`${f} isn't a capability, a list of them, or { "capabilities": [...] }`)
      const indexed = Array.isArray(c) ? c.length > 1 : list !== null && list !== c && Array.isArray(c?.capabilities)
      for (const [i, one] of list.entries()) if (one && typeof one === 'object') caps.push({ ...one, where: indexed ? `${f} [${i}]` : f })
    }
    const inline = t.config.app?.security?.capabilities
    for (const [i, c] of (Array.isArray(inline) ? inline : []).entries()) {
      if (c && typeof c === 'object') caps.push({ ...c, where: `${t.file} app.security.capabilities[${i}]` })
    }
    if (!caps.length) return notApplicable(`no capabilities in ${dir}/ or ${t.file}`)
    const broadId = /^fs:(allow-home-(read|write)-recursive|scope-home-recursive)$/
    const broadPath = /^(\$HOME|\$HOME\/\*\*(\/\*)?|\/|\/\*\*(\/\*)?|\*\*(\/\*)?)$/
    const interpreter = /^(sh|bash|zsh|fish|cmd|cmd\.exe|powershell|powershell\.exe|pwsh|python[0-9.]*|node|osascript)$/i
    const powerful = /^shell:allow-(execute|spawn|stdin-write)$|^fs:(.*write.*|allow-remove|allow-rename|allow-copy-file|allow-truncate)$/
    const problems = []
    for (const c of caps) {
      const perms = (Array.isArray(c.permissions) ? c.permissions : []).map((p) => (typeof p === 'string' ? { identifier: p } : p && typeof p === 'object' ? p : {}))
      if (Array.isArray(c.remote?.urls) && c.remote.urls.length) problems.push(`${c.where}: remote URLs (${c.remote.urls.join(', ')}) get the capability's commands`)
      for (const p of perms) {
        const id = String(p.identifier ?? '')
        if (broadId.test(id)) problems.push(`${c.where}: ${id}`)
        for (const entry of [p.allow ?? []].flat()) {
          const path = typeof entry === 'string' ? entry : entry?.path // a scope entry is a path or { path }
          if (broadPath.test(String(path ?? ''))) problems.push(`${c.where}: ${id} allows ${path}`)
          if (!/^shell:/.test(id)) continue
          if (entry?.args === true) problems.push(`${c.where}: ${id} allows ${entry.cmd ?? entry.name ?? 'a command'} with any arguments`)
          if (interpreter.test(posix.basename(String(entry?.cmd ?? '').replace(/\\/g, '/')))) problems.push(`${c.where}: ${id} allows the interpreter ${entry.cmd}`)
        }
      }
      const everyWindow = [c.windows, c.webviews].flat().includes('*')
      const strong = perms.filter((p) => powerful.test(String(p.identifier ?? '')))
      if (everyWindow && strong.length) problems.push(`${c.where}: every window ("*") gets ${strong.map((p) => p.identifier).join(', ')}`)
    }
    return problems.length ? fail(...list([...new Set(problems)])) : pass(`${caps.length} capability(s), none broad`)
  },

  'tauri.updater-key': (ctx) => {
    const t = tauriConfig(ctx)
    if (t.result) return t.result
    const updater = t.config.plugins?.updater
    if (!updater || typeof updater !== 'object') return notApplicable(`${t.file} configures no updater`)
    const problems = []
    // Buffer ignores what isn't base64 rather than throwing, so anything else decodes to noise.
    const decoded = Buffer.from(String(updater.pubkey ?? ''), 'base64').toString('utf8')
    if (!/^untrusted comment: minisign public key/.test(decoded)) problems.push(`${t.file}: plugins.updater.pubkey isn't a minisign public key (tauri signer generate makes one)`)
    for (const e of [updater.endpoints ?? []].flat()) if (!/^https:\/\//i.test(String(e))) problems.push(`${t.file}: update endpoint ${e} isn't HTTPS`)
    if (tauriKey(updater, 'dangerousInsecureTransportProtocol') === true) problems.push(`${t.file}: dangerousInsecureTransportProtocol allows updates over plain HTTP`)
    // A minisign secret key file, decoded or base64 as tauri signer writes it: the header, then the
    // key. The header is 45 bytes, a whole number of base64 groups, so its encoding is the file's
    // prefix whatever follows. Requiring the key after it keeps the header's mere mention (this
    // script, in a fork of the template) from counting.
    const header = 'untrusted comment: rsign encrypted secret key'
    const decodedKey = new RegExp(`${header}\\r?\\n[A-Za-z0-9+/]{40,}`)
    const encodedKey = new RegExp(`${Buffer.from(header).toString('base64')}(?:\\s*[A-Za-z0-9+/]){60,}`) // wrapped or not
    for (const f of textFiles(ctx)) {
      const text = ctx.repo.read(f)
      if (decodedKey.test(text) || encodedKey.test(text)) problems.push(`${f} holds the updater's private signing key: rotate it, since the history keeps it`)
    }
    for (const w of ctx.repo.workflows()) {
      for (const m of (ctx.repo.read(w.file) ?? '').matchAll(/\bTAURI_(?:SIGNING_)?PRIVATE_KEY\s*:\s*(.*)/g)) {
        if (!/^["']?\$\{\{\s*secrets\.[\w-]+\s*\}\}["']?\s*(#.*)?$/.test(m[1].trim())) problems.push(`${w.file} sets ${m[0].split(':')[0].trim()} from something other than a secret`)
      }
    }
    return problems.length ? fail(...list(problems)) : pass(`${t.file}: a minisign public key, HTTPS endpoints, and no private key in the repository`)
  },

  'tauri.rust-gates-in-ci': (ctx) => {
    const all = ctx.repo.ci(PR)
    const commands = crateCommands(ctx, all.commands)
    const ignored = crateCommands(ctx, all.ignored)
    // -D warnings on the command, or in RUSTFLAGS anywhere in the workflow that runs it.
    const denies = (c) =>
      /(^|\s)(-D\s*warnings|--deny[\s=]warnings)\b|CARGO_BUILD_WARNINGS=deny/.test(c.text) ||
      /\bRUSTFLAGS\s*[:=]\s*["']?[^\n]*-D\s*warnings/.test(ctx.repo.read(c.where.split(' ')[0]) ?? '')
    const gates = [
      ['cargo clippy with warnings denied', /^cargo\s+clippy\b/, denies],
      ['cargo fmt --check', /^cargo\s+fmt\b/, (c) => /\s--check\b/.test(c.text)],
      ['cargo test', /^cargo\s+(test|nextest\s+run)\b/, (c) => !/\s--no-run\b/.test(c.text)],
    ]
    const found = []
    const missing = []
    for (const [name, re, strict] of gates) {
      const hit = matching(commands, re).find(strict)
      if (hit) found.push(`${name}: ${hit.where}`)
      else {
        const loose = matching(commands, re)[0]
        missing.push(loose ? `"${loose.text}" in ${loose.where} isn't ${name}` : `no pull_request workflow runs ${name}`, ...silencedCopies(ignored, re))
      }
    }
    return missing.length ? fail(...missing, ...found) : pass(...found)
  },

  'tauri.supply-chain': (ctx) => {
    const events = ['pull_request', 'schedule']
    const all = ctx.repo.ci(events)
    const commands = crateCommands(ctx, all.commands)
    const ignored = crateCommands(ctx, all.ignored)
    const re = /^cargo\s+deny\s+(.*\s)?check\b|^cargo-deny\s+(.*\s)?check\b|^cargo\s+audit\b|^cargo-audit\b/
    // `cargo deny check licenses` skips the advisories; with no check named, all of them run.
    const advisories = (text) => {
      const named = (/\bcheck\b(.*)$/.exec(text)?.[1] ?? '').split(/\s+/).filter((w) => /^(advisor(y|ies)|bans?|licen[cs]es?|sources?|all)$/.test(w))
      return !named.length || named.some((w) => /^(advisor|all)/.test(w))
    }
    const hit = matching(commands, re).find((c) => !/\bdeny\b/.test(c.text) || advisories(c.text))
    if (hit) return pass(`"${hit.text}" in ${hit.where}`)
    const deny = /^EmbarkStudios\/cargo-deny-action@/
    // The action runs cargo deny on its manifest-path (./Cargo.toml by default) with its arguments,
    // so it reaches the app's crate where that command would.
    const manifestOf = (w) => posix.normalize(String(w['manifest-path'] ?? 'Cargo.toml'))
    const checksAdvisories = (w) => advisories(String(w.command ?? 'check'))
    const reachesCrate = (w) => crateCommands(ctx, [{ text: `cargo deny ${String(w.arguments ?? '')} check`, dir: posix.dirname(manifestOf(w)) }]).length > 0
    const action =
      actionSteps(ctx, events, deny, (w) => ctx.repo.has(manifestOf(w)) && checksAdvisories(w) && reachesCrate(w))[0] ??
      actionSteps(ctx, events, /^(rustsec|actions-rs)\/audit-check@/)[0]
    if (action) return pass(`${action.uses} in ${action.where}`)
    const stray = actionSteps(ctx, events, deny, (w) => !ctx.repo.has(manifestOf(w)))[0]
    if (stray) return fail(`${stray.uses} in ${stray.where} reads a manifest-path that isn't in the repository (its default is ./Cargo.toml; a Tauri app's is usually src-tauri/Cargo.toml)`)
    const narrowed = actionSteps(ctx, events, deny, (w) => !checksAdvisories(w))[0]
    if (narrowed) return fail(`${narrowed.uses} in ${narrowed.where} runs \`cargo deny ${String(narrowed.with.command).trim()}\`, which leaves out the advisories check`)
    const elsewhere = actionSteps(ctx, events, deny)[0]
    if (elsewhere) return fail(`${elsewhere.uses} in ${elsewhere.where} checks a manifest that doesn't reach the app's crate (a root package's, without --workspace in its arguments)`)
    return fail('no workflow on pull requests or a schedule runs cargo deny or cargo audit', ...silencedCopies(ignored, re))
  },
}

// --- Packs ---------------------------------------------------------------------------------------

/** Packs whose markers are at the root, as [{ pack, path: '.' }]. */
function detectPacks(catalog, repo) {
  const found = []
  const pkg = repo.pkg('.')
  const dependencies = pkg && !pkg.invalid ? deps(pkg) : {}
  for (const pack of catalog.packs.values()) {
    if (pack.name === 'core') continue
    const hit = pack.detect.some((m) => (m.file ? repo.files.some(globMatcher(m.file)) : hasDep(dependencies, m.dependency)))
    if (hit) found.push({ pack: pack.name, path: '.' })
  }
  return found
}

function parsePackSpec(spec, where) {
  if (typeof spec === 'string') {
    const at = spec.indexOf('@')
    return at === -1 ? { pack: spec, path: '.' } : { pack: spec.slice(0, at), path: spec.slice(at + 1) }
  }
  if (spec && typeof spec === 'object' && !Array.isArray(spec) && typeof spec.pack === 'string') {
    const extra = Object.keys(spec).filter((k) => k !== 'pack' && k !== 'path')
    if (extra.length) throw new CheckError(`${where}: a pack takes only "pack" and "path"; got "${extra.join('", "')}"`)
    if (spec.path !== undefined && (typeof spec.path !== 'string' || !spec.path.trim())) throw new CheckError(`${where}: pack ${spec.pack}'s "path" must be a non-empty string`)
    return { pack: spec.pack, path: spec.path ?? '.' }
  }
  throw new CheckError(`${where}: a pack is "<name>", "<name>@<path>", or { "pack": "<name>", "path": "<path>" }`)
}

function resolvePacks(specs, catalog, root, where) {
  const out = [{ pack: 'core', path: '.' }]
  for (const spec of specs) {
    const p = parsePackSpec(spec, where)
    if (!catalog.packs.has(p.pack)) throw new CheckError(`${where}: no pack "${p.pack}" (packs: ${[...catalog.packs.keys()].join(', ')})`)
    const path = joinDir('.', p.path.replace(/\\/g, '/'))
    const real = path !== null && isDir(join(root, path)) ? realpathSync(join(root, path)) : null
    const realRoot = realpathSync(root)
    if (!real || (real !== realRoot && !real.startsWith(`${realRoot}${sep}`))) {
      throw new CheckError(`${where}: pack ${p.pack} names path "${p.path}", which isn't a directory in the repository`)
    }
    if (!out.some((o) => o.pack === p.pack && o.path === path)) out.push({ pack: p.pack, path })
  }
  return out
}

// --- The repository's config ---------------------------------------------------------------------

// A real calendar date in YYYY-MM-DD, or undefined. `2026-02-31` is not a date.
function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? undefined : date
}

function readConfig(path, today) {
  if (!existsSync(path)) return { path, exists: false, data: {} }
  let data
  try {
    data = JSON.parse(read(path))
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    throw new CheckError(`${path} isn't valid JSON: ${error.message}`)
  }
  const problems = []
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new CheckError(`${path}: expected a JSON object`)
  for (const key of Object.keys(data)) {
    if (!['$comment', 'visibility', 'packs', 'baseline', 'waivers', 'vocabulary'].includes(key)) {
      problems.push(`"${key}" isn't a config field (visibility, packs, baseline, waivers, vocabulary)`)
    }
  }
  if (data.visibility !== undefined && !['public', 'private'].includes(data.visibility)) problems.push('"visibility" must be "public" or "private"')
  if (data.packs !== undefined && !Array.isArray(data.packs)) problems.push('"packs" must be a list')
  if (data.vocabulary !== undefined) {
    // The lists the repository's own prose checker reads (writing.vocabulary-registered).
    const v = data.vocabulary
    const paths = (k) => v[k] === undefined || (Array.isArray(v[k]) && v[k].every((x) => typeof x === 'string' && x.trim()))
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some((k) => !['accept', 'reject'].includes(k))) {
      problems.push('"vocabulary" must be { "accept": [paths], "reject": [paths] }')
    } else if (!paths('accept') || !paths('reject') || (!v.accept?.length && !v.reject?.length)) {
      problems.push('"vocabulary" "accept" and "reject" must be lists of repository paths, and name at least one')
    }
  }
  if (data.baseline !== undefined) {
    const b = data.baseline
    if (!b || typeof b !== 'object' || Array.isArray(b)) problems.push('"baseline" must be { "recorded": "YYYY-MM-DD", "standards": [...] }')
    else {
      if (!parseDate(b.recorded)) problems.push('baseline "recorded" must be a real date, YYYY-MM-DD')
      if (!Array.isArray(b.standards) || b.standards.some((s) => typeof s !== 'string')) problems.push('baseline "standards" must be a list of standard keys')
      else if (new Set(b.standards).size !== b.standards.length) problems.push('baseline "standards" lists a key twice')
    }
  }
  if (data.waivers !== undefined) {
    if (!Array.isArray(data.waivers)) problems.push('"waivers" must be a list')
    else {
      const latest = new Date(today.getTime() + MAX_WAIVER_DAYS * 86_400_000)
      const seen = new Set()
      data.waivers.forEach((w, i) => {
        const where = `waivers[${i}]`
        if (!w || typeof w !== 'object' || Array.isArray(w)) return problems.push(`${where}: must be an object`)
        const str = (k) => (typeof w[k] === 'string' ? w[k].trim() : '')
        if (!str('standard')) problems.push(`${where}: "standard" is required, the key the run reports`)
        if (str('reason').length < 40) problems.push(`${where}: "reason" must say why this is acceptable here (at least 40 characters)`)
        if (!str('owner')) problems.push(`${where}: "owner" is required: who revisits this when it expires`)
        const expires = parseDate(w.expires)
        if (!expires) problems.push(`${where}: "expires" must be a real date, YYYY-MM-DD`)
        else if (expires > latest) problems.push(`${where}: "expires" ${w.expires} is more than ${MAX_WAIVER_DAYS} days out; renew it later instead`)
        if (seen.has(str('standard'))) problems.push(`${where}: a second waiver for ${str('standard')}`)
        seen.add(str('standard'))
      })
    }
  }
  if (problems.length) throw new CheckError(`Invalid config ${path}:\n  ${problems.join('\n  ')}`)
  return { path, exists: true, data }
}

// Every key the config names must be a checked standard; whether it was evaluated is a run fact.
function validateKeys(config, catalog) {
  const checked = new Set(catalog.standards.filter((s) => s.enforcement === 'check').map((s) => s.id))
  const audit = new Set(catalog.standards.filter((s) => s.enforcement !== 'check').map((s) => s.id))
  const problems = []
  const keys = [
    ...(config.data.baseline?.standards ?? []).map((k) => ['baseline', k]),
    ...(config.data.waivers ?? []).map((w) => ['waiver', w.standard.trim()]),
  ]
  for (const [kind, key] of keys) {
    const id = key.split('@')[0]
    if (audit.has(id)) problems.push(`${kind} ${key}: an audit or settings standard isn't scored here, so it can't be ${kind === 'waiver' ? 'waived' : 'baselined'}`)
    else if (!checked.has(id)) problems.push(`${kind} ${key}: no checked standard ${id} in the catalog`)
  }
  if (problems.length) throw new CheckError(`Invalid config ${config.path}:\n  ${problems.join('\n  ')}`)
}

// --- A run ---------------------------------------------------------------------------------------

function templateInfo() {
  let commit = null
  try {
    commit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: TEMPLATE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch (error) {
    if (error.status !== 128 && error.code !== 'ENOENT') throw error
  }
  return { version: JSON.parse(read(join(TEMPLATE, 'package.json'))).version, commit }
}

const isoToday = () => new Date().toISOString().slice(0, 10)

// Skeleton directories (repo-files.mjs) hold copies waiting to be filled in, not the repository's files.
function openRepository(root) {
  const listed = listRepoFiles(root) // without symlinks out of the root
  if (!listed.length && readdirSync(root).some((entry) => entry !== '.git' && !SKIP_DIRS.has(entry))) {
    // Scoring nothing would pass most standards. A directory inside another repository's ignored
    // folder lists nothing, so does one that holds only symlinks out of it.
    throw new CheckError(`No files to score in ${root}, though it isn't empty: run this on the repository's own checkout.`)
  }
  const skeleton = inSkeletonDir(skeletonDirs(listed))
  return repository(root, listed.filter((f) => !skeleton(f)))
}

/** One probe against `root`, without the rest of a run: for tests, and for debugging a probe. */
export function runProbe(rootArg, id, { path = '.', visibility = null, today = isoToday(), vocabulary = null } = {}) {
  if (!PROBES[id]) throw new CheckError(`No probe ${id}.`)
  const root = resolve(rootArg)
  if (!isDir(root)) throw new CheckError(`Not a directory: ${root}`)
  const todayDate = parseDate(today)
  if (!todayDate) throw new CheckError(`today must be a real date, YYYY-MM-DD; got "${today}"`)
  return PROBES[id]({ repo: openRepository(root), path, visibility, today: todayDate, vocabulary })
}

/**
 * Scores `root`. Options: config (path; default <root>/docs/standards/conformance.json), packs
 * (specs that replace the config's and detection), visibility, today (YYYY-MM-DD), catalog.
 * Returns the scorecard; throws CheckError when the catalog, config, or arguments are invalid.
 */
export function conform(rootArg, options = {}) {
  const catalog = options.catalog ?? loadCatalog()
  if (catalog.problems.length) throw new CheckError(`The standards catalog is invalid:\n  ${catalog.problems.join('\n  ')}`)
  const today = options.today ?? isoToday()
  const todayDate = parseDate(today)
  if (!todayDate) throw new CheckError(`today must be a real date, YYYY-MM-DD; got "${today}"`)
  const root = resolve(rootArg)
  if (!isDir(root)) throw new CheckError(`Not a directory: ${root}`)
  const repo = openRepository(root)
  const configPath = options.config ? resolve(options.config) : join(root, CONFIG)
  // The repository's own config is one of its listed files, never a symlink out of it.
  const config = options.config || repo.has(CONFIG) ? readConfig(configPath, todayDate) : { path: configPath, exists: false, data: {} }
  validateKeys(config, catalog)

  const detected = detectPacks(catalog, repo)
  let source = 'detected'
  let specs = detected
  if (options.packs?.length) [source, specs] = ['--pack', options.packs]
  else if (config.data.packs) [source, specs] = [`${CONFIG} packs`, config.data.packs]
  const packs = resolvePacks(specs, catalog, root, source)
  const undeclared = detected.filter((d) => !packs.some((p) => p.pack === d.pack)).map((d) => d.pack)
  const visibility = options.visibility ?? config.data.visibility ?? null

  const results = []
  for (const { pack, path } of packs) {
    const ctx = { repo, path, visibility, today: todayDate, vocabulary: config.data.vocabulary ?? null }
    for (const s of catalog.standards.filter((x) => x.pack === pack)) {
      const key = path === '.' ? s.id : `${s.id}@${path}`
      // Not scored here: a person checks an audit standard, and check-settings.mjs a settings one,
      // over the GitHub API this script never calls.
      const outcome =
        s.enforcement === 'audit'
          ? { status: 'audit', evidence: [] }
          : s.enforcement === 'settings'
            ? { status: 'audit', evidence: ['a repository setting: scored by scripts/check-settings.mjs over the GitHub API'] }
            : PROBES[s.id](ctx)
      results.push({ key, id: s.id, pack, path, title: s.title, severity: s.severity, enforcement: s.enforcement, auditArea: s.auditArea, ...outcome })
    }
  }

  // The config's waivers and baseline, held to the bar they enforce.
  const problems = []
  const byKey = new Map(results.map((r) => [r.key, r]))
  for (const w of config.data.waivers ?? []) {
    const key = w.standard.trim()
    const r = byKey.get(key)
    if (w.expires < today) problems.push(`expired waiver: ${key} expired ${w.expires}. Fix it, or renew the waiver with a fresh reason.`)
    else if (!r) problems.push(`stale waiver: ${key} wasn't evaluated in this run (its pack doesn't apply here). Delete it.`)
    else if (r.status === 'fail') Object.assign(r, { status: 'waived', waiver: { reason: w.reason, owner: w.owner, expires: w.expires } })
    else if (r.status === 'pass' || r.status === 'n/a') problems.push(`stale waiver: ${key} no longer fails (${r.status}). Delete the waiver so it can't pre-approve a regression.`)
  }
  for (const key of config.data.baseline?.standards ?? []) {
    const r = byKey.get(key)
    if (!r) problems.push(`stale baseline entry: ${key} wasn't evaluated in this run (its pack doesn't apply here). Remove it with --write-baseline.`)
    else if (r.status === 'fail') r.status = 'baseline'
    else if (r.status === 'pass' || r.status === 'n/a') problems.push(`stale baseline entry: ${key} is fixed (${r.status}). Remove it with --write-baseline, so a regression fails.`)
  }

  const summary = {}
  for (const r of results) summary[r.status] = (summary[r.status] ?? 0) + 1
  const scored = results.filter((r) => ['pass', 'fail', 'waived', 'baseline'].includes(r.status)).length
  const exitCode = summary.error || !scored ? 2 : summary.fail || problems.length ? 1 : 0
  return {
    root,
    checked: today,
    template: templateInfo(),
    config: config.exists ? config.path : null,
    packs,
    packSource: source,
    undeclared,
    visibility,
    results,
    problems,
    summary,
    exitCode,
  }
}

/**
 * The config with its baseline brought up to date: every current failure when there's no baseline,
 * otherwise the old baseline minus what's fixed or no longer evaluated (the entries a run calls
 * stale). One that's skipped, waived, or errored this run stays: that says nothing about a fix.
 * Returns { config, refused } where refused lists failures the baseline doesn't already hold (a
 * baseline only shrinks).
 */
export function nextBaseline(card, configData, today) {
  const failing = card.results.filter((r) => r.status === 'fail' || r.status === 'baseline').map((r) => r.key)
  const old = configData.baseline?.standards
  if (!old) {
    return { refused: [], config: { ...configData, baseline: { recorded: today, standards: [...failing].sort() } } }
  }
  const refused = failing.filter((k) => !old.includes(k))
  const status = new Map(card.results.map((r) => [r.key, r.status]))
  const kept = old.filter((k) => status.has(k) && !['pass', 'n/a'].includes(status.get(k)))
  return { refused, config: { ...configData, baseline: { recorded: configData.baseline.recorded, standards: kept } } }
}

// --- Output --------------------------------------------------------------------------------------

const ORDER = ['error', 'fail', 'waived', 'baseline', 'skipped', 'pass', 'n/a', 'audit']
const MARK = { error: '!', fail: '✗', waived: '~', baseline: '·', skipped: '?', pass: '✓', 'n/a': '-', audit: ' ' }

export function formatCard(card) {
  const lines = []
  const packs = card.packs.map((p) => (p.path === '.' ? p.pack : `${p.pack}@${p.path}`)).join(', ')
  lines.push(`Standards conformance: ${card.root}`)
  lines.push(`Packs (${card.packSource}): ${packs}`)
  if (card.undeclared.length) lines.push(`Detected but not in the declared packs: ${card.undeclared.join(', ')}`)
  lines.push('')
  const sorted = [...card.results].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.key.localeCompare(b.key))
  for (const r of sorted) {
    lines.push(`${MARK[r.status]} ${r.status.padEnd(8)} ${r.key} (${r.severity}, area ${r.auditArea}): ${r.title}`)
    if (r.waiver) lines.push(`      waived until ${r.waiver.expires} (owner ${r.waiver.owner}): ${r.waiver.reason}`)
    if (r.status !== 'pass') for (const e of r.evidence) lines.push(`      ${e}`)
  }
  if (card.problems.length) lines.push('', ...card.problems.map((p) => `✗ ${p}`))
  const counts = ORDER.filter((s) => card.summary[s]).map((s) => `${card.summary[s]} ${s}`).join(', ')
  lines.push('', `${counts}. Template ${card.template.version}${card.template.commit ? ` (${card.template.commit})` : ''}, ${card.checked}.`)
  return lines.join('\n')
}

function stepSummary(card) {
  const rows = card.results
    .filter((r) => !['pass', 'n/a', 'audit'].includes(r.status))
    .map((r) => `| ${r.status} | \`${r.key}\` | ${r.severity} | ${(r.evidence[0] ?? '').replace(/\|/g, '\\|')} |`)
  const md = ['### Standards conformance', '', `${Object.entries(card.summary).map(([s, n]) => `${n} ${s}`).join(', ')}`, '']
  if (rows.length) md.push('| Status | Standard | Severity | Evidence |', '| --- | --- | --- | --- |', ...rows, '')
  if (card.problems.length) md.push(...card.problems.map((p) => `- ${p}`), '')
  return md.join('\n')
}

// --- Run -----------------------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { packs: [] }
  const value = (i, flag) => {
    const v = argv[i]
    if (v === undefined || v === '' || (v.startsWith('--') && v !== '-')) throw new CheckError(`${flag} needs a value.`)
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s, 2)
    const take = () => inline ?? value(++i, flag)
    if (flag === '--root') args.root = take()
    else if (flag === '--config') args.config = take()
    else if (flag === '--pack') args.packs.push(take())
    else if (flag === '--json') args.json = take()
    else if (flag === '--today') args.today = take()
    else if (flag === '--visibility') {
      args.visibility = take()
      if (!['public', 'private'].includes(args.visibility)) throw new CheckError('--visibility must be public or private.')
    } else if (flag === '--write-baseline' && inline === undefined) args.writeBaseline = true
    else throw new CheckError(`Unknown argument: ${argv[i]}`)
  }
  return args
}

const USAGE =
  'Usage: node scripts/check-conformance.mjs [--root <repo>] [--config <file>] [--pack <name[@path]>]...\n' +
  '         [--visibility public|private] [--json <file|->] [--write-baseline] [--today YYYY-MM-DD]'

function main(argv) {
  const args = parseArgs(argv)
  const root = resolve(args.root ?? '.')
  const options = { config: args.config, packs: args.packs, visibility: args.visibility, today: args.today }
  let card = conform(root, options)

  if (args.writeBaseline) {
    if (card.summary.error) {
      console.error(`${formatCard(card)}\n\n✗ Not writing a baseline: a probe couldn't run, so the failures aren't known.`)
      return 2
    }
    const configPath = args.config ? resolve(args.config) : join(card.root, CONFIG)
    if (!args.config) {
      let anchor = dirname(configPath)
      while (!existsSync(anchor)) anchor = dirname(anchor)
      const [real, realRoot] = [realpathSync(anchor), realpathSync(card.root)]
      if (isSymlink(configPath) || (real !== realRoot && !real.startsWith(`${realRoot}${sep}`))) {
        throw new CheckError(`${CONFIG} leads out of the repository through a symlink; not writing a baseline there. Pass --config to name the file.`)
      }
    }
    const current = existsSync(configPath) ? JSON.parse(read(configPath)) : {}
    const { refused, config } = nextBaseline(card, current, card.checked)
    if (refused.length) {
      console.error(
        `${formatCard(card)}\n\n✗ A baseline only shrinks. These fail and aren't in it; fix them or waive them with a reason:\n` +
          refused.map((k) => `  - ${k}`).join('\n'),
      )
      return 1
    }
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
    console.error(`Wrote the baseline (${config.baseline.standards.length} standard(s)) to ${configPath}.\n`)
    card = conform(root, { ...options, config: configPath })
  }

  const text = formatCard(card)
  if (args.json === '-') console.log(JSON.stringify(card, null, 2))
  else {
    if (args.json) writeFileSync(resolve(args.json), `${JSON.stringify(card, null, 2)}\n`)
    ;(card.exitCode === 0 ? console.log : console.error)(text)
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, stepSummary(card))
  return card.exitCode
}

// Run only when executed directly, so the tests and fleet-report.mjs can import the pieces.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let status
  try {
    status = main(process.argv.slice(2))
  } catch (error) {
    if (error instanceof CheckError) console.error(`✗ ${error.message}\n${USAGE}`)
    else if (error?.code === MISSING_DEPENDENCY) console.error(error.message)
    // Anything else is a defect here, not a finding about the repository: the stack is printed in
    // full, and the exit is 2 because nothing was checked (Node's own exit 1 would read as failures).
    else console.error(error?.stack ?? error)
    status = 2
  }
  process.exit(status)
}
