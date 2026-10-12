// The generated outputs, their sources, and the package.json scripts that build them, in one
// place: check-generated.mjs fails when they drift from their sources, init.mjs rebuilds them
// rather than editing them as text, and guard-generated.mjs stops an agent from editing them.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const OUTPUTS = [
  { path: 'platforms', source: 'tokens/**/*.json', build: 'tokens:build' },
  { path: 'src/styles/tokens', source: 'tokens/**/*.json', build: 'tokens:build' },
  // The registry also inlines src/lib/utils.ts and src/hooks/use-mobile.ts, builds its URLs from
  // package.json "homepage", and names each npm dependency's major from "dependencies".
  { path: 'registry.json', source: 'src/components/ui/, src/lib/utils.ts, src/hooks/use-mobile.ts, or package.json "homepage" or "dependencies"', build: 'registry:build' },
  { path: 'public/r', source: 'src/components/ui/, src/lib/utils.ts, src/hooks/use-mobile.ts, or package.json "homepage" or "dependencies"', build: 'registry:build' },
  { path: 'public/llms.txt', source: 'src/components/ui/, src/lib/utils.ts, src/hooks/use-mobile.ts, or package.json "homepage" or "name"', build: 'registry:build' },
  { path: '.claude/skills', source: '.agents/skills/', build: 'skills:build' },
]
export const GENERATED = OUTPUTS.map((output) => output.path)
export const BUILDS = [...new Set(OUTPUTS.map((output) => output.build))]

/** The output a repo-relative POSIX path is, or is inside; undefined when it isn't generated. */
export const outputOf = (rel) => OUTPUTS.find(({ path }) => rel === path || rel.startsWith(`${path}/`))
export const isGenerated = (rel) => outputOf(rel) !== undefined

/**
 * The file a build's package.json script runs. The scripts stay the single source of what the
 * builds are; callers run the file with their own Node rather than through `npm run` (one less
 * process, and no `npm.cmd` spawn, which Node refuses without a shell on Windows since the
 * CVE-2024-27980 fix). So only the plain `node <file>` shape is accepted.
 */
export function buildEntry(root, name) {
  const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {}
  const match = /^node (\S+)$/.exec(scripts[name] ?? '')
  if (!match) throw new Error(`package.json script "${name}" is "${scripts[name]}"; expected "node <file>".`)
  return match[1]
}
