import * as React from 'react'
import { Toaster as Sonner, toast } from 'sonner'

/*
 * Sonner is a standalone toast library, not a Radix primitive — there is no
 * Root/Portal/Content tree to re-export, and no `data-slot` convention to hook into
 * (Toaster's props are a closed `ToasterProps` interface with no passthrough `...rest`
 * spread onto the DOM node, so an unlisted prop like `data-slot` would silently do
 * nothing and fail typechecking besides). The integration shape here is therefore just:
 * one wrapper component that maps this system's semantic tokens onto whatever styling
 * hook Sonner itself exposes, plus a re-export of its `toast()` function.
 *
 * STYLING MECHANISM (sonner@2.0.7, confirmed by reading node_modules/sonner/dist —
 * the installed version, not assumed from memory of an older release): Sonner ships its
 * own stylesheet (dist/styles.css, auto-injected at runtime) that paints each toast from
 * CSS custom properties — `--normal-bg` / `--normal-border` / `--normal-text` for the
 * default toast, and `--success-bg/border/text`, `--error-bg/border/text`,
 * `--warning-bg/border/text`, `--info-bg/border/text` for the typed variants (gated
 * behind the `richColors` prop — without it every toast type renders with the `normal`
 * variables regardless of `toast.success()` vs `toast.error()`, so `richColors` is
 * enabled by default below). There is also a `toastOptions.classNames` mechanism, but it
 * is NOT reliable for re-skinning colors here: Tailwind v4 emits utilities inside a
 * `@layer`, and Sonner's injected stylesheet is unlayered — per the CSS Cascade Layers
 * spec, ANY unlayered rule beats ANY layered rule regardless of selector specificity, so
 * a `bg-popover` utility class can never out-rank Sonner's own `background: var(--normal-bg)`
 * rule. Overriding the custom properties that rule already reads from is the only
 * mechanism that reliably wins — which is also why this file passes a `style` prop
 * (rendered as a plain inline `style` attribute, which always outranks stylesheet rules,
 * layered or not) instead of a `next-themes`-style `theme` prop: this repo has no
 * next-themes dependency and toggles dark mode via a plain `.dark` class, and the
 * semantic vars referenced below (--popover, --border, --success, --destructive, …)
 * already flip under `.dark` in src/styles/tokens/tokens-dark.css, so the mapping needs
 * no runtime theme detection at all — leaving `theme` at its default is fine because
 * every color that default would have driven is overridden here anyway.
 *
 * The same "unlayered stylesheet wins" fact is also why the toast stack's z-index and
 * corner radius are set here via `style` (`zIndex`, `--border-radius`) rather than a
 * `z-[var(--z-toast)]` / `rounded-lg` Tailwind class on `className` — Sonner's toaster
 * root hardcodes `z-index: 999999999` and reads border-radius from `--border-radius`
 * directly, so only the same style-prop mechanism can move it onto this system's
 * z-index/radius scale.
 *
 * One known gap: the toast *description* line (a second, smaller line of text below the
 * main message, used when a toast call passes a `description` in addition to its main
 * message) gets its color from a hardcoded hex in Sonner's stylesheet rather than a
 * custom property, so it isn't reachable through this same override mechanism. None of
 * the stories below use `description` (every example here is a single-line message,
 * matching the Success messages / Error messages patterns in
 * docs/brand/ui-copy-patterns.mdx), so it isn't in play yet — but a future caller adding
 * a `description` string should know it will render in Sonner's default gray rather than
 * `text-muted-foreground`, and won't automatically flip for `.dark`.
 */

/**
 * Mount this once near the app root (e.g. alongside the router, outside any single
 * page) — it renders the fixed-position container every `toast()` call portals into.
 * Then call `toast()` (or `toast.success()` / `toast.error()` / `toast.warning()` /
 * `toast.info()`) from anywhere in the app, no further setup required:
 *
 * ```tsx
 * import { Toaster, toast } from '@/components/ui/sonner'
 *
 * function App() {
 *   return (
 *     <>
 *       <Toaster />
 *       <Button onClick={() => toast('Project created')}>Create project</Button>
 *     </>
 *   )
 * }
 * ```
 */
function Toaster({
  style,
  richColors = true,
  closeButton = true,
  ...props
}: React.ComponentProps<typeof Sonner>) {
  return (
    <Sonner
      richColors={richColors}
      // Sonner dismisses by swipe, a drag. The close button is the single-pointer alternative
      // WCAG 2.2 SC 2.5.7 asks for, so it's on unless a caller turns it off.
      closeButton={closeButton}
      style={
        {
          zIndex: 'var(--z-toast)',
          '--border-radius': 'var(--radius-lg)',
          // Default/normal toast — same surface treatment as Popover/DropdownMenu.
          '--normal-bg': 'var(--popover)',
          '--normal-border': 'var(--border)',
          '--normal-text': 'var(--popover-foreground)',
          // Solid-fill variants, matching Button's solid destructive/primary treatment
          // (bg + matching foreground text) rather than Alert's subtly-tinted
          // bg-success/10 style. RECOMMENDED DEFAULT, NOT COMMITTED: a toast is a
          // transient, attention-grabbing surface rather than page-resident status
          // content, so this file opts for the bolder solid fill; if that reads as
          // louder than the brand's generally quiet, muted-olive aesthetic wants (see
          // tokens/core/color.json's brand description), the alternative is Alert's
          // treatment: a `*/10` status tint with `foreground` text. Not `text-<status>` on
          // its own tint — that measured 1.74:1 for warning in the light theme. These CSS
          // variables are invisible to scripts/check-contrast.mjs's class scan, so add any
          // new pairing here to its TEXT_ON_SURFACE list by hand.
          '--success-bg': 'var(--success)',
          '--success-border': 'var(--success)',
          '--success-text': 'var(--success-foreground)',
          '--error-bg': 'var(--destructive)',
          '--error-border': 'var(--destructive)',
          '--error-text': 'var(--destructive-foreground)',
          '--warning-bg': 'var(--warning)',
          '--warning-border': 'var(--warning)',
          '--warning-text': 'var(--warning-foreground)',
          '--info-bg': 'var(--info)',
          '--info-border': 'var(--info)',
          '--info-text': 'var(--info-foreground)',
          ...style,
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster, toast }
