// Types for scripts/color.mjs.
export declare function parseCssColor(value: string): { rgb: [number, number, number]; alpha: number; mapped: boolean }
export declare function toSrgbHex(value: string, options?: { allowAlpha?: boolean }): { hex: string; mapped: boolean }
export declare function hexToOklch(color: string): [number, number, number]
