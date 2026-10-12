import '@testing-library/jest-dom/vitest'
import { afterAll, expect } from 'vitest'
import { toHaveNoViolations } from 'jest-axe'

expect.extend(toHaveNoViolations)

// @types/jest-axe types the matcher on the global jest.Matchers, which Vitest 5's Assertion no
// longer extends, so tell Vitest's own Matchers about the one registered above.
declare module 'vitest' {
  // A merged interface repeats Vitest's type parameters exactly, used or not.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    toHaveNoViolations(): R
  }
}

// input-otp (1.4.2) re-reads the caret 0, 10, and 50 ms after every value or focus change and
// never cancels those timers, even on unmount; each one calls setState. A file whose last
// render of an InputOTP is within 50 ms of jsdom's teardown gets that setState after `window`
// is gone, and Vitest fails the run with "window is not defined". Let them fire first. This
// hook is registered before any test file's, so it runs after all of them.
afterAll(() => new Promise((resolve) => setTimeout(resolve, 100)))

// jsdom has no layout engine and stubs out a handful of browser APIs that many
// Storybook stories (and the Radix / Embla / Recharts primitives underneath them)
// touch on mount. These are the small, standard, side-effect-free shims that let
// those components render far enough for axe to inspect their DOM. None of them
// affects the Button-style component tests — they only fill gaps jsdom leaves.

// ResizeObserver — used by carousel (Embla), resizable panels, sidebar, chart, scroll-area.
if (!('ResizeObserver' in globalThis)) {
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserver as unknown as typeof globalThis.ResizeObserver
}

// IntersectionObserver — Embla (carousel) reads it to track slides in view.
if (!('IntersectionObserver' in globalThis)) {
  class IntersectionObserver {
    root = null
    rootMargin = ''
    thresholds = []
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }
  globalThis.IntersectionObserver = IntersectionObserver as unknown as typeof globalThis.IntersectionObserver
}

// matchMedia — read on first render by the theme provider, sonner, and others.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

// scrollIntoView — called by Radix Select/Command/menus when moving focus.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// Radix relies on PointerEvent capture APIs jsdom omits.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {}
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {}
}

// Canvas 2D context — Recharts' responsive container measures text via a canvas. jsdom
// *does* define getContext, but only to emit a "Not implemented" console message and return
// null — so overwrite it unconditionally with a quiet no-op that returns null without the
// noise. (A presence guard here would be a no-op, since the noisy version already exists.)
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
