// Types for scripts/__tests__/check-upgrade-path.test.ts.
export declare function previousRelease(root?: string): string | null
export declare function checkUpgrade(from: string): { from: string; problems: string[]; summary: string }
export declare function firstRelease(root?: string): 'none' | 'head' | null
