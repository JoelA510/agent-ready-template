// Types for scripts/__tests__/fleet-update.test.ts.
export type UpdateResult = {
  name: string
  source: string
  status: 'current' | 'would propose' | 'proposed' | 'already proposed' | 'waiting' | 'failed'
  state?: string
  branch?: string
  changed?: string[]
  parked?: string[]
  warnings?: string[]
  url?: string
  error?: string
}
export type UpdateRun = { commit: string; apply: boolean; repos: UpdateResult[] }
export declare function updateFleet(
  fleetPath: string,
  options?: { apply?: boolean; token?: string; fetch?: typeof globalThis.fetch; slugOf?: (url: string) => string | null },
): Promise<UpdateRun>
export declare function formatUpdate(run: UpdateRun): string
