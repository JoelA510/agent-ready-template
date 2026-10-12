#!/usr/bin/env node
// WCAG contrast gate for the semantic color tokens.
//
// The accessibility docs quote hand-measured contrast ratios (e.g. "white on brand-700 is
// 6.73:1"). Those numbers become fiction the moment someone forks this template and swaps the
// palette — which is the whole point of the template. This script recomputes contrast directly
// from tokens/**/*.json, in both themes, and fails CI if anything drops below its WCAG bar. It
// reads the SOURCE tokens (not generated CSS) and the component source, so it needs no build
// step; its one dependency is `typescript` (already a devDependency), used to read string
// literals out of the components exactly rather than by regex.
//
// Two bars are enforced:
//   - Text (SC 1.4.3, AA): 4.5:1 for every `X-foreground` on `X`, foreground on background, and
//     every role the components render as text on some other surface (TEXT_ON_SURFACE below).
//   - Non-text (SC 1.4.11): 3:1 for focus rings, measured at the opacity the components actually
//     draw them, and for the status-colored alert icons against their tint.
//
// And a coverage scan keeps the declared lists honest: every `text-<role>`, icon color, and
// focus `ring-<role>` or `outline-<role>` class in src/components (stories included — they're
// the realistic usage) must be measured, at the alpha it's written with; where a class string
// also sets the element's own background, that exact text/background combination must be
// measured.
//
// Run: node scripts/check-contrast.mjs                  (also wired into `npm run check`)
//      node scripts/check-contrast.mjs --root <dir>     (check another tree; used by the tests)
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { toSrgbHex } from './color.mjs'

function parseArgs(argv) {
  let root
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--root') {
      root = argv[++i]
      if (root === undefined || root.startsWith('--')) return { error: '--root needs a directory argument.' }
    } else if (arg.startsWith('--root=')) {
      root = arg.slice('--root='.length)
      if (!root) return { error: '--root needs a directory argument.' }
    } else {
      return { error: `Unknown argument: ${arg}` }
    }
  }
  return { root }
}

const args = parseArgs(process.argv.slice(2))
if (args.error) {
  console.error(args.error)
  process.exit(2)
}
const ROOT = args.root === undefined ? dirname(dirname(fileURLToPath(import.meta.url))) : resolvePath(args.root)
if (!existsSync(ROOT) || !statSync(ROOT).isDirectory()) {
  console.error(`--root is not an existing directory: ${ROOT}`)
  process.exit(2)
}

const AA_NORMAL = 4.5 // WCAG 2.2 SC 1.4.3 (AA), normal-size text — the bar every text pairing must clear.
const AA_NON_TEXT = 3 // WCAG 2.2 SC 1.4.11 (AA) — UI components and meaningful graphics.

// --- Token loading + alias resolution -------------------------------------------------------

// Flatten a DTCG token tree into a { "palette.brand.700": "#5c5d4b", ... } map of leaf values.
function flatten(node, prefix, out) {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('$')) continue
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && '$value' in value) {
      out[path] = value.$value
    } else if (value && typeof value === 'object') {
      flatten(value, path, out)
    }
  }
  return out
}

const read = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'))

// Resolve a token value to the sRGB hex it renders as, following one `{alias.path}` hop into
// core. Hex, rgb(), and oklch() are accepted (scripts/color.mjs). An oklch color outside sRGB is
// gamut-mapped as CSS Color 4 tells a browser to on an sRGB screen, and listed after the results.
const GAMUT_MAPPED = new Set()
function resolve(core, value) {
  const match = /^\{(.+)\}$/.exec(value)
  const color = match ? core[match[1]] : value
  if (!color) throw new Error(`Cannot resolve color token: "${value}"`)
  let result
  try {
    result = toSrgbHex(color)
  } catch (error) {
    throw new Error(`Cannot measure color token "${value}": ${error.message}`, { cause: error })
  }
  if (result.mapped) GAMUT_MAPPED.add(`${match ? match[1] : value}: ${color} -> ${result.hex}`)
  return result.hex
}

// One accessor per theme, so every lookup of a role the theme lacks fails with the same message
// naming the file and what needed it — never a raw TypeError.
function themeReader(core, themeName) {
  const file = `tokens/semantic/${themeName}.json`
  const theme = read(file)
  return {
    name: themeName,
    roles: new Set(Object.keys(theme).filter((k) => !k.startsWith('$'))),
    has: (key) => theme[key] !== undefined,
    hex(key, neededBy) {
      if (theme[key] === undefined) {
        throw new Error(`${themeName}: ${neededBy} needs "${key}", which ${file} does not define.`)
      }
      return resolve(core, theme[key].$value)
    },
  }
}

// --- WCAG relative luminance + contrast ratio -----------------------------------------------

function channelToLinear(c) {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function luminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b)
}

// Composite `fg` at `alpha` over an opaque `bg` — how a `bg-x/10` tint or `text-x/70` renders.
function mix(fg, bg, alpha) {
  const channel = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  return (
    '#' +
    [0, 1, 2]
      .map((i) => Math.round(channel(fg, i) * alpha + channel(bg, i) * (1 - alpha)))
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')
  )
}

function contrast(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

// --- What gets measured -----------------------------------------------------------------------
// Pairings come from two sources, deliberately independent of each other:
//
// 1. Derived from token NAMES: every `X-foreground` on `X`, plus foreground on background.
// 2. Declared from component USAGE (TEXT_ON_SURFACE, ICON_ON_SURFACE, FOCUS_RING_SURFACES):
//    roles the components render on a surface other than their own — a form error is
//    `text-destructive` on the page, not on a red fill, and no naming convention reveals that.
//
// Source 1 alone once reported "all pass" while dark-theme form errors rendered at 2.9:1, and a
// focus ring the components draw at 50% opacity was measured solid. The coverage scan at the
// bottom closes the loop from the component side.

// `tint` = the surface is `bg-<tint>/<alpha * 100>` layered over `over`; it's composited before
// measuring. `alpha` on the entry itself = translucent text (`text-<fg>/<alpha * 100>`).
const surface = (over) => ({ over })
const tint = (role, alpha, over) => ({ tint: role, alpha, over })
const STATUS = ['destructive', 'success', 'warning', 'info']
const ALERT_TINT = 0.1 // alert.tsx: `bg-<status>/10`. The coverage scan fails if that drifts.
const MENU_TINT = 0.1 // dropdown/context/menubar: `data-[highlighted]:bg-destructive/10`.

const TEXT_ON_SURFACE = [
  // Secondary copy lands on every neutral surface, including highlighted menu/select/calendar
  // items (`bg-accent`).
  { fg: 'muted-foreground', on: ['background', 'card', 'popover', 'accent'].map(surface) },
  // Form messages and labels (form.tsx), destructive menu items in popovers, highlighted or not.
  {
    fg: 'destructive',
    on: [...['background', 'card', 'popover'].map(surface), tint('destructive', MENU_TINT, 'popover')],
  },
  // Success copy on the page (the form story's confirmation message).
  { fg: 'success', on: ['background', 'card'].map(surface) },
  // The `link` button variant.
  { fg: 'primary', on: ['background', 'card', 'popover'].map(surface) },
  // Tooltip: inverted surface.
  { fg: 'background', on: [surface('foreground')] },
  // Sidebar group labels (`text-sidebar-foreground/70`).
  { fg: 'sidebar-foreground', alpha: 0.7, on: [surface('sidebar')] },
  // The resizable handle's grip (`bg-border text-foreground`).
  { fg: 'foreground', on: [surface('border')] },
  // Button hover states: the fill fades to `/90` (`/80` for secondary) over the page.
  { fg: 'primary-foreground', on: [tint('primary', 0.9, 'background')] },
  { fg: 'destructive-foreground', on: [tint('destructive', 0.9, 'background')] },
  { fg: 'secondary-foreground', on: [tint('secondary', 0.8, 'background')] },
  // Status alerts (alert.tsx): title in foreground, description in muted-foreground, both on the
  // status tint over whichever surface the alert sits on.
  ...['foreground', 'muted-foreground'].map((fg) => ({
    fg,
    on: STATUS.flatMap((s) => [tint(s, ALERT_TINT, 'background'), tint(s, ALERT_TINT, 'card')]),
  })),
]

// Icons colored with a status role (alert.tsx `[&>svg]:text-<status>`), measured at 3:1. The
// warning alert's icon follows the text color instead: a yellow that clears 3:1 on a pale
// yellow tint doesn't exist in a typical light palette, so it's deliberately absent here — and
// the coverage scan fails if alert.tsx ever colors it.
const ICON_ON_SURFACE = STATUS.filter((s) => s !== 'warning').map((s) => ({
  fg: s,
  on: [tint(s, ALERT_TINT, 'background'), tint(s, ALERT_TINT, 'card')],
}))

// Surfaces a focus ring role is drawn against. The alpha is NOT declared here: it's read from
// the components' `focus-visible:ring-<role>/<alpha>` classes, so the ring is measured as drawn.
const FOCUS_RING_SURFACES = {
  ring: ['background', 'card', 'popover'],
  'sidebar-ring': ['sidebar'],
}

// Rings that mark a state other than focus (e.g. `aria-invalid:ring-destructive/20`). Reported,
// not enforced: the invalid state is also carried by a solid `border-destructive` and the
// error message text, so the ring is supplementary. An unprefixed ring color (`ring-2
// ring-background` separating stacked avatars) is decoration, not a state, and isn't listed.
const ADVISORY_RING_SURFACE = 'background'

const alphaKey = (role, alpha) => (alpha === 1 ? role : `${role}/${Math.round(alpha * 100)}`)
const surfaceKey = (on) => (on.tint ? `${alphaKey(on.tint, on.alpha)} tint` : on.over)
const describeSurface = (on) => (on.tint ? `${alphaKey(on.tint, on.alpha)} over ${on.over}` : on.over)

function textPairings(t) {
  const bgOf = (on, neededBy) =>
    on.tint ? mix(t.hex(on.tint, neededBy), t.hex(on.over, neededBy), on.alpha) : t.hex(on.over, neededBy)

  const list = [
    {
      label: 'foreground on background',
      fgKey: 'foreground',
      surfaceKey: 'background',
      fg: t.hex('foreground', 'the base foreground/background pairing'),
      bg: t.hex('background', 'the base foreground/background pairing'),
    },
  ]
  for (const key of t.roles) {
    if (!key.endsWith('-foreground')) continue
    const surfaceRole = key.replace(/-foreground$/, '')
    if (!t.has(surfaceRole)) continue
    list.push({
      label: `${key} on ${surfaceRole}`,
      fgKey: key,
      surfaceKey: surfaceRole,
      fg: t.hex(key, 'a derived X-foreground pairing'),
      bg: t.hex(surfaceRole, 'a derived X-foreground pairing'),
    })
  }
  for (const entry of TEXT_ON_SURFACE) {
    const alpha = entry.alpha ?? 1
    for (const on of entry.on) {
      const neededBy = `TEXT_ON_SURFACE (${entry.fg} on ${describeSurface(on)})`
      const bg = bgOf(on, neededBy)
      const fg = alpha < 1 ? mix(t.hex(entry.fg, neededBy), bg, alpha) : t.hex(entry.fg, neededBy)
      list.push({
        label: `${alphaKey(entry.fg, alpha)} on ${describeSurface(on)}`,
        fgKey: alphaKey(entry.fg, alpha),
        surfaceKey: surfaceKey(on),
        fg,
        bg,
      })
    }
  }
  return list
}

function nonTextPairings(t, scan) {
  const list = []
  // Focus rings, at every alpha the components draw them with.
  for (const { role, alpha } of scan.focusRings) {
    const surfaces = FOCUS_RING_SURFACES[role]
    if (!surfaces) continue // reported as uncovered by the coverage pass
    for (const over of surfaces) {
      const neededBy = `FOCUS_RING_SURFACES (${alphaKey(role, alpha)} on ${over})`
      const bg = t.hex(over, neededBy)
      list.push({
        label: `${alphaKey(role, alpha)} (focus ring) on ${over}`,
        fg: mix(t.hex(role, neededBy), bg, alpha),
        bg,
        enforced: true,
      })
    }
  }
  for (const entry of ICON_ON_SURFACE) {
    for (const on of entry.on) {
      const neededBy = `ICON_ON_SURFACE (${entry.fg} on ${describeSurface(on)})`
      list.push({
        label: `${entry.fg} icon on ${describeSurface(on)}`,
        fgKey: entry.fg,
        surfaceKey: surfaceKey(on),
        fg: t.hex(entry.fg, neededBy),
        bg: mix(t.hex(on.tint, neededBy), t.hex(on.over, neededBy), on.alpha),
        enforced: true,
      })
    }
  }
  // Advisory rows: skipped (not failed) when a fork's theme doesn't define the role.
  for (const { role, alpha } of scan.otherRings) {
    if (!t.has(role) || !t.has(ADVISORY_RING_SURFACE)) continue
    const bg = t.hex(ADVISORY_RING_SURFACE, 'an advisory ring pairing')
    list.push({
      label: `${alphaKey(role, alpha)} (state ring) on ${ADVISORY_RING_SURFACE}`,
      fg: mix(t.hex(role, 'an advisory ring pairing'), bg, alpha),
      bg,
      enforced: false,
    })
  }
  // `border`/`input`: 1.4.11 applies to a boundary only when it's the sole thing identifying
  // the control; a divider or a card edge is decorative and exempt. Which of those a fork's
  // inputs are is a design call (this template inherits shadcn's low-contrast borders), so the
  // numbers are surfaced for an informed decision rather than silently passed or failed.
  for (const role of ['border', 'input']) {
    if (!t.has(role) || !t.has('background')) continue
    list.push({
      label: `${role} on background`,
      fg: t.hex(role, 'an advisory boundary pairing'),
      bg: t.hex('background', 'an advisory boundary pairing'),
      enforced: false,
    })
  }
  return list
}

// --- Component scan ---------------------------------------------------------------------------

const SCAN_DIR = 'src/components'

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) sourceFiles(rel, out)
    else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) out.push(rel)
  }
  return out
}

// Split a class into its variant prefixes and the utility, on the `:` separators that sit
// outside brackets/parens — `[&_svg:not([class*='size-'])]:size-4` has colons inside brackets.
function splitVariants(token) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < token.length; i++) {
    const c = token[i]
    if (c === '[' || c === '(') depth++
    else if (c === ']' || c === ')') depth--
    else if (c === ':' && depth === 0) {
      parts.push(token.slice(start, i))
      start = i + 1
    }
  }
  return { variants: parts, utility: token.slice(start) }
}

function parseAlpha(raw) {
  if (raw === undefined) return 1
  const arbitrary = /^\[(.+)\]$/.exec(raw)
  const value = arbitrary ? arbitrary[1] : raw
  if (value.endsWith('%')) return Number(value.slice(0, -1)) / 100
  const n = Number(value)
  if (Number.isNaN(n)) return undefined
  return arbitrary ? n : n / 100 // `/[.9]` is a fraction; `/90` is a percentage
}

// Parse one class token into { kind, role, alpha, variants } for text-, bg-, and ring- colors
// that name a semantic role, in every Tailwind v4 spelling: `text-x`, `text-x/70`,
// `text-x/[.7]`, `text-x!`, `!text-x`, `text-(--x)`, `text-(--color-x)`, `text-[var(--x)]`.
// An outline color is a ring for this purpose: both draw a focus indicator (ScrollArea's
// viewport uses an inset outline, since an outset ring there is clipped).
// Anything else (sizes, raw palette steps, arbitrary hex) returns undefined.
function parseColorClass(token, roles) {
  const { variants, utility } = splitVariants(token)
  const bare = utility.replace(/^!/, '').replace(/!$/, '')
  const m = /^(text|bg|ring|outline)-(.+)$/.exec(bare)
  if (!m) return undefined
  const [, utilityKind, rest] = m
  const kind = utilityKind === 'outline' ? 'ring' : utilityKind
  let roleRaw
  let alphaRaw
  const cssVar = /^\((?:--color-|--)([a-z][a-z0-9-]*)\)(?:\/(.+))?$/.exec(rest)
  const arbitraryVar = /^\[var\((?:--color-|--)([a-z][a-z0-9-]*)\)\](?:\/(.+))?$/.exec(rest)
  const plain = /^([a-z][a-z-]*?)(?:\/(.+))?$/.exec(rest)
  if (cssVar) [, roleRaw, alphaRaw] = cssVar
  else if (arbitraryVar) [, roleRaw, alphaRaw] = arbitraryVar
  else if (plain) [, roleRaw, alphaRaw] = plain
  else return undefined
  if (!roles.has(roleRaw)) return undefined
  const alpha = parseAlpha(alphaRaw)
  if (alpha === undefined) return undefined
  // An arbitrary variant that targets an svg descendant (`[&>svg]:`, `[&_svg]:`) colors an icon;
  // `has-[>svg]:` colors the element itself when it contains one, so it stays text.
  const icon = kind === 'text' && variants.some((v) => /^\[&[>_ ]svg/.test(v))
  return { kind: icon ? 'icon' : kind, role: roleRaw, alpha, variants: variants.join(':') }
}

// Every string literal in a source file, via the TypeScript parser. A regex over quotes gets
// lost at the first apostrophe in JSX text ("Don't…") and silently misreads the rest of the
// file — the exact failure mode a coverage scan can't afford. Template literals contribute
// their static parts.
function stringLiterals(file, source) {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, kind)
  const out = []
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text)
    else if (ts.isTemplateExpression(node)) {
      out.push(node.head.text, ...node.templateSpans.map((span) => span.literal.text))
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return out
}

const FOCUS_VARIANT = /(^|:)(focus|focus-visible|focus-within|data-\[active=true\])(:|$)/
const STATE_VARIANT = /(^|:)aria-invalid(:|$)/

function scanComponents(roles) {
  if (!existsSync(join(ROOT, SCAN_DIR))) {
    throw new Error(`Coverage scan: ${SCAN_DIR}/ does not exist under ${ROOT} — the scan is broken, not the components.`)
  }
  const files = sourceFiles(SCAN_DIR)
  const text = new Map() // "role/alpha" -> Set<file>
  const icon = new Map()
  const focusRings = new Map() // "role/alpha" -> { role, alpha }
  const otherRings = new Map()
  const unknownFocusRings = new Map() // role -> Set<file>
  const sameElement = [] // { kind, fgKey, surfaceKey, file }
  const add = (map, key, file) => (map.get(key) ?? map.set(key, new Set()).get(key)).add(file)

  for (const file of files) {
    const source = readFileSync(join(ROOT, file), 'utf8')
    // Each string literal is one class list (cva bases and variants are separate literals).
    for (const literal of stringLiterals(file, source)) {
      const classes = literal
        .split(/\s+/)
        .map((token) => parseColorClass(token, roles))
        .filter(Boolean)
      for (const c of classes) {
        const key = alphaKey(c.role, c.alpha)
        if (c.kind === 'text') add(text, key, file)
        else if (c.kind === 'icon') add(icon, key, file)
        else if (c.kind === 'ring') {
          if (FOCUS_VARIANT.test(c.variants) && !STATE_VARIANT.test(c.variants)) {
            focusRings.set(key, { role: c.role, alpha: c.alpha })
            if (!FOCUS_RING_SURFACES[c.role]) add(unknownFocusRings, key, file)
          } else if (c.variants !== '') {
            otherRings.set(key, { role: c.role, alpha: c.alpha })
          }
        }
      }
      // Same-element pairs: a text/icon color and a background in one class list apply to the
      // same element whenever their variant states coincide — the same prefix, or one side
      // unprefixed and not overridden by the other side's kind under the prefixed side's state
      // (`bg-background hover:bg-accent hover:text-accent-foreground` never shows the hover text
      // on bg-background). Two different prefixes can't be reasoned about statically; the
      // role-level coverage above still requires both to be measured somewhere.
      const bgs = classes.filter((c) => c.kind === 'bg')
      const overriddenUnder = (kind, variants) => classes.some((o) => o.kind === kind && o.variants === variants)
      for (const fg of classes.filter((c) => c.kind === 'text' || c.kind === 'icon')) {
        for (const bg of bgs) {
          const coincide =
            fg.variants === bg.variants ||
            (fg.variants === '' && !overriddenUnder(fg.kind, bg.variants)) ||
            (bg.variants === '' && !overriddenUnder('bg', fg.variants))
          if (!coincide) continue
          sameElement.push({
            kind: fg.kind,
            fgKey: alphaKey(fg.role, fg.alpha),
            surfaceKey: bg.alpha === 1 ? bg.role : `${alphaKey(bg.role, bg.alpha)} tint`,
            file,
          })
        }
      }
    }
  }
  // Positive control: if the scan sees no text colors at all, the pattern or the path is
  // broken, and an empty result would read as "fully covered".
  if (files.length === 0 || !text.has('foreground')) {
    throw new Error(
      `Coverage scan found ${files.length} source file(s) and no \`text-foreground\` usage under ` +
        `${SCAN_DIR}/ — the scan is broken, not the components.`,
    )
  }
  return {
    files,
    text,
    icon,
    focusRings: [...focusRings.values()],
    otherRings: [...otherRings.values()],
    unknownFocusRings,
    sameElement,
  }
}

// Every usage must be measured by some pairing — keyed by role AND alpha, and for same-element
// pairs by the exact surface. Returns human-readable problems, one per distinct usage.
function coverage(scan, textPairs, nonTextPairs) {
  const problems = []
  const textFg = new Set(textPairs.map((p) => p.fgKey))
  // A role checked as text cleared 4.5:1 on its surfaces, which covers the 3:1 an icon needs.
  const iconFg = new Set([...textFg, ...nonTextPairs.filter((p) => p.enforced && p.fgKey).map((p) => p.fgKey)])
  const measured = new Set([...textPairs, ...nonTextPairs.filter((p) => p.fgKey)].map((p) => `${p.fgKey} on ${p.surfaceKey}`))

  for (const [key, files] of scan.text) {
    if (!textFg.has(key)) {
      problems.push(`\`text-${key}\` colors text in ${[...files].join(', ')} but no pairing measures ${key} as text. Add the surfaces it lands on to TEXT_ON_SURFACE.`)
    }
  }
  for (const [key, files] of scan.icon) {
    if (!iconFg.has(key)) {
      problems.push(`\`text-${key}\` colors an icon in ${[...files].join(', ')} but no pairing measures it. Add it to ICON_ON_SURFACE.`)
    }
  }
  for (const [key, files] of scan.unknownFocusRings) {
    problems.push(`\`ring-${key}\` is a focus ring in ${[...files].join(', ')} but FOCUS_RING_SURFACES doesn't say what it's drawn on.`)
  }
  const seen = new Set()
  for (const { kind, fgKey, surfaceKey: onKey, file } of scan.sameElement) {
    const pair = `${fgKey} on ${onKey}`
    if (measured.has(pair) || seen.has(`${kind}:${pair}`)) continue
    seen.add(`${kind}:${pair}`)
    const list = kind === 'icon' ? 'ICON_ON_SURFACE' : 'TEXT_ON_SURFACE'
    problems.push(`${file} renders ${kind} ${fgKey} on ${onKey} in one class list, and no pairing measures exactly that. Add it to ${list}.`)
  }
  return problems
}

// --- Run ------------------------------------------------------------------------------------

function main() {
  const core = flatten(read('tokens/core/color.json'), '', {})
  const themes = ['light', 'dark'].map((name) => themeReader(core, name))
  // Roles are scanned once; a role defined in either theme counts as a role.
  const scan = scanComponents(new Set(themes.flatMap((t) => [...t.roles])))

  let failures = 0
  let advisories = 0
  const problems = new Set()
  for (const t of themes) {
    const textPairs = textPairings(t)
    console.log(`\n${t.name} theme — text (AA ${AA_NORMAL}:1), ${textPairs.length} pairings`)
    for (const { label, fg, bg } of textPairs) {
      const ratio = contrast(fg, bg)
      const pass = ratio >= AA_NORMAL
      if (!pass) failures++
      console.log(`  ${pass ? '✓' : '✗'} ${ratio.toFixed(2).padStart(5)}:1  ${label}`)
    }

    const nonTextPairs = nonTextPairings(t, scan)
    console.log(`\n${t.name} theme — non-text (SC 1.4.11 ${AA_NON_TEXT}:1)`)
    for (const { label, fg, bg, enforced } of nonTextPairs) {
      const ratio = contrast(fg, bg)
      const pass = ratio >= AA_NON_TEXT
      if (!pass && enforced) failures++
      if (!pass && !enforced) advisories++
      const mark = pass ? '✓' : enforced ? '✗' : '!'
      const note = pass || enforced ? '' : '  (advisory — see note in this script)'
      console.log(`  ${mark} ${ratio.toFixed(2).padStart(5)}:1  ${label}${note}`)
    }

    for (const problem of coverage(scan, textPairs, nonTextPairs)) problems.add(problem)
  }

  console.log(`\nScanned ${scan.files.length} files under ${SCAN_DIR}/.`)
  if (GAMUT_MAPPED.size) {
    console.log(
      `\nMeasured after CSS Color 4 gamut mapping (outside sRGB; a browser that clips instead can ` +
        `render these slightly differently, so leave a margin):\n` +
        [...GAMUT_MAPPED].map((c) => `  ~ ${c}`).join('\n'),
    )
  }
  for (const problem of problems) console.error(`\n✗ ${problem}`)
  if (failures > 0) {
    console.error(
      `\n✗ ${failures} color pairing(s) fall below their WCAG bar (text ${AA_NORMAL}:1, non-text ` +
        `${AA_NON_TEXT}:1). Adjust the palette in tokens/core/color.json or the role mapping in ` +
        `tokens/semantic/*.json.`,
    )
  }
  if (problems.size > 0) console.error(`\n✗ ${problems.size} color usage(s) in components are not measured by any pairing.`)
  if (failures > 0 || problems.size > 0) return 1

  console.log(
    `\n✓ Every text pairing the components render meets WCAG AA (${AA_NORMAL}:1), and focus rings ` +
      `(at their drawn opacity) and status icons meet SC 1.4.11 (${AA_NON_TEXT}:1), in both themes.`,
  )
  if (advisories > 0) {
    console.log(
      `  ${advisories} advisory pairing(s) below ${AA_NON_TEXT}:1 — review whether those borders or ` +
        `state rings are the sole means of identifying a control or its state.`,
    )
  }
  return 0
}

try {
  process.exit(main())
} catch (error) {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
