// Types for what the tests and scripts/apply-process.mjs import from scripts/check-instructions.mjs.
export interface Finding {
  file: string
  line: number
  kind: 'link' | 'import' | 'path' | 'script' | 'hidden' | 'hides-agents' | 'skill' | 'skill-copy' | 'size' | 'platforms'
  detail: string
}
export declare const INSTRUCTION_PATHS: string[]
export declare const SKILL_PATHS: string[]
export declare const HIDDEN_RANGES: [number, number][]
export declare function findInstructionFiles(root: string, files?: string[]): string[]
export declare function agentsHiddenFromClaude(root: string): { file: string; detail: string } | null
export declare function agentsHiddenFromGemini(root: string): { file: string; detail: string } | null
export declare function skillCopiesThatDiffer(root: string): { file: string; detail: string }[]
export declare function parseJsonc(text: string): unknown
export interface Sizing {
  platforms: import('./agent-platforms.mjs').Platform[]
  legacy: boolean
  files: Set<string>
  problems?: string[]
}
export declare function sizingFor(root: string): Sizing | { error: string }
export declare function guidanceNotes(root: string, platforms: import('./agent-platforms.mjs').Platform[]): string[]
export declare function lintFile(
  root: string,
  abs: string,
  index?: string[],
  scriptsFor?: (dir: string) => { path: string; scripts: Record<string, string> } | null,
  sizing?: Sizing,
): { findings: Finding[]; examined: { links: number; imports: number; paths: number; scripts: number } }
