// Types for scripts/native-tokens.mjs.
export declare function parseEasing(value: string): number[] | { unsupported: string }
export declare function parseFontStack(value: string): string[]
export declare function parseShadow(value: string): {
  shadowColor?: string
  shadowOffset?: { width: number; height: number }
  shadowOpacity?: number
  shadowRadius?: number
  elevation?: number
  boxShadow: string
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a generated, open-ended token tree
export declare function deriveNativeTokens(tokens: { path: string[]; value: unknown; original: unknown }[]): Record<string, any>
