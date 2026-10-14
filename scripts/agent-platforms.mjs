// The coding agents ("platforms") the template knows, what each reads, and the limits its vendor
// documents, each fact with the page it came from and the date it was read. A project records the
// ones it uses in .agents/platforms.json, and check-instructions sizes the shared instruction files
// for exactly those (ADR 0020). prompts/agent-platforms.md is the same table for people and
// agents, with the procedure for researching a platform that isn't here;
// scripts/__tests__/agent-platforms.test.ts holds the two together.
//
// Per platform:
//   files          instruction files it reads that other platforms share, by name (a nested copy
//                  counts too): their size budget comes from the platforms that read them
//   agentsMd       how AGENTS.md reaches it: 'native', 'import' (from a file it reads), or
//                  'setting' (a configuration value names it)
//   wiring         what a project adds so it reads AGENTS.md, or null when nothing is needed
//   hardBytes      the documented limit past which a file isn't read in full, or null when the
//                  vendor documents none; hardEffect says what happens past it
//   guidanceLines  a documented length to stay under, advisory (a note, never a finding), or null;
//                  loads (then loadsOtherwise, when none of those exists) are the root files the
//                  count starts from, and expandsImports counts what their `@` imports pull in
//   skills, hooks  where its project skills and hook configuration live (ADRs 0011 and 0018)
//   notes          what the sources leave open, or a fact the fields above can't hold
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const SELECTION_FILE = '.agents/platforms.json'
export const PROCEDURE = 'prompts/agent-platforms.md'

const MiB = 1024 * 1024
const KiB = 1024

export const PLATFORMS = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    files: ['CLAUDE.md', 'AGENTS.md'],
    agentsMd: 'import',
    wiring: 'a CLAUDE.md whose first line is `@AGENTS.md` (skeleton: CLAUDE.skeleton.md)',
    hardBytes: 4 * MiB,
    hardEffect: 'skipped',
    guidanceLines: 200,
    loads: ['CLAUDE.md', '.claude/CLAUDE.md'],
    loadsOtherwise: ['AGENTS.md'],
    expandsImports: true,
    skills: '.claude/skills',
    hooks: '.claude/settings.json',
    notes:
      'Reads CLAUDE.md, and AGENTS.md only when there is no CLAUDE.md, .claude/CLAUDE.md, or CLAUDE.local.md (v2.1.277 and later); ' +
      'an `@AGENTS.md` import brings it in on every version and setting. "Target under 200 lines per CLAUDE.md file"; ' +
      'imports "don\'t reduce its context cost, because imported files also load at launch". A file over 4 MiB is skipped.',
    sources: [{ url: 'https://code.claude.com/docs/en/memory', checked: '2026-10-14' }],
  },
  {
    id: 'codex',
    name: 'Codex',
    files: ['AGENTS.md'],
    agentsMd: 'native',
    wiring: null,
    hardBytes: 32 * KiB,
    hardEffect: 'truncated: Codex stops adding files once their combined size, from the project root down, reaches project_doc_max_bytes',
    guidanceLines: null,
    skills: '.agents/skills',
    hooks: '.codex/hooks.json',
    notes:
      'The limit is project_doc_max_bytes (32 KiB by default, configurable), on the combined size of the AGENTS.md (or AGENTS.override.md) ' +
      "files from the project root to the working directory, so a nested file's budget is what its ancestors leave. Codex's GitHub code review reads AGENTS.md too.",
    sources: [
      { url: 'https://learn.chatgpt.com/docs/agent-configuration/agents-md', checked: '2026-10-14' },
      { url: 'https://learn.chatgpt.com/docs/third-party/github', checked: '2026-10-14' },
    ],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    files: ['AGENTS.md'],
    agentsMd: 'native',
    wiring: null,
    hardBytes: null,
    guidanceLines: 500,
    loads: ['AGENTS.md'],
    skills: '.agents/skills',
    hooks: '.claude/settings.json',
    notes:
      'Reads AGENTS.md at the root and in subdirectories, combined with its parents, the more specific taking precedence. The Rules page ' +
      'documents no byte limit; its best practices say "Keep rules under 500 lines", without saying whether that covers AGENTS.md. ' +
      'Runs the hooks in .claude/settings.json (ADR 0018).',
    sources: [{ url: 'https://cursor.com/docs/context/rules', checked: '2026-10-14' }],
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    files: ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'],
    agentsMd: 'native',
    wiring: null,
    hardBytes: null,
    guidanceLines: 1000,
    loads: ['AGENTS.md'],
    skills: '.agents/skills',
    hooks: '.github/hooks/',
    notes:
      'The cloud agent, code review, and Copilot CLI read AGENTS.md, CLAUDE.md, or GEMINI.md; Chat in VS Code reads AGENTS.md; other ' +
      'surfaces read none of them. The nearest AGENTS.md in the directory tree takes precedence. No byte limit is documented; the code ' +
      'review guide says "Limit any single instruction file to a maximum of about 1,000 lines." A 4,000-character code review limit ' +
      "appears in some translated copies of that guide but not in the current English one: unverified, so not applied.",
    sources: [
      { url: 'https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions', checked: '2026-10-14' },
      { url: 'https://docs.github.com/en/copilot/reference/custom-instructions-support', checked: '2026-10-14' },
      { url: 'https://docs.github.com/en/copilot/tutorials/customize-code-review', checked: '2026-10-14' },
    ],
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    files: ['GEMINI.md', 'AGENTS.md'],
    agentsMd: 'setting',
    wiring: '`.gemini/settings.json` of `{"context": {"fileName": ["AGENTS.md", "GEMINI.md"]}}`',
    hardBytes: null,
    guidanceLines: null,
    skills: '.agents/skills',
    hooks: '.gemini/settings.json',
    notes:
      'Reads GEMINI.md unless context.fileName names other files; concatenates every file it finds and sends them with each prompt. ' +
      'No size limit is documented. It stopped serving personal accounts on 2026-06-18 (ADR 0018); API-key and Code Assist users remain.',
    sources: [{ url: 'https://geminicli.com/docs/cli/gemini-md/', checked: '2026-10-14' }],
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    files: ['AGENTS.md', 'GEMINI.md'],
    agentsMd: 'native',
    wiring: null,
    hardBytes: 24_000,
    hardEffect: 'truncated',
    guidanceLines: null,
    skills: '.agents/skills',
    hooks: '.agents/hooks.json',
    notes:
      'Reads AGENTS.md and GEMINI.md (and the same names in .agents/) from the file it works on up to the workspace root. "Antigravity ' +
      'truncates any single rule file that exceeds 24,000 bytes", counted after its includes are expanded; always-on rules also share ' +
      'a 20,000-token budget, past which the largest are replaced by pointers.',
    sources: [{ url: 'https://antigravity.google/docs/rules', checked: '2026-10-14' }],
  },
]

const IDS = PLATFORMS.map((p) => p.id)
const DATE = /^\d{4}-\d{2}-\d{2}$/
const SELECTION_KEYS = new Set(['platforms', 'custom'])
const CUSTOM_KEYS = new Set(['name', 'files', 'agentsMd', 'wiring', 'hardBytes', 'hardEffect', 'guidanceLines', 'skills', 'hooks', 'notes', 'sources'])
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isLimit = (v) => v === null || (Number.isInteger(v) && v > 0)

/** What's wrong with a custom (researched) platform entry, as strings. */
function customProblems(entry, i) {
  const at = `custom[${i}]`
  if (!isObject(entry)) return [`${at} isn't an object`]
  const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name : null
  const label = name ? `${at} ("${name}")` : at
  const problems = Object.keys(entry).filter((k) => !CUSTOM_KEYS.has(k)).map((k) => `${label} has an unknown field "${k}" (fields: ${[...CUSTOM_KEYS].join(', ')})`)
  if (!name) problems.push(`${at} needs a "name"`)
  if (!Array.isArray(entry.files) || !entry.files.length || !entry.files.every((f) => typeof f === 'string' && f.trim())) {
    problems.push(`${label} needs "files": the instruction files it reads, by name`)
  }
  if (typeof entry.agentsMd !== 'string' || !entry.agentsMd.trim()) problems.push(`${label} needs "agentsMd": how AGENTS.md reaches it (or that it doesn't)`)
  if (!('hardBytes' in entry) || !isLimit(entry.hardBytes)) problems.push(`${label} needs "hardBytes": a whole number of bytes, or null when its documentation gives none`)
  if ('guidanceLines' in entry && !isLimit(entry.guidanceLines)) problems.push(`${label} "guidanceLines" must be a whole number of lines, or null`)
  for (const key of ['wiring', 'hardEffect', 'skills', 'hooks', 'notes']) {
    if (key in entry && entry[key] !== null && typeof entry[key] !== 'string') problems.push(`${label} "${key}" must be a string, or null`)
  }
  const sources = entry.sources
  if (!Array.isArray(sources) || !sources.length) {
    problems.push(`${label} needs "sources": each fact's page in the vendor's documentation, as { "url", "checked": "YYYY-MM-DD" }`)
  } else {
    sources.forEach((s, j) => {
      const url = isObject(s) && typeof s.url === 'string' && /^https?:\/\/\S+$/.test(s.url)
      const checked = isObject(s) && typeof s.checked === 'string' && DATE.test(s.checked)
      if (!url || !checked) problems.push(`${label} sources[${j}] needs a "url" (http or https) and a "checked" date (YYYY-MM-DD)`)
      else if (Object.keys(s).some((k) => k !== 'url' && k !== 'checked' && k !== 'note')) problems.push(`${label} sources[${j}] has a field other than url, checked, and note`)
    })
  }
  return problems
}

/**
 * The platforms a repo selected. { absent: true } when it records none; { error } when the file
 * can't be read as JSON; otherwise { platforms, problems }, where platforms are the registry
 * entries and the custom ones (a custom entry is kept when its limits are usable, so a missing
 * source is reported without loosening the budget).
 */
export function readSelection(root) {
  const path = join(root, SELECTION_FILE)
  if (!existsSync(path)) return { absent: true }
  let data
  try {
    data = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return { error: `${SELECTION_FILE} isn't valid JSON (${error.message})` }
  }
  if (!isObject(data)) return { platforms: [], problems: ['must be an object: {"platforms": [ids], "custom": [researched entries]}'] }
  const problems = Object.keys(data).filter((k) => !SELECTION_KEYS.has(k)).map((k) => `has an unknown field "${k}" (fields: platforms, custom)`)
  const ids = data.platforms ?? []
  const platforms = []
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) problems.push('"platforms" must be a list of platform ids')
  else {
    for (const id of new Set(ids)) {
      const known = PLATFORMS.find((p) => p.id === id)
      if (known) platforms.push(known)
      else problems.push(`"${id}" isn't a platform the template knows (${IDS.join(', ')}); research it into "custom" instead (${PROCEDURE})`)
    }
  }
  const custom = data.custom ?? []
  if (!Array.isArray(custom)) problems.push('"custom" must be a list')
  else {
    custom.forEach((entry, i) => {
      const found = customProblems(entry, i)
      problems.push(...found)
      if (isObject(entry) && Array.isArray(entry.files) && isLimit(entry.hardBytes ?? null)) {
        platforms.push({ ...entry, id: entry.name, hardBytes: entry.hardBytes ?? null, guidanceLines: entry.guidanceLines ?? null, loads: entry.files, custom: true })
      }
    })
  }
  if (!platforms.length && !problems.length) problems.push(`selects no platform: list the coding agents this repo uses (${IDS.join(', ')})`)
  return { platforms, problems }
}

/** The text of a selection of registry ids, keeping any custom entries already recorded. */
export function selectionText(root, ids) {
  const path = join(root, SELECTION_FILE)
  let custom
  if (existsSync(path)) {
    try {
      custom = JSON.parse(readFileSync(path, 'utf8')).custom
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error // an unreadable file is replaced, not merged
    }
  }
  return `${JSON.stringify({ platforms: ids, ...(custom ? { custom } : {}) }, null, 2)}\n`
}

/** The ids in a comma-separated list that the registry doesn't know. */
export const unknownIds = (ids) => ids.filter((id) => !IDS.includes(id))

/**
 * For one instruction file's name, the platforms whose hard limit binds it: the smallest
 * hardBytes among those that read it, as { bytes, by: [platforms] }, or null when none of them
 * documents a limit.
 */
export function budgetFor(fileName, platforms) {
  const limited = platforms.filter((p) => p.files.includes(fileName) && p.hardBytes !== null)
  if (!limited.length) return null
  const bytes = Math.min(...limited.map((p) => p.hardBytes))
  return { bytes, by: limited.filter((p) => p.hardBytes === bytes) }
}
