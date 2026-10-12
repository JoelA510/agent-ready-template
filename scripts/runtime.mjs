// The Node versions package.json's `engines` accepts, for the scripts and tests that must agree
// with it. Understands `||`-joined `^` and `>=` ranges, with a full version (the form this repo
// writes) or a partial one (`>=20`, `^22.12`, which mean .0 for what's left out). Anything else
// throws, so a new form in `engines` fails loudly instead of being misread.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** `engines.node` from this repo's package.json. */
export const enginesNode = () => JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).engines.node

const parseVersion = (v) => {
  const m = String(v).trim().replace(/^v/, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/)
  if (!m) throw new Error(`Not a version: "${v}"`)
  return { parts: [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)], majorOnly: m[2] === undefined }
}
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/** The ranges in an engines string, as [{ op, parts }]. */
function parseRange(range) {
  return range.split('||').map((r) => {
    const m = r.trim().match(/^(\^|>=)\s*(\d+(?:\.\d+){0,2})$/)
    if (!m) throw new Error(`Unsupported engines range "${r.trim()}" in "${range}": use ^X.Y.Z or >=X.Y.Z`)
    return { op: m[1], parts: parseVersion(m[2]).parts }
  })
}

/**
 * Whether a version satisfies the range. A major-only version (".nvmrc" `24`) means "the latest
 * 24.x", so it satisfies a range that admits some version of that major at or above the range's
 * own floor for it.
 */
export function satisfies(version, range) {
  const { parts, majorOnly } = parseVersion(version)
  return parseRange(range).some(({ op, parts: floor }) => {
    if (op === '^' && parts[0] !== floor[0]) return false
    if (majorOnly) return parts[0] >= floor[0]
    return compare(parts, floor) >= 0
  })
}

/** The lowest version the range accepts, as "X.Y.Z". */
export function floor(range) {
  return parseRange(range)
    .map((r) => r.parts)
    .sort(compare)[0]
    .join('.')
}
