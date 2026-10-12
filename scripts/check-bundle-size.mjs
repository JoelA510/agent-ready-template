#!/usr/bin/env node
// The size budget for what the app build ships: each budget in bundle-budget.json names a glob of
// files under the build's output directory and the most their gzipped sizes may add up to. Run it
// after `npm run build`; the gate does.
//
//   {
//     "dir": "dist",
//     "budgets": [{ "files": "assets/*.js", "gzip": "90 kB", "why": "React and the components the app renders" }]
//   }
//
// Sizes are gzip at level 9, in kB (1,000 bytes) or bytes ("90 kB", "92160 B"). A budget whose
// glob matches nothing fails: a size check that measured nothing hasn't passed. Raising a budget
// is a change like any other: say why in the pull request.
//
// Run: node scripts/check-bundle-size.mjs [--config <path>]   (exit 1 over budget, on an empty
//      match, or on a config it can't read)
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** "90 kB" or "92160 B" (or a plain number of bytes) as bytes; null for anything else. */
export function parseSize(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null
  const m = /^\s*(\d+(?:\.\d+)?)\s*(kB|B)\s*$/.exec(String(value))
  if (!m) return null
  const bytes = Number(m[1]) * (m[2] === 'kB' ? 1000 : 1)
  return bytes > 0 ? Math.round(bytes) : null
}

const kB = (bytes) => `${(bytes / 1000).toFixed(1)} kB`

// A glob (`*` within a path segment, `**` across them, `?` one character) as a predicate on
// relative paths. Kept here, not imported, so the script runs on its own once copied elsewhere.
function globMatcher(pattern) {
  const body = pattern
    .split(/(\*\*\/|\*\*|\*|\?)/)
    .map((part) => (part === '**/' ? '(?:.*/)?' : part === '**' ? '.*' : part === '*' ? '[^/]*' : part === '?' ? '[^/]' : part.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
    .join('')
  const re = new RegExp(`^${body}$`)
  return (path) => re.test(path)
}

function filesUnder(dir) {
  return readdirSync(dir, { recursive: true })
    .map((f) => String(f))
    .filter((f) => statSync(join(dir, f)).isFile())
    .map((f) => f.split(sep).join('/'))
}

/**
 * Each budget measured against the files under `root`/`config.dir`, as
 * { results: [{ files, matched, size, limit, over }], problems: string[] }.
 */
export function checkBudgets(root, config) {
  const problems = []
  if (!config || typeof config !== 'object' || typeof config.dir !== 'string' || !Array.isArray(config.budgets) || !config.budgets.length) {
    return { results: [], problems: ['the config needs a "dir" and at least one entry in "budgets"'] }
  }
  const dir = resolve(root, config.dir)
  if (relative(root, dir).startsWith('..')) return { results: [], problems: [`"dir" (${config.dir}) is outside the repository`] }
  let files
  try {
    files = filesUnder(dir)
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
    return { results: [], problems: [`${config.dir} doesn't exist: run the build first`] }
  }
  const results = []
  for (const [i, budget] of config.budgets.entries()) {
    const limit = parseSize(budget?.gzip)
    if (typeof budget?.files !== 'string' || limit === null) {
      problems.push(`budget ${i + 1} needs "files" (a glob) and "gzip" (a size like "90 kB")`)
      continue
    }
    const matches = files.filter(globMatcher(budget.files))
    if (!matches.length) {
      problems.push(`${budget.files} matched no file in ${config.dir}`)
      continue
    }
    const size = matches.reduce((sum, f) => sum + gzipSync(readFileSync(join(dir, f)), { level: 9 }).length, 0)
    results.push({ files: budget.files, matched: matches.length, size, limit, over: size > limit })
  }
  return { results, problems }
}

function main(argv) {
  let configPath = join(ROOT, 'bundle-budget.json')
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config' && argv[i + 1]) configPath = resolve(argv[++i])
    else {
      console.error(`check-bundle-size: unknown argument ${argv[i]}; usage: check-bundle-size.mjs [--config <path>]`)
      return 1
    }
  }
  let config
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
    console.error(`check-bundle-size: can't read ${relative(ROOT, configPath)}: ${error.message}`)
    return 1
  }
  const { results, problems } = checkBudgets(dirname(configPath), config)
  for (const r of results) {
    console.log(`${r.over ? '✗' : '✓'} ${r.files}: ${kB(r.size)} gzipped (${r.matched} file${r.matched === 1 ? '' : 's'}), budget ${kB(r.limit)}`)
  }
  for (const p of problems) console.error(`✗ ${p}`)
  const over = results.filter((r) => r.over)
  if (over.length) console.error(`\n${over.length} budget(s) exceeded. Shrink what ships, or raise the budget in bundle-budget.json and say why in the pull request.`)
  return over.length || problems.length ? 1 : 0
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2))
