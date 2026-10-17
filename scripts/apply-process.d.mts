// Types for the delivery lists and drift scripts/__tests__/apply-process.test.ts imports.
export declare const PROCESS_PROMPTS: string[]
export declare const PROCESS_SKILLS: string[]
export declare const TEMPLATE_ONLY: { prompts: string[]; skills: string[] }
export declare const SKILL_HOMES: string[]
export declare function skillHomes(target: string): {
  homes: string[]
  selected: boolean
  names: string[]
  elsewhere: { name: string; skills: string }[]
  problem: string | null
}
export declare function sources(packs?: string[], homes?: string[]): { dest: string; src: string | null; content: string }[]
export declare class ManifestError extends Error {}
export declare function drift(target: string): {
  delivered: boolean
  templateCommit: string | null
  ahead: boolean
  held: string[]
  heldBack: string[]
  changes: { kind: string; dest: string }[]
  leftovers: string[]
  ignored: string[]
  unselected: string[]
}
