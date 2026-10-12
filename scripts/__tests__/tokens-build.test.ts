import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const REPO = resolve(__dirname, '../..')
const roots: string[] = []

// A throwaway copy of the token pipeline (the config plus every script module it could import),
// built for real. `edit` changes the authored core tokens before each build.
function pipeline() {
  const root = mkdtempSync(join(tmpdir(), 'tokens-build-'))
  roots.push(root)
  cpSync(join(REPO, 'tokens'), join(root, 'tokens'), { recursive: true })
  cpSync(join(REPO, 'scripts'), join(root, 'scripts'), { recursive: true, filter: (src) => !src.includes('__tests__') })
  for (const f of ['style-dictionary.config.mjs', 'package.json']) cpSync(join(REPO, f), join(root, f))
  symlinkSync(join(REPO, 'node_modules'), join(root, 'node_modules'), 'dir')
  // Set one authored token value: `set('color.json', 'palette.brand.700', 'oklch(...)')`.
  const set = (file: string, tokenPath: string, value: string) => {
    const path = join(root, 'tokens/core', file)
    const json = JSON.parse(readFileSync(path, 'utf8'))
    const token = tokenPath.split('.').reduce((node, key) => node[key], json)
    token.$value = value
    writeFileSync(path, JSON.stringify(json))
  }
  const build = () => {
    const result = spawnSync(process.execPath, ['style-dictionary.config.mjs'], { cwd: root, encoding: 'utf8' })
    return { status: result.status, out: result.stdout + result.stderr }
  }
  const read = (path: string) => readFileSync(join(root, path), 'utf8')
  const setBrand700 = (color: string) => set('color.json', 'palette.brand.700', color)
  return { root, set, build, read, setBrand700 }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('the token build', () => {
  it('keeps an oklch() color in CSS and ships the same sRGB color to JS, iOS, and Android, never black', () => {
    const p = pipeline()
    // Tailwind v4 green-500: outside sRGB, gamut-mapped to its published #00c950.
    p.setBrand700('oklch(0.723 0.219 149.579)')
    const { status, out } = p.build()
    expect(status, out).toBe(0)
    expect(p.read('src/styles/tokens/tokens-core.css')).toContain('--palette-brand-700: oklch(0.723 0.219 149.579);')
    // `primary` is an alias of brand-700 in the light theme.
    expect(p.read('platforms/js/tokens-light.ts')).toContain('"primary": "#00c950"')
    expect(p.read('platforms/ios/TokensLight.swift')).toContain('public static let primary = UIColor(red: 0.000, green: 0.788, blue: 0.314, alpha: 1)')
    expect(p.read('platforms/android/colors_light.xml')).toContain('<color name="primary">#ff00c950</color>')
  })

  it.each([
    ['hsl(140 100% 39%)', '#ff00c742'],
    ['#00000080', '#80000000'],
    ['rgba(0, 0, 0, 0.5)', '#80000000'],
    ['oklch(0 0 0 / 0.5)', '#80000000'],
  ])('builds %s, as main did, into Android %s', (color, android) => {
    const p = pipeline()
    p.setBrand700(color)
    const { status, out } = p.build()
    expect(status, out).toBe(0)
    expect(p.read('platforms/android/colors_light.xml')).toContain(`<color name="primary">${android}</color>`)
  })

  it('fails on a color nothing can read, and leaves the last good output in place', () => {
    const p = pipeline()
    expect(p.build().status).toBe(0)
    const css = p.read('src/styles/tokens/tokens-core.css')
    p.setBrand700('bananas')
    const { status, out } = p.build()
    expect(status).not.toBe(0)
    expect(out).toContain('Unrecognised color "bananas"')
    expect(existsSync(join(p.root, 'src/styles/tokens/tokens-core.css'))).toBe(true)
    expect(p.read('src/styles/tokens/tokens-core.css')).toBe(css)
    expect(readdirSync(join(p.root, 'platforms'))).toEqual(['android', 'ios', 'js'])
  })

  it("lists a web value React Native can't use, instead of failing the web build", () => {
    const p = pipeline()
    p.set('motion.json', 'motion.easing.standard', 'steps(4, end)')
    p.set('shadow.json', 'elevation.sm', 'none')
    const { status, out } = p.build()
    expect(status, out).toBe(0)
    const native = JSON.parse(p.read('platforms/js/tokens-native.json'))
    expect(native.unsupported).toEqual(['motion.easing.standard: steps(4, end) has no Easing.bezier form'])
    expect(native.shadow.sm).toEqual({ boxShadow: 'none' })
  })
})
