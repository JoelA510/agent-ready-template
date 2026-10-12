import { describe, expect, it } from 'vitest'
import { hexToOklch, toSrgbHex } from '../color.mjs'

describe('toSrgbHex', () => {
  // Tailwind v4 authors its palette in oklch and publishes the sRGB hex each renders as; those
  // published values are the reference here.
  it.each([
    ['oklch(0.637 0.237 25.331)', '#fb2c36', false], // red-500
    ['oklch(0.546 0.245 262.881)', '#155dfc', false], // blue-600
    ['oklch(0.723 0.219 149.579)', '#00c950', true], // green-500: outside sRGB, gamut-mapped
    ['oklch(0.556 0 0)', '#737373', false], // neutral-500
    ['oklch(55.6% 0 0)', '#737373', false],
    ['oklch(1 0 0)', '#ffffff', false],
    ['oklch(0 0 0)', '#000000', false],
  ])('%s -> %s (mapped: %s)', (input, hex, mapped) => {
    expect(toSrgbHex(input)).toEqual({ hex, mapped })
  })

  it.each([
    ['#5c5d4b', '#5c5d4b'],
    ['#ABC', '#aabbcc'],
    ['rgb(92 93 75)', '#5c5d4b'],
    ['rgb(92, 93, 75)', '#5c5d4b'],
    ['rgba(92, 93, 75, 1)', '#5c5d4b'],
  ])('%s -> %s', (input, hex) => {
    expect(toSrgbHex(input).hex).toBe(hex)
  })

  it.each([
    ['hsl(140 100% 39%)', '#00c742'],
    ['hsl(140, 100%, 39%)', '#00c742'],
    ['hsl(140deg 100% 39%)', '#00c742'],
    ['rgb(0 0 0 / 50)', '#000000'], // an alpha of 50 clamps to 1, as CSS does
    ['rgb(300 -5 0)', '#ff0000'], // channels clamp
    ['oklch(0.5 -0.1 20)', '#636363'], // a negative chroma is 0: gray
  ])('reads %s as CSS does -> %s', (input, hex) => {
    expect(toSrgbHex(input).hex).toBe(hex)
  })

  it('keeps alpha when asked, as #rrggbbaa', () => {
    expect(toSrgbHex('#00000080', { allowAlpha: true }).hex).toBe('#00000080')
    expect(toSrgbHex('rgba(0, 0, 0, 0.5)', { allowAlpha: true }).hex).toBe('#00000080')
    expect(toSrgbHex('transparent', { allowAlpha: true }).hex).toBe('#00000000')
    expect(toSrgbHex('#0008', { allowAlpha: true }).hex).toBe('#00000088')
  })

  it('reports a chromatic color at the ends of lightness as mapped, since a clipping browser shows it differently', () => {
    expect(toSrgbHex('oklch(1 0.3 100)')).toEqual({ hex: '#ffffff', mapped: true })
    expect(toSrgbHex('oklch(1 0 0)')).toEqual({ hex: '#ffffff', mapped: false })
  })

  it('round-trips an sRGB hex through oklch', () => {
    for (const hex of ['#2f7f5f', '#5c5d4b', '#f9f9f5', '#1e1e1a', '#abc']) {
      const [L, C, H] = hexToOklch(hex)
      expect(toSrgbHex(`oklch(${L} ${C} ${H})`).hex).toBe(toSrgbHex(hex).hex)
    }
  })

  it.each([
    ['color(display-p3 0.3 0.4 0.2)', /Unsupported color/],
    ['oklch(0.5 0.1 20 / 0.5)', /Translucent color/],
    ['rgb(0 0 0 / 50%)', /Translucent color/],
    ['#00000080', /Translucent color/],
    ['oklch(0.5 banana 20)', /Not a number/],
    ['oklch(,0.1,20)', /Not a number/],
    ['rgb(92,,75)', /Not a number/],
    ['oklch(0.5 0.1 50%)', /percentage isn't allowed/],
    ['rgb(1 2)', /three components/],
  ])('refuses %s rather than guess', (input, message) => {
    expect(() => toSrgbHex(input)).toThrow(message)
  })
})
