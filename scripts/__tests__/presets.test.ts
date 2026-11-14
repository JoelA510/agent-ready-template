import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { toSrgbHex } from '../color.mjs'

// Brand presets (ADR 0021) fill the template's semantic roles with other values. These tests hold
// each preset to the two promises that make it safe to apply at init: it names exactly the
// template's roles, and its values pass the same contrast gate as the placeholder's.
const REPO = resolve(__dirname, '../..')
const PRESETS = readdirSync(join(REPO, 'presets'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
const roles = (file: string) =>
  Object.keys(JSON.parse(readFileSync(file, 'utf8')))
    .filter((key) => !key.startsWith('$'))
    .sort()

// A semantic role's value, followed through `{…}` references into the preset's core colors.
function roleHex(preset: string, theme: 'light' | 'dark', role: string): string {
  const read = (rel: string) => JSON.parse(readFileSync(join(REPO, 'presets', preset, 'tokens', rel), 'utf8'))
  const core = read('core/color.json')
  let value: string = read(`semantic/${theme}.json`)[role].$value
  for (let i = 0; value.startsWith('{') && i < 16; i++) {
    value = value.slice(1, -1).split('.').reduce((node: Record<string, unknown>, key) => node[key] as Record<string, unknown>, core).$value as string
  }
  return toSrgbHex(value).hex
}
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// The template's tokens and components with the preset's token sources laid over them: what a
// fork made with `--preset` holds, as far as the contrast gate reads it.
function overlay(preset: string) {
  const root = mkdtempSync(join(tmpdir(), `preset-${preset}-`))
  dirs.push(root)
  cpSync(join(REPO, 'tokens'), join(root, 'tokens'), { recursive: true })
  cpSync(join(REPO, 'presets', preset, 'tokens'), join(root, 'tokens'), { recursive: true })
  cpSync(join(REPO, 'src/components'), join(root, 'src/components'), { recursive: true })
  return root
}
const contrast = (root: string) => {
  const result = spawnSync(process.execPath, [join(REPO, 'scripts/check-contrast.mjs'), '--root', root], { encoding: 'utf8' })
  return { status: result.status, out: result.stdout + result.stderr }
}

describe('brand presets', () => {
  it('finds at least one preset, so the checks below examine something', () => {
    expect(PRESETS).toContain('plumb')
  })

  it.each(PRESETS)('%s names exactly the template\'s semantic roles, in both themes', (preset) => {
    for (const theme of ['light', 'dark']) {
      expect(roles(join(REPO, 'presets', preset, 'tokens/semantic', `${theme}.json`))).toEqual(
        roles(join(REPO, 'tokens/semantic', `${theme}.json`)),
      )
    }
  })

  it.each(PRESETS)('%s passes the contrast gate in both themes', (preset) => {
    const { status, out } = contrast(overlay(preset))
    expect(out).toContain('Every text pairing the components render meets WCAG AA')
    expect(status).toBe(0)
  })

  // The contrast gate treats a control's border as advisory, because the placeholder's are
  // decorative hairlines. A preset that gives `input` its own control-edge color holds it to
  // WCAG 1.4.11 (3:1) on every ground a control sits on: the page, a card, and a popover.
  it.each(PRESETS)('%s gives control borders (`input`) 3:1 on the background, card and popover, in both themes', (preset) => {
    const short: string[] = []
    for (const theme of ['light', 'dark'] as const) {
      const input = roleHex(preset, theme, 'input')
      for (const ground of ['background', 'card', 'popover']) {
        const r = ratio(input, roleHex(preset, theme, ground))
        if (r < 3) short.push(`${theme}: input on ${ground} ${r.toFixed(2)}:1`)
      }
    }
    expect(short).toEqual([])
  })

  it.each(PRESETS)('%s fails the contrast gate when a text role is given a low-contrast value', (preset) => {
    const root = overlay(preset)
    const file = join(root, 'tokens/semantic/light.json')
    const light = JSON.parse(readFileSync(file, 'utf8'))
    // The planted defect: primary text set to its own background.
    light['primary-foreground'] = { ...light['primary-foreground'], $value: light.primary.$value }
    writeFileSync(file, JSON.stringify(light, null, 2))
    const { status, out } = contrast(root)
    expect(status).not.toBe(0)
    expect(out).toMatch(/primary-foreground on primary/)
  })
})
