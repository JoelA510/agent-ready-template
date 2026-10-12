// Types for what the tests import from scripts/fleet-report.mjs.
import type { PackSpec, Scorecard } from './check-conformance.mjs'
import type { Get, SettingsCard } from './check-settings.mjs'

export interface FleetRepo {
  name: string
  path?: string
  url?: string
  ref?: string
  visibility?: 'public' | 'private'
  packs?: PackSpec[]
}
export interface Fleet {
  checked: string
  template: Scorecard['template'] | null
  repos: {
    name: string
    source: string
    card?: Scorecard
    error?: string
    process?: { status: 'current' | 'behind' | 'not delivered' | 'manifest unreadable'; changes: number; leftovers: number }
    settings?: { card?: SettingsCard; skipped?: string; error?: string }
  }[]
}
export declare function readFleet(path: string): FleetRepo[]
export declare function scoreFleet(fleetPath: string, options?: { today?: string; get?: Get }): Promise<Fleet>
export declare function formatFleet(fleet: Fleet): string
export declare function withoutCredentials(url: string): string
