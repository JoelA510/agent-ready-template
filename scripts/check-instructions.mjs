#!/usr/bin/env node
// Lints agent instruction files (CLAUDE.md, AGENTS.md, Cursor/Copilot/Gemini rules, …) for the
// ways they rot or get abused without anyone noticing, because each still reads fine:
//
//   - link:    a markdown link whose relative target doesn't exist. Resolved from the file, or
//              from the repo root for a `/`-rooted link; `#anchor`, `?query`, and a title are
//              ignored;
//   - import:  an `@path` import (Claude Code syntax, in CLAUDE*.md, AGENTS.md, .claude/rules/)
//              whose file doesn't exist. Resolved from the file, as Claude Code does; `@~/…`
//              imports are personal and skipped. An `@` word only counts when it reads as a
//              file (an extension, a leading ./ ../ or /, or a first directory that exists), so
//              a package name like `@scope/pkg` in prose isn't reported;
//   - path:    a path in an inline code span (`src/db/`, `docs/adr/0001-stack.md`) that matches
//              nothing: not from the repo root, not from the file, and not as the tail of any
//              path in the repo (so `styles/chrome.css`, said in the context of `frontend/src/`,
//              passes; `frontend/src/` after a rename to `web/src/` doesn't). A span counts when
//              it has two or more segments, only path characters, no ellipsis, and reads as a
//              path: it ends in `/`, its last part has an extension, or its first directory
//              exists (so `and/or`, `text/html`, `.sm/.lg`, `plugin/rule-name`, the placeholder
//              `path/to/file.ts`, a placeholder part like `session-NN/` or `YYYY-MM-DD.md`,
//              and a code reference like `tools/md_edit.wrap_block`, a name whose "extension"
//              has an underscore, don't). For a glob (`tokens/**/*.json`) the literal
//              directory prefix must match. Paths git ignores (a directory pattern matches with or
//              without the trailing slash; generated, local-only) and paths
//              with a node_modules/, dist/, or build/ segment aren't in a clean checkout by
//              design and are skipped. Write a path that lives elsewhere with its root
//              (`<target>/prompts/`); put examples in fenced blocks, which this and the two
//              checks above skip;
//   - script:  an `npm|pnpm|yarn|bun run <script>` naming a script that the nearest
//              package.json (from the file up to the root) lacks, fenced blocks included (a
//              fenced command list is how most files document them). Workspace-targeted runs
//              (`-w`, `--filter`, …), `--if-present`, and `bun run <file>` are skipped;
//   - hidden:  a character a reviewer can't see but a model reads: C0/C1 controls (bar tab and
//              line endings), bidi marks and overrides, zero-width and other invisible
//              characters, variation selectors, and Unicode tag characters (HIDDEN_RANGES).
//              Allowed where text needs them: a leading BOM, one variation selector after a
//              visible non-ASCII character (emoji presentation), and a zero-width joiner or
//              non-joiner between two visible non-ASCII characters (emoji sequences, scripts
//              that need them);
//   - hides-agents: the repo has an AGENTS.md and a CLAUDE.md that neither imports it nor is a
//              link to it. Claude Code then reads only CLAUDE.md, so the AGENTS.md rules never
//              reach it (code.claude.com/docs/en/memory, "AGENTS.md"). A personal
//              CLAUDE.local.md does the same for whoever has one. Likewise for Gemini CLI, which
//              reads GEMINI.md unless `.gemini/settings.json` names AGENTS.md in
//              `context.fileName`: reported when the repo uses Gemini (a GEMINI.md or a .gemini/
//              directory) and nothing brings AGENTS.md in (github.com/google-gemini/gemini-cli,
//              docs/cli/gemini-md.md);
//   - skill:   a SKILL.md in a skills directory (SKILL_PATHS) that breaks the Agent Skills
//              specification: a missing or malformed name, a name that isn't its directory's,
//              a missing or over-long description, frontmatter a YAML parser would misread
//              (scripts/skills.mjs has the rules). Agents skip or misload such a skill silently;
//   - skill-copy: a skill in both .agents/skills/ and .claude/skills/ whose two copies differ in
//              description or instructions. Claude Code runs one and every other agent the
//              other, so a fix made in one copy silently doesn't reach half the agents. The
//              frontmatter may differ (Claude Code's copy lifts its own settings out of
//              metadata), and so may the "Claude Code's copy of" notice line;
//   - size:    a shared instruction file over the smallest hard limit among the platforms that
//              read it, of those the repo selects in .agents/platforms.json (scripts/agent-
//              platforms.mjs holds each platform's files and documented limit, with its source),
//              so its end may never reach that agent. A file no selected platform limits has no
//              budget. With no selection, the AGENTS.md and GEMINI.md budget is the strictest of
//              every platform the template knows: 24,000 bytes, Antigravity's;
//   - platforms: a .agents/platforms.json that selects a platform the template doesn't know,
//              has a field it doesn't define, selects nothing, or has a custom (researched) entry
//              without its files, its limit (a number or null), or sources with a url and a
//              checked date (prompts/agent-platforms.md has the format).
//
// Notes, on stderr, never a finding: a repo with no .agents/platforms.json is told to record one;
// and a file over a selected platform's documented guidance length (Claude Code's 200 lines,
// counting what the file imports, since imports load too) is pointed at it.
//
// Run: node scripts/check-instructions.mjs [--root <repo>] [file...]
//   With no files, finds the instruction files under --root (default: the current directory).
//   Exit 0 clean, 1 on findings, 2 on bad arguments, when there was nothing to examine, when
//   .agents/platforms.json isn't valid JSON (no budget can be known), or when a skill needs
//   parsing and the template's dependencies aren't installed.
// scripts/__tests__/check-instructions.test.ts runs each finding kind against a planted defect.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLATFORMS, PROCEDURE, SELECTION_FILE, budgetFor, readSelection } from './agent-platforms.mjs'
import { SKELETON_MARKER, SKIP_DIRS, inSkeletonDir, listRepoFiles as listFiles, skeletonDirs, toPosix, walk } from './repo-files.mjs'
import { parseSkill } from './skills.mjs'
import { MISSING_DEPENDENCY } from './template-dependency.mjs'

// Top-level instruction files and directories, per agent, the shared file first. Nested
// CLAUDE.md/AGENTS.md/GEMINI.md files anywhere in the repo are found as well (agents load them
// for their subtree). process:apply uses this list too, to find where a target keeps its rules.
export const INSTRUCTION_PATHS = [
  'AGENTS.md',
  '.claude/AGENTS.md',
  'CLAUDE.md',
  '.claude/CLAUDE.md',
  'CLAUDE.local.md',
  '.claude/rules',
  'GEMINI.md',
  '.agents/AGENTS.md',
  '.agents/rules',
  '.agents/workflows',
  '.agent/rules',
  '.agent/workflows',
  '.cursor/rules',
  '.cursorrules',
  '.github/copilot-instructions.md',
  '.github/instructions',
  '.clinerules',
  '.windsurf/rules',
  '.windsurfrules',
]
// Agent Skills directories, per tool (.agents/skills is the one Codex, Antigravity, Gemini CLI,
// Cursor, and Copilot share; Claude Code reads .claude/skills). Linted like instructions, and
// each SKILL.md checked against the specification. Not rules: process:apply delivers skills here,
// so they don't count as a target's own instructions.
export const SKILL_PATHS = ['.agents/skills', '.agent/skills', '.claude/skills', '.github/skills', '.cursor/skills', '.gemini/skills', '.codex/skills']
// Without a selection, the files sized before platforms could be selected, for every platform.
const LEGACY = { platforms: PLATFORMS, legacy: true, files: new Set(['AGENTS.md', 'GEMINI.md']) }
const NESTED = new Set(['CLAUDE.md', 'AGENTS.md', 'GEMINI.md'])
// Inside an instruction directory, only these are instructions; a skill's images and scripts
// aren't.
const TEXT = /\.(md|mdc|mdx|txt)$/i

// Characters that render as nothing (or nothing a reviewer would notice), as code point ranges.
export const HIDDEN_RANGES = [
  [0x0000, 0x0008], // C0 controls (tab and line feed are allowed; CR only as a line ending)
  [0x000b, 0x001f],
  [0x007f, 0x009f], // DEL and C1 controls
  [0x00ad, 0x00ad], // soft hyphen
  [0x061c, 0x061c], // Arabic letter mark (bidi)
  [0x115f, 0x1160], // Hangul fillers
  [0x17b4, 0x17b5], // Khmer inherent vowels
  [0x180e, 0x180e], // Mongolian vowel separator
  [0x200b, 0x200f], // zero-width space, non-joiner, joiner; LRM, RLM
  [0x2028, 0x202e], // line and paragraph separators; bidi embeddings and overrides
  [0x2060, 0x2064], // word joiner, invisible operators
  [0x2066, 0x2069], // bidi isolates
  [0x3164, 0x3164], // Hangul filler
  [0xfe00, 0xfe0f], // variation selectors
  [0xfeff, 0xfeff], // BOM / zero-width no-break space
  [0xffa0, 0xffa0], // halfwidth Hangul filler
  [0xfff9, 0xfffb], // interlinear annotation
  [0xe0000, 0xe007f], // tag characters
  [0xe0100, 0xe01ef], // variation selectors supplement
]
const isHidden = (cp) => HIDDEN_RANGES.some(([from, to]) => cp >= from && cp <= to)
const visibleNonAscii = (cp) => cp !== undefined && cp > 0x7f && !isHidden(cp)
const isVariationSelector = (cp) => (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef)
const ZWNJ = 0x200c
const ZWJ = 0x200d

// Every file and directory in the repo, for matching a path by its tail. Skeletons aren't the
// repo's files (repo-files.mjs): `docs/adr/0000-template.md` must exist at a real path, not only
// as prompts/skeletons/docs/adr/0000-template.md.
function repoPaths(files) {
  const skeleton = inSkeletonDir(skeletonDirs(files))
  const paths = new Set()
  for (const f of files.filter((p) => !skeleton(p))) {
    const parts = f.split('/')
    for (let i = 1; i <= parts.length; i++) paths.add(parts.slice(0, i).join('/'))
  }
  return [...paths]
}

/** Every instruction file under root, as absolute paths, one per real file. */
export function findInstructionFiles(root, files = listFiles(root)) {
  const found = []
  for (const p of [...INSTRUCTION_PATHS, ...SKILL_PATHS]) {
    const abs = join(root, p)
    if (!existsSync(abs)) continue
    if (statSync(abs).isFile()) found.push(abs)
    else found.push(...walk(abs).filter((f) => TEXT.test(f)))
  }
  const skeleton = inSkeletonDir(skeletonDirs(files))
  found.push(...files.filter((p) => NESTED.has(basename(p)) && !skeleton(p)).map((p) => join(root, p)))
  // A CLAUDE.md that's a symlink to AGENTS.md is one file, linted once under its first name. One
  // that leads out of the repo isn't the repo's, and its content would reach the report.
  const seen = new Set()
  const realRoot = realpathSync(root)
  return [...new Set(found)]
    .filter((p) => !toPosix(relative(root, p)).startsWith('.claude/worktrees/'))
    .sort()
    .filter((p) => {
      const real = realpathSync(p)
      if (real !== realRoot && !real.startsWith(`${realRoot}${sep}`)) return false
      if (seen.has(real)) return false
      seen.add(real)
      return true
    })
}

// Code is not prose: fenced blocks are blanked; inline spans are returned separately.
function scan(text) {
  let fence = null
  return text.split(/\r?\n/).map((line, i) => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)
    if (marker && (!fence || marker[1][0] === fence[0])) {
      fence = fence ? null : marker[1]
      return { n: i + 1, prose: '', spans: [], raw: line }
    }
    if (fence) return { n: i + 1, prose: '', spans: [], raw: line }
    const spans = [...line.matchAll(/`([^`\n]+)`/g)].map((m) => m[1])
    return { n: i + 1, prose: line.replace(/`[^`\n]*`/g, ' '), spans, raw: line }
  })
}

// `name.ext` with a real stem: `.env.example` has one, the CSS class `.lg` doesn't.
const hasExtension = (segment) => /^.+\.\w+$/.test(segment.replace(/^\./, ''))

/** The `@` imports in a file's prose that read as files (personal ones skipped). */
function importsOf(abs, text = readFileSync(abs, 'utf8')) {
  const dir = dirname(abs)
  const out = []
  for (const { n, prose } of scan(text)) {
    for (const [, imp] of prose.matchAll(/(?:^|\s)@((?:~\/|\.{0,2}\/)?[\w.-]+(?:\/[\w.-]+)*)/g)) {
      const p = imp.replace(/[.,:;]+$/, '')
      if (p.startsWith('~/')) continue
      const first = p.split('/')[0]
      const readsAsFile =
        /^\.{0,2}\//.test(p) || hasExtension(p.split('/').at(-1)) || (p.includes('/') && existsSync(resolve(dir, first)))
      if (readsAsFile) out.push({ line: n, path: p, abs: isAbsolute(p) ? p : resolve(dir, p) })
    }
  }
  return out
}

/**
 * Why Claude Code wouldn't read this repo's AGENTS.md, as { file, detail }, or null. By
 * default it reads AGENTS.md only when there's no CLAUDE.md, .claude/CLAUDE.md, or
 * CLAUDE.local.md; one that imports AGENTS.md (or is a link to it) brings it back.
 */
export function agentsHiddenFromClaude(root) {
  const present = (paths) => paths.filter((p) => existsSync(join(root, p)))
  const agents = present(['AGENTS.md', '.claude/AGENTS.md'])
  const shared = present(['CLAUDE.md', '.claude/CLAUDE.md'])
  const local = present(['CLAUDE.local.md'])
  if (!agents.length || !(shared.length || local.length)) return null
  const agentFiles = new Set(agents.map((p) => realpathSync(join(root, p))))
  const reaches = (p) => {
    const abs = join(root, p)
    if (agentFiles.has(realpathSync(abs))) return true
    return importsOf(abs).some((i) => existsSync(i.abs) && agentFiles.has(realpathSync(i.abs)))
  }
  const names = agents.join(' and ')
  if (shared.length) {
    if (shared.some(reaches)) return null
    const importPath = toPosix(relative(dirname(join(root, shared[0])), join(root, agents[0])))
    return {
      file: shared[0],
      detail:
        `Claude Code reads ${shared.join(' and ')} and skips ${names}, so the rules there never ` +
        `reach it. Import it: a line \`@${importPath}\` in ${shared[0]}.`,
    }
  }
  if (reaches(local[0])) return null
  return {
    file: local[0],
    detail:
      `your personal ${local[0]} makes Claude Code skip ${names} for you. Import it there ` +
      `(\`@AGENTS.md\`), or set Project instructions to claude-md-and-agents-md in /config.`,
  }
}

const PATHLIKE = /^[\w.@-][\w./*?@-]*\/[\w./*?@-]*$/

// The part of a path that must exist: all of it, or a glob's literal directory prefix.
const literalPart = (p) => (/[*?]/.test(p) ? p.slice(0, p.search(/[*?]/)).replace(/[^/]*$/, '') : p)

function readsAsPath(root, fileDir, p) {
  if (!PATHLIKE.test(p) || p.startsWith('@') || /^[a-z]+:/i.test(p) || p.includes('...')) return false
  if (p.startsWith('path/to/')) return false // the conventional placeholder
  const segments = p.split('/').filter(Boolean)
  if (segments.length < 2 || segments.some((s) => SKIP_DIRS.has(s))) return false
  // A placeholder part (`session-NN/`, `YYYY-MM-DD.md`): a date field or a run of N or X.
  if (segments.some((s) => s.split(/[-_.]/).some((t) => /^(YYYY|YY|MM|DD|NN+|XX+)$/.test(t)))) return false
  // A code reference (`tools/md_edit.wrap_block`, a module and a function), not a file: no
  // file extension has an underscore.
  if (/^[A-Za-z_]\w*\.[A-Za-z]\w*_\w*$/.test(segments.at(-1))) return false
  return (
    p.endsWith('/') ||
    hasExtension(segments.at(-1)) ||
    [root, fileDir].some((base) => existsSync(resolve(base, segments[0])))
  )
}

function pathExists(root, fileDir, p, index) {
  const literal = literalPart(p).replace(/\/$/, '')
  if (!literal) return true
  if ([root, fileDir].some((base) => existsSync(resolve(base, literal)))) return true
  if (index.some((q) => q === literal || q.endsWith(`/${literal}`))) return true
  // Missing but ignored by git: generated or local-only, so absent from a clean checkout by
  // design. A directory pattern (`fixtures/`) only matches a path that says it's a directory, so
  // a path without a trailing slash is asked about both ways: `fixtures` may be that directory.
  const asked = literalPart(p)
  return [asked, ...(asked.endsWith('/') ? [] : [`${asked}/`])].some((q) => {
    try {
      execFileSync('git', ['check-ignore', '-q', '--no-index', q], { cwd: root, stdio: 'ignore' })
      return true
    } catch (error) {
      // 1: not ignored. 128: not a git repository. ENOENT: no git. Anything else is real.
      if (error.status === 1 || error.status === 128 || error.code === 'ENOENT') return false
      throw error
    }
  })
}

// Flags that point `run` at another package's scripts, or make a missing script fine.
const SKIP_RUN = /^(-w|--workspace|--workspaces|-ws|--filter|-F|--prefix|-C|--dir|--cwd|--if-present|-r|--recursive)(=|$)/

/** The script a `<tool> run …` invocation names, or null when it can't or needn't be checked. */
function scriptName(args) {
  for (const token of args.trim().split(/\s+/)) {
    if (!token || token === '--') return null
    if (token.startsWith('-')) {
      if (SKIP_RUN.test(token)) return null
      continue
    }
    const name = token.replace(/[.,:;)\]}'"]+$/, '')
    // `bun run src/server.ts` runs a file, not a script.
    if (!name || name.includes('/') || /\.(m?[jt]sx?|c[jt]s)$/.test(name)) return null
    return name
  }
  return null
}

// The scripts of the package.json nearest a directory, from it up to root: { path, scripts }.
function scriptsLookup(root) {
  const cache = new Map()
  const lookup = (dir) => {
    if (cache.has(dir)) return cache.get(dir)
    const pkg = join(dir, 'package.json')
    let found = null
    if (existsSync(pkg)) {
      found = { path: toPosix(relative(root, pkg)), scripts: JSON.parse(readFileSync(pkg, 'utf8')).scripts ?? {} }
    } else if (resolve(dir) !== resolve(root) && !relative(root, dir).startsWith('..')) {
      found = lookup(dirname(dir))
    }
    cache.set(dir, found)
    return found
  }
  return lookup
}

// Gemini CLI's settings are JSON with comments, and tolerate trailing commas. One pass that
// copies strings as they are, drops comments, and drops a comma whose next token closes.
export function parseJsonc(text) {
  let out = ''
  let comma = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2)
      if (close === -1) throw new SyntaxError('unterminated comment')
      i = close + 1
      continue
    }
    if (/\s/.test(c)) {
      out += c
      continue
    }
    if (comma && c !== '}' && c !== ']') out += ','
    comma = false
    if (c === ',') {
      comma = true
      continue
    }
    if (c === '"') {
      const string = /"(?:[^"\\]|\\.)*"/y
      string.lastIndex = i
      const m = string.exec(text)
      if (!m) throw new SyntaxError('unterminated string')
      out += m[0]
      i += m[0].length - 1
      continue
    }
    out += c
  }
  if (comma) out += ','
  return JSON.parse(out)
}

/**
 * Why Gemini CLI wouldn't read this repo's AGENTS.md, as { file, detail }, or null. It reads
 * GEMINI.md unless `.gemini/settings.json` lists AGENTS.md in `context.fileName`; a GEMINI.md
 * that imports it (`@./AGENTS.md`) brings it in too. Only asked of a repo that uses Gemini: one with a
 * GEMINI.md or a .gemini/ directory.
 */
export function agentsHiddenFromGemini(root) {
  if (!existsSync(join(root, 'AGENTS.md'))) return null
  const geminiMd = existsSync(join(root, 'GEMINI.md'))
  const settingsPath = join(root, '.gemini', 'settings.json')
  if (!geminiMd && !existsSync(join(root, '.gemini'))) return null
  const fix = 'set "context": { "fileName": ["AGENTS.md", "GEMINI.md"] } in .gemini/settings.json'
  if (existsSync(settingsPath)) {
    let names
    try {
      const settings = parseJsonc(readFileSync(settingsPath, 'utf8'))
      // `contextFileName` is the setting's name before Gemini CLI grouped it under `context`.
      names = [settings?.context?.fileName, settings?.contextFileName]
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      return { file: '.gemini/settings.json', detail: `isn't valid JSON (${error.message}), so Gemini CLI can't be told to read AGENTS.md` }
    }
    if (names.flat().includes('AGENTS.md')) return null
  }
  // Gemini's documented import form is a relative or absolute path: `@./AGENTS.md`.
  const imported = (i) => /^\.{0,2}\//.test(i.path) && i.abs === join(root, 'AGENTS.md')
  if (geminiMd && importsOf(join(root, 'GEMINI.md')).some(imported)) return null
  return {
    file: existsSync(settingsPath) ? '.gemini/settings.json' : geminiMd ? 'GEMINI.md' : '.gemini/',
    detail: `Gemini CLI reads GEMINI.md, not AGENTS.md, so the AGENTS.md rules never reach it: ${fix}.`,
  }
}

/**
 * Skills whose .agents/ and .claude/ copies disagree in description or instructions, as
 * [{ file, detail }] (reported on the Claude Code copy).
 */
export function skillCopiesThatDiffer(root) {
  const shared = join(root, '.agents', 'skills')
  const claude = join(root, '.claude', 'skills')
  if (!existsSync(shared) || !existsSync(claude)) return []
  const instructions = (body) => body.replace(/^\s*<!-- Claude Code's copy of [^\n]*-->\n?/, '').trim()
  const out = []
  for (const name of readdirSync(shared)) {
    const a = join(shared, name, 'SKILL.md')
    const b = join(claude, name, 'SKILL.md')
    if (!existsSync(a) || !existsSync(b)) continue
    const one = parseSkill(readFileSync(a, 'utf8'), name, { strict: false })
    const two = parseSkill(readFileSync(b, 'utf8'), name, { strict: false })
    const differs = [one.description !== two.description && 'description', instructions(one.body) !== instructions(two.body) && 'instructions'].filter(Boolean)
    if (differs.length) {
      out.push({
        file: `.claude/skills/${name}/SKILL.md`,
        detail: `differs from .agents/skills/${name}/SKILL.md in its ${differs.join(' and ')}: Claude Code runs this copy and every other agent runs that one. Make the same change in both.`,
      })
    }
  }
  return out
}

/**
 * How a repo's instruction files are sized: the platforms it selects (every known one, legacy,
 * when it records none), or { error } when the selection can't be read.
 */
export function sizingFor(root) {
  const selection = readSelection(root)
  if (selection.absent) return LEGACY
  if (selection.error) return { error: selection.error }
  return { platforms: selection.platforms, legacy: false, files: new Set(selection.platforms.flatMap((p) => p.files)), problems: selection.problems }
}

const nameOf = (platforms) => platforms.map((p) => p.name).join(' and ')
const sourceOf = (platform) => platform.sources?.[0]?.url.replace(/^https?:\/\//, '') ?? 'no source recorded'

function sizeFinding(bytes, budget, sizing) {
  const effect = budget.by[0].hardEffect?.split(':')[0]
  const scope = sizing.legacy
    ? `every platform the template knows, since no ${SELECTION_FILE} records which this repo uses`
    : `the platforms ${SELECTION_FILE} selects (${sizing.platforms.map((p) => p.id).join(', ')})`
  return (
    `${bytes} bytes; ${nameOf(budget.by)} ${budget.by.length > 1 ? 'read' : 'reads'} at most ${budget.bytes}` +
    `${effect ? ` (${effect} past it)` : ''}, the strictest limit among ${scope}, so the end may never reach the agent`
  )
}

/** Findings for one instruction file: [{ file, line, kind, detail }], plus what was examined. */
export function lintFile(root, abs, index = repoPaths(listFiles(root)), scriptsFor = scriptsLookup(root), sizing = sizingFor(root)) {
  const rel = toPosix(relative(root, abs))
  const text = readFileSync(abs, 'utf8')
  const dir = dirname(abs)
  const findings = []
  const examined = { links: 0, imports: 0, paths: 0, scripts: 0 }
  const report = (line, kind, detail) => findings.push({ file: rel, line, kind, detail })

  text.split(/\r?\n/).forEach((line, i) => {
    const cps = [...line]
    let column = 0
    cps.forEach((ch, j) => {
      const cp = ch.codePointAt(0)
      const prev = cps[j - 1]?.codePointAt(0)
      const next = cps[j + 1]?.codePointAt(0)
      const allowed =
        (cp === 0xfeff && i === 0 && j === 0) ||
        (isVariationSelector(cp) && visibleNonAscii(prev)) ||
        ((cp === ZWJ || cp === ZWNJ) && visibleNonAscii(prev) && visibleNonAscii(next))
      if (isHidden(cp) && !allowed) {
        report(i + 1, 'hidden', `U+${cp.toString(16).toUpperCase().padStart(4, '0')} at column ${column + 1}`)
      }
      column += ch.length
    })
  })

  for (const { n, prose, spans, raw } of scan(text)) {
    for (const [, href] of prose.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g)) {
      const target = href.split('#')[0].split('?')[0]
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue
      let decoded = target
      try {
        decoded = decodeURIComponent(target)
      } catch (error) {
        if (!(error instanceof URIError)) throw error // a stray `%` isn't an escape: use it as written
      }
      examined.links++
      if (!existsSync(decoded.startsWith('/') ? join(root, decoded) : resolve(dir, decoded))) {
        report(n, 'link', `${href} doesn't exist`)
      }
    }
    for (const span of spans) {
      if (readsAsPath(root, dir, span)) {
        examined.paths++
        if (!pathExists(root, dir, span, index)) report(n, 'path', `${span} doesn't exist`)
      }
    }
    for (const [, tool, args] of raw.matchAll(/\b(npm|pnpm|yarn|bun) run\b([^\n`|]*)/g)) {
      const name = scriptName(args)
      if (!name) continue
      examined.scripts++
      const pkg = scriptsFor(dir)
      if (!pkg) report(n, 'script', `${tool} run ${name}, but there's no package.json between this file and the root`)
      else if (!Object.hasOwn(pkg.scripts, name)) report(n, 'script', `${tool} run ${name} isn't a script in ${pkg.path}`)
    }
  }
  const skill = SKILL_PATHS.map((p) => new RegExp(`^${p.replaceAll('.', '\\.')}/([^/]+)/SKILL\\.md$`).exec(rel)).find(Boolean)
  if (skill) {
    // Strict in the path every agent shares; a tool's own directory may carry that tool's fields.
    const strict = rel.startsWith('.agents/skills/')
    for (const problem of parseSkill(text, skill[1], { strict }).problems) report(1, 'skill', problem)
  }
  const budget = sizing.files?.has(basename(rel)) ? budgetFor(basename(rel), sizing.platforms) : null
  if (budget) {
    const bytes = Buffer.byteLength(text)
    if (bytes > budget.bytes) report(1, 'size', sizeFinding(bytes, budget, sizing))
  }
  if (/(^|\/)(CLAUDE(\.local)?|AGENTS)\.md$/.test(rel) || rel.startsWith('.claude/rules/')) {
    for (const imp of importsOf(abs, text)) {
      examined.imports++
      if (!existsSync(imp.abs)) report(imp.line, 'import', `@${imp.path} doesn't exist`)
    }
  }
  return { findings, examined }
}

// Lines in a file plus, where the platform expands them, the files its `@` imports pull in
// (recursively, each counted once), as { lines, imported: [rel] }.
function linesLoaded(root, rels, expandsImports) {
  const seen = new Set()
  const imported = []
  let lines = 0
  const visit = (abs, depth) => {
    if (!existsSync(abs) || !statSync(abs).isFile()) return
    const real = realpathSync(abs)
    if (seen.has(real)) return
    seen.add(real)
    const text = readFileSync(abs, 'utf8')
    lines += text.split(/\r?\n/).length - (/\n$/.test(text) ? 1 : 0)
    if (depth > 0) imported.push(toPosix(relative(root, abs)))
    // Claude Code follows imports four hops deep.
    if (expandsImports && depth < 4) for (const imp of importsOf(abs, text)) visit(imp.abs, depth + 1)
  }
  for (const rel of rels) visit(join(root, rel), 0)
  return { lines, imported }
}

/** Advisory notes: each selected platform's documented guidance length, where a file passes it. */
export function guidanceNotes(root, platforms) {
  const notes = []
  for (const p of platforms.filter((x) => x.guidanceLines)) {
    let entry = (p.loads ?? []).filter((rel) => existsSync(join(root, rel)))
    if (!entry.length) entry = (p.loadsOtherwise ?? []).filter((rel) => existsSync(join(root, rel)))
    if (!entry.length) continue
    const { lines, imported } = linesLoaded(root, entry, p.expandsImports)
    if (lines <= p.guidanceLines) continue
    notes.push(
      `${p.name}'s documented guidance is under ${p.guidanceLines} lines (${sourceOf(p)}); ${entry.join(' and ')} ` +
        `${entry.length > 1 ? 'are' : 'is'} ${lines}${imported.length ? ` with what ${entry.length > 1 ? 'they import' : 'it imports'} (${imported.join(', ')})` : ''}. ` +
        `Keep the rules in AGENTS.md and move reference detail into docs/ with a pointer. Advisory, not a finding.`,
    )
  }
  return notes
}

function parseArgs(argv) {
  const args = { files: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--root' || arg.startsWith('--root=')) {
      const value = arg === '--root' ? argv[++i] : arg.slice('--root='.length)
      if (!value || value.startsWith('--')) return { error: '--root needs a path.' }
      args.root = value
    } else if (arg.startsWith('--')) return { error: `Unknown argument: ${arg}` }
    else args.files.push(arg)
  }
  return args
}

function main(argv) {
  const args = parseArgs(argv)
  if (args.error) {
    console.error(`${args.error}\nUsage: node scripts/check-instructions.mjs [--root <repo>] [file...]`)
    return 2
  }
  const root = resolve(args.root ?? '.')
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`Not a directory: ${root}`)
    return 2
  }
  const missing = args.files.filter((f) => !existsSync(resolve(root, f)))
  if (missing.length) {
    console.error(`Not found: ${missing.join(', ')}`)
    return 2
  }
  const listed = listFiles(root)
  const files = args.files.length ? args.files.map((f) => resolve(root, f)) : findInstructionFiles(root, listed)
  if (!files.length) {
    // Nothing examined is not a pass.
    console.error(`No agent instruction files under ${root} (looked for ${INSTRUCTION_PATHS.join(', ')}).`)
    return 2
  }

  const sizing = sizingFor(root)
  if (sizing.error) {
    // Without a readable selection no budget is known, and a guess would be a silent pass.
    console.error(`${sizing.error}, so the instruction files' size budget can't be known. Fix it (${PROCEDURE} has the format) and run again.`)
    return 2
  }
  const total = { links: 0, imports: 0, paths: 0, scripts: 0 }
  const findings = []
  const index = repoPaths(listed)
  const scriptsFor = scriptsLookup(root)
  for (const file of files) {
    const result = lintFile(root, file, index, scriptsFor, sizing)
    findings.push(...result.findings)
    for (const k of Object.keys(total)) total[k] += result.examined[k]
  }
  // A repo-level check, so only when the whole repo is being checked.
  if (!args.files.length) {
    for (const hidden of [agentsHiddenFromClaude(root), agentsHiddenFromGemini(root)]) {
      if (hidden) findings.push({ file: hidden.file, line: 1, kind: 'hides-agents', detail: hidden.detail })
    }
    for (const copy of skillCopiesThatDiffer(root)) findings.push({ file: copy.file, line: 1, kind: 'skill-copy', detail: copy.detail })
    for (const problem of sizing.problems ?? []) findings.push({ file: SELECTION_FILE, line: 1, kind: 'platforms', detail: problem })
  }
  const notes = []
  if (sizing.legacy) {
    notes.push(
      `no ${SELECTION_FILE} records which coding agents this repo uses, so AGENTS.md and GEMINI.md are held to ` +
        `${budgetFor('AGENTS.md', PLATFORMS).bytes} bytes, the strictest limit of any platform the template knows. Record yours there, ` +
        `e.g. {"platforms": ["claude-code", "codex"]}, from ${PLATFORMS.map((p) => p.id).join(', ')}; ${PROCEDURE} says how, ` +
        `and how to research one that isn't listed.`,
    )
  } else if (!args.files.length) notes.push(...guidanceNotes(root, sizing.platforms))
  for (const f of findings) console.log(`${f.file}:${f.line}: ${f.kind}: ${f.detail}`)
  const summary =
    `${files.length} file(s): ${total.links} link(s), ${total.imports} import(s), ` +
    `${total.paths} path(s), ${total.scripts} script reference(s), and every character`
  // Said out loud, so a skipped directory is never mistaken for a checked one.
  const skipped = skeletonDirs(listed)
  const skippedNote = skipped.length ? `\nLeft out as skeletons (marked by ${SKELETON_MARKER}): ${skipped.join(', ')}` : ''
  const noted = notes.map((n) => `\nNote: ${n}`).join('')
  if (findings.length) {
    console.error(`\n✗ ${findings.length} finding(s) in ${summary}.${skippedNote}${noted}`)
    return 1
  }
  console.log(`✓ Checked ${summary}.${skippedNote}`)
  if (noted) console.error(noted.slice(1))
  return 0
}

// Run only when executed directly, so the tests can import the pieces.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let status
  try {
    status = main(process.argv.slice(2))
  } catch (error) {
    if (error?.code !== MISSING_DEPENDENCY) throw error
    console.error(error.message)
    status = 2
  }
  process.exit(status)
}
