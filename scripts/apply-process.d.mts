// Types for the delivery lists and drift scripts/__tests__/apply-process.test.ts imports.
export declare const PROCESS_PROMPTS: string[]
export declare const PROCESS_SKILLS: string[]
export declare const TEMPLATE_ONLY: { prompts: string[]; skills: string[] }
export declare function sources(packs?: string[]): { dest: string; src: string | null; content: string }[]
export declare class ManifestError extends Error {}
export declare function drift(target: string): {
  delivered: boolean
  templateCommit: string | null
  ahead: boolean
  held: string[]
  heldBack: string[]
  changes: { kind: string; dest: string }[]
  leftovers: string[]
}
