// Types for what the tests and scripts import from scripts/agent-platforms.mjs.
export interface Source {
  url: string
  checked: string
  note?: string
}
export interface Platform {
  id: string
  name: string
  files: string[]
  agentsMd: string
  wiring: string | null
  hardBytes: number | null
  hardEffect?: string
  hardScope?: 'file' | 'combined'
  guidanceLines: number | null
  loads?: string[]
  loadsOtherwise?: string[]
  expandsImports?: boolean
  skills?: string | null
  hooks?: string | null
  notes?: string
  sources: Source[]
  custom?: boolean
}
export declare const SELECTION_FILE: string
export declare const PROCEDURE: string
export declare const PLATFORMS: Platform[]
export declare function readSelection(
  root: string,
): { absent: true } | { error: string } | { platforms: Platform[]; problems: string[] }
export declare function selectionText(root: string, ids: string[]): string
export declare function unknownIds(ids: string[]): string[]
export declare function budgetFor(fileName: string, platforms: Platform[]): { bytes: number; by: Platform[] } | null
export declare function combinedBudgets(
  root: string,
  rel: string,
  platforms: Platform[],
): { platform: Platform; ancestors: { file: string; bytes: number }[]; used: number; budget: number }[]
