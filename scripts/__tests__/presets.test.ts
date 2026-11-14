import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

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
