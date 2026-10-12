import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SELF_TEST, isPlaceholder, isPublicSecret, parseDotenv, scanSource, selfTest } from '../check-env.mjs'
import { ISOLATED_ENV, resolvesFrom } from './isolated-env'

const SCRIPT = resolve(__dirname, '../check-env.mjs')

let root: string
const write = (path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}
const run = () => spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' })
const findings = () => run().stdout.split('\n').filter((l) => /: [\w-]+: /.test(l) && !l.startsWith('✓'))

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'check-env-'))
  execFileSync('git', ['init', '-q'], { cwd: root })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('without the template installed', () => {
  it('says how to install its dependencies, instead of a stack trace', () => {
    const bare = mkdtempSync(join(tmpdir(), 'check-env-bare-'))
    try {
      for (const file of ['check-env.mjs', 'repo-files.mjs', 'template-dependency.mjs']) {
        mkdirSync(join(bare, 'scripts'), { recursive: true })
        copyFileSync(resolve(__dirname, '..', file), join(bare, 'scripts', file))
      }
      // Positive control: nothing above the scratch copy provides `typescript`, in the environment
      // the script runs in below (isolated-env.ts says why that environment drops NODE_PATH).
      expect(resolvesFrom(join(bare, 'scripts/check-env.mjs'), 'typescript')).toBe(false)
      write('.env.example', 'API_URL=\n')
      const result = spawnSync(process.execPath, [join(bare, 'scripts/check-env.mjs'), '--root', root], { encoding: 'utf8', env: ISOLATED_ENV })
      expect(result.stderr).toContain('npm ci --ignore-scripts')
      expect(result.stderr).not.toMatch(/^\s+at /m) // no stack trace
      expect(result.status).toBe(2)
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }
  })
})

describe('the self-test', () => {
  it('passes with the shipped detectors and samples', () => {
    expect(selfTest()).toEqual([])
  })

  it('fails when a sample the detectors should flag gets through, and when a clean one is flagged', () => {
    const broken = structuredClone(SELF_TEST)
    broken.flag.publicSecret.push('VITE_SUPABASE_URL')
    broken.pass.placeholder.push('changeme')
    expect(selfTest(broken)).toEqual([
      'publicSecret missed "VITE_SUPABASE_URL"',
      'placeholder wrongly flagged "changeme"',
    ])
  })
})

describe('detectors', () => {
  it.each([
    ['VITE_SUPABASE_SERVICE_ROLE_KEY', true],
    ['NEXT_PUBLIC_DATABASE_URL', true],
    ['EXPO_PUBLIC_ANTHROPIC_API_KEY', true],
    ['PUBLIC_WEBHOOK_SECRET', true],
    ['VITE_ADMIN_KEY', true],
    ['VITE_SUPABASE_ANON_KEY', false],
    ['VITE_PRIVACY_URL', false],
    ['VITE_SECRETARY_EMAIL', false],
    ['STRIPE_SECRET_KEY', false],
  ])('%s is a public secret: %s', (name, expected) => {
    expect(isPublicSecret(name)).toBe(expected)
  })

  it.each([
    ['your-api-key', true],
    ['"your_supabase_project_url"', true],
    ['https://your-project.supabase.co', true],
    ['sk-ant-your-key-here', true],
    ['[FILL IN]', true],
    // URL-shaped: a vendor's documented DSN or connection string, copied with its placeholder in.
    ['https://<your-key>@o0.ingest.sentry.io/0', true],
    ['https://your-key@o0.ingest.sentry.io/0', true],
    ['https://your-dsn@o0.ingest.sentry.io/0', true],
    ['https://abc@o0.ingest.sentry.io/<project-id>', true],
    ['postgres://app:changeme@localhost:5432/app', true],
    ['postgres://app:<password>@localhost:5432/app', true],
    ['https://0123456789abcdef0123456789abcdef@o4504000000000000.ingest.us.sentry.io/4504000000000001', false],
    ['postgres://app:s3cr3t@db.internal:5432/yourapp', false],
    ['Use <b>bold</b> here', false],
    ['https://abc.supabase.co', false],
    ['[::1]', false],
    ['["http://localhost:3000"]', false],
    ['[]', false],
    ['Your Health Portal', false],
    ['placeholder-image', false],
    ['0', false],
    ['', false],
  ])('%s is a placeholder: %s', (value, expected) => {
    expect(isPlaceholder(value)).toBe(expected)
  })

  it('parses dotenv lines, ignoring comments, blank lines, and export', () => {
    expect(parseDotenv('# c\n\nexport A=1\nB = "two" # note\n  C=\n')).toEqual([
      { line: 3, name: 'A', value: '1' },
      { line: 4, name: 'B', value: '"two"' },
      { line: 5, name: 'C', value: '' },
    ])
  })

  it.each([
    ['passed to a function', 'const env = schema.parse(import.meta.env)'],
    ['aliased', 'const env = import.meta.env\nexport const v = env[k]'],
    ['tested for truthiness', 'if (import.meta.env && flag) run()'],
    ['cast, then indexed', 'const v = (import.meta.env as Record<string, string>)[k]'],
    ['reached through a cast of import.meta', 'const v = (import.meta as any).env[k]'],
    ['satisfies, then indexed', 'const v = (import.meta.env satisfies object)[k]'],
  ])('Vite: import.meta.env %s embeds every variable', (_label, code) => {
    expect(scanSource(code).dynamic).toHaveLength(1)
  })

  it.each([
    ['indexed by a variable', "const n = 'NEXT_PUBLIC_X'\nconst v = process.env[n]"],
    ['aliased', 'const env = process.env\nconst v = env.NEXT_PUBLIC_X'],
    ['passed whole to a schema', 'const env = z.object({ EXPO_PUBLIC_API: z.string() }).parse(process.env)'],
  ])('Next/Expo: process.env %s in a file that reads public variables', (_label, code) => {
    expect(scanSource(code).dynamic).toHaveLength(1)
  })

  it('leaves process.env alone in server code, build config, and tests', () => {
    expect(scanSource('const port = process.env[name]\nconst all = { ...process.env }').dynamic).toEqual([])
    const withPublic = 'function readEnv(key) { return process.env[key] }\nreadEnv("EXPO_PUBLIC_API_URL")'
    expect(scanSource(withPublic, undefined, 'app.config.ts').dynamic).toEqual([])
    expect(scanSource(withPublic, undefined, 'src/__tests__/config.test.ts').dynamic).toEqual([])
    expect(scanSource(withPublic, undefined, 'src/lib/config.ts').dynamic).toHaveLength(1)
  })

  it('collects names from every form of read, so a secret read by bracket or destructuring is still seen', () => {
    const { names } = scanSource("const a = process.env['EXPO_PUBLIC_SERVICE_ROLE_KEY']\nconst { VITE_ADMIN_KEY } = import.meta.env")
    expect(names.map((n) => n.name)).toEqual(['EXPO_PUBLIC_SERVICE_ROLE_KEY', 'VITE_ADMIN_KEY'])
  })

  it('reads source as code: strings and comments are not env access', () => {
    const { names, dynamic } = scanSource(
      [
        '// import.meta.env[key] in a comment',
        'const doc = "process.env[\'EXPO_PUBLIC_X\']"',
        'const a = import.meta.env.VITE_A',
        'const b = process.env.EXPO_PUBLIC_B',
        'const c = import.meta.env[name]',
      ].join('\n'),
    )
    expect(names.map((n) => n.name)).toEqual(['VITE_A', 'EXPO_PUBLIC_B'])
    expect(dynamic.map((d) => d.line)).toEqual([5])
  })
})

describe('the run', () => {
  it('reports each kind of finding, with names but never values', () => {
    write('.env.local', 'VITE_SUPABASE_URL=your-project-url\nVITE_SUPABASE_SERVICE_ROLE_KEY=eyJrealvalue\n')
    write('.env.example', 'VITE_API_URL=your-api-url\n')
    write('mobile/eas.json', JSON.stringify({ build: { production: { env: { EXPO_PUBLIC_API_URL: '${EXPO_PUBLIC_API_URL}' }, ios: { env: { EXPO_PUBLIC_KEY: 'changeme' } } } } }))
    write('src/config.ts', 'export const url = import.meta.env[key]\nexport const { NEXT_PUBLIC_SITE } = process.env\n')
    const result = run()
    expect(result.status).toBe(1)
    expect(findings().sort()).toEqual(
      [
        '.env.local:1: placeholder: VITE_SUPABASE_URL is still a placeholder value',
        ".env.local:2: public-secret: VITE_SUPABASE_SERVICE_ROLE_KEY has a client-exposed prefix (VITE_) but its name says it's secret: any client read ships the value to every visitor",
        "mobile/eas.json build.production.env: unexpanded: EXPO_PUBLIC_API_URL uses ${…}, which EAS passes through literally (and it overrides the EAS environment's value); set it in the EAS environment instead",
        'mobile/eas.json build.production.ios.env: placeholder: EXPO_PUBLIC_KEY is still a placeholder value',
        'src/config.ts:1: dynamic-access: import.meta.env used as a whole makes Vite embed every VITE_ variable here; read import.meta.env.NAME',
        'src/config.ts:2: dynamic-access: process.env used as a whole where public variables are read: Next.js and Expo inline only process.env.NAME, so this is undefined in a client bundle; list each as process.env.NAME',
      ].sort(),
    )
    expect(result.stdout + result.stderr).not.toContain('eyJrealvalue')
  })

  it('reports a vite.config define that puts non-public variables in the bundle', () => {
    write('.env.example', 'GEMINI_API_KEY=\n')
    write(
      'vite.config.ts',
      [
        "import { defineConfig, loadEnv } from 'vite'",
        'export default defineConfig(({ mode }) => {',
        "  const env = loadEnv(mode, '.', '')",
        '  return {',
        '    define: {',
        "      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),",
        "      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),",
        "      'import.meta.env.VITE_BUILD_SHA': JSON.stringify(env.VITE_BUILD_SHA),",
        '    },',
        '  }',
        '})',
      ].join('\n'),
    )
    // The "expose process.env" recipe: define given by name, built from every loaded variable.
    write(
      'vite.config.prod.ts',
      [
        "import { defineConfig, loadEnv } from 'vite'",
        'export default defineConfig(({ mode }) => {',
        "  const env = loadEnv(mode, process.cwd(), '')",
        "  const values = Object.entries(env).reduce((all, [k, v]) => ({ ...all, ['process.env.' + k]: JSON.stringify(v) }), {})",
        '  return { define: values }',
        '})',
      ].join('\n'),
    )
    expect(findings()).toEqual([
      'vite.config.prod.ts:5: define-env: define copies a whole environment object into the client bundle: every variable in it ships',
      'vite.config.ts:6: define-env: define "process.env.GEMINI_API_KEY" puts GEMINI_API_KEY in the client bundle, past Vite\'s VITE_ prefix rule: once client code reads it, the value ships to every visitor',
    ])
    expect(run().status).toBe(1)
  })

  it('finds gitignored env files anywhere in the tree, not just at the root', () => {
    write('.gitignore', '.env\n.env.local\n')
    write('.env', 'VITE_API_URL=your-api-url\n')
    write('mobile/.env', 'EXPO_PUBLIC_API_URL=your-api-url\nEXPO_PUBLIC_SERVICE_ROLE_KEY=abc\n')
    expect(findings().sort()).toEqual(
      [
        '.env:1: placeholder: VITE_API_URL is still a placeholder value',
        'mobile/.env:1: placeholder: EXPO_PUBLIC_API_URL is still a placeholder value',
        "mobile/.env:2: public-secret: EXPO_PUBLIC_SERVICE_ROLE_KEY has a client-exposed prefix (EXPO_PUBLIC_) but its name says it's secret: any client read ships the value to every visitor",
      ].sort(),
    )
  })

  it('reads source files whose names have non-ASCII characters', () => {
    write('src/café.ts', 'export const v = import.meta.env[k]\n')
    expect(findings()).toEqual([expect.stringMatching(/^src\/café\.ts:1: dynamic-access: /)])
  })

  it('skips a tracked file deleted from the working tree instead of crashing', () => {
    write('eas.json', JSON.stringify({ build: { production: { env: { EXPO_PUBLIC_A: '${A}' } } } }))
    write('src/a.ts', 'export const v = process.env.EXPO_PUBLIC_A\n')
    execFileSync('git', ['add', '.'], { cwd: root })
    rmSync(join(root, 'eas.json'))
    const result = run()
    expect(result.stderr).not.toContain('ENOENT')
    expect(result.status).toBe(0)
  })

  it('reads eas.json with comments and trailing commas (eas-cli accepts JSON5), and reports one it cannot read', () => {
    write('eas.json', '{\n  // profiles\n  "build": { "production": { "env": { "EXPO_PUBLIC_A": "${A}", }, }, },\n}\n')
    expect(findings()).toEqual([expect.stringMatching(/^eas\.json build\.production\.env: unexpanded: EXPO_PUBLIC_A /)])
    write('eas.json', '{ "build": ')
    const result = run()
    expect(findings()).toEqual([expect.stringMatching(/^eas\.json: unreadable: not valid JSON or JSON5/)])
    expect(result.stderr).not.toContain('    at ')
  })

  it('ignores non-string eas.json env values instead of reading them as "[object Object]"', () => {
    write('eas.json', JSON.stringify({ build: { production: { env: { EXPO_PUBLIC_A: { nested: 1 }, EXPO_PUBLIC_B: 'https://ok.example.com' } } } }))
    expect(findings()).toEqual([])
  })

  it('reads an Astro frontmatter written with CRLF and a BOM', () => {
    write('src/page.astro', `${String.fromCharCode(0xfeff)}---\r\nconst u = import.meta.env[k]\r\n---\r\n<p>x</p>\r\n`)
    expect(findings()).toEqual([expect.stringMatching(/^src\/page\.astro:2: dynamic-access: /)])
  })

  it('checks the per-platform env blocks in eas.json', () => {
    write('eas.json', JSON.stringify({ build: { preview: { android: { env: { EXPO_PUBLIC_A: '${A}' } }, ios: { env: { EXPO_PUBLIC_B: 'xxxx' } } } } }))
    expect(findings()).toEqual([
      expect.stringMatching(/^eas\.json build\.preview\.android\.env: unexpanded: EXPO_PUBLIC_A /),
      'eas.json build.preview.ios.env: placeholder: EXPO_PUBLIC_B is still a placeholder value',
    ])
  })

  it('reads script blocks in .vue, .svelte, and .astro files, with their real line numbers', () => {
    write('src/App.vue', '<template><p>x</p></template>\n\n<script setup>\nconst u = import.meta.env[k]\n</script>\n')
    write('src/page.astro', '---\nconst { NEXT_PUBLIC_X } = process.env\n---\n<p>x</p>\n')
    expect(findings().map((f) => f.split(': ')[0]).sort()).toEqual(['src/App.vue:4', 'src/page.astro:2'])
  })

  it('passes a clean repo, and says what it examined', () => {
    write('.env.example', 'VITE_SUPABASE_URL=https://your-project.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=\n')
    write('src/env.ts', 'export const url = import.meta.env.VITE_SUPABASE_URL\n')
    const result = run()
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/Self-test passed; checked 2 variable name\(s\) from 1 env file\(s\) and source \(1 read\(s\)\)/)
  })

  it("leaves out skeleton directories, which aren't the repo's files, and says so", () => {
    write('.env.example', 'API_URL=https://example.com\n')
    for (const dir of ['prompts/skeletons/', 'templates/project/']) {
      write(`${dir}AGENTS.skeleton.md`, '# AGENTS.md\n')
      write(`${dir}.env.example`, 'DATABASE_URL=your-database-url\n')
      write(`${dir}src/env.ts`, 'export const key = process.env.SKELETON_KEY\n')
    }
    const result = run()
    expect(result.stdout).toMatch(/checked 1 variable name\(s\) from 1 env file\(s\) and source \(0 read\(s\)\)/)
    expect(result.stdout).toContain('Left out as skeletons (marked by AGENTS.skeleton.md): prompts/skeletons/, templates/project/')
    expect(result.status).toBe(0)
  })

  it("still checks a repo's own prompts/skeletons/ code, which has no skeleton marker", () => {
    write('prompts/skeletons/render.ts', 'export const key = import.meta.env.VITE_OPENAI_API_KEY\n')
    expect(findings()).toEqual([expect.stringMatching(/^prompts\/skeletons\/render\.ts:1: public-secret: /)])
  })

  it('fails, not passes, when there is nothing to examine', () => {
    write('README.md', '# nothing here\n')
    const result = run()
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('No environment variables found')
  })

  it('rejects bad arguments', () => {
    expect(spawnSync(process.execPath, [SCRIPT, '--root'], { encoding: 'utf8' }).status).toBe(2)
    expect(spawnSync(process.execPath, [SCRIPT, 'extra'], { encoding: 'utf8' }).status).toBe(2)
  })
})
