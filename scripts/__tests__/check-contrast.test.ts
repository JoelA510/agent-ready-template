import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hexToOklch } from '../color.mjs'

const REPO = resolve(__dirname, '../..')
const SCRIPT = join(REPO, 'scripts/check-contrast.mjs')

type Theme = Record<string, unknown>
const roots: string[] = []

// A throwaway tree with this repo's real tokens and a single probe component. `classes` is the
// probe's class list; the default includes `text-foreground` so the scan's positive control
// passes and each test only varies what it's about.
function fixture(
  classes: string,
  options: { editTheme?: (name: 'light' | 'dark', theme: Theme) => void; source?: string } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'check-contrast-'))
  roots.push(root)
  cpSync(join(REPO, 'tokens'), join(root, 'tokens'), { recursive: true })
  for (const name of ['light', 'dark'] as const) {
    const path = join(root, 'tokens/semantic', `${name}.json`)
    const theme = JSON.parse(readFileSync(path, 'utf8')) as Theme
    options.editTheme?.(name, theme)
    writeFileSync(path, JSON.stringify(theme))
  }
  mkdirSync(join(root, 'src/components/ui'), { recursive: true })
  writeFileSync(
    join(root, 'src/components/ui/probe.tsx'),
    options.source ?? `export const Probe = () => <div className="${classes}" />\n`,
  )
  return root
}

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
  return { status: result.status, out: result.stdout + result.stderr }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('check-contrast', () => {
  it('passes on this repo', () => {
    const { status, out } = run()
    expect(out).toContain('✓ Every text pairing the components render meets WCAG AA')
    expect(status).toBe(0)
  })

  it('passes a clean probe (the baseline every failing case below differs from)', () => {
    expect(run('--root', fixture('text-foreground')).status).toBe(0)
  })

  it('fails on the dark-theme destructive text regression it was written to catch', () => {
    // The original values: a red dark enough to carry white text, used as text on dark surfaces.
    const root = fixture('text-foreground text-destructive', {
      editTheme: (name, theme) => {
        if (name !== 'dark') return
        theme.destructive = { $value: '{color.danger.600}', $type: 'color' }
        theme['destructive-foreground'] = { $value: '{color.white}', $type: 'color' }
      },
    })
    const { status, out } = run('--root', root)
    expect(out).toMatch(/✗\s+2\.90:1\s+destructive on card/)
    expect(status).toBe(1)
  })

  it('measures a focus ring at the opacity the component draws it', () => {
    const { status, out } = run('--root', fixture('text-foreground focus-visible:ring-ring/50'))
    expect(out).toMatch(/✗\s+1\.82:1\s+ring\/50 \(focus ring\) on background/)
    expect(status).toBe(1)
  })

  it('measures a focus outline as it measures a focus ring', () => {
    const { status, out } = run('--root', fixture('text-foreground focus-visible:outline-2 focus-visible:outline-ring/50'))
    expect(out).toMatch(/✗\s+1\.82:1\s+ring\/50 \(focus ring\) on background/)
    expect(status).toBe(1)
  })

  it('fails when a component uses a role as text that no pairing measures', () => {
    const { status, out } = run('--root', fixture('text-foreground hover:text-warning'))
    expect(out).toContain('`text-warning` colors text in src/components/ui/probe.tsx')
    expect(status).toBe(1)
  })

  it.each([
    ['important suffix', 'text-warning!'],
    ['legacy important prefix', '!text-warning'],
    ['CSS-variable shorthand', 'text-(--warning)'],
    ['arbitrary var()', 'text-[var(--color-warning)]'],
  ])('sees a text color written with the %s', (_label, cls) => {
    const { status, out } = run('--root', fixture(`text-foreground ${cls}`))
    expect(out).toContain('`text-warning` colors text')
    expect(status).toBe(1)
  })

  it('keys coverage on alpha: translucent text is not covered by the opaque role', () => {
    const { status, out } = run('--root', fixture('text-foreground text-muted-foreground/60'))
    expect(out).toContain('`text-muted-foreground/60` colors text')
    expect(status).toBe(1)
  })

  it('reads arbitrary alpha values', () => {
    const { out } = run('--root', fixture('text-foreground text-muted-foreground/[.6]'))
    expect(out).toContain('`text-muted-foreground/60` colors text')
  })

  it('requires the exact text/background pair when one class list sets both', () => {
    // Both roles are measured somewhere, but never this combination.
    const { status, out } = run('--root', fixture('text-foreground bg-muted text-primary'))
    expect(out).toContain('renders text primary on muted in one class list')
    expect(status).toBe(1)
  })

  it('does not pair hover text with a background the hover state replaces', () => {
    const classes = 'text-foreground bg-background hover:bg-accent hover:text-accent-foreground'
    expect(run('--root', fixture(classes)).status).toBe(0)
  })

  it('treats an svg-targeted color as an icon covered by the enforced icon pairings', () => {
    expect(run('--root', fixture('text-foreground [&>svg]:text-info')).status).toBe(0)
  })

  it('keeps has-[>svg]: as text: it colors the element, not the icon', () => {
    const { status, out } = run('--root', fixture('text-foreground has-[>svg]:text-warning'))
    expect(out).toContain('`text-warning` colors text')
    expect(status).toBe(1)
  })

  it('reads class strings reliably past apostrophes in JSX text', () => {
    const source = `export const Probe = () => (
  <div className="text-foreground">
    <p>Don't stop here</p>
    <p className="text-warning">It's a warning</p>
  </div>
)
`
    const { status, out } = run('--root', fixture('', { source }))
    expect(out).toContain('`text-warning` colors text')
    expect(status).toBe(1)
  })

  it('refuses to report success when the coverage scan sees nothing', () => {
    const { status, out } = run('--root', fixture('bg-card p-4'))
    expect(out).toContain('the scan is broken, not the components')
    expect(status).toBe(1)
  })

  it('fails with a clear message, not a stack trace, when src/components is missing', () => {
    const root = fixture('text-foreground')
    rmSync(join(root, 'src'), { recursive: true })
    const { status, out } = run('--root', root)
    expect(out).toContain('src/components/ does not exist')
    expect(out).not.toContain('ENOENT')
    expect(status).toBe(1)
  })

  it('fails loudly on a declared pairing whose role the theme no longer defines', () => {
    const root = fixture('text-foreground', {
      editTheme: (_name, theme) => {
        delete theme.sidebar
      },
    })
    const { status, out } = run('--root', root)
    expect(out).toContain('needs "sidebar", which tokens/semantic/light.json does not define')
    expect(status).toBe(1)
  })

  it('skips advisory rows for a role a fork removed instead of crashing', () => {
    const root = fixture('text-foreground', {
      editTheme: (_name, theme) => {
        delete theme.input
      },
    })
    const { status, out } = run('--root', root)
    expect(out).not.toContain('input on background')
    expect(status).toBe(0)
  })

  // A rebrand that pastes Tailwind v4's palette brings oklch() values into tokens/core.
  function withCoreColor(path: string[], value: string) {
    const root = fixture('text-foreground')
    const file = join(root, 'tokens/core/color.json')
    const core = JSON.parse(readFileSync(file, 'utf8'))
    let node = core
    for (const key of path) node = node[key]
    node.$value = value
    writeFileSync(file, JSON.stringify(core))
    return root
  }

  it('measures an oklch() palette value as the sRGB color it renders as', () => {
    const before = run('--root', fixture('text-foreground')).out
    // brand-700 (#5c5d4b) written as oklch: every ratio that uses it must come out the same.
    const [L, C, H] = hexToOklch('#5c5d4b')
    const { status, out } = run('--root', withCoreColor(['palette', 'brand', '700'], `oklch(${L} ${C} ${H})`))
    expect(status).toBe(0)
    const ratio = (text: string) => text.match(/(\d+\.\d+):1 {2}primary-foreground on primary/)?.[1]
    expect(ratio(out)).toBeDefined()
    expect(ratio(out)).toBe(ratio(before))
  })

  it('lists colors it gamut-mapped from outside sRGB', () => {
    const { out } = run('--root', withCoreColor(['palette', 'brand', '700'], 'oklch(0.45 0.25 145)'))
    expect(out).toContain('Measured after CSS Color 4 gamut mapping')
    expect(out).toMatch(/~ palette\.brand\.700: oklch\(0\.45 0\.25 145\) -> #[0-9a-f]{6}/)
  })

  it.each([
    ['a format it does not read', 'color(display-p3 0.3 0.4 0.2)'],
    ['a translucent color', '#5c5d4b80'],
    ['a malformed one', 'rgb(92,,75)'],
  ])('fails, naming the token, on %s', (_label, color) => {
    const { status, out } = run('--root', withCoreColor(['palette', 'brand', '700'], color))
    expect(status).toBe(1)
    expect(out).toContain('Cannot measure color token "{palette.brand.700}"')
  })

  it('measures hsl() too', () => {
    expect(run('--root', withCoreColor(['palette', 'brand', '700'], 'hsl(60 10.3% 32.9%)')).status).toBe(0)
  })

  it('accepts --root=<dir> and rejects missing, non-directory, or unknown arguments', () => {
    expect(run(`--root=${fixture('text-foreground')}`).status).toBe(0)
    expect(run('--root').status).toBe(2)
    expect(run('--root=').status).toBe(2)
    expect(run('--root', join(REPO, 'package.json')).status).toBe(2)
    expect(run('--roots', REPO).status).toBe(2)
  })
})
