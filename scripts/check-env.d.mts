// Types for what the tests import from scripts/check-env.mjs.
export declare const PUBLIC_PREFIXES: string[]
export declare function publicPrefix(name: string): string | null
export declare function isPublicSecret(name: string): boolean
export declare function isPlaceholder(value: string): boolean
export declare function isUnexpanded(value: string): boolean
export declare function easEnv(text: string): { where: string; name: string; value: string }[]
export declare function parseDotenv(text: string): { line: number; name: string; value: string }[]
export declare function scanSource(
  text: string,
  kind?: number,
  file?: string,
): { names: { name: string; line: number }[]; dynamic: { line: number; why: string }[] }
export declare function findDynamicAccess(text: string): { line: number; why: string }[]
export declare function scanViteConfig(text: string, kind?: number): { line: number; why: string }[]
type Samples = { publicSecret: string[]; placeholder: string[]; unexpanded: string[]; dynamic: string[]; define: string[] }
export declare const SELF_TEST: { flag: Samples; pass: Samples }
export declare function selfTest(test?: { flag: Samples; pass: Samples }): string[]
