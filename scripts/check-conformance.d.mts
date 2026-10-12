// Types for what the tests and scripts/fleet-report.mjs import from scripts/check-conformance.mjs.
export type Status = 'pass' | 'fail' | 'n/a' | 'skipped' | 'audit' | 'error' | 'waived' | 'baseline'
export interface Outcome {
  status: Status
  evidence: string[]
}
export interface Result extends Outcome {
  key: string
  id: string
  pack: string
  path: string
  title: string
  severity: 'blocker' | 'high' | 'medium' | 'low'
  enforcement: 'check' | 'audit' | 'settings'
  auditArea: number
  waiver?: { reason: string; owner: string; expires: string }
}
export interface Standard {
  id: string
  pack: string
  name: string
  title: string
  severity: Result['severity']
  enforcement: Result['enforcement']
  auditArea: number
  file: string
}
export interface Catalog {
  packs: Map<string, { name: string; title: string; detect: ({ file: string } | { dependency: string })[] }>
  standards: Standard[]
  problems: string[]
}
export type PackSpec = string | { pack: string; path?: string }
export interface Scorecard {
  root: string
  checked: string
  template: { version: string; commit: string | null }
  config: string | null
  packs: { pack: string; path: string }[]
  packSource: string
  undeclared: string[]
  visibility: 'public' | 'private' | null
  results: Result[]
  problems: string[]
  summary: Partial<Record<Status, number>>
  exitCode: 0 | 1 | 2
}
export declare const CATALOG: string
export declare const CONFIG: string
export declare const MAX_WAIVER_DAYS: number
export declare class CheckError extends Error {}
export declare function loadCatalog(dir?: string): Catalog
export declare function globMatcher(pattern: string): (path: string) => boolean
export interface ShellOptions {
  errexit?: boolean
  pipefail?: boolean
}
/** Where the commands run: `posix: false` for PowerShell or cmd; the script's directory when they come from one. */
export interface ShellContext extends ShellOptions {
  posix?: boolean
  scriptDir?: string
  fixedErrexit?: boolean
}
export declare function shellCommands(text: string, dir?: string, options?: ShellContext): { text: string; dir: string | null; posix?: false; silenced?: string }[]
export declare function stepShell(shell: string | undefined | null): Required<ShellOptions> & { posix?: false }
export declare function setOptions(text: string, base: Required<ShellOptions>): Required<ShellOptions>
export declare function commandForms(text: string): string[]
export declare function scriptCalls(command: string): { name: string; dir: string | null; workspace: string | null }[]
export declare function migrationTables(
  migrations: { file: string; text: string }[],
): Map<string, { file: string; version: string; rls: boolean; exposure: boolean; defaultGrant: boolean }>
export declare const PROBES: Record<string, (ctx: unknown) => Outcome>
export declare function conform(
  root: string,
  options?: {
    config?: string
    packs?: PackSpec[]
    visibility?: 'public' | 'private'
    today?: string
    catalog?: Catalog
  },
): Scorecard
export declare function nextBaseline(
  card: Scorecard,
  config: Record<string, unknown>,
  today: string,
): { refused: string[]; config: Record<string, unknown> & { baseline: { recorded: string; standards: string[] } } }
export declare function formatCard(card: Scorecard): string
export declare function runProbe(
  root: string,
  id: string,
  options?: {
    path?: string
    visibility?: 'public' | 'private' | null
    today?: string
    vocabulary?: { accept?: string[]; reject?: string[] } | null
  },
): Outcome
