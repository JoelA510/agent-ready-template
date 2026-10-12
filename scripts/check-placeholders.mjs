#!/usr/bin/env node
// Finds unfinished skeleton content in artifacts copied out of templates/project/. A finished
// artifact contains none of:
//
//   - a placeholder: `[` + an uppercase letter + anything up to `]` on the same line, where the
//     `[` isn't preceded by a word character or `]` (that's indexing or generics:
//     `Optional[Settings]`, `Props[K]`, a reference link's second half) and the `]` isn't
//     followed by `(` or `[` (a link, a reference link). A `]:` exempts it only at the very
//     start of a line, where it's a link definition; mid-line, `— [REFUTED / CORRECTED]:` is
//     still a placeholder. Checkboxes (`[ ]`, `[x]`) and array literals don't start uppercase.
//   - a guidance comment: every skeleton comment starts `<!-- GUIDANCE`. Other HTML comments
//     (markdownlint or prettier markers in a file you merged into) are left alone.
//   - a stray comment close: a `-->` that closes no open comment, which is what's left when a
//     multi-line guidance comment is only partly deleted. (The script tracks comments across
//     lines; the grep below can't, so it doesn't look for this.)
//
// scripts/__tests__/check-placeholders.test.ts holds every skeleton to this rule (each
// bracketed placeholder must be one this finds) and proves the script agrees line for line
// with the grep one-liner the prompts give targets without Node, on everything but stray closes:
//
//   LC_ALL=C grep -nE '[^]A-Za-z0-9_]\[[A-Z][^]]*\]([^([]|$)|^\[[A-Z][^]]*\]([^(:[]|$)|<!-- GUIDANCE' <files>
//
// Files named 0000-template.md (the ADR template, which stays unfinished by design) are skipped
// with a note; exclude them from the grep yourself.
//
// Run: node scripts/check-placeholders.mjs <file-or-dir>...   (exit 1 if anything is unfinished,
//      2 if there was nothing to check)
import { closeSync, existsSync, lstatSync, openSync, readFileSync, readSync, readdirSync, realpathSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const MARKERS = [
  /(?<=[^\w\]])\[[A-Z][^\]\n]*\](?![([])/g, // mid-line: `]:` doesn't exempt it
  /^\[[A-Z][^\]\n]*\](?![([:])/g, // line start: `]:` is a link definition
  /<!-- GUIDANCE/g,
]
const EXEMPT = new Set(['0000-template.md'])
// Extensionless names count too: CODEOWNERS is a skeleton.
const TEXT_FILES = /\.(md|mdx|txt|example|ya?ml|json|toml)$|^\.env|^[^.]+$/

/** Every unfinished marker in `text`, as { line, match }. */
export function findUnfinished(text) {
  const found = []
  let inComment = false
  text.split('\n').forEach((line, i) => {
    for (const pattern of MARKERS) for (const m of line.matchAll(pattern)) found.push({ line: i + 1, match: m[0] })
    for (const [token] of line.matchAll(/<!--|-->/g)) {
      if (token === '<!--') inComment = true
      else if (inComment) inComment = false
      else found.push({ line: i + 1, match: '-->' })
    }
  })
  return found
}

// Whether a file reads as text: no NUL byte in its first 8 KB (an extensionless name can be a
// compiled binary as easily as a CODEOWNERS).
function isText(path) {
  const fd = openSync(path, 'r')
  try {
    const head = Buffer.alloc(8192)
    return !head.subarray(0, readSync(fd, head, 0, head.length, 0)).includes(0)
  } finally {
    closeSync(fd)
  }
}

// A directory argument is walked for text files only, without following symlinks.
function files(path) {
  if (!lstatSync(path).isDirectory()) return [path]
  return readdirSync(path, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && TEXT_FILES.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter(isText)
}

function main(args) {
  if (args.length === 0) {
    console.error('Usage: node scripts/check-placeholders.mjs <file-or-dir>...')
    return 2
  }
  const missing = args.filter((a) => !existsSync(a))
  if (missing.length) {
    console.error(`Not found: ${missing.join(', ')}`)
    return 2
  }
  const all = args.flatMap((a) => files(a))
  const skipped = all.filter((f) => EXEMPT.has(basename(f)))
  const checked = all.filter((f) => !EXEMPT.has(basename(f)))
  for (const f of skipped) console.log(`(skipped ${relative(process.cwd(), f)}: a template, unfinished by design)`)
  // Nothing examined is not "nothing unfinished": a directory of files this doesn't read, or only
  // the exempt template, would otherwise certify itself clean.
  if (checked.length === 0) {
    console.error(`✗ No file to check in ${args.join(', ')}: nothing was examined, so nothing is certified.`)
    return 2
  }
  let unfinished = 0
  for (const file of checked) {
    for (const { line, match } of findUnfinished(readFileSync(file, 'utf8'))) {
      unfinished++
      console.log(`${relative(process.cwd(), file)}:${line}: ${match}`)
    }
  }
  if (unfinished) {
    console.error(`\n✗ ${unfinished} unfinished placeholder(s) or guidance comment(s) in ${checked.length} file(s).`)
    return 1
  }
  console.log(`✓ No placeholders or guidance comments in ${checked.length} file(s).`)
  return 0
}

// Run only when executed directly, so the tests can import findUnfinished.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)))
}
