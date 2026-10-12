export const SPEC_FIELDS: string[]
export interface Skill {
  name: string
  description: string
  metadata: Record<string, string>
  fields: Record<string, unknown>
  body: string
  problems: string[]
}
export function parseSkill(text: string, dirName: string, options?: { strict?: boolean }): Skill
