import * as React from 'react'

/**
 * Width (in px) below which the app-shell switches from the fixed desktop rail
 * to the Sheet-based mobile drawer. Kept in sync with Tailwind's `md` breakpoint.
 */
const MOBILE_BREAKPOINT = 768

const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

/**
 * Subscribe a callback to viewport-width changes across the mobile breakpoint.
 * React only ever invokes this on the client, so touching `window` here is safe.
 */
function subscribe(onStoreChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY)
  mql.addEventListener('change', onStoreChange)
  return () => mql.removeEventListener('change', onStoreChange)
}

function getSnapshot() {
  return window.innerWidth < MOBILE_BREAKPOINT
}

/**
 * Returns `true` when the viewport is narrower than {@link MOBILE_BREAKPOINT}.
 *
 * Backed by `useSyncExternalStore`, which keeps the matchMedia subscription in
 * sync with React and is SSR-safe: the server snapshot resolves to `false`
 * (never touching `window`) and hydration corrects it on the client.
 */
export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false)
}
