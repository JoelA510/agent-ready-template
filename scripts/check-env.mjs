#!/usr/bin/env node
// Checks how a repo names, reads, and fills its environment variables, for the failures a
// client bundler turns into a leak or a silent `undefined`:
//
//   - public-secret: a variable with a client-exposed prefix (VITE_, NEXT_PUBLIC_, EXPO_PUBLIC_,
//                    PUBLIC_, REACT_APP_, …) whose name says it's secret: SECRET, PRIVATE,
//                    PASSWORD, SERVICE_ROLE, DATABASE_URL, a signing or admin key, or a vendor
//                    key that's only ever server-side (OpenAI, Anthropic, Resend, …). Any client
//                    code that reads it ships the value to every visitor, whatever the name
//                    promises. Names come from env files anywhere in the tree (gitignored and
//                    example files included: the name is the problem), eas.json, and every
//                    form of read in source. If a name trips this and the value really is
//                    public, rename it: the next reader will make the same mistake;
//   - dynamic-access: an env read the bundler handles differently from `.NAME`:
//                    - Vite: `import.meta.env` used as a whole (indexed, destructured, aliased,
//                      passed to a function, tested for truthiness) is replaced with an object
//                      of every VITE_ variable present at build time (vite/src/node/plugins/
//                      define.ts), so every one of them lands in the bundle at that spot;
//                    - Expo and Next.js inline only `process.env.NAME` (their environment-
//                      variable guides): bracket access, destructuring, an alias, or passing
//                      `process.env` whole comes out undefined in a client bundle. Server code
//                      does this legitimately, so it's reported only in files that name a
//                      process.env public prefix (NEXT_PUBLIC_, EXPO_PUBLIC_, REACT_APP_, …).
//                    Neither is reported in build config (`*.config.*`) or tests (`*.test.*`,
//                    `*.spec.*`, `__tests__/`, `tests/`, `e2e/`), which run in Node and are
//                    never bundled.
//                    Source is parsed with TypeScript (as check-contrast.mjs does), so strings,
//                    comments, and type positions don't count, and casts are seen through;
//   - define-env:    a `vite.config.*` that pushes a non-public variable into the client bundle:
//                    a `define` entry whose value reads `process.env.NAME`, or a field of what
//                    `loadEnv()` returned, for a NAME without a client prefix (or with one and a
//                    secret name), or that copies a whole env object (one from `loadEnv()` with
//                    no third argument holds only VITE_ variables, so it doesn't count). A
//                    `define` given by name is followed to its declaration in the same file;
//                    one built some other way is reported for any env it reads.
//                    Vite replaces each `define` key with its value at build time, so the value is
//                    in the bundle as soon as any client code reads the key (Google AI Studio's
//                    scaffold injects `process.env.GEMINI_API_KEY` this way). Build metadata
//                    (NODE_ENV, MODE, CI, npm_package_*, and SHA, COMMIT_REF, VERSION, ENV, and
//                    BRANCH, alone or after a prefix and an underscore) isn't reported;
//   - placeholder:   a string value in a real env file (not *.example, *.sample, *.template) or
//                    eas.json that is still a placeholder: `your-…`, `<…>`, `[UPPERCASE]`,
//                    `changeme`, `xxxx`, `REPLACE_ME`. It passes a "non-empty" check and ships.
//                    Only names are printed, never values;
//   - unexpanded:    a `${VAR}` reference in an eas.json build profile's env (`env`,
//                    `android.env`, `ios.env`). EAS passes the text through literally, and a
//                    profile's env overrides the EAS environment's real value, so the binary
//                    ships `${VAR}` (a sibling Expo repo's deployment guide
//                    postmortem: every build for five weeks died before first render);
//   - unreadable:    an eas.json that isn't JSON even after the JSON5 allowances eas-cli makes
//                    (comments, trailing commas). It wasn't checked, so the run can't pass.
//
// Before looking at the repo it runs a self-test: the detectors must flag every sample in
// SELF_TEST.flag and pass every sample in SELF_TEST.pass, or it exits 2 without checking
// anything. A detector edited into uselessness fails loudly instead of reporting a clean repo.
//
// Run: node scripts/check-env.mjs [--root <repo>]
//   Exit 0 clean, 1 on findings, 2 on bad arguments, a failed self-test, nothing to examine, or
//   the template's dependencies not installed.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SKELETON_MARKER, SKIP_DIRS, inSkeletonDir, listRepoFiles, skeletonDirs, toPosix, walk } from './repo-files.mjs'
import { MISSING_DEPENDENCY, templateDependency } from './template-dependency.mjs'

// A missing install is held here and reported by main(), with how to fix it, rather than
// thrown at import as a module-resolution stack trace.
let ts
let tsMissing
try {
  ts = templateDependency('typescript')
} catch (error) {
  if (error?.code !== MISSING_DEPENDENCY) throw error
  tsMissing = error
}

export const PUBLIC_PREFIXES = [
  'VITE_',
  'NEXT_PUBLIC_',
  'EXPO_PUBLIC_',
  'NUXT_PUBLIC_',
  'PUBLIC_', // SvelteKit, Astro
  'REACT_APP_',
  'VUE_APP_',
  'GATSBY_',
  'NG_APP_',
  'STORYBOOK_',
]
// The prefixes whose bundlers inline `process.env.NAME` (not `import.meta.env`).
const PROCESS_ENV_PREFIXES = ['NEXT_PUBLIC_', 'EXPO_PUBLIC_', 'REACT_APP_', 'GATSBY_', 'VUE_APP_', 'STORYBOOK_']
const SECRET_MARKERS =
  /(^|_)(SECRET|PRIVATE|PASSWORD|PASSWD|SERVICE_ROLE|SERVICE_KEY|SERVICE_ACCOUNT|DATABASE_URL|DB_URL|DB_PASSWORD|CONNECTION_STRING|ADMIN_KEY|MASTER_KEY|SIGNING_KEY)(_|$)/
const SERVER_ONLY_VENDOR_KEYS =
  /(^|_)((OPENAI|ANTHROPIC|RESEND|SENDGRID|POSTMARK|MAILGUN)_(API_)?KEY|TWILIO_AUTH_TOKEN|GITHUB_TOKEN|SLACK_(BOT_)?TOKEN)(_|$)/

/** The public prefix a name carries, or null. */
export const publicPrefix = (name) => PUBLIC_PREFIXES.find((p) => name.startsWith(p)) ?? null

/** Whether a variable name puts a secret behind a client-exposed prefix. */
export function isPublicSecret(name) {
  const prefix = publicPrefix(name)
  if (!prefix) return false
  const rest = name.slice(prefix.length)
  return SECRET_MARKERS.test(rest) || SERVER_ONLY_VENDOR_KEYS.test(rest)
}

/** Whether a value is a leftover placeholder rather than a real value. */
export function isPlaceholder(value) {
  const v = value.trim().replace(/^(['"])(.*)\1$/, '$2')
  if (!v) return false // blank is its own state, not a placeholder
  return (
    /^your[-_]/.test(v) ||
    /^<[^<>]+>$/.test(v) ||
    /^\[[A-Z][A-Z0-9 _/-]*\]$/.test(v) || // `[FILL IN]`, the skeletons' placeholder shape
    /^(change[-_]?me|replace[-_]?me|CHANGEME|CHANGE_ME|REPLACE_ME|TODO|TBD|FIXME|x{4,}|X{4,}|\*{4,})$/.test(v) ||
    /(^|[-_.:/])(your[-_](api[-_])?(key|token|secret|project|url|password)|changeme|replace[-_]?me)([-_.:/]|$)/.test(v)
  )
}

/** Whether a value relies on `${…}` interpolation that EAS doesn't do. */
export const isUnexpanded = (value) => /\$\{[^}]*\}/.test(value)

// --- Source ------------------------------------------------------------------------------------

const isCast = (node) =>
  ts.isParenthesizedExpression(node) ||
  ts.isNonNullExpression(node) ||
  ts.isAsExpression(node) ||
  ts.isSatisfiesExpression(node) ||
  ts.isTypeAssertionExpression(node)
const unwrap = (node) => (isCast(node) ? unwrap(node.expression) : node)
const isImportMeta = (node) => ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword
const isImportMetaEnv = (node) =>
  ts.isPropertyAccessExpression(node) && node.name.text === 'env' && isImportMeta(unwrap(node.expression))
const isProcessEnv = (node) => {
  if (!ts.isPropertyAccessExpression(node) || node.name.text !== 'env') return false
  const target = unwrap(node.expression)
  return ts.isIdentifier(target) && target.text === 'process'
}

// The expression an env object is really used in, looking through casts and parentheses.
function usage(node) {
  let child = node
  while (child.parent && isCast(child.parent)) child = child.parent
  return { child, parent: child.parent }
}
function inType(node) {
  for (let n = node.parent; n; n = n.parent) if (ts.isTypeNode(n)) return true
  return false
}

const WHY = {
  viteWhole: 'import.meta.env used as a whole makes Vite embed every VITE_ variable here; read import.meta.env.NAME',
  publicIndex: "Expo doesn't inline bracket access, and dot form is the only one every bundler documents; use process.env.NAME",
  processWhole:
    'process.env used as a whole where public variables are read: Next.js and Expo inline only process.env.NAME, so this is undefined in a client bundle; list each as process.env.NAME',
}

// Files that run in Node and never reach a client bundle.
const isNotBundled = (file) =>
  /(^|\/)[^/]*\.config\.[cm]?[jt]sx?$/.test(file) ||
  /(^|\/)[^/]*\.(test|spec)\.[cm]?[jt]sx?$/.test(file) ||
  /(^|\/)(__tests__|tests?|e2e)\//.test(file)

/**
 * The env reads in one source file: every variable name read in any form, and the reads a
 * bundler handles differently, as { line, why }. `kind` is a ts.ScriptKind; `file` decides
 * whether the file is bundled at all.
 */
export function scanSource(text, kind = ts.ScriptKind.TSX, file = 'src/x.tsx') {
  const source = ts.createSourceFile('x', text, ts.ScriptTarget.Latest, true, kind)
  const names = []
  const dynamic = []
  const whole = [] // process.env used whole: reported only if the file names a public process.env prefix
  let namesPublicProcessVar = false
  const line = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1

  const visit = (node) => {
    if ((ts.isIdentifier(node) || ts.isStringLiteralLike(node)) && PROCESS_ENV_PREFIXES.some((p) => node.text.startsWith(p))) {
      namesPublicProcessVar = true
    }
    const vite = isImportMetaEnv(node)
    const proc = isProcessEnv(node)
    if ((vite || proc) && !inType(node)) {
      const { child, parent } = usage(node)
      if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === child) {
        names.push({ name: parent.name.text, line: line(parent) })
      } else {
        const literalIndex =
          parent && ts.isElementAccessExpression(parent) && parent.expression === child && ts.isStringLiteralLike(parent.argumentExpression)
        if (literalIndex) names.push({ name: parent.argumentExpression.text, line: line(parent) })
        if (parent && ts.isVariableDeclaration(parent) && ts.isObjectBindingPattern(parent.name)) {
          for (const e of parent.name.elements) names.push({ name: (e.propertyName ?? e.name).getText(source), line: line(parent) })
        }
        if (vite) dynamic.push({ line: line(node), why: WHY.viteWhole })
        else if (literalIndex && publicPrefix(parent.argumentExpression.text)) dynamic.push({ line: line(parent), why: WHY.publicIndex })
        else if (!literalIndex) whole.push({ line: line(node), why: WHY.processWhole })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (isNotBundled(file)) return { names, dynamic: [] }
  return { names, dynamic: [...dynamic, ...(namesPublicProcessVar ? whole : [])].sort((a, b) => a.line - b.line) }
}

/** Every read a bundler handles differently, in a source text. */
export const findDynamicAccess = (text) => scanSource(text).dynamic

// --- vite.config ------------------------------------------------------------------------------

const VITE_CONFIG = /(^|\/)vite\.config(\.[\w-]+)*\.[cm]?[jt]s$/
// What a `define` commonly carries that no one treats as a secret.
const BUILD_METADATA = /^(NODE_ENV|MODE|CI|npm_package_\w+|(?:[A-Z0-9_]*_)?(SHA|COMMIT_REF|VERSION|ENV|BRANCH))$/
const secretName = (name) => SECRET_MARKERS.test(name) || SERVER_ONLY_VENDOR_KEYS.test(name)
// Whether putting a variable in the bundle exposes something Vite's prefix rule would have kept out.
const exposes = (name) => (publicPrefix(name) ? isPublicSecret(name) : !BUILD_METADATA.test(name) || secretName(name))
const propName = (name) => (ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : null)

/** The ways a vite.config text pushes the environment into the client bundle, as { line, why }. */
export function scanViteConfig(text, kind = ts.ScriptKind.TS) {
  const source = ts.createSourceFile('vite.config.ts', text, ts.ScriptTarget.Latest, true, kind)
  const line = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
  const isLoadEnv = (node) => {
    const n = unwrap(node)
    if (!ts.isCallExpression(n)) return false
    const callee = n.expression
    return (ts.isIdentifier(callee) && callee.text === 'loadEnv') || (ts.isPropertyAccessExpression(callee) && callee.name.text === 'loadEnv')
  }
  // loadEnv(mode, dir) loads only VITE_ variables; its third argument picks the prefixes ('' is all).
  const loadsPublicOnly = (node) => isLoadEnv(node) && unwrap(node).arguments.length < 3
  // Scope isn't followed, so a name declared twice is read at its most exposing: VITE_-only only if
  // every declaration is, and a `define` given by name is checked against each one.
  const envObjects = new Map() // const env = loadEnv(...) or process.env, to whether it's VITE_ only
  const envAliases = new Map() // const { KEY } = loadEnv(...) or process.env
  const declared = new Map() // const name = <initializer>, every one, for a `define` given by name
  const bind = (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name)) declared.set(node.name.text, [...(declared.get(node.name.text) ?? []), node.initializer])
      if (isLoadEnv(node.initializer) || isProcessEnv(unwrap(node.initializer))) {
        if (ts.isIdentifier(node.name)) envObjects.set(node.name.text, (envObjects.get(node.name.text) ?? true) && loadsPublicOnly(node.initializer))
        else if (ts.isObjectBindingPattern(node.name)) {
          for (const e of node.name.elements) if (ts.isIdentifier(e.name)) envAliases.set(e.name.text, (e.propertyName ?? e.name).getText(source))
        }
      }
    }
    ts.forEachChild(node, bind)
  }
  bind(source)
  const isEnvObject = (node) => isProcessEnv(node) || (ts.isIdentifier(node) && envObjects.has(node.text)) || isLoadEnv(node)
  const holdsNonPublic = (node) => !(ts.isIdentifier(node) ? envObjects.get(node.text) : loadsPublicOnly(node))
  // A VITE_-only env object has nothing else in it: env.API_URL there is undefined, not a leak.
  const readable = (object, name) => holdsNonPublic(object) || Boolean(publicPrefix(name))
  // The variables an expression reads from an env object, and whether it uses one whole.
  const reads = (expr) => {
    const names = []
    let whole = false
    const visit = (node) => {
      if (isEnvObject(node)) return void (whole ||= holdsNonPublic(node))
      if (ts.isPropertyAccessExpression(node)) {
        const object = unwrap(node.expression)
        if (isEnvObject(object)) {
          if (readable(object, node.name.text)) names.push(node.name.text)
        } else visit(node.expression) // the name after the dot is a property, not a variable
        return
      }
      if (ts.isElementAccessExpression(node) && isEnvObject(unwrap(node.expression))) {
        const key = node.argumentExpression
        if (ts.isStringLiteralLike(key)) {
          if (readable(unwrap(node.expression), key.text)) names.push(key.text)
        }
        else whole ||= holdsNonPublic(unwrap(node.expression))
        return
      }
      if (ts.isPropertyAssignment(node)) return visit(node.initializer) // a key isn't a read
      if (ts.isIdentifier(node) && envAliases.has(node.text)) return void names.push(envAliases.get(node.text))
      ts.forEachChild(node, visit)
    }
    visit(expr)
    return { names, whole }
  }
  const found = []
  const report = (expr, at, label) => {
    const { names, whole } = reads(expr)
    if (whole) found.push({ line: line(at), why: `${label} copies a whole environment object into the client bundle: every variable in it ships` })
    for (const name of [...new Set(names)].filter(exposes)) {
      found.push({ line: line(at), why: `${label} puts ${name} in the client bundle, past Vite's VITE_ prefix rule: once client code reads it, the value ships to every visitor` })
    }
  }
  const visit = (node) => {
    const given =
      ts.isPropertyAssignment(node) && propName(node.name) === 'define'
        ? node.initializer
        : ts.isShorthandPropertyAssignment(node) && node.name.text === 'define'
          ? node.name
          : null
    if (given) {
      // `define: values` or `{ define }`: what the name was declared as in this file.
      const value = unwrap(given)
      const values = ts.isIdentifier(value) && declared.has(value.text) ? declared.get(value.text).map(unwrap) : [value]
      for (const v of values) {
        if (!ts.isObjectLiteralExpression(v)) {
          report(v, node, 'define') // built some other way (`Object.fromEntries(...)`): any env it reads
          continue
        }
        for (const prop of v.properties) {
          const read = ts.isPropertyAssignment(prop) ? prop.initializer : ts.isShorthandPropertyAssignment(prop) ? prop.name : ts.isSpreadAssignment(prop) ? prop.expression : null
          if (!read) continue
          const key = ts.isSpreadAssignment(prop) ? '...' : (propName(prop.name) ?? prop.name.getText(source))
          report(read, prop, `define "${key}"`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

const SOURCE = /\.(m?[jt]sx?|c[jt]s|vue|svelte|astro)$/
const scriptKind = (file) =>
  /\.jsx$/.test(file) ? ts.ScriptKind.JSX : /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS

// The script parts of a file: all of a JS/TS file, or each <script> block (and an Astro
// frontmatter fence) of a .vue, .svelte, or .astro file, with the line offset of each.
function scriptsIn(file, raw) {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw // a BOM isn't content
  if (!/\.(vue|svelte|astro)$/.test(file)) return [{ text, offset: 0 }]
  const blocks = []
  const add = (start, body) => blocks.push({ text: body, offset: text.slice(0, start).split('\n').length - 1 })
  for (const m of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) add(m.index + m[0].indexOf('>') + 1, m[1])
  const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (front) add(text.indexOf('\n') + 1, front[1])
  return blocks
}

// --- Env files and eas.json -------------------------------------------------------------------

const ENV_FILE = /^\.env(\..+)?$/
const EXAMPLE = /\.(example|sample|template|defaults?)$/

/** `NAME=value` pairs in a dotenv file, with line numbers. */
export function parseDotenv(text) {
  const out = []
  text.split(/\r?\n/).forEach((line, i) => {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*(?:\s#.*)?$/)
    if (m) out.push({ line: i + 1, name: m[1], value: m[2] })
  })
  return out
}

// JSON, then JSON with the JSON5 allowances eas.json files use in practice (comments, trailing
// commas). eas-cli itself falls back to JSON5 when JSON.parse fails.
function parseEasJson(text) {
  try {
    return JSON.parse(text)
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    let out = ''
    let inString = false
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (inString) {
        out += c
        if (c === '\\') out += text[++i] ?? ''
        else if (c === '"') inString = false
      } else if (c === '"') {
        inString = true
        out += c
      } else if (c === '/' && text[i + 1] === '/') {
        while (i < text.length && text[i] !== '\n') i++
        out += '\n'
      } else if (c === '/' && text[i + 1] === '*') {
        const end = text.indexOf('*/', i + 2)
        if (end === -1) throw new SyntaxError('unterminated comment')
        i = end + 1
      } else out += c
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
  }
}

/** Every string env entry in an eas.json's build profiles, including the per-platform blocks. */
export function easEnv(text) {
  const out = []
  const json = parseEasJson(text)
  for (const [profile, config] of Object.entries(json?.build ?? {})) {
    const blocks = [
      [`build.${profile}.env`, config?.env],
      [`build.${profile}.android.env`, config?.android?.env],
      [`build.${profile}.ios.env`, config?.ios?.env],
    ]
    for (const [where, env] of blocks) {
      for (const [name, value] of Object.entries(env ?? {})) if (typeof value === 'string') out.push({ where, name, value })
    }
  }
  return out
}

// --- Self-test ---------------------------------------------------------------------------------

// The detectors' own proof they work, run before every check.
export const SELF_TEST = {
  flag: {
    publicSecret: [
      'VITE_SUPABASE_SERVICE_ROLE_KEY',
      'NEXT_PUBLIC_STRIPE_SECRET_KEY',
      'EXPO_PUBLIC_OPENAI_API_KEY',
      'PUBLIC_DATABASE_URL',
      'REACT_APP_JWT_SECRET',
    ],
    placeholder: ['your-anon-key', '<project-ref>', 'changeme', 'xxxxxxxx', 'REPLACE_ME', '[FILL IN]', 'https://your-project.supabase.co'],
    unexpanded: ['${EXPO_PUBLIC_SUPABASE_URL}', 'https://${HOST}/api'],
    dynamic: [
      'const url = import.meta.env[key]',
      'const { VITE_API_URL } = import.meta.env',
      'const env = schema.parse(import.meta.env)',
      'const v = (import.meta.env as Record<string, string>)[key]',
      "process.env['EXPO_PUBLIC_API_URL']",
      'const { NEXT_PUBLIC_SITE_URL } = process.env',
      'const env = z.object({ NEXT_PUBLIC_A: z.string() }).parse(process.env)',
    ],
    define: [
      "const env = loadEnv(mode, '.', ''); export default { define: { 'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY) } }",
      "export default { define: { 'process.env': process.env } }",
      'export default { define: { __KEY__: JSON.stringify(process.env.STRIPE_SECRET_KEY) } }',
      "const { OPENAI_API_KEY } = loadEnv(mode, root, ''); export default { define: { KEY: JSON.stringify(OPENAI_API_KEY) } }",
      "const env = loadEnv(mode, '.', ''); const values = { 'process.env.API_KEY': JSON.stringify(env.API_KEY) }; export default { define: values }",
      "const env = loadEnv(mode, process.cwd(), ''); const define = Object.fromEntries(Object.entries(env).map(([k, v]) => ['process.env.' + k, JSON.stringify(v)])); export default { define }",
      'const { GEMINI_API_KEY } = process.env; export default { define: { KEY: JSON.stringify(GEMINI_API_KEY) } }',
      "const env = loadEnv(mode, '.', ''); function other() { const env = loadEnv(mode, '.') } export default { define: { 'process.env': env } }",
    ],
  },
  pass: {
    publicSecret: ['VITE_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_API_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VITE_PRIVACY_POLICY_URL'],
    placeholder: ['https://abcd.supabase.co', 'pk_test_51Habc', 'true', '', 'yourls-shortener-prod', '[::1]', '["https://a.com"]', 'Your Health Portal'],
    unexpanded: ['https://abcd.supabase.co', '$5 off', '{literal}'],
    dynamic: [
      'import.meta.env.VITE_API_URL',
      'import.meta.env?.VITE_API_URL',
      'process.env.EXPO_PUBLIC_API_URL',
      'process.env[key]',
      'schema.parse(process.env)',
      "const s = 'import.meta.env[key]' // import.meta.env[key]",
      'type E = typeof import.meta.env',
    ],
    define: [
      "export default { define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV) } }",
      'export default { define: { __APP_VERSION__: JSON.stringify(pkg.version) } }',
      "const env = loadEnv(mode, '.'); export default { define: { 'import.meta.env.VITE_BUILD_SHA': JSON.stringify(env.VITE_BUILD_SHA) } }",
      "const env = loadEnv(mode, '.'); export default { define: { 'process.env': env } }",
      "const env = loadEnv(mode, '.'); export default { define: { 'process.env.API_URL': JSON.stringify(env.API_URL) } }",
      "const env = loadEnv(mode, '.', ''); export default { define: { __PKG__: JSON.stringify(pkg.env) } }",
      'export default { define: { __COMMIT__: JSON.stringify(process.env.COMMIT_REF), __BRANCH__: JSON.stringify(process.env.BRANCH) } }',
    ],
  },
}

/** Sample descriptions the detectors get wrong; empty when they all work. */
export function selfTest(test = SELF_TEST) {
  const wrong = []
  const detectors = {
    publicSecret: isPublicSecret,
    placeholder: isPlaceholder,
    unexpanded: isUnexpanded,
    dynamic: (s) => findDynamicAccess(s).length > 0,
    define: (s) => scanViteConfig(s).length > 0,
  }
  for (const [kind, detect] of Object.entries(detectors)) {
    for (const s of test.flag[kind]) if (!detect(s)) wrong.push(`${kind} missed ${JSON.stringify(s)}`)
    for (const s of test.pass[kind]) if (detect(s)) wrong.push(`${kind} wrongly flagged ${JSON.stringify(s)}`)
  }
  return wrong
}

// --- The check ---------------------------------------------------------------------------------

function check(root) {
  // Skeleton directories (repo-files.mjs) aren't the repo's files.
  const listed = listRepoFiles(root)
  const skipped = skeletonDirs(listed)
  const skeleton = inSkeletonDir(skipped)
  const files = listed.filter((p) => !skeleton(p))
  // Real env files are usually gitignored, so they're found by walking the tree, not from git.
  const envFiles = walk(root)
    .filter((p) => ENV_FILE.test(basename(p)))
    .map((p) => toPosix(relative(root, p)))
    .filter((p) => !skeleton(p))
    .sort()

  const findings = []
  const names = new Map() // name -> first place it was seen
  const seen = (name, where) => {
    if (!names.has(name)) names.set(name, where)
  }
  let reads = 0

  for (const f of envFiles) {
    for (const { line, name, value } of parseDotenv(readFileSync(join(root, f), 'utf8'))) {
      seen(name, `${f}:${line}`)
      if (!EXAMPLE.test(f) && isPlaceholder(value)) {
        findings.push({ where: `${f}:${line}`, kind: 'placeholder', detail: `${name} is still a placeholder value` })
      }
    }
  }
  for (const f of files.filter((p) => basename(p) === 'eas.json')) {
    let entries
    try {
      entries = easEnv(readFileSync(join(root, f), 'utf8'))
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      findings.push({ where: f, kind: 'unreadable', detail: `not valid JSON or JSON5 (${error.message}), so it wasn't checked` })
      continue
    }
    for (const { where, name, value } of entries) {
      seen(name, `${f} ${where}`)
      if (isUnexpanded(value)) {
        findings.push({
          where: `${f} ${where}`,
          kind: 'unexpanded',
          detail: `${name} uses \${…}, which EAS passes through literally (and it overrides the EAS environment's value); set it in the EAS environment instead`,
        })
      } else if (isPlaceholder(value)) {
        findings.push({ where: `${f} ${where}`, kind: 'placeholder', detail: `${name} is still a placeholder value` })
      }
    }
  }
  for (const f of files.filter((p) => SOURCE.test(p) && !p.split('/').some((s) => SKIP_DIRS.has(s)))) {
    for (const { text, offset } of scriptsIn(f, readFileSync(join(root, f), 'utf8'))) {
      const scanned = scanSource(text, scriptKind(f), f)
      for (const { name, line } of scanned.names) {
        reads++
        seen(name, `${f}:${line + offset}`)
      }
      for (const { line, why } of scanned.dynamic) {
        reads++
        findings.push({ where: `${f}:${line + offset}`, kind: 'dynamic-access', detail: why })
      }
    }
  }
  for (const f of files.filter((p) => VITE_CONFIG.test(p) && !p.split('/').some((s) => SKIP_DIRS.has(s)))) {
    const found = scanViteConfig(readFileSync(join(root, f), 'utf8'), scriptKind(f))
    reads += found.length
    for (const { line, why } of found) findings.push({ where: `${f}:${line}`, kind: 'define-env', detail: why })
  }
  for (const [name, where] of names) {
    if (isPublicSecret(name)) {
      findings.push({
        where,
        kind: 'public-secret',
        detail: `${name} has a client-exposed prefix (${publicPrefix(name)}) but its name says it's secret: any client read ships the value to every visitor`,
      })
    }
  }
  return { findings, examined: { envFiles: envFiles.length, names: names.size, reads }, skipped }
}

function main(argv) {
  if (tsMissing) {
    console.error(tsMissing.message)
    return 2
  }
  let rootArg
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--root' || arg.startsWith('--root=')) {
      rootArg = arg === '--root' ? argv[++i] : arg.slice('--root='.length)
      if (!rootArg || rootArg.startsWith('--')) {
        console.error('--root needs a path.')
        return 2
      }
    } else {
      console.error(`Unknown argument: ${arg}\nUsage: node scripts/check-env.mjs [--root <repo>]`)
      return 2
    }
  }
  const wrong = selfTest()
  if (wrong.length) {
    console.error(`✗ Self-test failed, so nothing was checked:\n${wrong.map((w) => `  - ${w}`).join('\n')}`)
    return 2
  }
  const root = resolve(rootArg ?? '.')
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`Not a directory: ${root}`)
    return 2
  }
  const { findings, examined, skipped } = check(root)
  // Said out loud, so a skipped directory is never mistaken for a checked one.
  const skippedNote = skipped.length ? `\nLeft out as skeletons (marked by ${SKELETON_MARKER}): ${skipped.join(', ')}` : ''
  if (examined.names === 0 && examined.reads === 0 && !findings.length) {
    // Nothing examined is not a pass.
    console.error(`No environment variables found under ${root}: no .env files, no eas.json env, no env reads in source.${skippedNote}`)
    return 2
  }
  // Two reads on one line (`import.meta.env && import.meta.env[key]`) are one finding.
  const lines = [...new Set(findings.map((f) => `${f.where}: ${f.kind}: ${f.detail}`))]
  for (const l of lines) console.log(l)
  const summary = `${examined.names} variable name(s) from ${examined.envFiles} env file(s) and source (${examined.reads} read(s))`
  if (lines.length) {
    console.error(`\n✗ ${lines.length} finding(s) in ${summary}.${skippedNote}`)
    return 1
  }
  console.log(`✓ Self-test passed; checked ${summary}.${skippedNote}`)
  return 0
}

// Run only when executed directly, so the tests can import the detectors.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)))
}
