/// <reference types="vite/client" />
import { readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { ComponentType } from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { axe } from 'jest-axe'
import { composeStories, setProjectAnnotations } from '@storybook/react'

import storybookConfig from '../../../.storybook/main'
import previewAnnotations from '../../../.storybook/preview'

// Apply the project's global decorators (theme-by-class wrapper + `bg-background`
// padding div) and the `globals.css` import to every composed story, exactly as
// Storybook does at runtime. Without this the primitives render unstyled and, more
// importantly, outside the annotations the real preview relies on.
setProjectAnnotations([previewAnnotations])

// --- Explicit exclude list -------------------------------------------------
// Stories that can't render in jsdom even with the polyfills in vitest.setup.ts, keyed by
// `${title} / ${exportName}` (composeStories exposes the export name as `storyName`), each
// skipped VISIBLY via it.skip with its reason, never silently dropped. Currently none:
// IntersectionObserver, ResizeObserver, matchMedia, scrollIntoView, pointer-capture and canvas
// stubs cover every story. Color contrast and target size aren't judged here (jsdom has no
// layout); the browser tier (npm run test:browser) and scripts/check-contrast.mjs cover them.
//
// An accessibility problem axe finds is fixed at the source, never listed here: Progress and
// Slider gained accessible names, Command's decorative separator is aria-hidden, ScrollArea's
// viewport takes focus when it must. The rare reviewed exception to ONE rule lives on the story
// as `parameters.a11y.options.rules: { [id]: { enabled: false } }` beside its reason; both tiers
// read it, and REVIEWED_EXCEPTIONS below is where each is counted and approved.
const EXCLUDED: Record<string, string> = {}

// Every story that turns any axe check down, and how. Adding a story exception without adding it
// here fails the "every exception is reviewed" test, so none slips in unnoticed.
const REVIEWED_EXCEPTIONS: Record<string, string[]> = {
  'Components/Command / Empty': ['aria-required-children off'],
}

type StoryModule = {
  default: { title?: string }
  [key: string]: unknown
}

// Every story under src/, not just this directory's — `../../**` also picks up stories that
// live outside src/components/ui/ (e.g. the ThemeToggle story) so nothing escapes the axe net.
// import.meta.glob needs a literal pattern, so the extensions are restated in GLOB_EXTENSIONS;
// the coverage block below checks both against Storybook's own config and the filesystem.
const storyModules = import.meta.glob<StoryModule>('../../**/*.stories.{js,jsx,mjs,ts,tsx}', {
  eager: true,
})
const GLOB_EXTENSIONS = ['js', 'jsx', 'mjs', 'ts', 'tsx']

type Case = {
  key: string
  path: string
  title: string
  storyName: string
  Story: ComponentType
}

const cases: Case[] = []

for (const path in storyModules) {
  const mod = storyModules[path]
  const title = mod.default?.title ?? path
  const composed = composeStories(mod) as unknown as Record<
    string,
    ComponentType & { storyName?: string }
  >
  for (const exportName in composed) {
    const Story = composed[exportName]
    const storyName = Story.storyName ?? exportName
    cases.push({ key: `${title} / ${storyName}`, path, title, storyName, Story })
  }
}

const runnable = cases.filter((c) => !(c.key in EXCLUDED))
const skipped = cases.filter((c) => c.key in EXCLUDED)

type A11yParameters = {
  disable?: boolean
  test?: string
  context?: unknown
  config?: { rules?: unknown[] }
  options?: { runOnly?: unknown; rules?: Record<string, { enabled?: boolean }> }
}
const a11yOf = (story: unknown) => ((story as { parameters?: { a11y?: A11yParameters } }).parameters?.a11y ?? {})

// Every way a story's parameters turn an axe check down, as readable labels.
function exceptionsOf(story: unknown): string[] {
  const a11y = a11yOf(story)
  const out: string[] = []
  if (a11y.disable) out.push('a11y disabled')
  if (a11y.test !== 'error') out.push(`test: ${a11y.test}`)
  if (a11y.context) out.push('context narrowed')
  if (a11y.options?.runOnly) out.push('runOnly')
  // An array here replaces the preview's rules outright; the object form below merges.
  if (a11y.config?.rules) out.push('config.rules set (use options.rules)')
  for (const [id, rule] of Object.entries(a11y.options?.rules ?? {})) {
    if (rule?.enabled === false) out.push(`${id} off`)
  }
  return out
}

// The axe rules a story turns off for itself, each beside its reason in the stories file.
function storyDisabledRules(story: unknown): string[] {
  return Object.entries(a11yOf(story).options?.rules ?? {})
    .filter(([, rule]) => rule?.enabled === false)
    .map(([id]) => id)
}

beforeAll(() => {
  // Visible coverage summary in the test output — no silent truncation.
  const excepted = cases.filter((c) => exceptionsOf(c.Story).length)
  console.info(
    `[stories.a11y] axe-checking ${runnable.length} stories across ${Object.keys(storyModules).length} components; ` +
      `${skipped.length} can't render in jsdom (EXCLUDED); ${excepted.length} turn a rule down (REVIEWED_EXCEPTIONS).`,
  )
})

// The net has to be provably cast. These checks derive their expectations from somewhere a
// broken glob or a renamed story can't reach — the filesystem, and the exclusion list itself —
// so "0 violations" can't quietly mean "0 stories checked".
// Storybook's own story extensions, read from .storybook/main.ts (`*.stories.@(js|jsx|…)`), so
// a story format Storybook renders can't escape this test by being a different extension.
const storybookExtensions = (storybookConfig.stories as string[]).flatMap((entry) => {
  const match = typeof entry === 'string' ? /\.stories\.@\(([^)]+)\)$/.exec(entry) : null
  return match ? match[1].split('|') : []
})

describe('story a11y coverage', () => {
  it('globs every story extension Storybook loads', () => {
    expect(storybookExtensions.length).toBeGreaterThan(0)
    expect(storybookExtensions.filter((ext) => !GLOB_EXTENSIONS.includes(ext))).toEqual([])
  })

  it('loads every stories file on disk under src/', () => {
    const srcDir = resolve(__dirname, '../..')
    const pattern = new RegExp(`\\.stories\\.(${storybookExtensions.join('|')})$`)
    const onDisk = (readdirSync(srcDir, { recursive: true }) as string[])
      .filter((file) => pattern.test(file))
      .map((file) => join(srcDir, file))
    const loaded = Object.keys(storyModules).map((path) => resolve(__dirname, path))
    expect(onDisk.length).toBeGreaterThan(0)
    expect(new Set(loaded)).toEqual(new Set(onDisk))
  })

  it('composes at least one story from every stories file', () => {
    // Counted per file path, not per title: two files sharing a title can't cover for each other.
    const empty = Object.keys(storyModules).filter((path) => !cases.some((c) => c.path === path))
    expect(empty.map((path) => relative(__dirname, resolve(__dirname, path)))).toEqual([])
  })

  it('every story exception is reviewed, and every reviewed one still exists', () => {
    const found = Object.fromEntries(cases.map((c) => [c.key, exceptionsOf(c.Story)]).filter(([, e]) => e.length))
    expect(found).toEqual(REVIEWED_EXCEPTIONS)
  })

  it('keeps target-size on for every story, whatever it turns off (positive control included)', () => {
    expect(cases.length).toBeGreaterThan(100)
    const off = cases.filter((c) => a11yOf(c.Story).options?.rules?.['target-size']?.enabled !== true).map((c) => c.key)
    expect(off).toEqual([])
  })

  it('has no stale exclusions (each EXCLUDED key names a story that exists)', () => {
    const keys = new Set(cases.map((c) => c.key))
    expect(Object.keys(EXCLUDED).filter((key) => !keys.has(key))).toEqual([])
  })
})

// Group by component title so failures read as "Components/Dialog > Default".
const byTitle = new Map<string, Case[]>()
for (const c of cases) {
  const list = byTitle.get(c.title) ?? []
  list.push(c)
  byTitle.set(c.title, list)
}

describe('Storybook stories have no axe violations (jsdom-evaluable rules)', () => {
  afterEach(() => {
    cleanup()
  })

  for (const [title, group] of byTitle) {
    describe(title, () => {
      for (const c of group) {
        if (c.key in EXCLUDED) {
          it.skip(`${c.storyName} — excluded: ${EXCLUDED[c.key]}`, () => {})
          continue
        }
        const off = storyDisabledRules(c.Story)
        it(`${c.storyName} has no accessibility violations${off.length ? ` (the story turns off: ${off.join(', ')})` : ''}`, async () => {
          const { container } = render(<c.Story />)
          const results = await axe(container, { rules: Object.fromEntries(off.map((id) => [id, { enabled: false }])) })
          expect(results).toHaveNoViolations()
        })
      }
    })
  }
})
