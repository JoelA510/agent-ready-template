// React Native shapes for the core tokens whose web form doesn't carry over. The JS output keeps
// CSS strings (a `cubic-bezier()`, a `box-shadow`, a font stack) and unitless line heights, which
// is what a web consumer wants and what React Native can't use:
//
//   - easing        -> [x1, y1, x2, y2] for `Easing.bezier(...tokensNative.easing.standard)`;
//   - shadow        -> iOS shadow props from the dominant layer (`shadowColor`, `shadowOffset`,
//                      `shadowOpacity`, `shadowRadius`), an Android `elevation`, and a
//                      `boxShadow` string for React Native 0.76+ on the New Architecture, which
//                      draws every layer. shadowRadius is half the CSS blur (CSS blur is two
//                      standard deviations; iOS shadowRadius is roughly one), and elevation is the
//                      dominant layer's y offset: both are approximations to check on a device;
//   - fontFamily    -> the stack as an array, quotes removed. React Native takes one family name,
//                      the one the app registered (expo-font, react-native.config.js), so pick
//                      from this list rather than passing it whole;
//   - lineHeight    -> points, per font size: `lineHeight.md.normal` is 16 * 1.5 = 24;
//   - letterSpacing -> points, per font size: `letterSpacing.md.tight` is 16 * -0.02.
//
// It reads the AUTHORED values ({ path, value, original } per token), so a unit is known rather
// than assumed: a line height may be a multiplier or a px/rem length, a letter spacing an em,
// px, or rem length. Two kinds of problem, handled differently:
//   - a value that is valid on the web but has no React Native form (a `steps()` easing, a
//     `none` shadow is fine, an inset-only shadow has no iOS props) is left out of its group and
//     listed in `unsupported` with the reason. It doesn't fail the web build;
//   - a malformed value (a length that isn't one, an easing with an empty point, an unreadable
//     shadow color) throws, so a typo fails the build rather than emitting NaN.
// A group whose source tokens don't exist is omitted.
import { parseCssColor } from './color.mjs'

const round = (n, places = 2) => Number(n.toFixed(places))
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i

/** A number, or throws: `Number('')` is 0, which is exactly the silent failure to avoid. */
function strictNumber(raw, what) {
  const t = String(raw).trim()
  if (!NUMBER.test(t)) throw new Error(`${what}: "${raw}" is not a number`)
  return Number(t)
}

// CSS's named timing functions, as cubic-bezier control points (CSS Easing Functions Level 1).
const NAMED_EASINGS = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
}

/**
 * `cubic-bezier(a, b, c, d)` or a named easing as [a, b, c, d]; `null` with a reason for an
 * easing React Native's Easing.bezier can't express (steps(), linear() with stops).
 */
export function parseEasing(value) {
  const v = String(value).trim()
  if (Object.hasOwn(NAMED_EASINGS, v)) return NAMED_EASINGS[v]
  if (/^(steps|step-start|step-end|linear\()/.test(v)) return { unsupported: `${v} has no Easing.bezier form` }
  const m = v.match(/^cubic-bezier\(([^)]*)\)$/)
  if (!m) throw new Error(`Cannot convert easing "${value}" for React Native: use cubic-bezier(x1, y1, x2, y2) or a CSS keyword`)
  const points = m[1].split(',').map((p) => strictNumber(p, `easing "${value}"`))
  if (points.length !== 4) throw new Error(`easing "${value}": cubic-bezier takes four numbers`)
  return points
}

/** A CSS font stack as family names, quotes removed. */
export function parseFontStack(value) {
  const families = String(value)
    .split(',')
    .map((f) => f.trim().replace(/^(['"])(.*)\1$/, '$2'))
    .filter(Boolean)
  if (!families.length) throw new Error(`Empty font stack "${value}"`)
  return families
}

// Split on top-level commas only: `rgb(0 0 0 / 0.1)` and `rgba(0, 0, 0, 0.1)` stay whole.
function splitTopLevel(value) {
  const parts = []
  let depth = 0
  let current = ''
  for (const c of value) {
    if (c === '(') depth++
    if (c === ')') depth--
    if (c === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else current += c
  }
  parts.push(current)
  return parts.map((p) => p.trim()).filter(Boolean)
}

// A shadow length: `4px`, or a bare `0`.
function shadowLength(raw, layer) {
  const m = raw.match(/^([+-]?(?:\d+\.?\d*|\.\d+))(px)?$/)
  if (!m || (m[2] === undefined && Number(m[1]) !== 0)) throw new Error(`Cannot convert box-shadow layer "${layer}": "${raw}" is not a px length`)
  return Number(m[1])
}

const COLOR_IN_LAYER = /(?:rgba?|hsla?|oklch)\([^)]*\)|#[0-9a-f]{3,8}\b|\btransparent\b/i

/** One `box-shadow` layer as { inset, x, y, blur, spread, rgb, alpha }. */
function parseShadowLayer(layer) {
  const colorMatch = layer.match(COLOR_IN_LAYER)
  if (!colorMatch) throw new Error(`Cannot convert box-shadow layer "${layer}": no color`)
  const color = parseCssColor(colorMatch[0])
  const rest = layer.replace(colorMatch[0], ' ').trim().split(/\s+/).filter(Boolean)
  const inset = rest[0] === 'inset' ? Boolean(rest.shift()) : false
  if (rest.length < 2 || rest.length > 4) throw new Error(`Cannot convert box-shadow layer "${layer}": expected 2 to 4 lengths`)
  const [x, y, blur = 0, spread = 0] = rest.map((r) => shadowLength(r, layer))
  return { inset, x, y, blur, spread, rgb: color.rgb, alpha: color.alpha }
}

const hexOf = (rgb) => `#${rgb.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`
const rgbaOf = (rgb, alpha) => `rgba(${rgb.map((c) => Math.round(c * 255)).join(', ')}, ${round(alpha, 3)})`

/** A CSS `box-shadow` as React Native style props. */
export function parseShadow(value) {
  const v = String(value).trim()
  if (v === 'none') return { boxShadow: 'none' }
  const layers = splitTopLevel(v).map(parseShadowLayer)
  const outer = layers.filter((l) => !l.inset)
  const boxShadow = layers
    .map((l) => `${l.inset ? 'inset ' : ''}${l.x}px ${l.y}px ${l.blur}px ${l.spread}px ${rgbaOf(l.rgb, l.alpha)}`)
    .join(', ')
  if (!outer.length) return { boxShadow }
  // iOS draws one shadow: the largest blur is what the eye reads as the elevation.
  const dominant = outer.reduce((a, b) => (b.blur > a.blur ? b : a))
  return {
    shadowColor: hexOf(dominant.rgb),
    shadowOffset: { width: dominant.x, height: dominant.y },
    shadowOpacity: round(dominant.alpha, 3),
    shadowRadius: round(dominant.blur / 2),
    elevation: Math.max(0, Math.round(dominant.y)),
    boxShadow,
  }
}

// A line height: a unitless multiplier, or an absolute px/rem length. -> { multiplier } | { points }
function parseLineHeight(raw, path) {
  const t = String(raw).trim()
  if (NUMBER.test(t)) return { multiplier: Number(t) }
  const m = t.match(/^([+-]?(?:\d+\.?\d*|\.\d+))(px|rem)$/)
  if (m) return { points: Number(m[1]) * (m[2] === 'rem' ? 16 : 1) }
  throw new Error(`${path}: line height "${raw}" isn't a number or a px/rem length`)
}

// A letter spacing: an em coefficient, or an absolute px/rem length. -> { em } | { points }
function parseLetterSpacing(raw, path) {
  const t = String(raw).trim()
  if (t === '0' || t === 'normal') return { points: 0 }
  const m = t.match(/^([+-]?(?:\d+\.?\d*|\.\d+))(em|px|rem)$/)
  if (!m) throw new Error(`${path}: letter spacing "${raw}" isn't an em, px, or rem length`)
  const n = Number(m[1])
  return m[2] === 'em' ? { em: n } : { points: m[2] === 'rem' ? n * 16 : n }
}

/**
 * The native token object from the core tokens, each as { path: string[], value (the JS-platform
 * value), original (the authored value) }.
 */
export function deriveNativeTokens(tokens) {
  const group = (...prefix) =>
    Object.fromEntries(
      tokens
        .filter((t) => t.path.length === prefix.length + 1 && prefix.every((p, i) => t.path[i] === p))
        .map((t) => {
          const key = t.path.join('.')
          if (typeof t.original === 'string' && /^\{.*\}$/.test(t.original)) {
            throw new Error(`${key}: native tokens read authored values, and "${t.original}" is a reference`)
          }
          return [t.path.at(-1), t]
        }),
    )
  const unsupported = []
  const out = {}
  const put = (name, entries) => {
    if (Object.keys(entries).length) out[name] = entries
  }

  const easing = {}
  for (const [k, t] of Object.entries(group('motion', 'easing'))) {
    const parsed = parseEasing(t.original)
    if (Array.isArray(parsed)) easing[k] = parsed
    else unsupported.push(`motion.easing.${k}: ${parsed.unsupported}`)
  }
  put('easing', easing)

  put(
    'shadow',
    Object.fromEntries(Object.entries(group('elevation')).map(([k, t]) => [k, parseShadow(t.original)])),
  )
  put(
    'fontFamily',
    Object.fromEntries(Object.entries(group('font', 'family')).map(([k, t]) => [k, parseFontStack(t.original)])),
  )

  const sizes = Object.fromEntries(
    Object.entries(group('font', 'size')).map(([k, t]) => [k, strictNumber(t.value, `font.size.${k}`)]),
  )
  const perSize = (entries) =>
    Object.fromEntries(Object.entries(sizes).map(([size, px]) => [size, Object.fromEntries(entries.map(([k, f]) => [k, f(px)]))]))
  const lineHeights = Object.entries(group('font', 'lineHeight')).map(([k, t]) => {
    const lh = parseLineHeight(t.original, `font.lineHeight.${k}`)
    return [k, (px) => round(lh.points ?? px * lh.multiplier, 1)]
  })
  const letterSpacings = Object.entries(group('font', 'letterSpacing')).map(([k, t]) => {
    const ls = parseLetterSpacing(t.original, `font.letterSpacing.${k}`)
    return [k, (px) => round(ls.points ?? px * ls.em)]
  })
  if (lineHeights.length) put('lineHeight', perSize(lineHeights))
  if (letterSpacings.length) put('letterSpacing', perSize(letterSpacings))

  if (unsupported.length) out.unsupported = unsupported
  return out
}
