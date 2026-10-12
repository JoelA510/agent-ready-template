export interface Output {
  path: string
  source: string
  build: string
}
export const GENERATED: string[]
export const BUILDS: string[]
export function outputOf(rel: string): Output | undefined
export function isGenerated(rel: string): boolean
export function buildEntry(root: string, name: string): string
