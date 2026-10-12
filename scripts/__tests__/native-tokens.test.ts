import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deriveNativeTokens, parseEasing, parseFontStack, parseShadow } from '../native-tokens.mjs'

const REPO = resolve(__dirname, '../..')

type Token = { path: string[]; value: unknown; original: unknown }

// The core tokens as the build hands them over: the JS-platform value, and the authored one.
function coreTokens(): Token[] {
  const js = JSON.parse(readFileSync(join(REPO, 'platforms/js/tokens-core.json'), 'utf8'))
  const out: Token[] = []
  const walk = (node: Record<string, unknown>, path: string[]) => {
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('$') || !v || typeof v !== 'object') continue
      if ('$value' in v) {
        const value = [...path, k].reduce<unknown>((o, key) => (o as Record<string, unknown>)?.[key], js)
        out.push({ path: [...path, k], value, original: (v as { $value: unknown }).$value })
      } else walk(v as Record<string, unknown>, [...path, k])
    }
  }
  for (const f of readdirSync(join(REPO, 'tokens/core'))) walk(JSON.parse(readFileSync(join(REPO, 'tokens/core', f), 'utf8')), [])
  return out
}
const edit = (tokens: Token[], path: string, original: unknown) =>
  tokens.map((t) => (t.path.join('.') === path ? { ...t, original } : t))

describe('parseEasing', () => {
  it.each([
    ['cubic-bezier(0.4, 0, 0.2, 1)', [0.4, 0, 0.2, 1]],
    ['cubic-bezier(0,0,1,1)', [0, 0, 1, 1]],
    ['ease-in-out', [0.42, 0, 0.58, 1]],
    ['linear', [0, 0, 1, 1]],
  ])('%s', (input, points) => {
    expect(parseEasing(input)).toEqual(points)
  })

  it.each(['steps(4, end)', 'step-start', 'linear(0, 0.5 50%, 1)'])('reports %s as having no Easing.bezier form', (input) => {
    expect(parseEasing(input)).toEqual({ unsupported: expect.stringContaining('no Easing.bezier form') })
  })

  it.each([
    ['cubic-bezier(0.4, 0, 0.2)', /four numbers/],
    ['cubic-bezier(0.4,,0.2,1)', /is not a number/],
    ['constructor', /Cannot convert easing/],
    ['toString', /Cannot convert easing/],
    ['springy', /Cannot convert easing/],
  ])('refuses %s', (input, message) => {
    expect(() => parseEasing(input)).toThrow(message)
  })
})

describe('parseFontStack', () => {
  it('returns family names in order, quotes removed', () => {
    expect(parseFontStack(`'Inter Variable', Inter, "SF Pro", system-ui`)).toEqual(['Inter Variable', 'Inter', 'SF Pro', 'system-ui'])
  })
})

describe('parseShadow', () => {
  it('takes the iOS shadow from the layer with the largest blur, and keeps every layer in boxShadow', () => {
    expect(parseShadow('0 2px 4px -2px rgb(15 23 22 / 0.06), 0 12px 24px -4px rgb(15 23 22 / 0.12)')).toEqual({
      shadowColor: '#0f1716',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.12,
      shadowRadius: 12,
      elevation: 12,
      boxShadow: '0px 2px 4px -2px rgba(15, 23, 22, 0.06), 0px 12px 24px -4px rgba(15, 23, 22, 0.12)',
    })
  })

  it('reads colors the way the contrast gate does (one grammar), clamping as CSS does', () => {
    expect(parseShadow('0 1px 2px #000')).toMatchObject({ shadowColor: '#000000', shadowOpacity: 1 })
    expect(parseShadow('0 0 #0000')).toMatchObject({ shadowOpacity: 0 })
    expect(parseShadow('0 1px 2px rgb(0 0 0 / 50)')).toMatchObject({ shadowOpacity: 1 })
    expect(parseShadow('0 1px 2px rgb(255.6 0 0 / 0.1)')).toMatchObject({ shadowColor: '#ff0000' })
    expect(parseShadow('0 1px 2px oklch(0.5 0 0 / 0.2)')).toMatchObject({ shadowOpacity: 0.2 })
  })

  it('handles none, and leaves inset layers to boxShadow only', () => {
    expect(parseShadow('none')).toEqual({ boxShadow: 'none' })
    expect(parseShadow('inset 0 1px 0 rgba(255, 255, 255, 0.5)')).toEqual({
      boxShadow: 'inset 0px 1px 0px 0px rgba(255, 255, 255, 0.5)',
    })
  })

  it.each([
    ['0 1px 2px', /no color/],
    ['0 1em 2px black', /no color|not a px length/],
    ['0 1.2.3px 2px #000', /not a px length/],
    ['0 1px 2px rgb(0,,0)', /Not a number/],
  ])('refuses %s', (input, message) => {
    expect(() => parseShadow(input)).toThrow(message)
  })
})

describe('deriveNativeTokens', () => {
  const tokens = coreTokens()

  it('turns line heights and letter spacing into points per font size', () => {
    const native = deriveNativeTokens(tokens)
    expect(native.lineHeight.md).toEqual({ tight: 17.6, snug: 20.8, normal: 24, relaxed: 26.4 })
    expect(native.letterSpacing.md).toEqual({ tight: -0.32, normal: 0, wide: 0.32 })
  })

  it('is what the committed tokens-native.json holds', () => {
    expect(JSON.parse(readFileSync(join(REPO, 'platforms/js/tokens-native.json'), 'utf8'))).toEqual(deriveNativeTokens(tokens))
  })

  it('reads the unit a value was authored with instead of assuming one', () => {
    const native = deriveNativeTokens(edit(edit(tokens, 'font.letterSpacing.tight', '-0.5px'), 'font.lineHeight.normal', '1.25rem'))
    expect(native.letterSpacing.md.tight).toBe(-0.5)
    expect(native.lineHeight.md.normal).toBe(20)
    expect(native.lineHeight.xs.normal).toBe(20)
  })

  it.each([
    ['font.lineHeight.normal', 'calc(1.5 / 1)', /line height "calc\(1.5 \/ 1\)" isn't a number/],
    ['font.letterSpacing.tight', '-0.5', /isn't an em, px, or rem length/],
    ['font.letterSpacing.tight', '{font.letterSpacing.normal}', /is a reference/],
  ])('refuses %s: %s', (path, value, message) => {
    expect(() => deriveNativeTokens(edit(tokens, path, value))).toThrow(message)
  })

  it('lists a web value with no React Native form instead of failing the build', () => {
    const native = deriveNativeTokens(edit(tokens, 'motion.easing.standard', 'steps(4, end)'))
    expect(native.easing.standard).toBeUndefined()
    expect(native.unsupported).toEqual(['motion.easing.standard: steps(4, end) has no Easing.bezier form'])
  })

  it('leaves out a group a fork removed', () => {
    const native = deriveNativeTokens(tokens.filter((t) => t.path[0] !== 'elevation'))
    expect(native.shadow).toBeUndefined()
    expect(native.easing).toBeDefined()
  })
})
