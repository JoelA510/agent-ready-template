// Reads a SKILL.md against the Agent Skills specification (agentskills.io/specification), the
// format Claude Code, Codex, Antigravity, Gemini CLI, Cursor, and GitHub Copilot share:
//
//   - `name`: required; 1-64 characters of a-z, 0-9, and single hyphens, not at either end;
//     equal to the skill's directory name;
//   - `description`: required; 1-1024 characters. It's what an agent reads to decide whether to
//     load the skill, so it says what the skill does and when to use it;
//   - `license`, `compatibility` (at most 500 characters), `metadata` (string keys and string
//     values), `allowed-tools` (a space-separated string): optional.
//
// The frontmatter is parsed as YAML (block scalars, lists, comments, and escapes included), so a
// valid skill written in any YAML style reads as valid. `strict` is for the shared
// `.agents/skills/` path: there a field outside the specification, or a spec field in another
// shape, is reported, since only the specification is common to every agent that reads that
// path. Tool-specific settings belong under `metadata`; this repo's build lifts the ones Claude
// Code understands into its own copy.
import { templateDependency } from './template-dependency.mjs'

// Loaded on first use, so a module that imports this one but never parses a skill
// (process:apply, through check-instructions) still runs without node_modules.
let yaml
const parseDocument = (text) => (yaml ??= templateDependency('yaml')).parseDocument(text)

export const SPEC_FIELDS = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// Maps to null-prototype objects, so a key like `constructor` or `__proto__` is just a key.
function plain(value) {
  if (value instanceof Map) {
    const out = Object.create(null)
    for (const [k, v] of value) out[String(k)] = plain(v)
    return out
  }
  if (Array.isArray(value)) return value.map(plain)
  return value
}

/**
 * { name, description, metadata, fields, body, problems } for a SKILL.md whose directory is
 * `dirName`. `fields` holds every frontmatter field as parsed; `problems` lists every way the
 * file breaks the specification (empty means valid).
 */
export function parseSkill(text, dirName, { strict = true } = {}) {
  const problems = []
  const empty = { name: '', description: '', metadata: Object.create(null), fields: Object.create(null) }
  const source = text.replace(/^\uFEFF/, '')
  // The closing fence is a line of its own, so a value that ends in " ---" isn't cut short.
  const match = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(source)
  if (!match) return { ...empty, body: source, problems: ['no YAML frontmatter between --- lines'] }
  const body = source.slice(match[0].length)

  const doc = parseDocument(match[1] ?? '')
  if (doc.errors.length) {
    return { ...empty, body, problems: doc.errors.map((e) => `frontmatter isn't valid YAML: ${e.message.split('\n')[0]}`) }
  }
  const data = doc.toJS({ mapAsMap: true })
  if (!(data instanceof Map)) return { ...empty, body, problems: ['frontmatter must be a set of "key: value" fields'] }
  const fields = plain(data)

  const text_ = (key) => (typeof fields[key] === 'string' ? fields[key] : '')
  const name = text_('name')
  const description = text_('description')
  if (!Object.hasOwn(fields, 'name')) problems.push('"name" is missing')
  else if (typeof fields.name !== 'string') problems.push('"name" must be a string')
  else {
    if (name.length > 64 || !NAME.test(name)) problems.push(`name "${name}" must be 1-64 characters of a-z, 0-9, and single hyphens, not at either end`)
    if (name !== dirName) problems.push(`name "${name}" must match its directory, "${dirName}"`)
  }
  if (!description.trim()) problems.push('"description" is missing, empty, or not a string')
  else if (description.length > 1024) problems.push(`description is ${description.length} characters; the limit is 1024`)
  if (Object.hasOwn(fields, 'compatibility')) {
    if (typeof fields.compatibility !== 'string') problems.push('"compatibility" must be a string')
    else if (fields.compatibility.length > 500) problems.push(`compatibility is ${fields.compatibility.length} characters; the limit is 500`)
  }

  const metadata = Object.create(null)
  const rawMetadata = fields.metadata
  if (rawMetadata !== undefined && rawMetadata !== null) {
    if (typeof rawMetadata !== 'object' || Array.isArray(rawMetadata)) problems.push('"metadata" must be a map of string keys to string values')
    else {
      for (const [k, v] of Object.entries(rawMetadata)) {
        if (typeof v === 'string') metadata[k] = v
        else if (strict) problems.push(`metadata "${k}" must be a string`)
      }
    }
  }
  if (strict) {
    for (const key of Object.keys(fields)) {
      if (!SPEC_FIELDS.includes(key)) problems.push(`"${key}" isn't an Agent Skills field; agents that follow the spec ignore it. Put tool-specific settings under metadata`)
    }
    if (Object.hasOwn(fields, 'license') && typeof fields.license !== 'string') problems.push('"license" must be a string')
    if (Object.hasOwn(fields, 'allowed-tools') && typeof fields['allowed-tools'] !== 'string') {
      problems.push('"allowed-tools" must be a space-separated string')
    }
  }
  return { name, description, metadata, fields, body, problems }
}
