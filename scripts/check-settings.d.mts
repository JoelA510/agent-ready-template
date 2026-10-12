// Types for what the tests import from scripts/check-settings.mjs.
import type { Catalog, Outcome, Result } from './check-conformance.mjs'

export type Get = (path: string) => Promise<{ path: string; status: number; body: unknown; message: string }>
export interface SettingsCard {
  repo: string
  private: boolean
  checked: string
  results: Result[]
  summary: Partial<Record<Result['status'], number>>
  exitCode: 0 | 1
}
export declare function githubApi(options: { token: string; fetch?: typeof globalThis.fetch; apiUrl?: string }): Get
export declare const SETTINGS: Record<string, (ctx: { get: Get; slug: string; repo: Record<string, unknown> }) => Promise<Outcome>>
export declare function slugFromRemote(root: string): string | null
export declare function slugFromUrl(url: string): string | null
export declare function checkSettings(slug: string, options: { get: Get; catalog?: Catalog; today?: string }): Promise<SettingsCard>
export declare function formatSettings(card: SettingsCard): string
