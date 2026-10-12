#!/usr/bin/env node
// Build a shadcn-compatible component registry from src/components/ui/*.tsx.
//
// WHY: this template's whole "cutting-edge consumption" path is that a downstream project
// can install a component into its own repo with the shadcn CLI:
//
//     npx shadcn@latest add https://<your-host>/r/button.json
//
// For that to work, each component needs a machine-readable manifest describing its npm
// dependencies, its sibling-component dependencies, and the files to copy. This script
// derives all of that from the source itself (by parsing import statements), so the
// registry can never drift from the components. It reads the SOURCE .tsx files and
// package.json — no build step, no third-party deps (matches scripts/init.mjs and
// scripts/check-contrast.mjs).
//
// HOSTING ASSUMPTION: the shadcn CLI fetches a single item JSON by URL. We therefore emit
// BOTH:
//   - registry.json at the repo root — the aggregate manifest (the `shadcn build` input
//     convention; also what a human/tooling reads to see every item at once), and
//   - public/r/<name>.json — one file per item, which is what `shadcn add <host>/r/<name>.json`
//     actually fetches. `public/` is served at the site root by Vite, so a deployed build
//     exposes these at https://<host>/r/<name>.json.
// Both are committed build artifacts (like the platforms/ token outputs) — the published
// thing consumers fetch — so they are NOT gitignored.
//
// Each served item carries its files' `content`: the shadcn CLI writes a file from `content`
// and silently skips one without it (read in the shadcn 4.21 source), so an item with only a
// `path` installs its npm dependencies and no component. And each dependency on another item
// here is that item's absolute URL: the CLI resolves a bare name like "button" against
// shadcn's own registry, which would install stock shadcn components in place of these.
//
// The registry is named after package.json's "name" and served from its "homepage" (the
// deployed site that serves public/r/; `npm run init --homepage` sets it for a fork). The
// dependency URLs are built from it, so the items are only installable from that site.
//
// Run: node scripts/build-registry.mjs   (also: npm run registry:build)
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLACEHOLDER_HOMEPAGE, siteBase } from './homepage.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

const UI_DIR = join(ROOT, 'src', 'components', 'ui')
const UI_DIR_REL = 'src/components/ui'

// Shared, non-ui files that components import. Each becomes its own registry item so that a
// component's registryDependencies resolve to a real, installable target.
const SHARED_ITEMS = {
  utils: {
    name: 'utils',
    type: 'registry:lib',
    title: 'cn() utility',
    description: 'clsx + tailwind-merge class-name helper used by every component.',
    file: { path: 'src/lib/utils.ts', type: 'registry:lib' },
    // import specifiers that map to this shared item
    match: ['@/lib/utils'],
  },
  'use-mobile': {
    name: 'use-mobile',
    type: 'registry:hook',
    title: 'useIsMobile hook',
    description: 'matchMedia-backed hook that reports whether the viewport is below the mobile breakpoint.',
    file: { path: 'src/hooks/use-mobile.ts', type: 'registry:hook' },
    match: ['@/hooks/use-mobile'],
  },
}

// --- package.json deps: the allow-list of "real" external packages -------------------------
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

// The registry's identity: "@acme/design-system" publishes as "acme-design-system", at the
// package's homepage, which for this package is the deployed site that serves public/r/ (init's
// --homepage). Until a fork sets one, example.com stands in.
if (typeof pkg.name !== 'string' || !pkg.name) throw new Error('package.json has no "name" to name the registry after')
const REGISTRY_NAME = pkg.name.replace(/^@/, '').replace('/', '-')
// The site's directory URL (scripts/homepage.mjs), so `r/x.json` resolves beneath it.
let REGISTRY_HOMEPAGE
try {
  REGISTRY_HOMEPAGE = siteBase(pkg.homepage ?? PLACEHOLDER_HOMEPAGE, 'package.json "homepage"')
} catch (error) {
  throw new Error(`${error.message}. The registry needs the http(s) URL of the site that serves public/r/.`, { cause: error })
}
const itemUrl = (name) => new URL(`r/${name}.json`, REGISTRY_HOMEPAGE).href
const REAL_DEPS = new Set(Object.keys(pkg.dependencies ?? {}))

// Each npm dependency is named with the major package.json declares it at: `name@^8`, or `^0.7`
// below 1.0, where a minor is a major. The shadcn CLI installs a bare name at npm's `latest`,
// which can be a major a component doesn't compile against (data-table against
// @tanstack/react-table 9, 2026-10), and installs a name with a range as given (read in shadcn's
// packages/registry/src/updaters/update-dependencies.ts). Only the major, so an in-range update
// to package.json leaves the registry as it is; a major upgrade changes it, and check:generated
// holds the two together. The cost: the CLI installs a ranged name even when the project already
// declares that package, so `shadcn add` moves the project onto this major.
const PINNABLE = /^[\^~]?(\d+)\.(\d+)\.\d+(?:-[\w.]+)?$/
function dependencySpec(name) {
  const m = PINNABLE.exec(pkg.dependencies?.[name] ?? '')
  return m ? `${name}@^${m[1] === '0' ? `0.${m[2]}` : m[1]}` : null
}
// Peer deps assumed present in any React host; never emitted as a component dependency.
const PEER_DEPS = new Set(['react', 'react-dom'])

// --- import parsing ------------------------------------------------------------------------

// Every module specifier in a top-of-file import statement. Anchoring on `^import` (with the
// `m` flag) skips specifiers that appear inside JSDoc/`//` comments (which start with ` *`
// or `//`, never column-0 `import`) — e.g. sonner.tsx documents `import ... from
// '@/components/ui/sonner'` in a comment, which must not become a self-dependency. The lazy
// `[\s\S]*?` lets a single match span a multi-line `import { ... } from '...'` block.
function importSpecifiers(source) {
  const specs = []
  const re = /^import\b[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/gm
  let m
  while ((m = re.exec(source)) !== null) specs.push(m[1])
  return specs
}

// Bare npm package name from a specifier: '@radix-ui/react-slot' -> '@radix-ui/react-slot',
// 'date-fns/foo' -> 'date-fns', 'recharts' -> 'recharts'.
function packageName(spec) {
  if (spec.startsWith('@')) {
    const parts = spec.split('/')
    return parts.slice(0, 2).join('/')
  }
  return spec.split('/')[0]
}

// Resolve an internal specifier to a registry item name, or null if it's not internal.
// Handles both alias imports (@/components/ui/x, @/lib/utils, @/hooks/use-mobile) and
// relative sibling imports within the ui dir (./button, ./toggle, ...).
function internalItemName(spec) {
  // shared lib/hook items
  for (const item of Object.values(SHARED_ITEMS)) {
    if (item.match.includes(spec)) return item.name
  }
  // alias to a ui component
  const alias = /^@\/components\/ui\/(.+)$/.exec(spec)
  if (alias) return alias[1]
  // relative sibling within the ui dir (e.g. ./button, ./toggle)
  const rel = /^\.\/(.+)$/.exec(spec)
  if (rel) return rel[1]
  return null
}

// --- scan components -----------------------------------------------------------------------

function titleCase(name) {
  return name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

const componentFiles = readdirSync(UI_DIR)
  .filter((f) => f.endsWith('.tsx') && !f.endsWith('.stories.tsx') && !f.endsWith('.test.tsx'))
  .sort()

const unclassified = [] // report: specifiers we couldn't place (not real dep, not internal)

function buildComponentItem(file) {
  const name = basename(file, '.tsx')
  const source = readFileSync(join(UI_DIR, file), 'utf8')
  const specs = importSpecifiers(source)

  const dependencies = new Set()
  const registryDependencies = new Set()

  for (const spec of specs) {
    // relative or alias path?
    const isPath = spec.startsWith('.') || spec.startsWith('@/')
    if (isPath) {
      const item = internalItemName(spec)
      if (item && item !== name) {
        registryDependencies.add(item)
      } else if (!item) {
        unclassified.push({ component: name, spec })
      }
      continue
    }
    // external package
    const p = packageName(spec)
    if (PEER_DEPS.has(p)) continue
    if (REAL_DEPS.has(p)) {
      dependencies.add(p)
    } else {
      // Not a peer, not a listed dependency, not an internal path — flag for review.
      unclassified.push({ component: name, spec })
    }
  }

  const files = [{ path: `${UI_DIR_REL}/${file}`, type: 'registry:ui' }]

  return {
    $schema: 'https://ui.shadcn.com/schema/registry-item.json',
    name,
    type: 'registry:ui',
    title: titleCase(name),
    description: `The ${titleCase(name)} component.`,
    dependencies: [...dependencies].sort(),
    registryDependencies: [...registryDependencies].sort(),
    files,
  }
}

function buildSharedItem(shared) {
  return {
    $schema: 'https://ui.shadcn.com/schema/registry-item.json',
    name: shared.name,
    type: shared.type,
    title: shared.title,
    description: shared.description,
    dependencies:
      shared.name === 'utils' ? ['clsx', 'tailwind-merge'].filter((d) => REAL_DEPS.has(d)) : [],
    registryDependencies: [],
    files: [shared.file],
  }
}

const items = [
  ...componentFiles.map(buildComponentItem),
  ...Object.values(SHARED_ITEMS).map(buildSharedItem),
].sort((a, b) => a.name.localeCompare(b.name))

// Drop empty arrays for a cleaner manifest (schema treats them as optional).
function pruneItem(item) {
  const out = { ...item }
  if (out.dependencies.length === 0) delete out.dependencies
  if (out.registryDependencies.length === 0) delete out.registryDependencies
  if (!out.description) delete out.description
  return out
}

const prunedItems = items.map(pruneItem)

// --- validation: no dangling registryDependencies -----------------------------------------
// Before anything is written, so a broken build leaves the last good registry in place.
const emittedNames = new Set(items.map((i) => i.name))
const dangling = []
for (const item of items) {
  for (const dep of item.registryDependencies ?? []) {
    if (!emittedNames.has(dep)) dangling.push({ item: item.name, missing: dep })
  }
}
if (dangling.length > 0) {
  console.error(`✗ ${dangling.length} dangling registryDependency reference(s); nothing was written:`)
  for (const d of dangling) console.error(`    ${d.item} -> ${d.missing} (no such item)`)
  process.exit(1)
}

// --- validation: every npm dependency has a major to pin ------------------------------------
const unpinnable = [...new Set(items.flatMap((item) => item.dependencies.filter((dep) => !dependencySpec(dep))))].sort()
if (unpinnable.length > 0) {
  console.error(`✗ ${unpinnable.length} dependenc${unpinnable.length === 1 ? 'y' : 'ies'} with no major to pin; nothing was written:`)
  for (const dep of unpinnable) console.error(`    ${dep}: package.json declares "${pkg.dependencies?.[dep]}", not ^x.y.z, ~x.y.z, or x.y.z`)
  process.exit(1)
}

// --- write output --------------------------------------------------------------------------
// Dependencies on items here become their URLs (see the header). Every name was checked above
// against the items written below, so every URL names one of those files. npm dependencies get
// their major (dependencySpec), checked above as well.
const linked = prunedItems.map((item) => ({
  ...item,
  ...(item.dependencies && { dependencies: item.dependencies.map(dependencySpec) }),
  ...(item.registryDependencies && { registryDependencies: item.registryDependencies.map(itemUrl) }),
}))

// The manifest lists files by path, the `shadcn build` input shape; the served items inline them.
const registry = {
  $schema: 'https://ui.shadcn.com/schema/registry.json',
  name: REGISTRY_NAME,
  homepage: REGISTRY_HOMEPAGE,
  items: linked,
}

writeFileSync(join(ROOT, 'registry.json'), JSON.stringify(registry, null, 2) + '\n')

const rDir = join(ROOT, 'public', 'r')
// Start clean so removed components don't leave stale per-item files behind.
rmSync(rDir, { recursive: true, force: true })
mkdirSync(rDir, { recursive: true })
for (const item of linked) {
  const served = { ...item, files: item.files.map((file) => ({ ...file, content: readFileSync(join(ROOT, file.path), 'utf8') })) }
  writeFileSync(join(rDir, `${item.name}.json`), JSON.stringify(served, null, 2) + '\n')
}

// llms.txt (llmstxt.org): what an agent reads first at the site's root to find the items. The
// H1 and the summary are the only parts the format fixes; each item is a link with its note.
const line = (item) => `- [${item.title ?? item.name}](${REGISTRY_HOMEPAGE}r/${item.name}.json): ${item.description ?? ''}`.trimEnd()
const llms = [
  `# ${REGISTRY_NAME}`,
  '',
  '> Accessible React components on design tokens (Radix UI and Tailwind CSS v4), published as a',
  '> shadcn registry. Each link below is a registry item: JSON holding the component\'s full source',
  `> and its dependencies. Install one with \`npx shadcn@latest add ${REGISTRY_HOMEPAGE}r/<name>.json\`.`,
  '',
  "Storybook, at this site's root, shows every component in every state, in light and dark.",
  '',
  '## Components',
  '',
  ...linked.filter((item) => item.type === 'registry:ui').map(line),
  '',
  '## Utilities',
  '',
  ...linked.filter((item) => item.type !== 'registry:ui').map(line),
  '',
].join('\n')
writeFileSync(join(ROOT, 'public', 'llms.txt'), llms)

// --- report --------------------------------------------------------------------------------
console.log(`Registry: "${REGISTRY_NAME}" (${prunedItems.length} items), served from ${REGISTRY_HOMEPAGE}r/`)
console.log(`  wrote registry.json`)
console.log(`  wrote public/r/*.json (${prunedItems.length} files, each with its source inlined)`)
console.log(`  wrote public/llms.txt`)

console.log(`  ✓ every registryDependency resolves to an emitted item`)
console.log(`  ✓ every npm dependency names the major package.json declares`)

if (unclassified.length > 0) {
  console.warn(`\n⚠ ${unclassified.length} import(s) needing manual review (not a package.json`)
  console.warn(`  dependency and not an internal registry item):`)
  for (const u of unclassified) console.warn(`    ${u.component}: ${u.spec}`)
} else {
  console.log(`  ✓ every import classified (all externals are real deps; all paths resolve)`)
}
