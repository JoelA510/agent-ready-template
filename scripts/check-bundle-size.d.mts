// Types for what the tests import from scripts/check-bundle-size.mjs.
export declare function parseSize(value: unknown): number | null
export declare function checkBudgets(
  root: string,
  config: unknown,
): { results: { files: string; matched: number; size: number; limit: number; over: boolean }[]; problems: string[] }
