// CSS colors as the token source may author them, turned into the sRGB values the contrast
// check measures and the native platforms need. Shared by check-contrast.mjs, the Style
// Dictionary config, and native-tokens.mjs, so every consumer reads one grammar.
//
// Accepts #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba() and hsl()/hsla() (comma or space
// syntax, with an optional alpha), oklch() (CSS Color 4: L as a number or percentage, C as a
// number or a percentage of 0.4, H in degrees), and `transparent`. Components are clamped the
// way CSS clamps them (an alpha of 50 is 1; a negative oklch chroma is 0). A malformed color
// throws: an empty component, a percentage hue, a wrong component count.
//
// Tailwind v4's palette is authored in oklch, and many of its vivid colors sit outside sRGB.
// Those are brought into sRGB with CSS Color 4's gamut-mapping algorithm (reduce chroma, keep
// lightness and hue), the mapping the spec asks browsers to use on an sRGB screen, and reported
// as mapped.

// --- sRGB <-> linear <-> OKLab (Björn Ottosson's matrices, as CSS Color 4 uses) ---------------

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

function oklabToLinearSrgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

function linearSrgbToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

const oklchToOklab = ([L, C, H]) => [L, C * Math.cos((H * Math.PI) / 180), C * Math.sin((H * Math.PI) / 180)]
const oklabToOklch = ([L, a, b]) => [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360]

const oklchToSrgb = (lch) => oklabToLinearSrgb(oklchToOklab(lch)).map(toGamma)
const srgbToOklab = (rgb) => linearSrgbToOklab(rgb.map(toLinear))

const inGamut = (rgb, eps = 1e-6) => rgb.every((c) => c >= -eps && c <= 1 + eps)
const clip = (rgb) => rgb.map((c) => Math.min(1, Math.max(0, c)))
const deltaEOK = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/**
 * An OKLCH color brought into sRGB by CSS Color 4 §13.2's binary-search gamut mapping:
 * returns [r, g, b] in 0..1 and whether the color had to change to fit.
 */
function gamutMapOklch([L, C, H]) {
  const outside = !inGamut(oklchToSrgb([L, C, H]))
  // The algorithm's first steps: lightness at or past the ends is white or black, whatever the chroma.
  if (L >= 1) return { rgb: [1, 1, 1], mapped: outside }
  if (L <= 0) return { rgb: [0, 0, 0], mapped: outside }
  const origin = oklchToSrgb([L, C, H])
  if (!outside) return { rgb: clip(origin), mapped: false }
  const JND = 0.02
  const EPSILON = 0.0001
  let min = 0
  let max = C
  let minInGamut = true
  let clipped = clip(origin)
  if (deltaEOK(srgbToOklab(clipped), oklchToOklab([L, C, H])) < JND) return { rgb: clipped, mapped: true }
  while (max - min > EPSILON) {
    const chroma = (min + max) / 2
    const current = oklchToSrgb([L, chroma, H])
    if (minInGamut && inGamut(current)) {
      min = chroma
      continue
    }
    clipped = clip(current)
    const E = deltaEOK(srgbToOklab(clipped), oklchToOklab([L, chroma, H]))
    if (E < JND) {
      if (JND - E < EPSILON) return { rgb: clipped, mapped: true }
      minInGamut = false
      min = chroma
    } else {
      max = chroma
    }
  }
  return { rgb: clipped, mapped: true }
}

// --- Parsing ------------------------------------------------------------------------------------

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

// One component: a number, a percentage of `percentOf`, `none` (0), or, where `angle` allows it,
// a number with `deg`. Anything else, including an empty component, throws.
function component(raw, { percentOf, angle = false } = {}) {
  const t = raw.trim()
  if (t === 'none') return 0
  const m = t.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg)?$/i)
  if (!m) throw new Error(`Not a number: "${raw}"`)
  const n = Number(m[1])
  if (m[2] === '%') {
    if (percentOf === undefined) throw new Error(`A percentage isn't allowed here: "${raw}"`)
    return (n / 100) * percentOf
  }
  if (m[2]?.toLowerCase() === 'deg' && !angle) throw new Error(`An angle isn't allowed here: "${raw}"`)
  return n
}

// `a b c / alpha` or `a, b, c[, alpha]` -> [[a, b, c], alpha | undefined]
function components(body) {
  const [main, slash, extra] = body.split('/')
  if (extra !== undefined) throw new Error(`More than one "/" in "${body}"`)
  const parts = main.includes(',') ? main.split(',') : main.trim().split(/\s+/)
  let alpha = slash
  if (slash === undefined && parts.length === 4 && main.includes(',')) alpha = parts.pop()
  if (parts.length !== 3) throw new Error(`Expected three components in "${body}"`)
  return [parts, alpha]
}

const alphaOf = (raw) => (raw === undefined ? 1 : clamp(component(raw, { percentOf: 1 }), 0, 1))

function hslToSrgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  return [0, 8, 4].map((n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))
}

/**
 * A CSS color as `{ rgb: [r, g, b] (0..1, sRGB), alpha, mapped }`. `mapped` is true when an
 * oklch color was outside sRGB and had to be gamut-mapped. Throws on anything it can't read.
 */
export function parseCssColor(value) {
  const v = String(value).trim().toLowerCase()
  let m
  if (v === 'transparent') return { rgb: [0, 0, 0], alpha: 0, mapped: false }
  if ((m = v.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/))) {
    const h = m[1].length <= 4 ? [...m[1]].map((c) => c + c).join('') : m[1]
    const bytes = [0, 2, 4, 6].map((i) => (i < h.length ? parseInt(h.slice(i, i + 2), 16) : 255))
    return { rgb: bytes.slice(0, 3).map((b) => b / 255), alpha: bytes[3] / 255, mapped: false }
  }
  if ((m = v.match(/^rgba?\((.*)\)$/))) {
    const [parts, alpha] = components(m[1])
    return { rgb: parts.map((p) => clamp(component(p, { percentOf: 255 }), 0, 255) / 255), alpha: alphaOf(alpha), mapped: false }
  }
  if ((m = v.match(/^hsla?\((.*)\)$/))) {
    const [[h, s, l], alpha] = components(m[1])
    const hue = ((component(h, { angle: true }) % 360) + 360) % 360
    const sat = clamp(component(s, { percentOf: 1 }), 0, 1)
    const light = clamp(component(l, { percentOf: 1 }), 0, 1)
    return { rgb: hslToSrgb(hue, sat, light), alpha: alphaOf(alpha), mapped: false }
  }
  if ((m = v.match(/^oklch\((.*)\)$/))) {
    const [[l, c, h], alpha] = components(m[1])
    const L = clamp(component(l, { percentOf: 1 }), 0, 1)
    const C = Math.max(0, component(c, { percentOf: 0.4 }))
    const H = component(h, { angle: true })
    return { ...gamutMapOklch([L, C, H]), alpha: alphaOf(alpha) }
  }
  throw new Error(`Unsupported color "${value}": use hex, rgb(), hsl(), oklch(), or transparent`)
}

const hex2 = (c) =>
  Math.round(clamp(c, 0, 1) * 255)
    .toString(16)
    .padStart(2, '0')

/**
 * A CSS color as `{ hex, mapped }`: `#rrggbb`, or `#rrggbbaa` for a translucent color when
 * `allowAlpha` is set. Without it a translucent color throws: the contrast gate can only measure
 * an opaque one.
 */
export function toSrgbHex(value, { allowAlpha = false } = {}) {
  const { rgb, alpha, mapped } = parseCssColor(value)
  if (alpha < 1 && !allowAlpha) throw new Error(`Translucent color "${value}": a token must be opaque to be measured`)
  return { hex: `#${rgb.map(hex2).join('')}${alpha < 1 ? hex2(alpha) : ''}`, mapped }
}

/** A color as oklch [L, C, H], for tests and for authors converting a palette. */
export function hexToOklch(color) {
  return oklabToOklch(srgbToOklab(parseCssColor(color).rgb))
}
