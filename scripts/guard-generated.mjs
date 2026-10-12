#!/usr/bin/env node
// A pre-edit hook for every coding agent that has one: refuses an edit aimed at a generated
// output, and tells the agent which source to edit and which build to run instead. Golden rule 1
// (never hand-edit generated files) is then enforced as the agent works, not only when CI's
// check:generated fails afterwards. Agents without hooks, and writes made through a shell
// command, are still caught by that CI gate. Where each agent registers it, and the contract each
// one documents, is ADR 0018.
//
// Reads the hook payload (JSON) on stdin and finds the files the call would write, under each
// agent's names for them: the tool input (`tool_input`, Copilot's `toolArgs`, which may be a JSON
// string, or Antigravity's `toolCall.args`), at `file_path`, `path`, `notebook_path`, `TargetFile`,
// or `target_file`; and every file a Codex `apply_patch` adds, updates, deletes, or moves to.
// Relative paths resolve against the payload's `cwd` (Antigravity's first `workspacePaths`).
//
// Exit 2 blocks the call and hands stderr to the agent: Claude Code, Codex, Cursor, Copilot, and
// Gemini CLI all read it as a refusal. Antigravity documents only a JSON decision, so with
// `--agent antigravity` a refusal is `{"decision":"deny","reason":...}` on stdout and exit 0.
// Exit 0 with nothing printed allows the call. A payload that isn't JSON exits 1: most agents
// report that without blocking, and Copilot, which fails closed, blocks; either way it's visible.
//
// Paths are compared as the filesystem resolves them: through symlinks (a project reached via
// /tmp on macOS is /private/tmp) and, on a case-insensitive filesystem, in their real case, so
// `Platforms/…` can't slip past `platforms/`.
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { outputOf } from './generated.mjs'

const AGENTS = ['claude', 'codex', 'cursor', 'copilot', 'gemini', 'antigravity']
const PATH_KEYS = ['file_path', 'path', 'notebook_path', 'TargetFile', 'target_file']

/**
 * The files an apply_patch body writes: each Add, Update, and Delete header, and each Move to.
 * Read as Codex reads it: a header line is trimmed (so an indented one counts), except inside an
 * Update hunk, where only the line's end is, and an indented line is context, not a header.
 */
export function patchTargets(text) {
  const found = []
  let inUpdate = false
  for (const raw of text.split(/\r?\n/)) {
    // Rust's trim also takes U+0085 (next line), which JavaScript's doesn't.
    const end = raw.replace(/[\s\u0085]+$/, '')
    const m = /^\*\*\* (?:(Add|Update|Delete) File|Move to): (.+?)\s*$/.exec(inUpdate ? end : end.replace(/^[\s\u0085]+/, ''))
    if (!m) continue
    found.push(m[2])
    if (m[1]) inUpdate = m[1] === 'Update'
  }
  return found
}

function parsedArgs(value) {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return null
  }
}

/** Every path a hook payload says the call will write, from any agent's payload shape. */
export function targets(payload) {
  const inputs = [payload?.tool_input, parsedArgs(payload?.toolArgs), payload?.toolCall?.args].filter((x) => x && typeof x === 'object')
  const found = []
  for (const input of inputs) {
    for (const key of PATH_KEYS) if (typeof input[key] === 'string' && input[key]) found.push(input[key])
    // Codex sends an apply_patch as text, in `command`.
    for (const text of [input.command, input.patch, input.input]) if (typeof text === 'string') found.push(...patchTargets(text))
  }
  return [...new Set(found)]
}

/** lstat, or null where nothing is (a missing path, one below a file, or one below a link loop). */
function linkAt(path) {
  try {
    return lstatSync(path)
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'ELOOP') return null
    throw error
  }
}

/**
 * The real path: the deepest existing ancestor resolved (links, true case), the rest appended. A
 * link whose target doesn't exist yet resolves to that target, where a write through it lands.
 */
function real(path, hops = 0) {
  const missing = []
  let current = path
  while (!existsSync(current)) {
    const link = linkAt(current)
    if (link?.isSymbolicLink() && hops < 40) return join(real(resolve(dirname(current), readlinkSync(current)), hops + 1), ...missing)
    const parent = dirname(current)
    if (parent === current) return path
    missing.unshift(basename(current))
    current = parent
  }
  return join(realpathSync.native(current), ...missing)
}

function main(argv) {
  let agent = 'claude'
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--agent' && AGENTS.includes(argv[i + 1])) agent = argv[++i]
    else {
      console.error(`guard-generated: unknown argument ${argv[i]}; usage: guard-generated.mjs [--agent ${AGENTS.join('|')}]`)
      return 1
    }
  }

  let payload
  try {
    payload = JSON.parse(readFileSync(0, 'utf8'))
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    console.error(`guard-generated: the hook payload isn't JSON (${error.message}); the edit was not checked.`)
    return 1
  }

  // The project is the checkout this script lives in, which each hook's command finds from where
  // the agent is working: in a git worktree that's the worktree, where CLAUDE_PROJECT_DIR would
  // still name the main checkout.
  const project = real(dirname(dirname(fileURLToPath(import.meta.url))))
  const base = [payload?.cwd, payload?.workspacePaths?.[0]].find((p) => typeof p === 'string' && p) ?? project
  for (const target of targets(payload)) {
    const rel = relative(project, real(resolve(base, target)))
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue // outside the project
    const output = outputOf(rel.split(sep).join('/'))
    if (!output) continue
    const reason =
      `${rel} is generated (${output.path}): edit ${output.source} instead, then run \`npm run ${output.build}\`. ` +
      'Generated files are never hand-edited; CI fails when they drift from their sources (npm run check:generated).'
    if (agent === 'antigravity') {
      console.log(JSON.stringify({ decision: 'deny', reason }))
      return 0
    }
    console.error(reason)
    return 2
  }
  return 0
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)))
