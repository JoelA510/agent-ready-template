import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CheckError,
  conform,
  formatCard,
  globMatcher,
  loadCatalog,
  migrationTables,
  nextBaseline,
  PROBES,
  runProbe,
  commandForms,
  scriptCalls,
  setOptions,
  shellCommands,
} from '../check-conformance.mjs'
import { fixtureGit } from './fixture-git'

// Every probe is shown failing on a planted defect and passing on the fix, as the catalog's README
// requires of a new one. Fixtures are throwaway trees; a probe that needs git gets a repository.
const REPO = resolve(__dirname, '../..')
const SCRIPT = resolve(__dirname, '../check-conformance.mjs')
const TODAY = '2026-10-07'

let root: string
const write = (path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}
const json = (path: string, value: unknown) => write(path, `${JSON.stringify(value, null, 2)}\n`)
const probe = (
  id: string,
  options: { path?: string; visibility?: 'public' | 'private'; today?: string; vocabulary?: { accept?: string[]; reject?: string[] } } = {},
) => runProbe(root, id, options)
const git = fixtureGit(() => root)
const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, '--root', root, '--today', TODAY, ...args], { encoding: 'utf8' })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'conformance-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

// A Node project that meets every node standard; each test plants one defect in it.
const workflow = (steps: string, on = 'pull_request:\n  schedule:\n    - cron: "0 6 * * 1"') =>
  `on:\n  ${on}\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v7\n${steps}`
const SETUP_NODE = '      - uses: actions/setup-node@v7\n        with:\n          node-version-file: .nvmrc\n'
function goodNode(overrides: { scripts?: Record<string, string>; devDependencies?: Record<string, string> } = {}) {
  json('package.json', {
    name: 'app',
    engines: { node: '^22.12.0 || ^24.0.0' },
    scripts: {
      lint: 'eslint .',
      typecheck: 'tsc --noEmit',
      test: 'vitest run',
      build: 'vite build',
      check: 'npm run lint && npm run typecheck && npm run check:unused && npm run test && npm run build',
      'check:unused': 'knip',
      'check:audit': 'npm audit --audit-level=high',
      ...overrides.scripts,
    },
    devDependencies: { vitest: '^5.0.0', typescript: '^6.0.0', vite: '^8.0.0', knip: '^6.39.0', ...overrides.devDependencies },
    packageManager: 'npm@11.19.0',
  })
  write('.npmrc', 'min-release-age=7\nallow-git=root\nallow-remote=root\n')
  write('.nvmrc', '24\n')
  json('tsconfig.json', { compilerOptions: { strict: true, noEmit: true }, include: ['src'] })
  write('src/main.ts', 'export const answer: number = 42\n')
  write('.github/workflows/ci.yml', workflow(`${SETUP_NODE}      - run: npm ci\n      - run: npm run check\n      - run: npm run check:audit\n`))
}

describe('the catalog', () => {
  const catalog = loadCatalog()

  it('loads without problems (positive control: it found the standards)', () => {
    expect(catalog.problems).toEqual([])
    expect(catalog.standards.length).toBeGreaterThan(20)
    expect([...catalog.packs.keys()]).toEqual(expect.arrayContaining(['core', 'node', 'vite-spa', 'supabase', 'python']))
  })

  it('has a probe for every checked standard and a checked standard for every probe', () => {
    const checked = catalog.standards.filter((s) => s.enforcement === 'check').map((s) => s.id)
    expect(checked.sort()).toEqual(Object.keys(PROBES).sort())
  })

  it('reports a malformed catalog instead of scoring with it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'catalog-'))
    try {
      mkdirSync(join(dir, 'core'))
      writeFileSync(join(dir, 'core/README.md'), '---\npack: core\ntitle: Every repository\n---\nCore.\n')
      writeFileSync(join(dir, 'core/one.md'), '---\nid: core.two\ntitle: A title\nseverity: urgent\nenforcement: check\naudit-area: 14\n---\n')
      writeFileSync(join(dir, 'core/three.md'), 'No frontmatter.\n')
      mkdirSync(join(dir, 'web'))
      writeFileSync(join(dir, 'web/README.md'), '---\npack: web\ntitle: Web\n---\n')
      const { problems } = loadCatalog(dir)
      expect(problems).toEqual(
        expect.arrayContaining([
          'core/one.md: "id" must be "core.one", its path',
          'core/one.md: "severity" must be one of blocker, high, medium, low',
          'core/one.md: "audit-area" must be the existing-project audit area it belongs to, 1-13',
          'core/one.md: the body must say what the standard requires and why',
          'core/one.md: enforcement is "check", but PROBES has no core.one',
          'core/three.md: no YAML frontmatter between --- lines',
          'web/README.md: "detect" must list at least one marker ({ file: <glob> } or { dependency: <name> })',
          'PROBES.core.agent-rules has no "check" standard in the catalog',
        ]),
      )
      expect(() => conform(root, { catalog: loadCatalog(dir), today: TODAY })).toThrow(CheckError)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('helpers', () => {
  it.each([
    ['vite.config.*', 'vite.config.ts', true],
    ['vite.config.*', 'web/vite.config.ts', false],
    ['requirements*.txt', 'requirements-dev.txt', true],
    ['supabase/migrations/', 'supabase/migrations/20260101000000_init.sql', true],
    ['supabase/migrations/', 'supabase/migrations', false],
    ['*.py', 'tool.py', true],
    ['*.py', 'tools/tool.py', false],
    ['**/*.py', 'tools/deep/tool.py', true],
  ])('glob %s matches %s: %s', (pattern, path, expected) => {
    expect(globMatcher(pattern)(path)).toBe(expected)
  })

  it('splits shell snippets into commands and follows cd', () => {
    expect(shellCommands('cd web && npm ci\nnpm test | tee out.log; # a comment\ncd .. || exit 1', '.')).toEqual([
      { text: 'npm ci', dir: 'web' },
      { text: 'npm test', dir: 'web', silenced: 'piped into another command, without pipefail' },
      { text: 'tee out.log', dir: 'web' },
      { text: 'exit 1', dir: '.' },
    ])
    expect(shellCommands('cd "$HOME" && npm test')).toEqual([{ text: 'npm test', dir: null }])
  })

  it('marks the commands whose failure the shell swallows', () => {
    const silenced = (text: string, options?: { errexit?: boolean; pipefail?: boolean }) =>
      shellCommands(text, '.', options).filter((c) => c.silenced).map((c) => c.text)
    expect(silenced('npm run lint && npm test || true')).toEqual(['npm run lint', 'npm test'])
    expect(silenced('npm audit || echo "audit failed"')).toEqual(['npm audit'])
    expect(silenced('npm test || exit 1')).toEqual([]) // still fails the step
    expect(silenced('npm test || npm test')).toEqual([]) // a retry: the second run decides
    expect(silenced('npm test | tee log', { pipefail: true })).toEqual([])
    expect(silenced('eslint . ; tsc ; vitest run', { errexit: false })).toEqual(['eslint .', 'tsc'])
    expect(silenced('eslint . ; tsc ; vitest run')).toEqual([]) // a step's bash -e stops at the first
  })

  it.each([
    ['npx --yes eslint .', 'eslint .'],
    ['CI=1 node_modules/.bin/vitest run', 'vitest run'],
    ['uv run python -m pytest -q', 'pytest -q'],
    ['npx supabase@2 db lint', 'supabase db lint'],
    ['npx @biomejs/biome check .', 'biome check .'],
  ])('reads %s as running %s', (command, program) => {
    expect(commandForms(command)).toContain(program)
  })

  it.each([
    ['cross-env NODE_ENV=test jest --ci', 'jest --ci'],
    ['pnpm --filter web exec tsc --noEmit', 'tsc --noEmit'],
    ['dotenv -e .env.test -- vitest run', 'vitest run'],
    ['timeout 15m npx vitest run', 'vitest run'],
    ['node node_modules/.bin/jest', 'jest'],
    ['env -u CI eslint .', 'eslint .'],
  ])('reads %s, behind its wrapper, as running %s', (command, program) => {
    expect(commandForms(command)).toContain(program)
  })

  it.each([
    ['npm install --no-save eslint tsc vitest'],
    ['pip install pytest pytest-cov'],
    ['python -m pip install pytest'],
    ['echo vitest'],
    ['command -v eslint'],
    ['npx -p eslint prettier --check .'],
    ['uv run --with pytest python build.py'],
    ['npm ls eslint'],
    ['yarn global add eslint'],
    ['npm --global install eslint'],
    ['conda install -y pytest'],
    ['grep -q vitest package.json'],
    ['test -x node_modules/.bin/eslint'],
    ['git commit -m "fix eslint warnings"'],
  ])('reads %s as running no tool it names', (command) => {
    expect(commandForms(command).some((form) => /^(eslint|tsc|vitest|pytest)(\s|$)/.test(form))).toBe(false)
  })

  it('splits shell only outside quotes, substitutions, and groups', () => {
    const texts = (text: string) => shellCommands(text).map((c) => c.text)
    expect(texts("jest --ci --testPathIgnorePatterns='/e2e/|/integration/'")).toEqual(["jest --ci --testPathIgnorePatterns='/e2e/|/integration/'"])
    expect(texts('npx playwright test --grep "@smoke|@critical" # smoke; then the rest')).toEqual(['npx playwright test --grep "@smoke|@critical"'])
    expect(texts('REPO="$(cd "$(dirname "$0")/.." && pwd)"; vitest run 2>&1 | tee log')).toEqual(['REPO="$(cd "$(dirname "$0")/.." && pwd)"', 'vitest run 2>&1', 'tee log'])
    expect(shellCommands('( cd web && npx vitest run )')).toEqual([{ text: 'npx vitest run', dir: 'web' }])
  })

  it('follows a cd through the directories a script finds for itself', () => {
    const dirs = (text: string, options: { scriptDir?: string; posix?: boolean } = {}) =>
      shellCommands(text, '.', options).filter((c) => /^npm /.test(c.text)).map((c) => c.dir)
    // The running script's own directory, the repository's root, $(pwd), and a variable set to one.
    expect(dirs('cd "$(dirname "$0")/../web" && npm test', { scriptDir: 'scripts' })).toEqual(['web'])
    expect(dirs('cd "$(dirname "${BASH_SOURCE[0]}")"/.. && npm test', { scriptDir: 'scripts/ci' })).toEqual(['scripts'])
    expect(dirs('cd $(dirname $0) && npm test', { scriptDir: 'scripts' })).toEqual(['scripts'])
    expect(dirs('cd "$(git rev-parse --show-toplevel)/web" && npm test')).toEqual(['web'])
    expect(dirs('cd "$(cd "$(dirname "$0")/.." && pwd)" && npm test', { scriptDir: 'scripts' })).toEqual(['.'])
    expect(dirs('ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"\ncd "$ROOT/web"\nnpm test', { scriptDir: 'scripts/ci' })).toEqual(['web'])
    expect(dirs('cd web\nHERE=$(pwd)\ncd ..\ncd "$HERE" && npm test')).toEqual(['web'])
    expect(dirs('cd "$PWD/web" && npm test')).toEqual(['web'])
    // cd - goes back where the shell was; a shell that hasn't moved has nowhere to go back to.
    expect(dirs('cd web && npm test && cd - && npm test')).toEqual(['web', '.'])
    expect(dirs('cd web\ncd ../api\ncd -\nnpm test')).toEqual(['web'])
    expect(dirs('cd - && npm test')).toEqual([null])
    // What it can't know stays unknown: a workflow step's $0 is a file outside the checkout, a
    // variable set to anything else, a single-quoted variable, a substitution it doesn't read, and
    // a shell that doesn't expand these at all.
    // The usual ways of writing those: `--`, `-P`, and redirections don't change where cd goes.
    for (const idiom of [
      'DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )\ncd "$DIR/../web"',
      'DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"\ncd "$DIR/../web"',
      'DIR="$(cd -P "$(dirname "$0")" && pwd)"\ncd "$DIR/../web"',
      'cd -- "$(dirname -- "$0")/../web"',
      'cd "$(dirname "$0")/../web" > /dev/null',
    ]) {
      expect(dirs(`${idiom}\nnpm test`, { scriptDir: 'scripts' }), idiom).toEqual(['web'])
    }
    expect(dirs('cd "$GITHUB_WORKSPACE"/web && npm test')).toEqual(['web'])
    expect(dirs('cd "${{ github.workspace }}"/web; npm test', { posix: false })).toEqual(['web'])
    expect(dirs('cd -- && npm test')).toEqual([null]) // home
    expect(dirs('cd >/dev/null && npm test')).toEqual([null]) // home too
    expect(dirs('cd web>/dev/null && npm test')).toEqual([null])
    expect(dirs('cd "$GITHUB_WORKSPACE/$APP" && npm test')).toEqual([null])
    expect(dirs('cd "$(dirname "$0")" && npm test')).toEqual([null])
    expect(dirs('ROOT=web\ncd "$ROOT" && npm test')).toEqual([null])
    expect(dirs('ROOT="$(git rev-parse --show-toplevel)"\nROOT=elsewhere\ncd "$ROOT" && npm test')).toEqual([null])
    expect(dirs("cd '$GITHUB_WORKSPACE/web' && npm test")).toEqual([null])
    expect(dirs('cd "$(mktemp -d)" && npm test')).toEqual([null])
    expect(dirs('cd "$(dirname "$0")/$APP" && npm test', { scriptDir: 'scripts' })).toEqual([null])
    expect(dirs('cd "$(dirname "$0")/../.." && npm test', { scriptDir: 'scripts' })).toEqual([null]) // outside the repository
    expect(dirs('cd "$(git rev-parse --show-toplevel)/web"; npm test', { posix: false })).toEqual([null])
  })

  it('follows a failure through && and || the way bash does', () => {
    const silenced = (text: string, options?: { errexit?: boolean; pipefail?: boolean }) =>
      shellCommands(text, '.', options).filter((c) => c.silenced).map((c) => c.text)
    expect(silenced('npx eslint . || echo "::error::lint failed" && exit 1')).toEqual([]) // the exit still runs
    expect(silenced('npm test || (cat log; exit 1)')).toEqual([])
    expect(silenced('npm run lint || echo "lint failed" && npm test')).toEqual(['npm run lint'])
    // bash -e ignores a failure that isn't the last of its && list, unless it's the snippet's last line.
    expect(silenced('npm run lint && npm run typecheck\nnpm test')).toEqual(['npm run lint'])
    expect(silenced('vitest run && node -e "a(); b()"', { errexit: false })).toEqual([])
    expect(silenced('npm run lint & lint=$!\nnpm test\nwait $lint')).toEqual([]) // wait collects its status
    // A newline after && or || continues the list, as in bash.
    expect(silenced('npm run lint &&\n  npm run typecheck\nnpm test')).toEqual(['npm run lint'])
    expect(silenced('npx eslint . ||\n  echo "lint failed"\nnpm test')).toEqual(['npx eslint .'])
    // An unknown command after || is assumed to fail too, so a later || true still swallows.
    expect(silenced('npx eslint . || npx eslint . --format compact || true')).toEqual(['npx eslint .', 'npx eslint . --format compact'])
    expect(silenced('if ! deno test; then\n  exit 1\nfi', { errexit: false })).toEqual([])
  })

  it('skips heredoc bodies and comments, wherever an apostrophe in them sits', () => {
    const texts = (text: string) => shellCommands(text).map((c) => c.text)
    expect(texts('cat >> "$GITHUB_STEP_SUMMARY" <<EOF\nDon\'t merge on red | ; &&\nEOF\nnpm test')).toEqual(['cat >> "$GITHUB_STEP_SUMMARY" <<EOF', 'npm test'])
    expect(texts("npm run lint || {\n  # don't hide the failure\n  echo failed\n  exit 1\n}\nnpm test")).toEqual(['npm run lint', 'echo failed', 'exit 1', 'npm test'])
  })

  it('applies a set line from where it is, and a script keeps errexit', () => {
    const silenced = (text: string, options?: { errexit?: boolean; pipefail?: boolean; fixedErrexit?: boolean }) =>
      shellCommands(text, '.', options).filter((c) => c.silenced).map((c) => c.text)
    expect(silenced('npm run lint\nnpm test\nset +e\nnpx codecov\necho done')).toEqual(['npx codecov'])
    expect(silenced('set +e\nnpm run lint\nlint=$?\nexit $lint', { errexit: true, fixedErrexit: true })).toEqual([])
    expect(silenced('set -o pipefail\nnpx eslint . | tee log')).toEqual([])
    expect(silenced('npx eslint . | tee log\nset -o pipefail')).toEqual(['npx eslint .'])
  })

  it('reads set lines for errexit and pipefail', () => {
    expect(setOptions('set -oe pipefail', { errexit: false, pipefail: false })).toEqual({ errexit: true, pipefail: true })
    expect(setOptions('set -euo pipefail\nnpm test', { errexit: false, pipefail: false })).toEqual({ errexit: true, pipefail: true })
    expect(setOptions('set -e -o pipefail', { errexit: false, pipefail: false })).toEqual({ errexit: true, pipefail: true })
    expect(setOptions('set -o errexit -o pipefail', { errexit: false, pipefail: false })).toEqual({ errexit: true, pipefail: true })
    expect(setOptions('set +e', { errexit: true, pipefail: false })).toEqual({ errexit: false, pipefail: false })
  })

  it.each([
    ['npm run lint -- --fix', [{ name: 'lint', dir: null, workspace: null }]],
    ['CI=1 npm test', [{ name: 'test', dir: null, workspace: null }]],
    ['npm --prefix web run build', [{ name: 'build', dir: 'web', workspace: null }]],
    ['npm run test -w mobile-app', [{ name: 'test', dir: null, workspace: 'mobile-app' }]],
    ['yarn workspace mobile-app test --ci', [{ name: 'test', dir: null, workspace: 'mobile-app' }]],
    ['pnpm --filter api typecheck', [{ name: 'typecheck', dir: null, workspace: 'api' }]],
    ['yarn lint', [{ name: 'lint', dir: null, workspace: null }]],
    ['npm ci', []],
    ['npm run --workspaces test', []],
    ['npx vitest run', []],
    ['npm --loglevel warn run check', [{ name: 'check', dir: null, workspace: null }]],
    ['run-s lint typecheck "test:*"', [{ name: 'lint', dir: null, workspace: null }, { name: 'typecheck', dir: null, workspace: null }, { name: 'test:*', dir: null, workspace: null }]],
  ])('%s calls %j', (command, expected) => {
    expect(scriptCalls(command)).toEqual(expected)
  })
})

describe('reading the repository', () => {
  it('ignores a symlink that leads out of the root, and never quotes what it points at', () => {
    goodNode()
    git('init', '-q') // git lists a symlink; a walk outside a work tree never follows one
    const outside = mkdtempSync(join(tmpdir(), 'outside-'))
    try {
      writeFileSync(join(outside, 'environ'), 'MY_DEPLOY_TOKEN=tok_abc123\n')
      rmSync(join(root, '.nvmrc'))
      symlinkSync(join(outside, 'environ'), join(root, '.nvmrc'))
      const result = probe('node.runtime-pinned')
      expect(result.status).toBe('fail')
      expect(result.evidence[0]).toContain('no .nvmrc')
      expect(JSON.stringify(result)).not.toContain('tok_abc123')
      // Positive control: a symlink inside the repository still counts.
      write('versions/node', '24\n')
      rmSync(join(root, '.nvmrc'))
      symlinkSync('versions/node', join(root, '.nvmrc'))
      expect(probe('node.runtime-pinned').status).toBe('pass')
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it("doesn't count a gitignored file, which a fresh clone wouldn't have", () => {
    goodNode()
    write('.gitignore', '.nvmrc\n')
    git('init', '-q')
    expect(probe('node.runtime-pinned').evidence[0]).toContain('no .nvmrc')
    write('.gitignore', '\n')
    expect(probe('node.runtime-pinned').status).toBe('pass')
  })

  it("refuses a directory git lists nothing in, instead of scoring an empty repository", () => {
    write('.gitignore', 'vendor/\n')
    git('init', '-q')
    const inner = join(root, 'vendor/app')
    mkdirSync(join(inner, '.agent/workflows'), { recursive: true })
    writeFileSync(join(inner, '.agent/workflows/deploy.md'), '# Deploy\n')
    expect(() => conform(inner, { today: TODAY })).toThrow(/No files to score/)
    // Positive control: an empty repository is scored, not refused.
    const empty = join(root, 'vendor/empty')
    mkdirSync(empty)
    expect(() => conform(empty, { today: TODAY })).not.toThrow()
  })

  it('refuses a directory that holds only symlinks out of it', () => {
    const outside = mkdtempSync(join(tmpdir(), 'outside-'))
    try {
      writeFileSync(join(outside, 'notes.md'), '# Notes\n')
      git('init', '-q')
      symlinkSync(join(outside, 'notes.md'), join(root, 'README.md'))
      expect(() => conform(root, { today: TODAY })).toThrow(/No files to score/)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it("won't write a baseline into a symlinked directory that leads out", () => {
    const outside = mkdtempSync(join(tmpdir(), 'outside-'))
    try {
      write('README.md', '# App\n')
      symlinkSync(outside, join(root, 'docs'))
      git('init', '-q')
      const result = run('--write-baseline')
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('leads out of the repository through a symlink')
      expect(existsSync(join(outside, 'standards'))).toBe(false)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('reads a package.json with a byte order mark, as npm does', () => {
    goodNode()
    write('package.json', `\uFEFF${readFileSync(join(root, 'package.json'), 'utf8')}`)
    expect(probe('node.runtime-pinned').status).toBe('pass')
  })

  it("won't write a baseline through a symlinked config", () => {
    const outside = mkdtempSync(join(tmpdir(), 'outside-'))
    try {
      writeFileSync(join(outside, 'target.json'), '{}\n')
      mkdirSync(join(root, 'docs/standards'), { recursive: true })
      symlinkSync(join(outside, 'target.json'), join(root, 'docs/standards/conformance.json'))
      write('README.md', '# App\n')
      git('init', '-q')
      const result = run('--write-baseline')
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('leads out of the repository through a symlink')
      expect(readFileSync(join(outside, 'target.json'), 'utf8')).toBe('{}\n')
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('core probes', () => {
  it('agent-rules: AGENTS.md at the root, not only a tool-specific file', () => {
    // Rules kept in ordinary docs aren't looked for, so the evidence claims only the default locations.
    write('docs/HANDOFF.md', '# Agent rules\n')
    expect(probe('core.agent-rules')).toMatchObject({
      status: 'fail',
      evidence: ['no AGENTS.md at the root', 'no agent rules in any file an agent reads by default'],
    })
    write('CLAUDE.md', '# Rules\n')
    expect(probe('core.agent-rules')).toMatchObject({ status: 'fail', evidence: ['no AGENTS.md at the root', 'rules kept only in: CLAUDE.md'] })
    write('AGENTS.md', '# Rules\n')
    expect(probe('core.agent-rules').status).toBe('pass')
  })

  it('instructions-resolve: runs the instruction lint', () => {
    expect(probe('core.instructions-resolve').status).toBe('n/a')
    write('AGENTS.md', 'Schema in `src/db/schema.ts`.\n')
    expect(probe('core.instructions-resolve')).toMatchObject({ status: 'fail', evidence: expect.arrayContaining([expect.stringContaining("src/db/schema.ts doesn't exist")]) })
    write('src/db/schema.ts', '\n')
    expect(probe('core.instructions-resolve').status).toBe('pass')
  })

  it('ci-on-pull-requests: a workflow on pull_request, and none GitHub can\'t parse', () => {
    expect(probe('core.ci-on-pull-requests')).toMatchObject({ status: 'fail', evidence: ['no GitHub Actions workflows (.github/workflows/)'] })
    write('.github/workflows/deploy.yml', workflow('      - run: echo deploy\n', 'push:'))
    expect(probe('core.ci-on-pull-requests')).toMatchObject({ status: 'fail', evidence: [expect.stringContaining('no workflow runs on pull_request')] })
    write('.github/workflows/ci.yml', workflow('      - run: echo ok\n'))
    expect(probe('core.ci-on-pull-requests').status).toBe('pass')
    write('.github/workflows/broken.yml', 'on: [pull_request\njobs: {')
    expect(probe('core.ci-on-pull-requests')).toMatchObject({ status: 'fail', evidence: [expect.stringContaining("broken.yml doesn't parse")] })
    rmSync(join(root, '.github/workflows/broken.yml'))
    write('.github/workflows/empty.yml', 'on: pull_request\n')
    expect(probe('core.ci-on-pull-requests')).toMatchObject({ status: 'fail', evidence: ['.github/workflows/empty.yml has no jobs, so GitHub rejects it as invalid'] })
  })

  it('ci-on-pull-requests: another CI system is skipped, not failed', () => {
    write('.gitlab-ci.yml', 'test:\n  script: npm test\n')
    expect(probe('core.ci-on-pull-requests').status).toBe('skipped')
  })

  it('security-policy: SECURITY.md at the root, in .github/, or in docs/', () => {
    expect(probe('core.security-policy').status).toBe('fail')
    write('.github/SECURITY.md', 'Report privately.\n')
    expect(probe('core.security-policy').status).toBe('pass')
  })

  it('license: needs the visibility, applies to public repositories', () => {
    expect(probe('core.license').status).toBe('skipped')
    expect(probe('core.license', { visibility: 'private' }).status).toBe('n/a')
    expect(probe('core.license', { visibility: 'public' }).status).toBe('fail')
    write('license-checker.json', '{}\n')
    expect(probe('core.license', { visibility: 'public' }).status).toBe('fail')
    write('LICENSE-MIT.md', 'MIT\n')
    expect(probe('core.license', { visibility: 'public' }).status).toBe('pass')
  })

  it('lf-line-endings: reads what is committed, and is skipped outside git', () => {
    write('a.txt', 'one\r\ntwo\r\n')
    expect(probe('core.lf-line-endings').status).toBe('skipped')
    git('init', '-q')
    git('-c', 'core.autocrlf=false', 'add', '.')
    git('commit', '-q', '--no-verify', '-m', 'crlf')
    expect(probe('core.lf-line-endings')).toMatchObject({ status: 'fail', evidence: [expect.stringContaining('1 of 1'), 'a.txt (crlf)'] })
    write('a.txt', 'one\ntwo\n')
    git('-c', 'core.autocrlf=false', 'add', '.')
    expect(probe('core.lf-line-endings').status).toBe('pass')
  })

  it('no-agent-workflows: Antigravity workflows left behind', () => {
    write('.agent/workflows/review.md', '# Review\n')
    expect(probe('core.no-agent-workflows')).toMatchObject({ status: 'fail', evidence: [expect.stringContaining('2026-10-19'), '.agent/workflows/review.md'] })
    rmSync(join(root, '.agent'), { recursive: true })
    expect(probe('core.no-agent-workflows').status).toBe('pass')
  })

  it('dependency-updates: n/a with nothing to update, and a manifest or an action makes it apply', () => {
    write('tools/check.py', 'print(1)\n')
    expect(probe('core.dependency-updates')).toMatchObject({ status: 'n/a' })
    write('.github/workflows/ci.yml', workflow('      - run: python tools/check.py\n'))
    expect(probe('core.dependency-updates').status).toBe('fail') // actions/checkout is a dependency
    rmSync(join(root, '.github'), { recursive: true })
    write('tools/Dockerfile', 'FROM python:3.13-slim\n')
    expect(probe('core.dependency-updates').status).toBe('fail')
  })

  it.each([['.github/dependabot.yml'], ['renovate.json'], ['.github/renovate.json5']])('dependency-updates: passes on %s', (file) => {
    json('package.json', { name: 'app' })
    expect(probe('core.dependency-updates').status).toBe('fail')
    write(file, '{}\n')
    expect(probe('core.dependency-updates').status).toBe('pass')
  })

  it('dependency-cooldown: every Dependabot entry waits, and Renovate by setting or preset', () => {
    expect(probe('core.dependency-cooldown').status).toBe('n/a')
    const entry = (ecosystem: string, cooldown = '') => `  - package-ecosystem: ${ecosystem}\n    directory: /\n    schedule:\n      interval: weekly\n${cooldown}`
    write('.github/dependabot.yml', `version: 2\nupdates:\n${entry('npm', '    cooldown:\n      default-days: 7\n')}${entry('github-actions')}`)
    expect(probe('core.dependency-cooldown')).toMatchObject({
      status: 'fail',
      evidence: ['.github/dependabot.yml: github-actions (/) sets no cooldown of 3 days or more (default-days unset)', '.github/dependabot.yml: npm (/) waits 7 days'],
    })
    write('.github/dependabot.yml', `version: 2\nupdates:\n${entry('npm', '    cooldown:\n      default-days: 2\n')}`)
    expect(probe('core.dependency-cooldown').evidence[0]).toContain('(default-days: 2)')
    write('.github/dependabot.yml', `version: 2\nupdates:\n${entry('npm', '    cooldown:\n      default-days: 3\n')}`)
    expect(probe('core.dependency-cooldown').status).toBe('pass')
    // A cooldown that waits for nothing: every dependency excluded, or patches and minors on day one.
    write('.github/dependabot.yml', `version: 2\nupdates:\n${entry('npm', '    cooldown:\n      default-days: 7\n      exclude: ["*"]\n')}`)
    expect(probe('core.dependency-cooldown').evidence[0]).toContain('excludes every dependency')
    write('.github/dependabot.yml', `version: 2\nupdates:\n${entry('npm', '    cooldown:\n      default-days: 7\n      semver-patch-days: 0\n')}`)
    expect(probe('core.dependency-cooldown').evidence[0]).toContain('semver-patch-days: 0')
    rmSync(join(root, '.github'), { recursive: true })
    const renovate = (config: string) => write('renovate.json5', config)
    renovate('{\n  // comments, as JSON5 allows\n  extends: ["config:recommended"],\n  minimumReleaseAge: "0 days",\n}\n')
    expect(probe('core.dependency-cooldown')).toMatchObject({ status: 'fail', evidence: ['renovate.json5 sets no minimumReleaseAge of 3 days or more for every package'] })
    renovate('{ minimumReleaseAge: "12 hours" }\n')
    expect(probe('core.dependency-cooldown').status).toBe('fail')
    renovate('{ packageRules: [{ matchDepTypes: ["devDependencies"], minimumReleaseAge: "3 days" }] }\n')
    expect(probe('core.dependency-cooldown').status).toBe('fail') // only some packages wait
    renovate('{ minimumReleaseAge: "7 days", packageRules: [{ matchPackageNames: ["*"], minimumReleaseAge: null }] }\n')
    expect(probe('core.dependency-cooldown').status).toBe('fail') // a later rule for everything takes it back
    renovate('{ packageRules: [{ matchPackageNames: ["*"], minimumReleaseAge: "1 week" }] }\n')
    expect(probe('core.dependency-cooldown')).toMatchObject({ status: 'pass', evidence: ['renovate.json5: minimumReleaseAge of 7 days'] })
    // A rule scoped to some packages can only lower the wait for them, which is a finding.
    renovate('{ minimumReleaseAge: "3 days", packageRules: [{ matchUpdateTypes: ["patch", "minor"], minimumReleaseAge: "0 days" }] }\n')
    expect(probe('core.dependency-cooldown').evidence[0]).toContain('a package rule (matchUpdateTypes: ["patch","minor"]) sets minimumReleaseAge "0 days"')
    renovate('{ minimumReleaseAge: "3 days", packageRules: [{ matchUpdateTypes: ["lockFileMaintenance"], minimumReleaseAge: null }, { matchPackageNames: ["left-pad"], minimumReleaseAge: "1 year" }] }\n')
    expect(probe('core.dependency-cooldown').status).toBe('pass') // lock file maintenance has no release to age; a year is longer
    renovate('{ minimumReleaseAge: "3 days", extends: ["github>acme/renovate-config"] }\n')
    expect(probe('core.dependency-cooldown').status).toBe('skipped') // its rules could lower the age
    renovate('{ packageRules: [{ matchPackageNames: [], minimumReleaseAge: "3 days" }] }\n')
    expect(probe('core.dependency-cooldown').status).toBe('fail') // no names is no package
    renovate('{ packageRules: [{ extends: ["monorepo:react"], matchPackageNames: ["*"], minimumReleaseAge: "3 days" }] }\n')
    expect(probe('core.dependency-cooldown').status).toBe('fail') // the preset adds its own selector
    renovate('{ extends: ["config:best-practices"] }\n')
    expect(probe('core.dependency-cooldown').evidence[0]).toContain("config:best-practices doesn't cover any manifest here")
    json('tests/fixtures/web/package.json', { name: 'fixture' })
    expect(probe('core.dependency-cooldown').status).toBe('fail') // Renovate ignores tests/, so this isn't the repo's npm
    json('web/package.json', { name: 'web' })
    renovate('{ extends: [":unpublishSafe"] }\n')
    expect(probe('core.dependency-cooldown').status).toBe('pass') // a package.json below the root, and the old alias
    write('requirements.txt', 'requests==2.32.3\n')
    expect(probe('core.dependency-cooldown').evidence[0]).toContain("doesn't cover a Python manifest") // PyPI updates don't wait
    rmSync(join(root, 'requirements.txt'))
    rmSync(join(root, 'web'), { recursive: true })
    rmSync(join(root, 'tests'), { recursive: true })
    for (const age of ['1 week 2 days', '1 yr', '3 M']) {
      renovate(`{ minimumReleaseAge: "${age}" }\n`)
      expect(probe('core.dependency-cooldown').status, age).toBe('pass')
    }
    renovate('{ minimumReleaseAge: "3 m" }\n')
    expect(probe('core.dependency-cooldown').status).toBe('fail') // three minutes
    write('Cargo.toml', '[package]\nname = "app"\n')
    renovate('{ extends: ["security:minimumReleaseAgeCrate"] }\n')
    expect(probe('core.dependency-cooldown')).toMatchObject({ status: 'pass', evidence: ['renovate.json5: extends security:minimumReleaseAgeCrate, which waits for Cargo.toml updates only'] })
    rmSync(join(root, 'Cargo.toml'))
    // Every kind of manifest counts, not only the three a preset can cover.
    json('package.json', { name: 'app' })
    renovate('{ extends: ["config:best-practices"] }\n')
    expect(probe('core.dependency-cooldown').status).toBe('pass')
    write('go.mod', 'module example.com/app\n')
    expect(probe('core.dependency-cooldown').evidence[0]).toContain("config:best-practices doesn't cover go.mod") // Go updates don't wait
    rmSync(join(root, 'go.mod'))
    // Tests, fixtures, and examples are skipped only through :ignoreModulesAndTests (config:recommended
    // extends it); Renovate's own default skips node_modules and bower_components alone.
    write('examples/client/requirements.txt', 'requests==2.32.3\n')
    expect(probe('core.dependency-cooldown').status).toBe('pass')
    renovate('{ extends: ["security:minimumReleaseAgeNpm"] }\n')
    expect(probe('core.dependency-cooldown').evidence[0]).toContain("doesn't cover a Python manifest")
    renovate('{ extends: ["config:recommended", "security:minimumReleaseAgeNpm"] }\n')
    expect(probe('core.dependency-cooldown').status).toBe('pass')
    renovate('{ extends: ["security:minimumReleaseAgeNpm"], ignorePaths: ["client/"] }\n')
    expect(probe('core.dependency-cooldown').status).toBe('pass') // its own list, as a substring of the path
    renovate('{ extends: ["config:recommended", "security:minimumReleaseAgeNpm"], ignorePaths: ["**/node_modules/**"] }\n')
    expect(probe('core.dependency-cooldown').status).toBe('fail') // a config's own ignorePaths replaces the preset's
    renovate('{ extends: ["security:minimumReleaseAgeNpm"], ignorePaths: ["**/examples/**", "**/node_modules/**"] }\n')
    expect(probe('core.dependency-cooldown').status).toBe('pass') // and as a glob
    renovate('{ extends: ["config:base-js", "security:minimumReleaseAgeNpm"] }\n')
    expect(probe('core.dependency-cooldown').status).toBe('pass') // an old name for config:recommended
    // A glob as minimatch reads it: braces expand, and a pattern ending in a slash matches nothing.
    renovate('{ extends: ["security:minimumReleaseAgeNpm"], ignorePaths: ["**/{example,examples}/**"] }\n')
    expect(probe('core.dependency-cooldown').status).toBe('pass')
    renovate('{ extends: ["security:minimumReleaseAgeNpm"], ignorePaths: ["**/examples/"] }\n')
    expect(probe('core.dependency-cooldown').status).toBe('fail')
    renovate('{ extends: ["security:minimumReleaseAgeNpm"], ignorePaths: ["{examples/,fixtures/}"] }\n')
    expect(probe('core.dependency-cooldown').status).toBe('fail') // each alternative ends in a slash
    renovate('{ extends: ["security:only-security-updates", "security:minimumReleaseAgeNpm"] }\n')
    expect(probe('core.dependency-cooldown').status).toBe('pass') // it extends config:recommended
    rmSync(join(root, 'examples'), { recursive: true })
    // NuGet's own override in :ignoreModulesAndTests leaves test projects in; packages.config isn't read.
    renovate('{ extends: ["config:best-practices"] }\n')
    write('packages.config', '<packages />\n')
    expect(probe('core.dependency-cooldown').status).toBe('pass')
    write('tests/App.Tests/App.Tests.csproj', '<Project />\n')
    expect(probe('core.dependency-cooldown').evidence[0]).toContain("doesn't cover a .NET project")
    renovate('{ extends: ["config:best-practices"], nuget: { ignorePaths: ["tests/"] } }\n')
    expect(probe('core.dependency-cooldown').status).toBe('pass')
    rmSync(join(root, 'tests'), { recursive: true })
    rmSync(join(root, 'packages.config'))
    rmSync(join(root, 'package.json'))
    for (const shared of ['github>acme/renovate-config', '@acme/renovate-config:strict', 'renovate-config-acme']) {
      renovate(`{ extends: ["${shared}"] }\n`)
      expect(probe('core.dependency-cooldown'), shared).toMatchObject({ status: 'skipped', evidence: [expect.stringContaining(`${shared}, which this check can't read`)] })
    }
    write('.github/dependabot.yml', `version: 2\nupdates:\n${entry('npm', '    cooldown:\n      default-days: 7\n')}`)
    expect(probe('core.dependency-cooldown').status).toBe('skipped') // a passing Dependabot doesn't vouch for the unread preset
    rmSync(join(root, '.github'), { recursive: true })
    rmSync(join(root, 'renovate.json5'))
    json('package.json', { name: 'app', renovate: { extends: ['config:best-practices'] } })
    expect(probe('core.dependency-cooldown')).toMatchObject({ status: 'pass', evidence: ['package.json "renovate": extends config:best-practices, which waits for package.json updates only'] })
  })

  it('workflows-audited: zizmor on pull requests, where a finding can fail the run', () => {
    expect(probe('core.workflows-audited').status).toBe('n/a')
    write('.github/workflows/ci.yml', workflow('      - run: npm test\n'))
    expect(probe('core.workflows-audited').status).toBe('fail')
    write('.github/workflows/ci.yml', workflow('      - run: pipx run zizmor --format=sarif . > zizmor.sarif\n'))
    expect(probe('core.workflows-audited').status).toBe('fail') // SARIF output exits 0 on findings
    write('.github/workflows/ci.yml', workflow('      - run: uvx zizmor --no-exit-codes .\n'))
    expect(probe('core.workflows-audited').status).toBe('fail')
    write('.github/workflows/ci.yml', workflow('      - run: zizmor --format "sarif" . > z.sarif\n'))
    expect(probe('core.workflows-audited').status).toBe('fail')
    write('.github/workflows/ci.yml', workflow('      - run: zizmor . || true\n'))
    expect(probe('core.workflows-audited')).toMatchObject({ status: 'fail', evidence: ['no pull_request workflow runs zizmor where a finding can fail it', expect.stringContaining("which can't fail the run")] })
    write('.github/workflows/ci.yml', workflow("      - run: pipx run --spec 'zizmor==1.30.1' zizmor --format=github .\n"))
    expect(probe('core.workflows-audited').status).toBe('pass')
    write('.github/workflows/ci.yml', workflow('      - uses: zizmorcore/zizmor-action@v1\n'))
    expect(probe('core.workflows-audited').status).toBe('fail') // uploads to code scanning and doesn't fail
    write('.github/workflows/ci.yml', workflow('      - uses: zizmorcore/zizmor-action@v1\n        with:\n          advanced-security: false\n'))
    expect(probe('core.workflows-audited').status).toBe('pass')
  })

  it('workflow-caches: nothing restored into a job that publishes, holds a secret, or can write', () => {
    const caches = () => probe('core.workflow-caches')
    expect(caches().status).toBe('n/a')
    const node = (extra = '') => `      - uses: actions/setup-node@v7\n        with:\n          node-version-file: .nvmrc\n${extra}`
    // A pull request's tests, read-only and without secrets, keep their cache.
    write('.github/workflows/ci.yml', workflow(node('          cache: npm\n')))
    expect(caches().status).toBe('pass')
    // Pages: the build job's cache ships with the site its sibling job deploys.
    const pages = (build: string) =>
      `on:\n  push:\n    branches: [main]\npermissions: {}\njobs:\n  build:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: read\n    steps:\n${build}      - uses: actions/upload-pages-artifact@v4\n  deploy:\n    needs: build\n    runs-on: ubuntu-latest\n    permissions:\n      pages: write\n      id-token: write\n    steps:\n      - uses: actions/deploy-pages@v4\n`
    write('.github/workflows/pages.yml', pages(node('          cache: npm\n')))
    expect(caches()).toMatchObject({ status: 'fail', evidence: [".github/workflows/pages.yml (job build) step \"step 1\" restores setup-node's npm cache, and the workflow publishes"] })
    // setup-node v5 and later cache npm by themselves when package.json names it, unless told not to.
    write('.github/workflows/pages.yml', pages(node()))
    expect(caches().status).toBe('pass')
    json('package.json', { name: 'app', packageManager: 'npm@10.9.9' })
    expect(caches().evidence[0]).toContain('(on by default, since package.json names npm)')
    write('.github/workflows/pages.yml', pages(node('          package-manager-cache: false\n')))
    expect(caches().status).toBe('pass')
    write('.github/workflows/pages.yml', pages(node().replace('setup-node@v7', 'setup-node@v4')))
    expect(caches().status).toBe('pass') // before automatic caching
    json('package.json', { name: 'app', devEngines: { packageManager: [{ name: 'npm' }] } })
    write('.github/workflows/pages.yml', pages(node().replace('setup-node@v7', 'setup-node@0123456789abcdef0123456789abcdef01234567')))
    expect(caches().status).toBe('fail') // a commit pin is a current release
    json('package.json', { name: 'app', packageManager: 'pnpm@10.0.0' })
    expect(caches().status).toBe('pass')
    rmSync(join(root, '.github/workflows/pages.yml'))
    // A secret, other than the run's own token, in the job or the workflow's env.
    const job = (head: string, steps: string) => `on:\n  push:\n${head}jobs:\n  job:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`
    const cache = '      - uses: actions/cache@v5\n        with:\n          path: ~/.npm\n          key: npm\n'
    write('.github/workflows/x.yml', job('', `${cache}      - run: ./deploy.sh\n        env:\n          TOKEN: \${{ secrets.DEPLOY_TOKEN }}\n`))
    expect(caches().evidence[0]).toContain('restores actions/cache, and the job is given a secret')
    write('.github/workflows/x.yml', job('', `${cache}      - run: gh pr list\n        env:\n          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}\n`))
    expect(caches().status).toBe('pass')
    write('.github/workflows/x.yml', job('env:\n  KEY: ${{ secrets.KEY }}\n', cache))
    expect(caches().status).toBe('fail')
    // A token that can write, from the job or the workflow.
    const go = (extra = '') => `      - uses: actions/setup-go@v6\n${extra}`
    write('.github/workflows/x.yml', job('permissions:\n  contents: write\n', go()))
    expect(caches().evidence[0]).toContain("restores setup-go's module cache (on by default), and the job's token can write")
    write('.github/workflows/x.yml', job('permissions:\n  contents: write\n', go('        with:\n          cache: false\n')))
    expect(caches().status).toBe('pass')
    write('.github/workflows/x.yml', job('permissions: write-all\n', '      - uses: Swatinem/rust-cache@v2\n'))
    expect(caches().status).toBe('fail')
    write('.github/workflows/x.yml', job('permissions: write-all\n', '      - uses: Swatinem/rust-cache@v2\n        if: false\n'))
    expect(caches().status).toBe('pass') // a step that never runs
    // A publishing command, or a release, makes every job in the workflow count.
    write('.github/workflows/x.yml', job('', `${go()}      - run: go test ./...\n`).replace('  job:\n', '  test:\n') + '  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm publish --provenance\n')
    expect(caches().evidence[0]).toContain('(job test)')
    write('.github/workflows/x.yml', `on:\n  release:\n    types: [published]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: astral-sh/setup-uv@v7\n`)
    expect(caches().status).toBe('fail')
    write('.github/workflows/x.yml', `on:\n  release:\n    types: [published]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: astral-sh/setup-uv@v7\n        with:\n          enable-cache: false\n`)
    expect(caches().status).toBe('pass')
    // Docker: GitHub's cache backend is a restore, and a push that isn't plainly false publishes.
    const docker = (w: string) =>
      write('.github/workflows/x.yml', `on:\n  push:\njobs:\n  image:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: docker/build-push-action@v7\n        with:\n${w}`)
    docker('          push: ${{ github.event_name != \'pull_request\' }}\n          cache-from: type=gha\n')
    expect(caches().evidence[0]).toContain("restores docker's GitHub Actions cache (cache-from: type=gha), and the workflow publishes")
    docker('          push: false\n          cache-from: type=gha\n')
    expect(caches().status).toBe('pass')
    // A local reusable workflow runs with what its caller gives it.
    rmSync(join(root, '.github/workflows/x.yml'))
    write('.github/workflows/build.yml', `on:\n  workflow_call:\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@v6\n        with:\n          cache: npm\n`)
    expect(caches().status).toBe('pass') // read alone, nothing makes it matter
    const caller = (job: string, extra = '') =>
      write('.github/workflows/release.yml', `on:\n  push:\n    tags: [v*]\njobs:\n  build:\n    uses: ./.github/workflows/build.yml\n${job}${extra}`)
    caller('', '  publish:\n    needs: build\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm publish\n')
    expect(caches().evidence[0]).toBe('.github/workflows/release.yml (job build) -> .github/workflows/build.yml (job build) step "step 1" restores setup-node\'s npm cache, and the workflow publishes')
    caller('    secrets: inherit\n')
    expect(caches().evidence[0]).toContain('and the job is given a secret')
    caller('    permissions:\n      contents: write\n')
    expect(caches().evidence[0]).toContain("and the job's token can write")
    caller('')
    expect(caches().status).toBe('pass')
    // ...including a caller whose publishing happens in another workflow it calls.
    write('.github/workflows/publish.yml', `on:\n  workflow_call:\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm publish\n`)
    caller('', '  publish:\n    needs: build\n    uses: ./.github/workflows/publish.yml\n')
    expect(caches().evidence[0]).toContain('.github/workflows/release.yml (job build) -> .github/workflows/build.yml (job build) step "step 1" restores')
    rmSync(join(root, '.github/workflows/publish.yml'))
    // ...at any depth, and through a cycle without looping.
    const hop = (name: string, ...next: string[]) =>
      write(`.github/workflows/${name}.yml`, `on:\n  workflow_call:\njobs:\n${next.map((n, i) => `  hop${i}:\n    uses: ./.github/workflows/${n}.yml\n`).join('')}`)
    hop('a', 'b')
    hop('b', 'c')
    hop('c', 'build', 'a')
    write('.github/workflows/release.yml', `on:\n  push:\n    tags: [v*]\njobs:\n  build:\n    uses: ./.github/workflows/a.yml\n  publish:\n    needs: build\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm publish\n`)
    expect(caches().evidence).toEqual([
      '.github/workflows/release.yml (job build) -> .github/workflows/a.yml (job hop0) -> .github/workflows/b.yml (job hop0) -> .github/workflows/c.yml (job hop0) -> .github/workflows/build.yml (job build) step "step 1" restores setup-node\'s npm cache, and the workflow publishes',
    ])
    for (const f of ['a', 'b', 'c', 'build', 'release']) rmSync(join(root, `.github/workflows/${f}.yml`))
    // A commit pin's version comes from the comment beside it: setup-node v4 never cached on its own.
    json('package.json', { name: 'app', packageManager: 'npm@11.19.0' })
    const pinned = (comment: string) =>
      write('.github/workflows/x.yml', `on:\n  push:\njobs:\n  job:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 ${comment}\n        env:\n          TOKEN: \${{ secrets.TOKEN }}\n`)
    pinned('# v4.4.0')
    expect(caches().status).toBe('pass')
    pinned('# v5.0.0')
    expect(caches().status).toBe('fail')
    pinned('')
    expect(caches().status).toBe('fail') // no comment: a current release
  })

  it('audit-waivers: a reason and an expiry within 90 days, in every register', () => {
    expect(probe('core.audit-waivers', { today: TODAY })).toMatchObject({ status: 'n/a' })
    const osv = (entries: string) => write('osv-scanner.toml', entries)
    osv('[[IgnoredVulns]]\nid = "GHSA-aaaa-bbbb-cccc"\nignoreUntil = 2026-11-01\nreason = "Only the build server parses this input, never a user."\n')
    expect(probe('core.audit-waivers', { today: TODAY })).toMatchObject({ status: 'pass', evidence: ['1 waiver(s), each with a reason', '1 with an expiry within 90 days'] })
    osv('[[IgnoredVulns]]\nid = "GHSA-aaaa-bbbb-cccc"\nignoreUntil = 09:30:00\nreason = "Only the build server parses this input, never a user."\n')
    expect(probe('core.audit-waivers', { today: TODAY }).evidence).toEqual(['osv-scanner.toml: GHSA-aaaa-bbbb-cccc: no expiry date']) // a time is no date
    osv('[[IgnoredVulns]\nid =')
    expect(probe('core.audit-waivers', { today: TODAY })).toMatchObject({ status: 'fail', evidence: ["osv-scanner.toml doesn't parse, so its waivers can't be read"] })
    osv('[[IgnoredVulns]]\nid = "GHSA-aaaa-bbbb-cccc"\nreason = "no fix yet"\n\n[[IgnoredVulns]]\nid = "PYSEC-2026-1"\nignoreUntil = 2026-10-01T00:00:00Z\nreason = "Fixed upstream; waiting on the next release."\n\n[[IgnoredVulns]]\nid = "RUSTSEC-2026-0001"\nignoreUntil = 2027-06-01\nreason = "The affected feature is compiled out of every build."\n')
    expect(probe('core.audit-waivers', { today: TODAY }).evidence).toEqual([
      'osv-scanner.toml: GHSA-aaaa-bbbb-cccc: no reason (20 characters or more)',
      'osv-scanner.toml: GHSA-aaaa-bbbb-cccc: no expiry date',
      'osv-scanner.toml: PYSEC-2026-1: expired 6 day(s) ago',
      'osv-scanner.toml: RUSTSEC-2026-0001: expires 237 days out, more than 90',
    ])
    osv('[[PackageOverrides]]\nname = "lodash"\nlicense.override = ["MIT"]\n\n[[PackageOverrides]]\nname = "minimist"\nversion = "1.2.5"\nvulnerability.ignore = true\n')
    expect(probe('core.audit-waivers', { today: TODAY }).evidence).toEqual([
      'osv-scanner.toml: the override for minimist@1.2.5: no reason (20 characters or more)',
      'osv-scanner.toml: the override for minimist@1.2.5: no expiry date',
    ]) // a license override waives no advisory
    rmSync(join(root, 'osv-scanner.toml'))
    json('docs/security/audit-waivers.json', { waivers: [{ advisory: 'GHSA-x', package: 'p', reason: 'A reason long enough to review.', owner: 'o', expires: '2026-10-07' }] })
    expect(probe('core.audit-waivers', { today: TODAY }).status).toBe('pass') // expiring today still holds
    expect(probe('core.audit-waivers', { today: '2026-10-08' }).evidence).toEqual(['docs/security/audit-waivers.json: GHSA-x: expired 1 day(s) ago'])
    rmSync(join(root, 'docs'), { recursive: true })
    write('deny.toml', '[advisories]\nignore = ["RUSTSEC-2026-0002", { id = "RUSTSEC-2026-0003", reason = "Unreachable: we never call the parser it affects." }, { crate = "foo@1.0.0" }]\n')
    expect(probe('core.audit-waivers', { today: TODAY }).evidence).toEqual([
      'deny.toml: RUSTSEC-2026-0002 is ignored with no reason (write { id = "RUSTSEC-2026-0002", reason = "..." })',
      'deny.toml: foo@1.0.0: no reason (20 characters or more)',
    ])
    write('deny.toml', '[advisories]\nignore = [{ id = "RUSTSEC-2026-0003", reason = "Unreachable: we never call the parser it affects." }]\n')
    expect(probe('core.audit-waivers', { today: TODAY })).toMatchObject({ status: 'pass', evidence: ['1 waiver(s), each with a reason', expect.stringContaining("in deny.toml, which can't hold an expiry")] })
    write('deny.toml', '[advisories\nignore = [')
    expect(probe('core.audit-waivers', { today: TODAY })).toMatchObject({ status: 'fail', evidence: ["deny.toml doesn't parse, so its ignores can't be read"] })
    rmSync(join(root, 'deny.toml'))
    write('.cargo/audit.toml', '[advisories\nignore = [')
    expect(probe('core.audit-waivers', { today: TODAY }).status).toBe('fail')
    write('.cargo/audit.toml', '[advisories]\nignore = ["RUSTSEC-2026-0004"]\n')
    expect(probe('core.audit-waivers', { today: TODAY }).evidence[0]).toContain('.cargo/audit.toml ignores RUSTSEC-2026-0004, and can hold no reason or expiry')
    rmSync(join(root, '.cargo'), { recursive: true })
    write('.github/workflows/ci.yml', workflow('      - run: pip-audit -r requirements.txt --ignore-vuln GHSA-yyyy\n'))
    expect(probe('core.audit-waivers', { today: TODAY }).evidence[0]).toContain('ignores GHSA-yyyy on the command line')
    write('.github/workflows/ci.yml', workflow('      - run: uv audit -i https://pypi.example.com/simple\n'))
    expect(probe('core.audit-waivers', { today: TODAY }).status).toBe('n/a') // -i is uv's index URL
    write('.github/workflows/ci.yml', workflow('      - run: safety check -r requirements.txt -i 12345\n'))
    expect(probe('core.audit-waivers', { today: TODAY }).evidence[0]).toContain('ignores 12345') // and safety's --ignore
    write('.github/workflows/ci.yml', workflow('      - run: uvx -i https://pypi.example.com/simple safety check\n'))
    expect(probe('core.audit-waivers', { today: TODAY }).status).toBe('n/a') // uvx's own -i
    write('.github/workflows/ci.yml', workflow('      - run: uv audit --ignore-until-fixed GHSA-zzzz\n      - run: safety check --ignore 12345\n'))
    expect(probe('core.audit-waivers', { today: TODAY }).evidence.join('\n')).toMatch(/ignores GHSA-zzzz[\s\S]*ignores 12345/)
    write('.github/workflows/ci.yml', workflow('      - uses: pypa/gh-action-pip-audit@v1\n        with:\n          ignore-vulns: |\n            GHSA-aaaa\n            GHSA-bbbb\n'))
    expect(probe('core.audit-waivers', { today: TODAY }).evidence[0]).toContain('ignores GHSA-aaaa, GHSA-bbbb in ignore-vulns')
    write('.github/workflows/ci.yml', workflow('      - run: pip-audit -r requirements.txt\n'))
    expect(probe('core.audit-waivers', { today: TODAY }).status).toBe('n/a')
  })

  it('process-delivered: a manifest, or a templateVersion', () => {
    expect(probe('core.process-delivered').status).toBe('fail')
    json('prompts/.apply-manifest.json', { templateCommit: 'abcdef0123456789', files: {} })
    expect(probe('core.process-delivered')).toMatchObject({ status: 'pass', evidence: ['delivered by process:apply from template commit abcdef012345'] })
    rmSync(join(root, 'prompts'), { recursive: true })
    json('package.json', { name: 'fork', templateVersion: '1.0.0' })
    expect(probe('core.process-delivered').status).toBe('pass')
  })
})

describe('node probes', () => {
  it.each(Object.keys(PROBES).filter((id) => id.startsWith('node.')))('%s passes on a project that meets it', (id) => {
    goodNode()
    expect(probe(id)).toMatchObject({ status: 'pass' })
  })

  it('install-guards: npm waits for releases to age and refuses a dependency\'s git and URL dependencies', () => {
    goodNode()
    const guards = (options = {}) => probe('node.install-guards', options)
    const pkg = () => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const ok = 'min-release-age=7\nallow-git=root\nallow-remote=root\n'
    expect(guards()).toMatchObject({ status: 'pass', evidence: ['.npmrc: min-release-age=7, allow-git=root, allow-remote=root, npm 11.19'] })
    // Read as npm's ini parser reads it: an unquoted value ends at a ; or a #.
    write('.npmrc', '# guards\nmin-release-age = "7"\nallow-git=root ; ours only\nallow-remote=none # never\n')
    expect(guards().status).toBe('pass')
    write('.npmrc', 'min-release-age=2\nallow-git=all\n')
    expect(guards().evidence).toEqual([
      ".npmrc sets no min-release-age of 3 days or more (it's 2)",
      '.npmrc lets a dependency bring in a git dependency of its own (allow-git=all; set it to root or none)',
      '.npmrc lets a dependency bring in a tarball from any URL (allow-remote=all; set it to root or none)',
    ])
    rmSync(join(root, '.npmrc'))
    expect(guards().evidence[0]).toBe('.npmrc sets no min-release-age of 3 days or more')
    write('.npmrc', ok)
    // An npm too old for the settings ignores them; npm 12 refuses git by default.
    json('package.json', { ...pkg(), packageManager: 'npm@11.12.0' })
    expect(guards().evidence).toEqual(['npm 11.12 is pinned, which ignores min-release-age (npm 11.10), allow-git (11.9), or allow-remote (11.14, fixed in 11.15)'])
    json('package.json', { ...pkg(), packageManager: undefined })
    expect(guards().evidence[0]).toContain('nothing pins npm 11.15 or later')
    json('package.json', { ...pkg(), devEngines: { packageManager: { name: 'npm', version: '11.15.0' } } })
    expect(guards().status).toBe('pass')
    // npm 12 refuses a dependency's git and URL dependencies unless told otherwise.
    json('package.json', { ...pkg(), devEngines: undefined, packageManager: 'npm@12.2.0' })
    write('.npmrc', 'min-release-age=7\n')
    expect(guards()).toMatchObject({ status: 'pass', evidence: ['.npmrc: min-release-age=7, allow-git=none, allow-remote=none, npm 12.2'] })
    write('.npmrc', 'min-release-age=7\nallow-remote=all\n')
    expect(guards().evidence).toEqual(['.npmrc lets a dependency bring in a tarball from any URL (allow-remote=all; set it to root or none)'])
    write('.npmrc', ok)
    json('package.json', { ...pkg(), packageManager: 'npm@11.19.0' })
    // A workspace installs from its workspace root: the root's package.json and .npmrc decide,
    // and npm ignores the workspace's own .npmrc.
    json('apps/web/package.json', { name: 'web' })
    json('package.json', { ...pkg(), workspaces: ['apps/*'] })
    expect(guards({ path: 'apps/web' })).toMatchObject({ status: 'pass', evidence: ['.npmrc: min-release-age=7, allow-git=root, allow-remote=root, npm 11.19'] })
    write('apps/web/.npmrc', ok)
    write('.npmrc', 'allow-git=root\nallow-remote=root\n')
    expect(guards({ path: 'apps/web' }).evidence).toEqual(['.npmrc sets no min-release-age of 3 days or more'])
    // npm's negations: one excludes what it matches, unless a later pattern it matches lifts it;
    // two !s cancel.
    const npmMember = (workspaces: string[], path = 'apps/web') => {
      json('package.json', { ...pkg(), workspaces })
      return guards({ path }).evidence[0] === '.npmrc sets no min-release-age of 3 days or more'
    }
    expect(npmMember(['apps/*', '!apps/web'])).toBe(false)
    expect(npmMember(['apps/*', '!./apps/web/**'])).toBe(false)
    expect(npmMember(['apps/*', '!apps/other'])).toBe(true)
    expect(npmMember(['apps/*', '!apps/web/*'])).toBe(true) // only what's below apps/web
    expect(npmMember(['apps/*', '!apps/*', 'apps/web'])).toBe(true)
    expect(npmMember(['apps/*', '!!apps/web'])).toBe(true)
    expect(npmMember(['!apps/web', 'apps/*'])).toBe(false) // apps/* as text doesn't match apps/web
    json('apps/package.json', { name: 'apps' })
    expect(npmMember(['apps/*'], 'apps')).toBe(false) // a * needs a name to match
    expect(npmMember(['apps/**'], 'apps')).toBe(true)
    json('apps/web/sub/package.json', { name: 'sub' })
    expect(npmMember(['apps/**'], 'apps/web/sub')).toBe(true)
    expect(npmMember(['apps/**', '!apps/*'], 'apps/web/sub')).toBe(false) // !apps/* drops apps/** itself
    expect(npmMember(['apps/**', '!apps/*/'], 'apps/web/sub')).toBe(true) // !apps/*/ doesn't: the / counts
    expect(npmMember(['apps/**', '!apps/*/'])).toBe(false)
    expect(npmMember(['!apps/*/', 'apps/*'])).toBe(false) // nor does it lift
    expect(npmMember(['!apps/*/', 'apps/*/'])).toBe(true)
    rmSync(join(root, 'apps/package.json'))
    rmSync(join(root, 'apps/web/sub'), { recursive: true })
    // A package below the root that isn't a workspace installs on its own.
    json('package.json', { ...pkg(), workspaces: undefined })
    expect(guards({ path: 'apps/web' }).evidence).toEqual(['nothing pins npm 11.15 or later (packageManager, or devEngines.packageManager with an exact version), and an older npm ignores these settings'])
    json('apps/web/package.json', { name: 'web', packageManager: 'npm@11.19.0' })
    expect(guards({ path: 'apps/web' }).status).toBe('pass')
    rmSync(join(root, 'apps'), { recursive: true })
    // pnpm: its own settings, in pnpm-workspace.yaml, at the workspace root for a workspace.
    json('package.json', { ...pkg(), packageManager: 'pnpm@10.20.0' })
    expect(guards().evidence).toEqual([
      'pnpm-workspace.yaml sets no minimumReleaseAge of 4320 minutes (3 days) or more',
      "pnpm-workspace.yaml doesn't set blockExoticSubdeps: true, so a dependency can bring in a git or tarball dependency of its own",
    ])
    write('pnpm-workspace.yaml', 'minimumReleaseAge: 1440\nblockExoticSubdeps: true\n')
    expect(guards().evidence).toEqual(["pnpm-workspace.yaml sets no minimumReleaseAge of 4320 minutes (3 days) or more (it's 1440)"])
    write('pnpm-workspace.yaml', 'packages:\n  - apps/*\nminimumReleaseAge: 10080\nblockExoticSubdeps: true\n')
    expect(guards().status).toBe('pass')
    json('apps/api/package.json', { name: 'api' })
    expect(guards({ path: 'apps/api' })).toMatchObject({ status: 'pass', evidence: ['pnpm-workspace.yaml: minimumReleaseAge 10080 minutes, blockExoticSubdeps'] })
    // pnpm excludes what a negation matches, wherever it stands.
    write('pnpm-workspace.yaml', 'packages:\n  - "!apps/api"\n  - apps/*\nminimumReleaseAge: 10080\nblockExoticSubdeps: true\n')
    expect(guards({ path: 'apps/api' }).evidence[0]).toBe('apps/api/.npmrc sets no min-release-age of 3 days or more') // its own
    write('pnpm-workspace.yaml', 'packages:\n  - apps/*\n  - "!apps/api/*"\nminimumReleaseAge: 10080\nblockExoticSubdeps: true\n')
    expect(guards({ path: 'apps/api' }).status).toBe('pass')
    rmSync(join(root, 'apps'), { recursive: true })
    write('pnpm-workspace.yaml', 'minimumReleaseAge: [\n')
    expect(guards().evidence[0]).toContain("pnpm-workspace.yaml doesn't parse")
    json('package.json', { ...pkg(), packageManager: undefined })
    rmSync(join(root, 'pnpm-workspace.yaml'))
    write('yarn.lock', '# yarn lockfile v1\n')
    expect(guards().status).toBe('skipped')
  })

  it('unused-code: knip on pull requests, where it can fail the run', () => {
    goodNode()
    expect(probe('node.unused-code')).toMatchObject({ status: 'pass', evidence: [expect.stringContaining('"knip" in .github/workflows/ci.yml')] })
    goodNode({ scripts: { 'check:unused': 'knip --no-exit-code' } })
    expect(probe('node.unused-code').evidence[0]).toBe('no pull_request workflow runs knip where it can fail the run')
    goodNode({ scripts: { 'check:unused': 'knip || true' } })
    expect(probe('node.unused-code').evidence).toEqual(['no pull_request workflow runs knip where it can fail the run', expect.stringContaining("which can't fail the run")])
    goodNode({ scripts: { 'check:unused': 'npx knip --production' } })
    expect(probe('node.unused-code').status).toBe('pass')
  })

  it('runtime-pinned: a version file inside engines', () => {
    goodNode()
    write('.nvmrc', 'lts/*\n')
    expect(probe('node.runtime-pinned')).toMatchObject({ status: 'fail', evidence: ['.nvmrc says "lts/*", a floating alias, not a version'] })
    write('.nvmrc', '20\n')
    expect(probe('node.runtime-pinned')).toMatchObject({ status: 'fail', evidence: [expect.stringContaining('outside engines.node')] })
    rmSync(join(root, '.nvmrc'))
    write('mise.toml', '[tools]\nnode = "24.1.0"\n')
    expect(probe('node.runtime-pinned').status).toBe('pass')
    // A range this check can't read is undecided, never a pass.
    write('.nvmrc', '16\n')
    goodNode()
    json('package.json', { ...JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')), engines: { node: '18.x' } })
    write('.nvmrc', '16\n')
    expect(probe('node.runtime-pinned')).toMatchObject({ status: 'skipped', evidence: [expect.stringContaining('a form this check can\'t compare')] })
  })

  it('test-suites-in-ci: a pack path is matched as text, not as a pattern', () => {
    for (const dir of ['app(v2', 'apps-web']) {
      json(`${dir}/package.json`, { name: dir, devDependencies: { '@playwright/test': '^1.0.0' } })
      write(`${dir}/playwright.config.ts`, 'export default {}\n')
    }
    mkdirSync(join(root, 'apps.web'))
    json('apps.web/package.json', { name: 'web', devDependencies: {} })
    expect(probe('node.test-suites-in-ci', { path: 'app(v2' }).status).toBe('fail')
    expect(probe('node.test-suites-in-ci', { path: 'apps.web' }).status).toBe('n/a') // not apps-web's config
  })

  it('ci-runs-gate: a package reached from the checkout root, by --prefix or a script', () => {
    goodNode()
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    rmSync(join(root, 'package.json'))
    json('web/package.json', pkg)
    const ci = (step: string) => write('.github/workflows/ci.yml', workflow(`${SETUP_NODE}${step}`))
    ci('      - run: npm --prefix "$GITHUB_WORKSPACE/web" run check\n')
    expect(probe('node.ci-runs-gate', { path: 'web' }).status).toBe('pass')
    ci('      - run: npm --prefix "web" run check\n')
    expect(probe('node.ci-runs-gate', { path: 'web' }).status).toBe('pass')
    ci('      - run: npm --prefix $GITHUB_WORKSPACE/web run check\n        shell: pwsh\n')
    expect(probe('node.ci-runs-gate', { path: 'web' }).status).toBe('fail') // PowerShell's is $env:GITHUB_WORKSPACE
    ci('      - run: bash scripts/ci/web.sh\n')
    for (const [cd, status] of [
      ['cd "$(dirname "$0")/../../web"', 'pass'],
      ['cd "$(git rev-parse --show-toplevel)/web"', 'pass'],
      ['cd "$(mktemp -d)"', 'fail'],
    ]) {
      write('scripts/ci/web.sh', `#!/usr/bin/env bash\nset -euo pipefail\n${cd}\nnpm run check\n`)
      expect(probe('node.ci-runs-gate', { path: 'web' }).status, cd).toBe(status)
    }
    // At the root too, a gate run somewhere it can't know counts for nothing.
    rmSync(join(root, 'web'), { recursive: true })
    json('package.json', pkg)
    write('scripts/ci/web.sh', '#!/usr/bin/env bash\nset -euo pipefail\ncd "$(dirname "$0")/../.."\nnpm run check\n')
    expect(probe('node.ci-runs-gate').status).toBe('pass')
    write('scripts/ci/web.sh', '#!/usr/bin/env bash\nset -euo pipefail\ncd "$RUNNER_TEMP"\nnpx eslint . && npx tsc --noEmit && npx vitest run && vite build\n')
    expect(probe('node.ci-runs-gate').status).toBe('fail')
    // A called workflow's working directory from its inputs: the caller's value, else the default.
    const called = (dir: string) =>
      write('.github/workflows/gate.yml', `on:\n  workflow_call:\n    inputs:\n      dir:\n        type: string\n        default: ${dir}\njobs:\n  gate:\n    runs-on: ubuntu-latest\n    defaults:\n      run:\n        working-directory: \${{ inputs.dir }}\n    steps:\n      - run: npm run check\n`)
    const caller = (given: string) => write('.github/workflows/ci.yml', `on:\n  pull_request:\njobs:\n  gate:\n    uses: ./.github/workflows/gate.yml\n${given}`)
    called('.')
    caller('')
    expect(probe('node.ci-runs-gate').status).toBe('pass')
    called('web')
    caller('    with:\n      dir: .\n')
    expect(probe('node.ci-runs-gate').status).toBe('pass')
    caller('')
    expect(probe('node.ci-runs-gate').status).toBe('fail') // run in web, where there's no package
    caller('    with:\n      dir: ${{ matrix.dir }}\n')
    expect(probe('node.ci-runs-gate').status).toBe('fail') // an expression it doesn't evaluate: unknown
  })

  it('ci-uses-pin: a matrix or literal under a range it can\'t read is undecided, not failed', () => {
    goodNode()
    json('package.json', { ...JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')), engines: { node: '18.x' } })
    write('.github/workflows/ci.yml', workflow(`      - uses: actions/setup-node@v7\n        with:\n          node-version: \${{ matrix.node }}\n      - run: npm test\n`).replace('    runs-on: ubuntu-latest\n', '    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        node: [18, 20, 22]\n'))
    expect(probe('node.ci-uses-pin')).toMatchObject({ status: 'skipped', evidence: [expect.stringContaining("can't compare")] })
  })

  it('ci-uses-pin: a version written into a workflow, unless it is the engines floor', () => {
    goodNode()
    const literal = (v: string) => workflow(`      - uses: actions/setup-node@v7\n        with:\n          node-version: ${v}\n      - run: npm run check\n`)
    write('.github/workflows/ci.yml', literal('24'))
    expect(probe('node.ci-uses-pin')).toMatchObject({ status: 'fail', evidence: [expect.stringContaining('written into the workflow instead of read from the pin')] })
    write('.github/workflows/ci.yml', literal('22.12.0'))
    expect(probe('node.ci-uses-pin')).toMatchObject({ status: 'pass', evidence: [expect.stringContaining('exactly the engines floor')] })
    write('.github/workflows/ci.yml', literal("${{ env.NODE }}"))
    expect(probe('node.ci-uses-pin').evidence[0]).toContain("an expression this check can't read")
  })

  it('ci-uses-pin: a matrix inside engines passes, and CI with no setup-node fails', () => {
    goodNode()
    const matrix = (versions: string) =>
      `on: pull_request\njobs:\n  test:\n    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        node: [${versions}]\n    steps:\n      - uses: actions/setup-node@v7\n        with:\n          node-version: \${{ matrix.node }}\n      - run: npm test\n`
    write('.github/workflows/ci.yml', matrix('22.12.0, 24'))
    expect(probe('node.ci-uses-pin').status).toBe('pass')
    write('.github/workflows/ci.yml', matrix('20, 24'))
    expect(probe('node.ci-uses-pin').status).toBe('fail')
    write('.github/workflows/ci.yml', workflow('      - run: npm ci && npm test\n'))
    expect(probe('node.ci-uses-pin')).toMatchObject({ status: 'fail', evidence: [expect.stringContaining('no actions/setup-node step')] })
  })

  it('ci-runs-gate: matches the tools, not the script names', () => {
    goodNode({ scripts: { lint: 'tsc --noEmit' } })
    expect(probe('node.ci-runs-gate')).toMatchObject({ status: 'fail', evidence: expect.arrayContaining(['no linter runs in a pull_request workflow']) })
  })

  it('ci-runs-gate: the build script, and steps that can fail the run', () => {
    goodNode({ scripts: { check: 'npm run lint && npm run typecheck && npm run test' } })
    expect(probe('node.ci-runs-gate').evidence).toContain('the build script ("vite build") never runs in a pull_request workflow')
    goodNode()
    write('.github/workflows/ci.yml', workflow(`${SETUP_NODE}      - run: npm run check\n        continue-on-error: true\n`))
    const result = probe('node.ci-runs-gate')
    expect(result.status).toBe('fail')
    expect(result.evidence).toEqual(
      expect.arrayContaining(['no linter runs in a pull_request workflow', expect.stringContaining("which can't fail the run")]),
    )
  })

  it.each([
    ['a step with if: false', `      - run: npm run check\n        if: false\n`],
    ['a step whose failure goes to || true', `      - run: npm run check || true\n`],
    ['an install that names the tools', `      - run: npm install --no-save eslint typescript vitest && npx vite build\n`],
  ])('ci-runs-gate: %s runs no gate', (_label, steps) => {
    goodNode()
    write('.github/workflows/ci.yml', workflow(`${SETUP_NODE}${steps}`))
    expect(probe('node.ci-runs-gate')).toMatchObject({ status: 'fail', evidence: expect.arrayContaining(['no linter runs in a pull_request workflow']) })
  })

  it('ci-runs-gate: a job with if: false runs nothing, and a script runs only its last command after ;', () => {
    goodNode()
    write('.github/workflows/ci.yml', workflow(`${SETUP_NODE}      - run: npm run check\n`).replace('    runs-on:', '    if: ${{ false }}\n    runs-on:'))
    expect(probe('node.ci-runs-gate').status).toBe('fail')
    goodNode({ scripts: { check: 'eslint . ; tsc --noEmit ; vitest run && vite build' } })
    expect(probe('node.ci-runs-gate').evidence).toEqual(expect.arrayContaining(['no linter runs in a pull_request workflow', 'no type checker runs in a pull_request workflow']))
  })

  it('ci-runs-gate: a pipe counts where the step or script sets pipefail', () => {
    goodNode({ scripts: { check: 'eslint . && tsc --noEmit && vite build' } })
    write('scripts/test.sh', '#!/usr/bin/env bash\nset -eu -o pipefail\nnpx vitest run | tee vitest.log\n')
    write('.github/workflows/ci.yml', workflow(`${SETUP_NODE}      - run: |\n          set -o pipefail\n          npm run check | tee check.log\n      - run: bash scripts/test.sh\n`))
    expect(probe('node.ci-runs-gate').status).toBe('pass')
    write('scripts/test.sh', '#!/usr/bin/env bash\nnpx vitest run | tee vitest.log\n')
    expect(probe('node.ci-runs-gate').evidence).toEqual(expect.arrayContaining(['no test runner runs in a pull_request workflow']))
  })

  it('ci-runs-gate: follows a script behind a wrapper or an if', () => {
    goodNode()
    write('.github/workflows/ci.yml', workflow(`${SETUP_NODE}      - run: |\n          if ! npm run lint; then\n            exit 1\n          fi\n          timeout 20m npm run typecheck\n          xvfb-run -a npm test\n          npm run build\n`))
    expect(probe('node.ci-runs-gate').status).toBe('pass')
  })

  it("ci-runs-gate: a Windows job's default shell goes by its last command", () => {
    goodNode()
    write('.github/workflows/ci.yml', workflow(`${SETUP_NODE}      - run: |\n          npm run check\n          echo done\n`).replace('runs-on: ubuntu-latest', 'runs-on: windows-latest'))
    expect(probe('node.ci-runs-gate').evidence).toEqual(expect.arrayContaining(['no linter runs in a pull_request workflow']))
  })

  it('ci-runs-gate: a report-only copy beside the real gate passes, and npm-run-all is followed', () => {
    goodNode()
    write('.github/workflows/report.yml', workflow(`${SETUP_NODE}      - run: npx eslint . --format json\n        continue-on-error: true\n`, 'pull_request:'))
    expect(probe('node.ci-runs-gate').status).toBe('pass')
    goodNode({ scripts: { check: 'run-s lint typecheck "test:*" build', 'test:unit': 'vitest run' } })
    expect(probe('node.ci-runs-gate').status).toBe('pass')
  })

  it('ci-runs-gate: a pack path matches as a whole path, not inside another name', () => {
    goodNode()
    json('web/package.json', { name: 'web', scripts: {}, devDependencies: { vitest: '^5.0.0' } })
    write('.github/workflows/ci.yml', workflow(`${SETUP_NODE}      - run: npx eslint website && npx tsc -p website && npx vitest run --dir website\n`))
    expect(probe('node.ci-runs-gate', { path: 'web' }).status).toBe('fail')
    write('.github/workflows/ci.yml', workflow(`${SETUP_NODE}      - run: npx eslint web && npx tsc -p ./web/ && npx vitest run --dir web\n`))
    expect(probe('node.ci-runs-gate', { path: 'web' }).status).toBe('pass')
  })

  it('ci-runs-gate: follows workspace calls and shell scripts', () => {
    goodNode()
    json('package.json', { name: 'root', private: true, workspaces: ['web'] })
    json('web/package.json', { name: '@acme/web', scripts: { gate: 'eslint . && tsc --noEmit && vitest run' }, devDependencies: { vitest: '^5.0.0', typescript: '^6.0.0' } })
    write('web/tsconfig.json', '{}')
    write('scripts/gate.sh', '#!/bin/sh\nset -e\nyarn workspace @acme/web gate\n')
    write('.github/workflows/ci.yml', workflow(`${SETUP_NODE}      - run: bash scripts/gate.sh\n`))
    expect(probe('node.ci-runs-gate', { path: 'web' })).toMatchObject({ status: 'pass' })
    expect(probe('node.ci-runs-gate', { path: 'web' }).evidence.join(' ')).toContain('scripts/gate.sh -> script "gate"')
  })

  it('ci-runs-gate: hints at a project below a workspace root', () => {
    json('package.json', { name: 'root', private: true, workspaces: ['mobile-app'], scripts: { postinstall: 'patch-package' } })
    write('.github/workflows/ci.yml', workflow('      - run: echo nothing\n'))
    expect(probe('node.ci-runs-gate').evidence).toEqual(
      expect.arrayContaining([expect.stringContaining('declare { "pack": "node", "path": "mobile-app" }')]),
    )
  })

  it('test-suites-in-ci: an installed runner nobody runs', () => {
    goodNode({ devDependencies: { '@playwright/test': '^1.63.0' } })
    expect(probe('node.test-suites-in-ci')).toMatchObject({ status: 'fail', evidence: ['Playwright Test is installed but no pull_request workflow runs it', expect.any(String)] })
    goodNode({ devDependencies: { '@playwright/test': '^1.63.0' }, scripts: { 'test:e2e': 'bddgen && playwright test' } })
    write('.github/workflows/ci.yml', workflow(`${SETUP_NODE}      - run: npm run check\n      - run: npm run test:e2e\n      - run: npm run check:audit\n`))
    expect(probe('node.test-suites-in-ci').status).toBe('pass')
  })

  it('audit-gate: on pull requests, on a schedule, and able to fail', () => {
    goodNode()
    write('.github/workflows/ci.yml', workflow(`${SETUP_NODE}      - run: npm run check\n      - run: npm run check:audit\n`, 'pull_request:'))
    expect(probe('node.audit-gate')).toMatchObject({ status: 'fail', evidence: ['no dependency audit in a workflow with a schedule trigger', expect.any(String)] })
    write('.github/workflows/ci.yml', workflow(`${SETUP_NODE}      - run: npm audit\n        continue-on-error: true\n`))
    expect(probe('node.audit-gate').evidence).toEqual(
      expect.arrayContaining(['no dependency audit in a pull_request workflow step that can fail', expect.stringContaining("which can't fail the run")]),
    )
    write('.github/workflows/ci.yml', workflow(`${SETUP_NODE}      - run: npm audit --audit-level=high || true\n`))
    expect(probe('node.audit-gate').evidence).toEqual(expect.arrayContaining([expect.stringContaining('its failure goes to "|| true"')]))
    // A report-only audit beside one that can fail doesn't fail the standard.
    write('.github/workflows/ci.yml', workflow(`${SETUP_NODE}      - run: npm audit --audit-level=high\n      - run: npm audit --json\n        continue-on-error: true\n`))
    expect(probe('node.audit-gate').status).toBe('pass')
  })

  it('strict-types: strict for TypeScript, checkJs for JavaScript', () => {
    goodNode()
    json('tsconfig.json', { compilerOptions: { strict: false, noEmit: true }, include: ['src'] })
    expect(probe('node.strict-types')).toMatchObject({ status: 'fail', evidence: ['tsconfig.json: strict is off for 1 TypeScript files'] })
    rmSync(join(root, 'src/main.ts'))
    write('src/main.js', 'export const answer = 42\n')
    json('tsconfig.json', { compilerOptions: { allowJs: true, checkJs: true, noEmit: true }, include: ['src'] })
    expect(probe('node.strict-types')).toMatchObject({ status: 'pass', evidence: ['tsconfig.json: checkJs (1 JavaScript files)'] })
    rmSync(join(root, 'tsconfig.json'))
    expect(probe('node.strict-types').evidence[0]).toContain('nothing typechecks the project')
  })

  it('strict-types: an unset strict is on from TypeScript 6, off before it, and unknown without a version', () => {
    goodNode({ devDependencies: { typescript: '~6.0.2' } })
    json('tsconfig.json', { compilerOptions: { noEmit: true }, include: ['src'] })
    expect(probe('node.strict-types')).toMatchObject({ status: 'pass', evidence: [expect.stringContaining('tsconfig.json: strict by default under TypeScript 6 (1 TypeScript files)')] })
    goodNode({ devDependencies: { typescript: '^5.9.3' } })
    json('tsconfig.json', { compilerOptions: { noEmit: true }, include: ['src'] })
    expect(probe('node.strict-types')).toMatchObject({ status: 'fail', evidence: ['tsconfig.json: strict is off for 1 TypeScript files (unset, which TypeScript 5 reads as off)'] })
    // The installed compiler outranks the declared range.
    write('node_modules/typescript/package.json', JSON.stringify({ name: 'typescript', version: '6.0.3' }))
    expect(probe('node.strict-types').status).toBe('pass')
    rmSync(join(root, 'node_modules'), { recursive: true, force: true })
    goodNode({ devDependencies: { typescript: 'latest' } })
    json('tsconfig.json', { compilerOptions: { noEmit: true }, include: ['src'] })
    expect(probe('node.strict-types').evidence[0]).toContain("strict isn't set, and the project's TypeScript version couldn't be read")
    // An explicit false is off whatever the version.
    goodNode({ devDependencies: { typescript: '~6.0.2' } })
    json('tsconfig.json', { compilerOptions: { strict: false, noEmit: true }, include: ['src'] })
    expect(probe('node.strict-types')).toMatchObject({ status: 'fail', evidence: ['tsconfig.json: strict is off for 1 TypeScript files'] })
  })

  it('strict-types: follows references and extends, and skips what needs an install', () => {
    goodNode()
    json('tsconfig.json', { files: [], references: [{ path: './tsconfig.app.json' }] })
    json('tsconfig.base.json', { compilerOptions: { strict: true } })
    json('tsconfig.app.json', { extends: './tsconfig.base.json', compilerOptions: { noEmit: true }, include: ['src'] })
    expect(probe('node.strict-types')).toMatchObject({ status: 'pass', evidence: ['tsconfig.app.json: strict (1 TypeScript files)'] })
    json('tsconfig.app.json', { extends: 'expo/tsconfig.base', include: ['src'] })
    expect(probe('node.strict-types')).toMatchObject({ status: 'skipped', evidence: [expect.stringContaining('needs the repository\'s dependencies installed')] })
  })
})

describe('vite-spa.bundle-budget', () => {
  it('a size check on pull requests, where it can fail the run', () => {
    const budget = () => probe('vite-spa.bundle-budget')
    write('.github/workflows/ci.yml', workflow('      - run: npm run build\n'))
    expect(budget().evidence[0]).toBe('no pull_request workflow checks the bundle against a size budget where it can fail the run')
    for (const run of ['node scripts/check-bundle-size.mjs', 'npx size-limit', 'npx bundlewatch --config .bundlewatch.json']) {
      write('.github/workflows/ci.yml', workflow(`      - run: npm run build && ${run}\n`))
      expect(budget().status, run).toBe('pass')
    }
    write('.github/workflows/ci.yml', workflow('      - run: npx size-limit || true\n'))
    expect(budget().evidence).toEqual([expect.stringContaining('no pull_request workflow'), expect.stringContaining("which can't fail the run")])
    write('.github/workflows/ci.yml', workflow('      - run: echo size-limit\n'))
    expect(budget().status).toBe('fail') // named, not run
    write('.github/workflows/ci.yml', workflow('      - uses: andresz1/size-limit-action@v1\n'))
    expect(budget().status).toBe('skipped')
  })
})

describe('vite-spa.client-env', () => {
  it('fails on a define that pushes a server variable into the bundle (the AI Studio scaffold)', () => {
    write('.env.example', 'GEMINI_API_KEY=\n')
    write(
      'vite.config.ts',
      "import { defineConfig, loadEnv } from 'vite'\nexport default defineConfig(({ mode }) => {\n  const env = loadEnv(mode, '.', '')\n  return { define: { 'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY) } }\n})\n",
    )
    expect(probe('vite-spa.client-env')).toMatchObject({ status: 'fail', evidence: [expect.stringContaining('vite.config.ts:4: define-env: define "process.env.GEMINI_API_KEY" puts GEMINI_API_KEY in the client bundle'), expect.any(String)] })
    write('vite.config.ts', "import { defineConfig } from 'vite'\nexport default defineConfig({})\n")
    write('src/main.ts', 'export const url = import.meta.env.VITE_API_URL\n')
    expect(probe('vite-spa.client-env').status).toBe('pass')
  })

  it('is n/a with no environment variables anywhere', () => {
    write('src/main.ts', 'export const x = 1\n')
    expect(probe('vite-spa.client-env').status).toBe('n/a')
  })

  it('checks the pack path, not the whole repository, and passes with the summary as evidence', () => {
    write('web/src/main.ts', 'export const url = import.meta.env.VITE_API_URL\n')
    write('mobile/.env.example', 'EXPO_PUBLIC_SERVICE_ROLE_KEY=\n')
    expect(probe('vite-spa.client-env').status).toBe('fail')
    expect(probe('vite-spa.client-env', { path: 'web' })).toMatchObject({ status: 'pass', evidence: [expect.stringMatching(/^✓ /)] })
  })
})

describe('supabase', () => {
  const sql = (file: string, text: string) => write(`supabase/migrations/${file}`, text)

  it('reads tables out of migrations: comments, strings, and function bodies are not statements', () => {
    const tables = migrationTables([
      {
        file: 'supabase/migrations/20260101000000_init.sql',
        text: [
          'create table public.profiles (id uuid primary key);',
          'CREATE TABLE IF NOT EXISTS "Teams" (id int); -- create table public.ghost (id int);',
          "/* create table public.ghost2 (id int); */ insert into notes values ('create table public.ghost3 (x int);');",
          'create function f() returns void as $$ begin create table public.inner_table (id int); end $$ language plpgsql;',
          'create temporary table scratch (id int);',
          'create table private.secrets (id int);',
          'alter table public.profiles enable row level security;',
          'create table public.old (id int); alter table public.old rename to renamed; alter table renamed enable row level security;',
          'create table public.gone (id int); drop table if exists public.gone cascade;',
        ].join('\n'),
      },
    ])
    expect([...tables.keys()].sort()).toEqual(['private.secrets', 'public.Teams', 'public.profiles', 'public.renamed'])
    expect(tables.get('public.profiles')?.rls).toBe(true)
    expect(tables.get('public.renamed')?.rls).toBe(true)
    expect(tables.get('public.Teams')?.rls).toBe(false)
  })

  it('migration-names: a name the CLI can order', () => {
    sql('20260101000000_init.sql', 'select 1;')
    expect(probe('supabase.migration-names').status).toBe('pass')
    sql('init_v2.sql', 'select 1;')
    expect(probe('supabase.migration-names')).toMatchObject({ status: 'fail', evidence: [expect.any(String), 'supabase/migrations/init_v2.sql'] })
  })

  it('migration-names: a .gitkeep or README is not a migration', () => {
    sql('.gitkeep', '')
    sql('README.md', '# Migrations\n')
    expect(probe('supabase.migration-names').status).toBe('n/a')
  })

  it('rls-on-every-table: a public table without row-level security', () => {
    expect(probe('supabase.rls-on-every-table').status).toBe('n/a')
    sql('20260101000000_init.sql', 'create table public.notes (id int);\ncreate table logs (id int);\nalter table public.notes enable row level security;\n')
    expect(probe('supabase.rls-on-every-table')).toMatchObject({
      status: 'fail',
      evidence: ['1 of 2 public tables without row-level security:', 'public.logs (created in supabase/migrations/20260101000000_init.sql)'],
    })
    sql('20260102000000_rls.sql', 'ALTER TABLE IF EXISTS ONLY "public"."logs" ENABLE ROW LEVEL SECURITY;\n')
    expect(probe('supabase.rls-on-every-table').status).toBe('pass')
  })

  it('explicit-grants: from 2026-10-30, a new table states its exposure', () => {
    sql('20261001000000_before.sql', 'create table public.early (id int);')
    expect(probe('supabase.explicit-grants').status).toBe('n/a')
    sql('20261031000000_after.sql', 'create table public.late (id int);\nalter table public.late enable row level security;\n')
    expect(probe('supabase.explicit-grants')).toMatchObject({ status: 'fail', evidence: [expect.any(String), 'public.late (created in supabase/migrations/20261031000000_after.sql)'] })
    sql('20261101000000_grants.sql', 'grant select, insert on table public.late, public.other to authenticated;\n')
    expect(probe('supabase.explicit-grants').status).toBe('pass')
  })

  it('explicit-grants: default privileges granted in public cover later tables', () => {
    sql('20261031000000_defaults.sql', 'alter default privileges in schema public grant select on tables to anon;\ncreate table public.late (id int);\n')
    expect(probe('supabase.explicit-grants').status).toBe('pass')
  })

  it('db-tests-in-ci: SQL tests, run on pull requests', () => {
    expect(probe('supabase.db-tests-in-ci').evidence).toEqual(['no SQL tests under supabase/tests/'])
    write('supabase/tests/rls.test.sql', 'select plan(1);\n')
    write('.github/workflows/db.yml', workflow('      - run: supabase start\n'))
    expect(probe('supabase.db-tests-in-ci').status).toBe('fail')
    write('.github/workflows/db.yml', workflow('      - run: supabase start && supabase test db\n'))
    expect(probe('supabase.db-tests-in-ci').status).toBe('pass')
  })

  it("advisors-in-ci: Supabase's lints, set to fail", () => {
    expect(probe('supabase.advisors-in-ci').status).toBe('fail')
    write('.github/workflows/db.yml', workflow('      - run: supabase db lint\n'))
    expect(probe('supabase.advisors-in-ci').evidence[0]).toContain('has no --fail-on')
    write('.github/workflows/db.yml', workflow('      - run: supabase db lint --fail-on none\n'))
    expect(probe('supabase.advisors-in-ci').status).toBe('fail')
    write('.github/workflows/db.yml', workflow('      - run: supabase db lint --fail-on error || true\n'))
    expect(probe('supabase.advisors-in-ci').evidence).toEqual(['no workflow runs supabase db advisors or supabase db lint', expect.stringContaining('its failure goes to "|| true"')])
    write('.github/workflows/db.yml', workflow('      - run: supabase db advisors --fail-on=warning\n'))
    expect(probe('supabase.advisors-in-ci').status).toBe('pass')
  })

  it('function-tests-in-ci: Deno tests need a Deno step', () => {
    expect(probe('supabase.function-tests-in-ci').status).toBe('n/a')
    write('supabase/functions/hello/index.test.ts', 'Deno.test("x", () => {})\n')
    write('.github/workflows/ci.yml', workflow('      - run: npm test\n'))
    expect(probe('supabase.function-tests-in-ci').status).toBe('fail')
    write('scripts/deno-tests.sh', '#!/usr/bin/env bash\ncd "$(dirname "$0")/.."\ndeno test --allow-env supabase/functions\n')
    write('.github/workflows/ci.yml', workflow('      - run: bash scripts/deno-tests.sh\n'))
    expect(probe('supabase.function-tests-in-ci')).toMatchObject({ status: 'pass', evidence: [expect.stringContaining('scripts/deno-tests.sh')] })
    // A script without set -e that checks the status itself, then reports.
    write('scripts/deno-tests.sh', '#!/usr/bin/env bash\nset -uo pipefail\nSTATUS=0\nif ! TZ="$zone" deno test \\\n  --allow-read=. supabase/functions; then\n  STATUS=1\nfi\necho done\nexit $STATUS\n')
    expect(probe('supabase.function-tests-in-ci').status).toBe('pass')
  })
})

describe('static-site', () => {
  const firebase = (headers: unknown[] = [], extra: object = {}) => json('firebase.json', { hosting: { public: 'dist', headers, ...extra } })
  const every = (pairs: Record<string, string>) => ({ source: '**', headers: Object.entries(pairs).map(([key, value]) => ({ key, value })) })
  const GOOD = {
    'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  }

  it('security-headers: each required header on a rule for every page', () => {
    expect(probe('static-site.security-headers').status).toBe('n/a')
    firebase()
    expect(probe('static-site.security-headers').evidence[0]).toContain('Content-Security-Policy; X-Content-Type-Options: nosniff; Referrer-Policy; frame-ancestors')
    firebase([every(GOOD)])
    expect(probe('static-site.security-headers').status).toBe('pass')
    // A rule for one path doesn't cover every page.
    firebase([{ ...every(GOOD), source: '/admin/**' }])
    expect(probe('static-site.security-headers').status).toBe('fail')
    // frame-ancestors can come from X-Frame-Options instead.
    firebase([every({ ...GOOD, 'Content-Security-Policy': "default-src 'self'", 'X-Frame-Options': 'DENY' })])
    expect(probe('static-site.security-headers').status).toBe('pass')
  })

  it("security-headers: reads Netlify's netlify.toml and _headers, and a CSP meta tag", () => {
    write('netlify.toml', '[build]\n  publish = "dist"\n\n[[headers]]\n  for = "/*"\n  [headers.values]\n    X-Frame-Options = "DENY"\n    X-Content-Type-Options = "nosniff"\n    Referrer-Policy = "no-referrer"\n    Content-Security-Policy = """\n      default-src \'self\';\n      img-src \'self\' data:\n    """\n')
    expect(probe('static-site.security-headers').status).toBe('pass')
    rmSync(join(root, 'netlify.toml'))
    write('_headers', '/*\n  X-Frame-Options: DENY\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n')
    expect(probe('static-site.security-headers').evidence[0]).toContain('Content-Security-Policy')
    write('index.html', '<head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'"></head>\n')
    expect(probe('static-site.security-headers').status).toBe('pass')
  })

  it('security-headers: a GitHub Pages site is skipped, not failed', () => {
    write('.github/workflows/pages.yml', workflow('      - uses: actions/deploy-pages@v4\n', 'push:'))
    expect(probe('static-site.security-headers').status).toBe('skipped')
  })

  it('served-files-deployed: robots.txt and sitemap.xml reach the served directory', () => {
    firebase()
    expect(probe('static-site.served-files-deployed').status).toBe('n/a') // keeps neither
    write('robots.txt', 'User-agent: *\n')
    write('dist/index.html', '<h1>Home</h1>\n')
    expect(probe('static-site.served-files-deployed').evidence[0]).toContain("robots.txt isn't in dist/")
    rmSync(join(root, 'robots.txt'))
    write('public/robots.txt', 'User-agent: *\n')
    expect(probe('static-site.served-files-deployed')).toMatchObject({ status: 'pass', evidence: ['robots.txt: public/robots.txt'] })
    json('firebase.json', { hosting: { public: '.' } })
    expect(probe('static-site.served-files-deployed').status).toBe('n/a') // the root is served as is
  })

  it('html-checked-in-ci: a validator or link checker that can fail the run', () => {
    expect(probe('static-site.html-checked-in-ci').status).toBe('fail')
    write('.github/workflows/ci.yml', workflow('      - run: npx html-validate "dist/**/*.html" || true\n'))
    expect(probe('static-site.html-checked-in-ci').evidence).toEqual(['no pull_request workflow validates the HTML or checks its links', expect.stringContaining('|| true')])
    write('.github/workflows/ci.yml', workflow('      - uses: lycheeverse/lychee-action@v2\n        with:\n          args: --offline dist\n          fail: false\n'))
    expect(probe('static-site.html-checked-in-ci').status).toBe('fail') // reports broken links and passes
    write('.github/workflows/ci.yml', workflow('      - uses: lycheeverse/lychee-action@v2\n        with:\n          args: --offline dist\n'))
    expect(probe('static-site.html-checked-in-ci').status).toBe('pass')
  })

  it('html-checked-in-ci: lychee-action v1 passes by default, and vnu can be told to', () => {
    write('.github/workflows/ci.yml', workflow('      - uses: lycheeverse/lychee-action@v1.10.0\n'))
    expect(probe('static-site.html-checked-in-ci').status).toBe('fail') // v1's fail defaults to false
    write('.github/workflows/ci.yml', workflow('      - uses: lycheeverse/lychee-action@v1.10.0\n        with:\n          fail: true\n'))
    expect(probe('static-site.html-checked-in-ci').status).toBe('pass')
    write('.github/workflows/ci.yml', workflow('      - run: java -jar vnu.jar --exit-zero-always --skip-non-html dist\n'))
    expect(probe('static-site.html-checked-in-ci').status).toBe('fail')
    const sha = 'a'.repeat(40)
    write('.github/workflows/ci.yml', workflow(`      - uses: lycheeverse/lychee-action@${sha} # v1.10.0\n`))
    expect(probe('static-site.html-checked-in-ci').status).toBe('fail') // a v1 by its comment
    write('.github/workflows/ci.yml', workflow(`      - uses: 'lycheeverse/lychee-action@${sha}' # v1.10.0\n`))
    expect(probe('static-site.html-checked-in-ci').status).toBe('fail') // quoted, too
    write('.github/workflows/ci.yml', workflow(`      - uses: lycheeverse/lychee-action@${sha} # v2.4.1\n`))
    expect(probe('static-site.html-checked-in-ci').status).toBe('pass')
  })

  it("security-headers: firebase.json's comments, Netlify's inline values, static/_headers, and no commented-out CSP", () => {
    write('firebase.json', `{\n  // headers for every page\n  "hosting": { "public": "dist", /* all of it */ "headers": ${JSON.stringify([every(GOOD)])} }\n}\n`)
    expect(probe('static-site.security-headers').status).toBe('pass')
    rmSync(join(root, 'firebase.json'))
    write('netlify.toml', '[[headers]]\n  for = "/*"\n  values = { X-Frame-Options = "DENY", X-Content-Type-Options = "nosniff", "Referrer-Policy" = "no-referrer" }\n')
    write('index.html', '<head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'"></head>\n')
    expect(probe('static-site.security-headers').status).toBe('pass')
    write('index.html', '<head><!-- <meta http-equiv="Content-Security-Policy" content="default-src \'self\'"> --></head>\n')
    expect(probe('static-site.security-headers').evidence[0]).toContain('Content-Security-Policy')
    rmSync(join(root, 'netlify.toml'))
    rmSync(join(root, 'index.html'))
    write('static/_headers', '/*\n  Content-Security-Policy: default-src \'self\'; frame-ancestors \'none\'\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n')
    expect(probe('static-site.security-headers').status).toBe('pass')
  })

  it("served-files-deployed: Netlify's publish is relative to its base", () => {
    write('netlify.toml', '[build]\n  base = "site"\n  publish = "dist"\n')
    write('site/public/robots.txt', 'User-agent: *\n')
    expect(probe('static-site.served-files-deployed')).toMatchObject({ status: 'pass', evidence: ['robots.txt: site/public/robots.txt'] })
  })
})

describe('writing', () => {
  it("prose-checks-in-ci: a linter, or the repository's own checker, on pull requests", () => {
    expect(probe('writing.prose-checks-in-ci').evidence[0]).toContain('no pull_request workflow (core.ci-on-pull-requests)')
    write('.github/workflows/ci.yml', workflow('      - run: python3 -m unittest discover -s tools\n'))
    expect(probe('writing.prose-checks-in-ci').evidence[0]).toBe('no pull_request workflow runs a prose check')
    write('.github/workflows/ci.yml', workflow('      - run: python3 tools/check_log.py --diff origin/main\n'))
    expect(probe('writing.prose-checks-in-ci').status).toBe('fail') // no such checker in the repository
    write('tools/check_log.py', 'import pathlib\nfor p in pathlib.Path("rp-log").rglob("*.md"):\n    print(p)\n')
    expect(probe('writing.prose-checks-in-ci').status).toBe('pass')
    for (const run of ['python3 $GITHUB_WORKSPACE/tools/check_log.py', 'python3 "${GITHUB_WORKSPACE}/tools/check_log.py"', 'python3 ${{ github.workspace }}/tools/check_log.py']) {
      write('.github/workflows/ci.yml', workflow(`      - run: ${run}\n`))
      expect(probe('writing.prose-checks-in-ci').status, run).toBe('pass')
    }
    for (const run of ['python3 $TOOLS/check_log.py', 'python3 ${{ env.TOOLS }}/check_log.py']) {
      write('.github/workflows/ci.yml', workflow(`      - run: ${run}\n`))
      expect(probe('writing.prose-checks-in-ci').evidence[1], run).toContain("a path this check can't resolve")
    }
    // A check script that isn't about prose doesn't count.
    write('scripts/check-env.mjs', "console.log(process.env.CI)\n")
    write('.github/workflows/ci.yml', workflow('      - run: node scripts/check-env.mjs\n'))
    expect(probe('writing.prose-checks-in-ci').status).toBe('fail')
    write('.github/workflows/ci.yml', workflow('      - run: npx markdownlint-cli2 "**/*.md"\n'))
    expect(probe('writing.prose-checks-in-ci').status).toBe('pass')
  })

  it('prose-checks-in-ci: a run that checks no prose does not count', () => {
    for (const run of ['vale sync', 'vale ls-config', 'vale test', 'npx cspell --version', 'cspell trace Kimmy', 'cspell init',
      'npx markdownlint-cli2 --help', 'textlint --init']) {
      write('.github/workflows/ci.yml', workflow(`      - run: ${run}\n`))
      expect(probe('writing.prose-checks-in-ci').evidence, run).toEqual(['no pull_request workflow runs a prose check', expect.stringContaining('checks no prose')])
    }
    for (const run of ['vale sync && vale docs', 'cspell check README.md', 'npx cspell lint "**/*.md"', 'vale --config .vale.ini docs']) {
      write('.github/workflows/ci.yml', workflow(`      - run: ${run}\n`))
      expect(probe('writing.prose-checks-in-ci').status, run).toBe('pass')
    }
  })

  describe('vocabulary-registered', () => {
    const vocab = (options = {}) => probe('writing.vocabulary-registered', options)
    const ci = (steps: string) => write('.github/workflows/ci.yml', workflow(steps))
    const run = (cmd: string) => ci(`      - run: ${cmd}\n`)
    const cspell = (config: Record<string, unknown>, file = 'cspell.json') => json(file, { version: '0.2', ...config })
    const vale = (ini: string, accept = 'Zorwen\n', reject = 'Denise\n') => {
      write('.vale.ini', ini)
      write('styles/config/vocabularies/Book/accept.txt', accept)
      write('styles/config/vocabularies/Book/reject.txt', reject)
    }
    const VALE = 'StylesPath = styles\nVocab = Book\n\n[*.md]\nBasedOnStyles = Vale\n'
    beforeEach(() => write('book/one.md', '# One\n'))

    it('is n/a without a prose check on pull requests, and fails on markdownlint alone', () => {
      expect(vocab()).toMatchObject({ status: 'n/a', evidence: [expect.stringContaining('writing.prose-checks-in-ci')] })
      run('npx markdownlint-cli2 "**/*.md"')
      expect(vocab()).toMatchObject({ status: 'fail', evidence: [expect.stringContaining("markdownlint's proper-names rule")] })
    })

    it('cspell: an accept list and a reject list, each required', () => {
      run('npx cspell "**/*.md"')
      cspell({ words: [], flagWords: ['Denise'] })
      expect(vocab().evidence[0]).toContain('no accept list')
      cspell({ words: ['Zorwen'] })
      expect(vocab().evidence[0]).toContain('no reject list')
      cspell({ words: ['Zorwen'], flagWords: ['Denise'] })
      expect(vocab()).toMatchObject({ status: 'pass', evidence: [expect.stringContaining('1 accepted word(s) (cspell.json)'), expect.stringContaining('1 rejected word(s)')] })
    })

    it('cspell: reads the config the run reads', () => {
      run('npx cspell "**/*.md"')
      cspell({ words: ['Zorwen'], flagWords: ['Denise'] })
      // A package.json with a cspell key comes first in a directory, and shadows cspell.json.
      json('package.json', { name: 'book', cspell: { ignorePaths: ['dist'] } })
      expect(vocab().evidence[0]).toContain('no accept list')
      json('package.json', { name: 'book' })
      expect(vocab().status).toBe('pass')
      // .cspell.json comes before cspell.json.
      cspell({}, '.cspell.json')
      expect(vocab().status).toBe('fail')
      rmSync(join(root, '.cspell.json'))
      // --config with --no-config-search reads only that file; a missing one stops cspell.
      cspell({}, 'ci/cspell.json')
      run('npx cspell --no-config-search -c ci/cspell.json "**/*.md"')
      expect(vocab().status).toBe('fail')
      run('npx cspell --config=missing.json "**/*.md"')
      expect(vocab().evidence[0]).toContain("its config missing.json isn't in the repository")
      // A relative import is followed.
      cspell({ import: ['./ci/names.json'] })
      cspell({ words: ['Zorwen'], flagWords: ['Denise'] }, 'ci/names.json')
      run('npx cspell "**/*.md"')
      expect(vocab().status).toBe('pass')
    })

    it('cspell: a dictionary counts when it is enabled and its file holds entries', () => {
      run('npx cspell "**/*.md"')
      const defs = { dictionaryDefinitions: [{ name: 'cast', path: './cast.txt', addWords: true }] }
      write('cast.txt', '# the cast\nZorwen\n!Denise\n')
      cspell(defs)
      expect(vocab().status).toBe('fail') // defined, never enabled
      cspell({ ...defs, dictionaries: ['cast'] })
      expect(vocab()).toMatchObject({ status: 'pass', evidence: [expect.stringContaining('1 accepted'), expect.stringContaining('1 rejected')] })
      cspell({ ...defs, dictionaries: ['cast', '!cast'] })
      expect(vocab().status).toBe('fail')
      cspell({ dictionaryDefinitions: [{ name: 'cast', path: './gone.txt' }], dictionaries: ['cast'] })
      expect(vocab().evidence[0]).toContain("names ./gone.txt, which isn't in the repository")
      write('cast.txt', '# only a comment\n')
      cspell({ ...defs, dictionaries: ['cast'] })
      expect(vocab().evidence[0]).toContain('no accept list')
    })

    it.each([
      ['--report flagged', 'npx cspell --report flagged "**/*.md"', {}],
      ['unknownWords report-flagged', 'npx cspell "**/*.md"', { unknownWords: 'report-flagged' }],
      ['an ignore pattern for capitalized words', 'npx cspell "**/*.md"', { ignoreRegExpList: ['/\\b[A-Z][a-z]+\\b/g'] }],
      ['enabled: false', 'npx cspell "**/*.md"', { enabled: false }],
      ['a phrase in flagWords', 'npx cspell "**/*.md"', { flagWords: ['Denise', 'Auntie Kimmy'] }],
      ['a lowercase flag of a registered word', 'npx cspell "**/*.md"', { words: ['Zorwen', 'GitHub'], flagWords: ['Denise', 'github'] }],
    ])('cspell: %s fails', (_label, cmd, extra) => {
      run(cmd)
      cspell({ words: ['Zorwen'], flagWords: ['Denise'], ...extra })
      expect(vocab().status).toBe('fail')
    })

    it.each([
      ['a bare regex', { ignoreRegExpList: ['\\b[a-z]+\\b'] }],
      ['a named pattern', { patterns: [{ name: 'caps', pattern: '/\\b[A-Z]\\w+/g' }], ignoreRegExpList: ['caps'] }],
      ['the Everything pattern', { ignoreRegExpList: ['Everything'] }],
      ['ignoreWords holding a flagged word', { ignoreWords: ['denise'] }],
      ['minWordLength above four', { minWordLength: 12 }],
      ['Markdown turned off in an override', { overrides: [{ filename: '**/*.md', enabled: false }] }],
      ['every Markdown file in ignorePaths', { ignorePaths: ['*.md'] }],
    ])('cspell: %s fails', (_label, extra) => {
      run('npx cspell "**/*.md"')
      cspell({ words: ['Zorwen'], flagWords: ['Denise'], ...extra })
      expect(vocab().status).toBe('fail')
    })

    it('cspell: a predefined pattern, minWordLength four, and lists in a Markdown override or language setting pass', () => {
      run('npx cspell "**/*.md"')
      for (const config of [
        { words: ['Zorwen'], flagWords: ['Denise'], ignoreRegExpList: ['Urls', '/\\d+/g'], minWordLength: 4 },
        { overrides: [{ filename: 'book/*.md', words: ['Zorwen'], flagWords: ['Denise'] }] },
        { languageSettings: [{ languageId: 'markdown,mdx', words: ['Zorwen'], flagWords: ['Denise'] }] },
      ]) {
        cspell(config)
        expect(vocab().status, JSON.stringify(config)).toBe('pass')
      }
      // A dictionary enabled for TypeScript, or a language setting for Python, isn't Markdown's.
      write('cast.txt', 'Zorwen\n')
      cspell({ flagWords: ['Denise'], dictionaryDefinitions: [{ name: 'cast', path: './cast.txt' }], overrides: [{ filename: '**/*.ts', dictionaries: ['cast'] }] })
      expect(vocab().evidence[0]).toContain('no accept list')
      cspell({ flagWords: ['Denise'], languageSettings: [{ languageId: 'python', words: ['Zorwen'] }] })
      expect(vocab().evidence[0]).toContain('no accept list')
    })

    it('cspell: a config nearer the document merges over the root one; --no-config-search stops only that', () => {
      run('npx cspell "**/*.md"')
      cspell({ words: ['Zorwen'], flagWords: ['Denise'] }, 'book/cspell.json')
      expect(vocab().status).toBe('pass') // lists only in book/
      cspell({ words: ['Zorwen'], flagWords: ['Denise'] })
      cspell({ enabled: false }, 'book/cspell.json')
      expect(vocab().evidence[0]).toContain('enabled: false')
      cspell({ unknownWords: 'report-flagged' }, 'book/cspell.json')
      expect(vocab().evidence[0]).toContain('unknownWords "report-flagged"')
      run('npx cspell --no-config-search "**/*.md"')
      expect(vocab().status).toBe('pass') // the root config, not book's
    })

    it('cspell: configs that do not parse fail without stopping the check', () => {
      run('npx cspell "**/*.md"')
      write('cspell.yaml', 'version: "0.2"\nwords: *nope\n')
      expect(vocab().evidence[0]).toContain("cspell.yaml doesn't parse")
      // A duplicate key loads, as cspell loads it.
      write('cspell.yaml', 'version: "0.2"\nwords: [Zorwen]\nflagWords: [Denise]\nwords: [Zorwen]\n')
      expect(vocab().status).toBe('pass')
      rmSync(join(root, 'cspell.yaml'))
      write('package.json', 'null\n')
      run('npx cspell -c package.json "**/*.md"')
      expect(vocab().status).toBe('fail')
    })

    it('cspell: the action, its report input, and a JavaScript config', () => {
      cspell({ words: ['Zorwen'], flagWords: ['Denise'] })
      ci('      - uses: streetsidesoftware/cspell-action@v7\n')
      expect(vocab().status).toBe('pass')
      ci('      - uses: streetsidesoftware/cspell-action@v7\n        with:\n          report: typos\n')
      expect(vocab().evidence[0]).toContain('--report typos lets an unknown word pass')
      rmSync(join(root, 'cspell.json'))
      write('cspell.config.mjs', 'export default { words: ["Zorwen"] }\n')
      ci('      - uses: streetsidesoftware/cspell-action@v7\n')
      expect(vocab()).toMatchObject({ status: 'skipped', evidence: [expect.stringContaining('a JavaScript cspell config')] })
    })

    it('vale: the Vocab folder, in Vale 3’s place', () => {
      run('vale book')
      vale(VALE)
      expect(vocab()).toMatchObject({ status: 'pass', evidence: [expect.stringContaining('1 accepted term(s)'), expect.stringContaining('1 rejected term(s)')] })
      rmSync(join(root, 'styles/config'), { recursive: true })
      expect(vocab().evidence[0]).toContain("styles/config/vocabularies/Book/ isn't in the repository")
      write('styles/Vocab/Book/accept.txt', 'Zorwen\n')
      expect(vocab().evidence[0]).toContain("that's Vale 2's place")
      write('.vale.ini', '[*.md]\nBasedOnStyles = Vale\n')
      expect(vocab().evidence.join('\n')).toContain('gives no Markdown file a Vocab')
    })

    // Each was run with Vale 3.24.0: the rule stays off, or the run passes Denise.
    it.each([
      ['Vale.Avoid turned off', `${VALE}Vale.Avoid = NO\n`],
      ['the styles reset in a later section', `${VALE}\n[book/*.md]\nBasedOnStyles =\n`],
      ['Vale.Avoid at warning, which the CLI passes', `${VALE}Vale.Avoid = warning\n`],
      ['a switch that outlasts a later BasedOnStyles', `${VALE}Vale.Avoid = NO\n\n[book/*.md]\nBasedOnStyles = Vale\n`],
      ['a level that outlasts a later BasedOnStyles', `${VALE}Vale.Avoid = warning\n\n[book/*.md]\nBasedOnStyles = Vale\n`],
      ['[*] turning a rule off, before the section', 'StylesPath = styles\nVocab = Book\n\n[*]\nVale.Avoid = NO\n\n[*.md]\nBasedOnStyles = Vale\n'],
      ['[*] turning a rule off, after the section', `${VALE}\n[*]\nVale.Avoid = NO\n`],
      ['a later [*] turning a rule back on, which a section outranks', `${VALE}Vale.Avoid = NO\n\n[*]\nVale.Avoid = YES\n`],
      ['an earlier section turning a rule off', 'StylesPath = styles\nVocab = Book\n\n[book/*.md]\nVale.Avoid = NO\n\n[*.md]\nBasedOnStyles = Vale\n'],
      ['a section Vocab’s rule turned off by its name', 'StylesPath = styles\n\n[*.md]\nBasedOnStyles = Vale\nVocab = Book\nVale.Book.Avoid = NO\n'],
      ['a Vocab only for text files', 'StylesPath = styles\n\n[*.txt]\nVocab = Book\n\n[*.md]\nBasedOnStyles = Vale\n'],
      ['MinAlertLevel above the rule’s level', `StylesPath = styles\nMinAlertLevel = error\nVocab = Book\n\n[*.md]\nBasedOnStyles = Vale\nVale.Avoid = warning\n`],
    ])('vale: %s fails', (_label, ini) => {
      run('vale book')
      vale(ini)
      expect(vocab().status).toBe('fail')
    })

    it.each([
      ['a later [*] with no styles, which a section outranks', `${VALE}\n[*]\nBasedOnStyles =\n`],
      ['Vale.Terms turned off: the spell check and Avoid read the lists', `${VALE}Vale.Terms = NO\n`],
      ['a core Vocab with a Vale.<Name> switch, which names no rule', `${VALE}Vale.Book.Avoid = NO\n`],
      ['a section Vocab, whose rules run whatever the styles', 'StylesPath = styles\n\n[*.md]\nBasedOnStyles = Vale\nVocab = Book\n'],
      ['a later section turning a rule back on', `${VALE}Vale.Avoid = NO\n\n[book/*.md]\nVale.Avoid = YES\n`],
      ['a single-item brace', 'StylesPath = styles\nVocab = Book\n\n[*.{md}]\nBasedOnStyles = Vale\n'],
      ['* crossing a slash', 'StylesPath = styles\nVocab = Book\n\n[b*.md]\nBasedOnStyles = Vale\n'],
      ['inline comments and a quoted value', 'StylesPath = "styles"\nVocab = Book # the cast\n\n[*.md]\nBasedOnStyles = Vale ; core\n'],
      ['a header with a comment after it', 'StylesPath = styles\nVocab = Book\n\n[*.txt]\nVale.Avoid = NO\n\n[*.md] # the prose\nBasedOnStyles = Vale\n'],
    ])('vale: %s passes', (_label, ini) => {
      run('vale book')
      vale(ini)
      expect(vocab().status).toBe('pass')
    })

    it('vale: section globs match from where Vale runs; --glob, --filter and --minAlertLevel', () => {
      write('book/sub/two.md', '# Two\n')
      ci('      - run: vale .\n        working-directory: book\n')
      vale('StylesPath = styles\nVocab = Book\n\n[book/**/*.md]\nBasedOnStyles = Vale\n')
      expect(vocab().status).toBe('fail') // the paths are one.md and sub/two.md
      vale('StylesPath = styles\nVocab = Book\n\n[sub/*.md]\nBasedOnStyles = Vale\n')
      expect(vocab().status).toBe('pass')
      vale(VALE)
      run("vale --glob='*.txt' book")
      expect(vocab().evidence[0]).toContain('leaves out every Markdown file')
      run("vale --glob='*.{md,txt}' book")
      expect(vocab().status).toBe('pass')
      run(`vale --filter='.Level == "error"' book`)
      expect(vocab()).toMatchObject({ status: 'skipped', evidence: [expect.stringContaining("doesn't evaluate")] })
      vale(`${VALE}Vale.Avoid = warning\n`)
      ci('      - uses: vale-cli/vale-action@v3\n        with:\n          fail_level: warning\n          vale_flags: --minAlertLevel=error\n')
      expect(vocab().status).toBe('fail')
      ci('      - uses: vale-cli/vale-action@v3\n        with:\n          fail_level: any\n')
      expect(vocab().status).toBe('pass')
    })

    it('a split between the tools: cspell holds the lists, Vale runs without them', () => {
      ci('      - run: npx cspell "**/*.md"\n      - run: vale book\n')
      cspell({ words: ['Zorwen'], flagWords: ['Denise'] })
      write('.vale.ini', 'StylesPath = styles\n\n[*.md]\nBasedOnStyles = Vale\n')
      expect(vocab().status).toBe('pass')
      vale(`${VALE}Vale.Spelling = NO\n`)
      expect(vocab().status).toBe('pass')
      // A section's Vocab rules run under another style: Vale.Book.Avoid holds the reject half.
      cspell({ words: ['Zorwen'] })
      vale('StylesPath = styles\n\n[*.md]\nBasedOnStyles = House\nVocab = Book\n')
      expect(vocab().status).toBe('pass')
      // Vale alone with its spell check off has no accept half.
      vale(`${VALE}Vale.Spelling = NO\n`)
      run('vale book')
      expect(vocab().evidence).toEqual(expect.arrayContaining([expect.stringContaining('a reject list but no accept list'), expect.stringContaining('only fixes casing')]))
    })

    it('vale: the rules on one by one, the action’s fail_level, a filter, and the config the run names', () => {
      run('vale book')
      vale('StylesPath = styles\nVocab = Book\n\n[*.md]\nVale.Spelling = YES\nVale.Terms = YES\nVale.Avoid = YES\n')
      expect(vocab().status).toBe('pass')
      vale(`${VALE}Vale.Avoid = warning\n`)
      ci('      - uses: vale-cli/vale-action@v3\n        with:\n          fail_level: warning\n')
      expect(vocab().status).toBe('pass')
      ci('      - uses: vale-cli/vale-action@v3\n        with:\n          fail_level: error\n')
      expect(vocab().status).toBe('fail')
      vale(VALE)
      run(`vale --filter='.Name != "Vale.Terms"' book`)
      expect(vocab().evidence[0]).toContain('names a vocabulary rule')
      // The action reads the config it's given, not the root's.
      write('.vale.ini', '[*.md]\nBasedOnStyles = Vale\n')
      write('docs/.vale.ini', 'StylesPath = ../styles\nVocab = Book\n\n[*.md]\nBasedOnStyles = Vale\n')
      ci('      - uses: vale-cli/vale-action@v3\n        with:\n          fail_level: error\n          config: docs/.vale.ini\n')
      expect(vocab().status).toBe('pass')
    })

    it('vale: comments, a #tag entry, and a rejected phrase that holds an accepted term', () => {
      run('vale book')
      vale(VALE, 'Zorwen\n', '# retired names\n')
      expect(vocab().evidence[0]).toContain('no reject list')
      vale(VALE, 'Zorwen\n', '#tag\n')
      expect(vocab().status).toBe('pass')
      vale(VALE, 'Kimmy\n', 'Auntie Kimmy\n')
      expect(vocab().evidence[0]).toContain('holds the accepted "Kimmy"')
      vale(VALE, '[Kk]immy\n', 'Auntie Kimmy\n')
      expect(vocab().evidence[0]).toContain('holds the accepted "[Kk]immy"')
      vale(VALE, '(?i)kimmy\n', 'Auntie Kimmy\n')
      expect(vocab().evidence[0]).toContain('holds the accepted "(?i)kimmy"')
    })

    // Round two of the review: each case was run against cspell 10.3.6 or Vale 3.24.0.
    it.each([
      ['a lowercase yes, which Vale reads as off', `${VALE}Vale.Avoid = yes\n`],
      ['an uppercase level, which Vale reads as off', `${VALE}Vale.Avoid = ERROR\n`],
      ['a colon for the equals sign', `${VALE}Vale.Avoid: NO\n`],
      ['a header with a comment after it', `${VALE}\n[book/*.md] # the book\nVale.Avoid = NO\n`],
      ['a repeated section, merged into its first place', `${VALE}\n[book/*.md]\nVale.Avoid = NO\n\n[*.md]\nVale.Avoid = YES\n`],
      ['a class that ^ doesn’t negate', 'StylesPath = styles\nVocab = Book\n\n[[^t]*.md]\nBasedOnStyles = Vale\n'],
      ['a list that reaches only some files', `${VALE}Vale.Avoid = NO\n\n[docs/*.md]\nVale.Avoid = YES\n`],
    ])('vale: %s fails', (_label, ini) => {
      write('docs/two.md', '# Two\n')
      run('vale book docs')
      vale(ini)
      expect(vocab().status).toBe('fail')
    })

    it('vale: UNSET, a ! class, and only the files the run names', () => {
      run('vale book')
      vale(`${VALE}Vale.Avoid = UNSET\n`)
      expect(vocab().status).toBe('pass')
      vale('StylesPath = styles\nVocab = Book\n\n[[!t]*.md]\nBasedOnStyles = Vale\n')
      expect(vocab().status).toBe('pass')
      vale('StylesPath = styles\nVocab = Book\n\n[docs/*.md]\nBasedOnStyles = Vale\n')
      write('docs/two.md', '# Two\n')
      expect(vocab().status).toBe('fail') // vale book lints book/one.md, which no section covers
      run('vale $GITHUB_WORKSPACE/book')
      expect(vocab().status).toBe('skipped')
      run('vale --output=line')
      expect(vocab().evidence.join('\n')).toContain('lints no Markdown file')
      ci('      - run: vale .\n        working-directory: ${{ matrix.dir }}\n')
      expect(vocab().status).toBe('skipped')
    })

    it('vale: the action’s glob, min_alert_level and files inputs', () => {
      vale(`${VALE}Vale.Avoid = warning\n`)
      ci('      - uses: vale-cli/vale-action@v3\n        with:\n          fail_level: warning\n')
      expect(vocab().status).toBe('pass')
      ci('      - uses: vale-cli/vale-action@v3\n        with:\n          fail_level: warning\n          min_alert_level: error\n')
      expect(vocab().status).toBe('fail')
      ci("      - uses: vale-cli/vale-action@v3\n        with:\n          fail_level: warning\n          glob: '*.txt'\n")
      expect(vocab().status).toBe('fail')
      ci('      - uses: vale-cli/vale-action@v3\n        with:\n          fail_level: warning\n          files: docs\n')
      expect(vocab().status).toBe('skipped')
    })

    it('vale: an accepted entry JavaScript reads only without the u flag', () => {
      run('vale book')
      vale(VALE, 'Kimmy\\-Lee\n', 'Big Kimmy-Lee\n')
      expect(vocab().evidence[0]).toContain('holds the accepted')
    })

    it.each([
      ['Markdown off in a brace override', { overrides: [{ filename: '**/*.{md,mdx}', enabled: false }] }],
      ['Markdown off in a class override', { overrides: [{ filename: '[bd]*/[a-z]*.md', enabled: false }] }],
      ['an ignore pattern bounded to short names', { ignoreRegExpList: ['/\\b[A-Z][a-z]{2,6}\\b/g'] }],
      ['the flags only in an override for other files', { flagWords: [], overrides: [{ filename: 'docs/**', flagWords: ['Denise'] }] }],
      ['an override that turns cspell off, over a nearer config', { overrides: [{ filename: '**/*.md', enabled: false }] }, { enabled: true }],
      ['an override that lets unknown words pass, over a nearer config', { overrides: [{ filename: '**/*.md', unknownWords: 'report-flagged' }] }, { unknownWords: 'report-all' }],
    ])('cspell: %s fails', (_label, extra, nested?: Record<string, unknown>) => {
      write('docs/two.md', '# Two\n')
      run('npx cspell "**/*.md"')
      cspell({ words: ['Zorwen'], flagWords: ['Denise'], ...extra })
      if (nested) cspell(nested, 'book/cspell.json')
      expect(vocab().status).toBe('fail')
    })

    it('cspell: brace globs, a file left out, the run’s own globs, and a glob it can’t follow', () => {
      run('npx cspell "**/*.md"')
      cspell({ overrides: [{ filename: '**/*.{md,mdx}', words: ['Zorwen'], flagWords: ['Denise'] }] })
      expect(vocab().status).toBe('pass')
      write('CHANGELOG.md', '# Changes\n')
      cspell({ words: ['Zorwen'], flagWords: ['Denise'], overrides: [{ filename: 'CHANGELOG.md', enabled: false }] })
      expect(vocab().status).toBe('pass') // one file left out; the book is still checked
      // The accept list reaches every file, the reject list docs/ only: the book has a gap.
      rmSync(join(root, 'CHANGELOG.md'))
      write('docs/two.md', '# Two\n')
      cspell({ words: ['Zorwen'], overrides: [{ filename: 'docs/**', flagWords: ['Denise'] }] })
      run('npx cspell "**/*.md"')
      expect(vocab().evidence[0]).toContain('1 Markdown file(s) get an accept list but no reject list: book/one.md')
      run('npx cspell "book/**/*.md"')
      expect(vocab().status).toBe('fail')
      run('npx cspell "**/*.md" --exclude "book/**"')
      expect(vocab().status).toBe('pass')
      run('npx cspell "**/*.md" "!book/**"')
      expect(vocab().status).toBe('pass')
      // A gap beside a run this check skipped may be that run's to fill: skipped, not failed.
      ci(`      - run: npx cspell "**/*.md"\n      - run: vale --filter='.Level == "error"' book\n`)
      vale(VALE)
      expect(vocab().status).toBe('skipped')
      ci('      - run: npx cspell "**/*.md"\n        working-directory: ${{ matrix.dir }}\n')
      expect(vocab().status).toBe('skipped')
      cspell({ words: ['Zorwen'], flagWords: ['Denise'], overrides: [{ filename: 'book/!(two).md', enabled: false }] })
      run('npx cspell "**/*.md"')
      expect(vocab()).toMatchObject({ status: 'skipped', evidence: [expect.stringContaining("a glob this check doesn't follow")] })
      run('npx cspell "$BOOK/**/*.md"')
      expect(vocab().status).toBe('skipped')
    })

    it('cspell: a config in .config/ globs from the directory above it', () => {
      run('npx cspell "**/*.md"')
      cspell({ overrides: [{ filename: 'book/*.md', words: ['Zorwen'], flagWords: ['Denise'] }] }, '.config/cspell.json')
      expect(vocab().status).toBe('pass')
      cspell({ words: ['Zorwen'], flagWords: ['Denise'], overrides: [{ filename: 'book/*.md', enabled: false }] }, '.config/cspell.json')
      expect(vocab().status).toBe('fail')
    })

    // Round three of the review: each case was run against cspell 10.3.6 or Vale 3.24.0.
    it('vale: a quoted glob lints nothing, an unquoted one is the shell’s, and xargs or -exec feeds every file', () => {
      vale(VALE)
      run(`vale "book/*.md"`)
      expect(vocab().evidence.join('\n')).toContain('lints no Markdown file')
      run('vale book/*.md')
      expect(vocab().status).toBe('skipped')
      for (const cmd of ["find . -name '*.md' | xargs vale", "git diff --name-only origin/main -- '*.md' | xargs vale", "find book -name '*.md' -exec vale {} +"]) {
        run(cmd)
        expect(vocab().status, cmd).toBe('pass')
      }
    })

    it('vale: **/ matches no folder too, in a section and in the action’s glob', () => {
      write('README.md', '# Read me\n')
      // cspell has the accept list; Vale's [**/*.md] has to reach README.md for its reject list.
      cspell({ words: ['Zorwen'] })
      ci('      - run: npx cspell "**/*.md"\n      - run: vale .\n')
      vale('StylesPath = styles\nVocab = Book\n\n[**/*.md]\nBasedOnStyles = Vale\nVale.Spelling = NO\n')
      expect(vocab().status).toBe('pass')
      vale('StylesPath = styles\nVocab = Book\n\n[**/*.md]\nBasedOnStyles = Vale\n')
      ci('      - uses: vale-cli/vale-action@v3\n        with:\n          fail_level: error\n          glob: "**/*.md"\n')
      expect(vocab().status).toBe('pass')
    })

    it('redirections are not paths', () => {
      vale(VALE)
      cspell({ words: ['Zorwen'], flagWords: ['Denise'] })
      for (const cmd of ['vale --output=JSON book > vale.json', 'set -o pipefail; npx cspell "**/*.md" 2>&1 | tee cspell.log', 'npx cspell --no-progress "**/*.md" >> "$GITHUB_STEP_SUMMARY"']) {
        run(cmd)
        expect(vocab().status, cmd).toBe('pass')
      }
    })

    it('cspell: dot folders, excludes at any depth, the config’s files, and options with values', () => {
      // cspell has the accept list; Vale the reject list, over every file.
      write('.github/PULL_REQUEST_TEMPLATE.md', '# Template\n')
      cspell({ words: ['Zorwen'] })
      vale(`${VALE}Vale.Spelling = NO\n`)
      ci('      - run: npx cspell "**/*.md"\n      - run: vale .\n')
      expect(vocab().evidence[0]).toContain('get a reject list but no accept list: .github/PULL_REQUEST_TEMPLATE.md')
      ci('      - run: npx cspell --dot "**/*.md"\n      - run: vale .\n')
      expect(vocab().status).toBe('pass')
      rmSync(join(root, '.github/PULL_REQUEST_TEMPLATE.md'))
      write('book/CHANGELOG.md', '# Changes\n')
      ci('      - run: npx cspell "**/*.md" --exclude CHANGELOG.md\n      - run: vale .\n')
      expect(vocab().evidence[0]).toContain('book/CHANGELOG.md')
      // With no glob argument, the config's files, or nothing.
      cspell({ words: ['Zorwen'], flagWords: ['Denise'] })
      run('npx cspell --no-progress')
      expect(vocab().evidence.join('\n')).toContain('so cspell checks nothing')
      cspell({ words: ['Zorwen'], flagWords: ['Denise'], files: ['book/**/*.md'] })
      expect(vocab().status).toBe('pass')
      cspell({ words: ['Zorwen'], flagWords: ['Denise'], files: ['drafts/**/*.md'] })
      expect(vocab().evidence.join('\n')).toContain('it checks no Markdown file') // the config's files narrow the run
      run('npx cspell **/*.md')
      expect(vocab().evidence[0]).toContain("an unquoted glob is the shell's")
      // The option's value isn't a file: docs/, with only the accept list, isn't checked.
      write('docs/two.md', '# Two\n')
      cspell({ words: ['Zorwen'], overrides: [{ filename: 'book/**', flagWords: ['Denise'] }] })
      run('npx cspell --stop-config-search-at docs "book/**/*.md"')
      expect(vocab().status).toBe('pass')
      run('npx cspell --file book/one.md "**/*.md"')
      expect(vocab().status).toBe('skipped')
    })

    it("the repository's own checker: skipped until its lists are declared, then held to them", () => {
      write('tools/check_log.py', 'import pathlib\nfor p in pathlib.Path("rp-log").rglob("*.md"):\n    print(p)\n')
      run('python3 tools/check_log.py --diff origin/main')
      expect(vocab()).toMatchObject({ status: 'skipped', evidence: [expect.stringContaining('"vocabulary"')] })
      const vocabulary = { accept: ['tools/names.txt'], reject: ['tools/retired.txt'] }
      write('tools/names.txt', 'Maya\n')
      write('tools/retired.txt', 'Denise\n')
      expect(vocab({ vocabulary }).evidence[0]).toContain("isn't read by the checker")
      write('tools/check_log.py', 'import pathlib\nNAMES = "names.txt"\nRETIRED = "retired.txt"\nfor p in pathlib.Path("rp-log").rglob("*.md"):\n    print(p)\n')
      expect(vocab({ vocabulary })).toMatchObject({ status: 'pass', evidence: ['tools/names.txt: 1 accepted entry, read by tools/check_log.py', 'tools/retired.txt: 1 rejected entry, read by tools/check_log.py'] })
      // Read through a file the checker names (one hop).
      write('tools/check_log.py', 'import pathlib\nimport lists\nfor p in pathlib.Path("rp-log").rglob("*.md"):\n    print(p)\n')
      write('tools/lists.py', 'NAMES = "names.txt"\nRETIRED = "retired.txt"\n')
      expect(vocab({ vocabulary }).status).toBe('pass')
      expect(vocab({ vocabulary: { accept: ['./tools/names.txt'], reject: ['tools/retired.txt'] } }).status).toBe('pass')
      write('tools/retired.txt', '# nothing yet\n')
      expect(vocab({ vocabulary }).evidence[0]).toContain('has no entries')
      expect(vocab({ vocabulary: { accept: ['tools/gone.txt'] } }).evidence[0]).toContain("isn't in the repository")
      // A document that names a list isn't a reader of it.
      write('tools/retired.txt', 'Denise\n')
      write('tools/check_log.py', 'import pathlib\n# The rules are in CLAUDE.md.\nfor p in pathlib.Path("rp-log").rglob("*.md"):\n    print(p)\n')
      write('CLAUDE.md', 'Add retired names to tools/retired.txt and the cast to tools/names.txt.\n')
      expect(vocab({ vocabulary }).evidence[0]).toContain("isn't read by the checker")
    })

    it('both tools configured: the evidence names each', () => {
      ci('      - run: npx cspell "**/*.md"\n      - run: vale book\n')
      cspell({ words: ['Zorwen'], flagWords: ['Denise'] })
      vale(VALE)
      const out = vocab()
      expect(out.status).toBe('pass')
      expect(out.evidence.join('\n')).toMatch(/cspell[\s\S]*vale/)
    })

    it('the config takes a vocabulary only as lists of paths', () => {
      json('docs/standards/conformance.json', { vocabulary: { accept: 'tools/names.txt' } })
      expect(() => conform(root, { today: TODAY })).toThrow('"vocabulary" "accept" and "reject" must be lists')
      json('docs/standards/conformance.json', { vocabulary: { names: ['x'] } })
      expect(() => conform(root, { today: TODAY })).toThrow('"vocabulary" must be { "accept": [paths], "reject": [paths] }')
      json('docs/standards/conformance.json', { packs: ['writing'], vocabulary: { accept: ['tools/names.txt'], reject: ['tools/retired.txt'] } })
      write('tools/check_log.py', 'import pathlib\nNAMES = "names.txt"\nRETIRED = "retired.txt"\nfor p in pathlib.Path("rp-log").rglob("*.md"):\n    print(p)\n')
      write('tools/names.txt', 'Maya\n')
      write('tools/retired.txt', 'Denise\n')
      run('python3 tools/check_log.py --diff origin/main')
      expect(conform(root, { today: TODAY }).results.find((r) => r.id === 'writing.vocabulary-registered')).toMatchObject({ status: 'pass' })
    })
  })

  it("prose-checks-in-ci: a run that can't exit non-zero doesn't count", () => {
    write('.github/workflows/ci.yml', workflow('      - run: vale --no-exit docs\n'))
    expect(probe('writing.prose-checks-in-ci').status).toBe('fail')
    write('.github/workflows/ci.yml', workflow('      - uses: vale-cli/vale-action@v3\n'))
    expect(probe('writing.prose-checks-in-ci').status).toBe('fail') // fail_on_error defaults to false
    write('.github/workflows/ci.yml', workflow('      - uses: vale-cli/vale-action@v3\n        with:\n          fail_on_error: true\n'))
    expect(probe('writing.prose-checks-in-ci').status).toBe('pass')
  })

  // One fixture per input that turns an action's failure off: each must fail the standard.
  it.each([
    ['vale-action with fail_level none, which outranks fail_on_error', '      - uses: vale-cli/vale-action@v3\n        with:\n          fail_on_error: true\n          fail_level: none\n'],
    ['cspell-action with strict: false', '      - uses: streetsidesoftware/cspell-action@v7\n        with:\n          strict: false\n'],
  ])("prose-checks-in-ci: %s doesn't count", (_label, steps) => {
    write('.github/workflows/ci.yml', workflow(steps))
    expect(probe('writing.prose-checks-in-ci').status).toBe('fail')
  })

  it('prose-checks-in-ci: the cspell and markdownlint actions count by default, and vale with a fail_level', () => {
    for (const steps of [
      '      - uses: streetsidesoftware/cspell-action@v7\n',
      '      - uses: DavidAnson/markdownlint-cli2-action@v20\n',
      '      - uses: vale-cli/vale-action@v3\n        with:\n          fail_level: error\n',
    ]) {
      write('.github/workflows/ci.yml', workflow(steps))
      expect(probe('writing.prose-checks-in-ci').status, steps).toBe('pass')
    }
  })
})

describe('godot', () => {
  const project = (dir: string, features = '"4.5", "Forward Plus"') =>
    write(`${dir}/project.godot`, `config_version=5\n\n[application]\n\nconfig/name="Game"\nconfig/features=PackedStringArray(${features})\n`)

  it('tests-in-ci: GDScript suites or a .NET test project, run by a pull_request workflow', () => {
    project('game')
    expect(probe('godot.tests-in-ci', { path: 'game' }).evidence[0]).toContain('no tests under game')
    write('game/addons/gut/gut_cmdln.gd', 'extends SceneTree\n')
    write('game/test/test_combat.gd', 'extends GutTest\n\nfunc test_damage():\n\tassert_eq(1, 1)\n')
    expect(probe('godot.tests-in-ci', { path: 'game' }).evidence[0]).toContain('1 GDScript suite(s), 0 .NET test project(s), but no pull_request workflow runs them')
    write('.github/workflows/ci.yml', workflow('      - run: godot --headless -s addons/gut/gut_cmdln.gd -gexit\n        working-directory: game\n'))
    expect(probe('godot.tests-in-ci', { path: 'game' }).evidence[0]).toContain('exits 0 having run nothing') // no import first
    write('.github/workflows/ci.yml', workflow('      - run: |\n          godot --headless --import\n          godot --headless -s addons/gut/gut_cmdln.gd -gexit\n        working-directory: game\n'))
    expect(probe('godot.tests-in-ci', { path: 'game' }).status).toBe('pass')
  })

  it('tests-in-ci: the import has to run in the same job as GUT, by whatever name the engine has', () => {
    project('.')
    write('addons/gut/gut_cmdln.gd', 'extends SceneTree\n')
    write('test/test_x.gd', 'extends "res://addons/gut/test.gd"\n\nfunc test_x():\n\tassert_true(true)\n')
    const jobs = (exportRun: string, testRun: string) =>
      `on:\n  pull_request:\njobs:\n  export:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${exportRun}\n  test:\n    runs-on: ubuntu-latest\n    steps:\n${testRun}`
    write('.github/workflows/ci.yml', jobs('godot --headless --import', '      - run: godot -s addons/gut/gut_cmdln.gd -gexit\n'))
    expect(probe('godot.tests-in-ci').evidence[0]).toContain('in its job') // imported in another job
    write('.github/workflows/ci.yml', jobs('echo export', '      - run: ./Godot_v4.5-stable_linux.x86_64 --headless --import\n      - run: ./Godot_v4.5-stable_linux.x86_64 -s addons/gut/gut_cmdln.gd -gexit\n'))
    expect(probe('godot.tests-in-ci')).toMatchObject({ status: 'pass', evidence: [expect.stringContaining('1 GDScript suite(s)')] })
    write('.github/workflows/ci.yml', jobs('echo export', '      - run: |\n          "$GODOT" --headless --import\n          $GODOT -s addons/gut/gut_cmdln.gd -gexit\n'))
    expect(probe('godot.tests-in-ci').status).toBe('pass') // the engine in a variable
  })

  it('tests-in-ci: a C# project counts its .NET tests, run with dotnet test', () => {
    project('client', '"4.5", "C#"')
    write('client/Tests/Tests.csproj', '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="xunit" Version="2.9.3" /></ItemGroup></Project>\n')
    write('.github/workflows/ci.yml', workflow('      - run: dotnet test sim/Sim.Tests\n'))
    expect(probe('godot.tests-in-ci', { path: 'client' }).status).toBe('fail') // another directory's tests
    write('.github/workflows/ci.yml', workflow('      - run: dotnet test client/Tests\n'))
    expect(probe('godot.tests-in-ci', { path: 'client' }).status).toBe('pass')
  })

  it('engine-pinned: every version CI or the C# project names matches project.godot', () => {
    project('.')
    expect(probe('godot.engine-pinned').status).toBe('n/a')
    write('Game.csproj', '<Project Sdk="Godot.NET.Sdk/4.5.1"></Project>\n')
    expect(probe('godot.engine-pinned').status).toBe('pass')
    write('.github/workflows/ci.yml', workflow('      - uses: chickensoft-games/setup-godot@v2\n        with:\n          version: 4.3.0\n'))
    expect(probe('godot.engine-pinned').evidence).toEqual(['project.godot names 4.5; these name another version:', '.github/workflows/ci.yml (job check): 4.3.0'])
    write('.github/workflows/ci.yml', workflow("      - uses: godot-gdunit-labs/gdUnit4-action@v1\n        with:\n          godot-version: '4.4.1'\n          paths: res://test\n"))
    expect(probe('godot.engine-pinned').status).toBe('fail')
    write('.github/workflows/ci.yml', workflow('    container: barichello/godot-ci:mono-4.2.2\n'))
    expect(probe('godot.engine-pinned').evidence).toEqual(['project.godot names 4.5; these name another version:', '.github/workflows/ci.yml: 4.2.2'])
    project('.', '"Forward Plus"')
    expect(probe('godot.engine-pinned').evidence[0]).toContain('names no engine version')
  })
})

describe('expo', () => {
  const app = (config: object, dependencies: Record<string, string> = { expo: '~57.0.0', 'expo-updates': '~29.0.0' }) => {
    json('mobile/package.json', { name: 'mobile', dependencies })
    json('mobile/app.json', { expo: { name: 'App', slug: 'app', ...config } })
  }

  it('update-environment: every eas update names its environment, in workflows and scripts alike', () => {
    expect(probe('expo.update-environment').status).toBe('n/a')
    write('.github/workflows/update.yml', workflow('      - run: npx eas-cli@latest update --channel production --auto\n        working-directory: mobile\n', 'push:\n    branches: [main]'))
    expect(probe('expo.update-environment', { path: 'mobile' })).toMatchObject({
      status: 'fail',
      evidence: [expect.stringMatching(/^"npx eas-cli@latest update --channel production --auto" in \.github\/workflows\/update\.yml .* has no --environment/)],
    })
    write('.github/workflows/update.yml', workflow('      - run: npx eas update --channel production --environment production --auto\n', 'push:\n    branches: [main]'))
    expect(probe('expo.update-environment', { path: 'mobile' }).status).toBe('pass')
    json('mobile/package.json', { name: 'mobile', scripts: { 'update:preview': 'eas update --branch preview' } })
    expect(probe('expo.update-environment', { path: 'mobile' }).evidence).toEqual([expect.stringContaining('mobile/package.json script "update:preview" has no --environment')])
    // Every caller passes it through.
    write('.github/workflows/update.yml', workflow('      - run: npm run update:preview -- --environment preview\n        working-directory: mobile\n', 'push:\n    branches: [main]'))
    expect(probe('expo.update-environment', { path: 'mobile' }).status).toBe('pass')
    // npm keeps a flag before a lone `--` for itself: the script never gets it.
    write('.github/workflows/update.yml', workflow('      - run: npm run update:preview --environment preview\n        working-directory: mobile\n', 'push:\n    branches: [main]'))
    expect(probe('expo.update-environment', { path: 'mobile' }).status).toBe('fail')
    // A command that only mentions the script's name isn't a caller.
    json('mobile/package.json', { name: 'mobile', scripts: { update: 'eas update --auto' } })
    write('.github/workflows/update.yml', workflow('      - run: npx eas update --auto --environment production\n', 'push:\n    branches: [main]'))
    expect(probe('expo.update-environment', { path: 'mobile' }).evidence).toEqual([expect.stringContaining('script "update" has no --environment')])
  })

  it('runtime-version: a policy, for every platform; a hand-written string fails', () => {
    app({}, { expo: '~57.0.0' })
    expect(probe('expo.runtime-version', { path: 'mobile' }).status).toBe('n/a')
    app({})
    expect(probe('expo.runtime-version', { path: 'mobile' }).evidence[0]).toContain('sets no runtimeVersion')
    app({ runtimeVersion: '1.0.0' })
    expect(probe('expo.runtime-version', { path: 'mobile' }).evidence[0]).toBe('runtimeVersion is the string "1.0.0"')
    app({ runtimeVersion: { policy: 'appVersion' } })
    expect(probe('expo.runtime-version', { path: 'mobile' })).toMatchObject({ status: 'pass', evidence: ['runtimeVersion: policy appVersion'] })
    app({ ios: { runtimeVersion: { policy: 'fingerprint' } } })
    expect(probe('expo.runtime-version', { path: 'mobile' }).status).toBe('fail') // Android has none
    app({ ios: { runtimeVersion: { policy: 'fingerprint' } }, android: { runtimeVersion: '3' } })
    expect(probe('expo.runtime-version', { path: 'mobile' }).evidence[0]).toBe('android.runtimeVersion is the string "3"')
    app({ runtimeVersion: { policy: 'appversion' } })
    expect(probe('expo.runtime-version', { path: 'mobile' }).evidence[0]).toContain("runtimeVersion isn't one of Expo's policies")
  })

  it("runtime-version: app config written as code is skipped, and a broken app.json isn't read as empty", () => {
    json('package.json', { name: 'app', dependencies: { expo: '~57.0.0', 'expo-updates': '~29.0.0' } })
    write('app.config.ts', "export default { name: 'App', runtimeVersion: '1.0.0' }\n")
    expect(probe('expo.runtime-version').status).toBe('skipped')
    write('app.json', '{ "expo": { ')
    expect(probe('expo.runtime-version').evidence[0]).toBe("app.json isn't a JSON object")
  })

  it('client-env: runs check-env at the pack path', () => {
    write('mobile/.env.example', 'EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY=\n')
    expect(probe('expo.client-env', { path: 'mobile' }).status).toBe('fail')
    write('mobile/.env.example', 'EXPO_PUBLIC_API_URL=\n')
    expect(probe('expo.client-env', { path: 'mobile' }).status).toBe('pass')
  })

  it('doctor-in-ci: expo-doctor or expo install --check, for the app at the pack path, able to fail', () => {
    write('.github/workflows/ci.yml', workflow('      - run: npx expo-doctor\n        working-directory: mobile\n        continue-on-error: true\n'))
    expect(probe('expo.doctor-in-ci', { path: 'mobile' }).evidence).toEqual([
      'no pull_request workflow runs expo-doctor or expo install --check',
      expect.stringContaining("continue-on-error, which can't fail the run"),
    ])
    write('.github/workflows/ci.yml', workflow('      - run: CI=1 npx expo install --check\n        working-directory: mobile\n'))
    expect(probe('expo.doctor-in-ci', { path: 'mobile' }).status).toBe('pass')
    expect(probe('expo.doctor-in-ci', { path: 'web' }).status).toBe('fail') // another app's check
    // A scoped workspace name reaches the package's script, wherever the package lives.
    json('apps/phone/package.json', { name: '@acme/mobile', scripts: { doctor: 'expo-doctor' } })
    for (const run of ['pnpm --filter @acme/mobile run doctor', 'pnpm --filter=@acme/mobile run doctor', 'npm --workspace=@acme/mobile run doctor']) {
      write('.github/workflows/ci.yml', workflow(`      - run: ${run}\n`))
      expect(probe('expo.doctor-in-ci', { path: 'apps/phone' }).status, run).toBe('pass')
    }
  })
})

describe('tauri', () => {
  const conf = (config: object, dir = 'src-tauri') => json(`${dir}/tauri.conf.json`, { productName: 'App', identifier: 'com.example.app', ...config })
  const security = (s: object) => conf({ app: { security: s } })
  const capability = (name: string, c: object) => json(`src-tauri/capabilities/${name}.json`, { identifier: name, windows: ['main'], permissions: ['core:default'], ...c })
  // Fixture keys, built here so no key-shaped text sits in the source: the shape is what's checked.
  const PUBKEY = Buffer.from('untrusted comment: minisign public key: 0123456789ABCDEF\nRWQBI0VniavN7wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n').toString('base64')
  const SECRET = Buffer.from('untrusted comment: rsign encrypted secret key\nRWRTY0IyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n').toString('base64')

  it('capabilities-scoped: reads capabilities in TOML and JSON5 too', () => {
    conf({})
    write('src-tauri/capabilities/default.toml', 'identifier = "default"\nwindows = ["*"]\npermissions = ["shell:allow-execute"]\n')
    expect(probe('tauri.capabilities-scoped').evidence[0]).toBe('src-tauri/capabilities/default.toml: every window ("*") gets shell:allow-execute')
    rmSync(join(root, 'src-tauri/capabilities/default.toml'))
    write('src-tauri/capabilities/main.json5', "{\n  // the main window\n  identifier: 'main',\n  windows: ['main'],\n  permissions: ['fs:scope-home-recursive'],\n}\n")
    expect(probe('tauri.capabilities-scoped').evidence[0]).toBe('src-tauri/capabilities/main.json5: fs:scope-home-recursive')
  })

  it('reads a Tauri 2 config in JSON, JSON5, or TOML, and says what it can\'t read', () => {
    expect(probe('tauri.csp').evidence[0]).toContain('no tauri.conf.json, tauri.conf.json5, or Tauri.toml in src-tauri/ or ./')
    // TOML may spell a key in kebab-case.
    write('src-tauri/Tauri.toml', '[app.security]\ncsp = "default-src \'self\'"\ndangerous-disable-asset-csp-modification = true\n')
    expect(probe('tauri.csp').evidence).toEqual([expect.stringContaining('src-tauri/Tauri.toml: dangerousDisableAssetCspModification')])
    write('src-tauri/Tauri.toml', '[app.security]\ncsp = "default-src \'self\'"\n')
    expect(probe('tauri.csp').status).toBe('pass')
    write('src-tauri/Tauri.toml', '[app.security\ncsp = ')
    expect(probe('tauri.csp').evidence[0]).toBe("src-tauri/Tauri.toml isn't a valid config object")
    rmSync(join(root, 'src-tauri/Tauri.toml'))
    write('src-tauri/tauri.conf.json5', "{\n  // JSON5: comments, unquoted keys\n  app: { security: { csp: null } },\n}\n")
    expect(probe('tauri.csp').evidence[0]).toContain('src-tauri/tauri.conf.json5 sets no app.security.csp')
    conf({ tauri: { security: { csp: null } } })
    expect(probe('tauri.csp').evidence[0]).toContain('a Tauri 1 config')
    write('src-tauri/tauri.conf.json', '{ "app": ')
    expect(probe('tauri.csp').evidence[0]).toBe("src-tauri/tauri.conf.json isn't a valid config object")
  })

  it('csp: set, restricting scripts, without unsafe-eval or the asset modification turned off', () => {
    security({ csp: null })
    expect(probe('tauri.csp').evidence[0]).toContain('sets no app.security.csp')
    security({ csp: "img-src 'self'" })
    expect(probe('tauri.csp').evidence[0]).toContain('neither script-src nor default-src')
    security({ csp: "default-src 'self'; script-src 'self' 'unsafe-eval'" })
    expect(probe('tauri.csp').evidence).toEqual(["src-tauri/tauri.conf.json: script-src allows 'unsafe-eval'"])
    security({ csp: { 'default-src': "'self'", 'script-src': ["'self'", "'wasm-unsafe-eval'"] } })
    expect(probe('tauri.csp').status).toBe('pass')
    security({ csp: "default-src 'self'", dangerousDisableAssetCspModification: ['script-src'] })
    expect(probe('tauri.csp').evidence[0]).toContain('dangerousDisableAssetCspModification')
  })

  it('capabilities-scoped: no home-wide, root-wide, remote, interpreter, or every-window grants', () => {
    conf({ app: { security: { csp: "default-src 'self'" } } })
    expect(probe('tauri.capabilities-scoped').status).toBe('n/a')
    capability('default', { permissions: ['core:default', 'fs:default', { identifier: 'fs:allow-read-file', allow: [{ path: '$APPDATA/**' }] }] })
    expect(probe('tauri.capabilities-scoped')).toMatchObject({ status: 'pass', evidence: ['1 capability(s), none broad'] })
    const cases: [object, string][] = [
      [{ permissions: ['fs:scope-home-recursive'] }, 'fs:scope-home-recursive'],
      [{ permissions: [{ identifier: 'fs:allow-read-file', allow: [{ path: '$HOME/**' }] }] }, 'fs:allow-read-file allows $HOME/**'],
      [{ permissions: [{ identifier: 'shell:allow-execute', allow: [{ name: 'run', cmd: '/bin/bash', args: ['-c', { validator: '.+' }] }] }] }, 'allows the interpreter /bin/bash'],
      [{ permissions: [{ identifier: 'shell:allow-execute', allow: [{ name: 'git', cmd: 'git', args: true }] }] }, 'allows git with any arguments'],
      [{ windows: ['*'], permissions: ['fs:allow-write-text-file'] }, 'every window ("*") gets fs:allow-write-text-file'],
      [{ remote: { urls: ['https://*.example.com'] } }, 'remote URLs (https://*.example.com)'],
      [{ permissions: [{ identifier: 'fs:scope', allow: ['/**'] }] }, 'fs:scope allows /**'], // a scope entry as a plain path
    ]
    for (const [c, finding] of cases) {
      capability('extra', c)
      expect(probe('tauri.capabilities-scoped')).toMatchObject({ status: 'fail', evidence: [expect.stringContaining(finding)] })
    }
    capability('extra', { windows: ['*'], permissions: ['fs:default'] }) // read-only, app-scoped: fine everywhere
    expect(probe('tauri.capabilities-scoped').status).toBe('pass')
    // A file can hold a list of capabilities, or { capabilities: [...] }: each is read.
    json('src-tauri/capabilities/extra.json', { capabilities: [{ identifier: 'a', windows: ['main'], permissions: ['core:default'] }, { identifier: 'b', windows: ['*'], permissions: ['shell:allow-execute'] }] })
    expect(probe('tauri.capabilities-scoped').evidence[0]).toBe('src-tauri/capabilities/extra.json [1]: every window ("*") gets shell:allow-execute')
    json('src-tauri/capabilities/extra.json', [{ identifier: 'a', windows: ['main'], permissions: ['core:default'] }])
    expect(probe('tauri.capabilities-scoped').status).toBe('pass')
    capability('extra', { permissions: ['fs:scope-home-recursive'] }) // one capability: named by its file alone
    expect(probe('tauri.capabilities-scoped').evidence[0]).toBe('src-tauri/capabilities/extra.json: fs:scope-home-recursive')
    write('src-tauri/capabilities/nested/broken.json', '{')
    expect(probe('tauri.capabilities-scoped').evidence[0]).toBe('src-tauri/capabilities/nested/broken.json isn\'t a capability, a list of them, or { "capabilities": [...] }')
  })

  it('updater-key: a minisign public key, HTTPS, and the private key only in secrets', () => {
    const updater = (u: object) => conf({ plugins: { updater: { pubkey: PUBKEY, endpoints: ['https://releases.example.com/{{target}}/{{current_version}}'], ...u } } })
    conf({})
    expect(probe('tauri.updater-key').status).toBe('n/a')
    updater({})
    expect(probe('tauri.updater-key').status).toBe('pass')
    updater({ pubkey: 'replace-me', endpoints: ['http://releases.example.com/latest.json'] })
    expect(probe('tauri.updater-key').evidence).toEqual([
      "src-tauri/tauri.conf.json: plugins.updater.pubkey isn't a minisign public key (tauri signer generate makes one)",
      "src-tauri/tauri.conf.json: update endpoint http://releases.example.com/latest.json isn't HTTPS",
    ])
    updater({})
    write('src-tauri/keys/app.key', `${SECRET}\n`)
    expect(probe('tauri.updater-key').evidence).toEqual([expect.stringMatching(/^src-tauri\/keys\/app\.key holds the updater's private signing key/)])
    write('src-tauri/keys/app.key', `${SECRET.match(/.{1,76}/g)?.join('\n')}\n`) // wrapped, as base64(1) writes it
    expect(probe('tauri.updater-key').evidence).toEqual([expect.stringMatching(/^src-tauri\/keys\/app\.key holds/)])
    rmSync(join(root, 'src-tauri/keys'), { recursive: true })
    // Naming the header isn't holding a key: a fork of this template keeps the probe that does.
    write('scripts/scan.mjs', "const header = 'untrusted comment: rsign encrypted secret key'\n")
    expect(probe('tauri.updater-key').status).toBe('pass')
    const release = (value: string) => write('.github/workflows/release.yml', workflow(`      - run: npm run tauri build\n        env:\n          TAURI_SIGNING_PRIVATE_KEY: ${value}\n`, 'push:\n    tags: ["v*"]'))
    release('${{ vars.TAURI_KEY }}')
    expect(probe('tauri.updater-key').evidence).toEqual(['.github/workflows/release.yml sets TAURI_SIGNING_PRIVATE_KEY from something other than a secret'])
    release('${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}')
    expect(probe('tauri.updater-key').status).toBe('pass')
  })

  it("rust-gates-in-ci: gates count for the app's crate, or the Cargo workspace it's a member of", () => {
    conf({})
    const gates = (dir: string) => workflow(`      - run: cargo fmt --check && cargo clippy -- -D warnings && cargo test\n        working-directory: ${dir}\n`)
    write('server/Cargo.toml', '[package]\nname = "server"\n')
    write('.github/workflows/ci.yml', gates('server'))
    expect(probe('tauri.rust-gates-in-ci').status).toBe('fail') // another crate's gates
    write('.github/workflows/ci.yml', gates('src-tauri'))
    expect(probe('tauri.rust-gates-in-ci').status).toBe('pass')
    write('.github/workflows/ci.yml', gates('.'))
    expect(probe('tauri.rust-gates-in-ci').status).toBe('fail') // the root isn't a workspace yet
    write('Cargo.toml', '[workspace]\nmembers = ["src-tauri", "server"]\n')
    expect(probe('tauri.rust-gates-in-ci').status).toBe('pass')
    write('.github/workflows/ci.yml', workflow('      - run: cargo fmt --check --manifest-path src-tauri/Cargo.toml && cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings && cargo test --manifest-path src-tauri/Cargo.toml\n'))
    expect(probe('tauri.rust-gates-in-ci').status).toBe('pass') // named by path
    const fromServer = (manifest: string) =>
      workflow(`      - run: cargo fmt --check --manifest-path ${manifest} && cargo clippy --manifest-path ${manifest} -- -D warnings && cargo test --manifest-path ${manifest}\n        working-directory: server\n`)
    write('.github/workflows/ci.yml', fromServer('../src-tauri/Cargo.toml'))
    expect(probe('tauri.rust-gates-in-ci').status).toBe('pass') // a path relative to where it runs
    write('.github/workflows/ci.yml', fromServer('Cargo.toml'))
    expect(probe('tauri.rust-gates-in-ci').status).toBe('fail') // server's own manifest
  })

  it("rust-gates-in-ci: from a workspace root, only where Cargo would check the app's crate", () => {
    conf({})
    write('src-tauri/Cargo.toml', '[package]\nname = "app"\n')
    const atRoot = (flags = '') => workflow(`      - run: cargo fmt --check ${flags} && cargo clippy ${flags} -- -D warnings && cargo test ${flags}\n`)
    // The checkout's root named through the workspace variable, as a working directory or a cd.
    write('Cargo.toml', '[workspace]\nmembers = ["src-tauri"]\n')
    for (const step of ['        working-directory: ${{ github.workspace }}/src-tauri\n', '        working-directory: ${{ github.workspace }}\n']) {
      write('.github/workflows/ci.yml', workflow(`      - run: cargo fmt --check && cargo clippy -- -D warnings && cargo test\n${step}`))
      expect(probe('tauri.rust-gates-in-ci').status, step).toBe('pass')
    }
    write('.github/workflows/ci.yml', workflow('      - run: cd "$GITHUB_WORKSPACE/src-tauri" && cargo fmt --check && cargo clippy -- -D warnings && cargo test\n'))
    expect(probe('tauri.rust-gates-in-ci').status).toBe('pass')
    write('Cargo.toml', '[package]\nname = "root"\n\n[workspace]\nmembers = ["src-tauri"]\n')
    // cargo fmt at a root package: every member from the root with no package named and no manifest
    // given (or with --all); only what it's pointed at otherwise.
    const fmtOnly = (args: string) => workflow(`      - run: cargo fmt --check ${args} && cargo clippy --workspace -- -D warnings && cargo test --workspace\n`)
    for (const [args, status] of [['', 'pass'], ['--all', 'pass'], ['-p server', 'fail'], ['-p app', 'pass'], ['--manifest-path Cargo.toml', 'fail']]) {
      write('.github/workflows/ci.yml', fmtOnly(args))
      expect(probe('tauri.rust-gates-in-ci').status, args).toBe(status)
    }
    // At a root package, cargo fmt still formats every member; clippy and test take only the root.
    write('.github/workflows/ci.yml', atRoot())
    expect(probe('tauri.rust-gates-in-ci').evidence).toEqual([
      'no pull_request workflow runs cargo clippy with warnings denied',
      'no pull_request workflow runs cargo test',
      'cargo fmt --check: .github/workflows/ci.yml (job check) step "step 2"',
    ])
    write('.github/workflows/ci.yml', atRoot())
    expect(probe('tauri.rust-gates-in-ci').status).toBe('fail') // a root package: Cargo checks only it
    write('.github/workflows/ci.yml', atRoot('--all-targets --all-features'))
    expect(probe('tauri.rust-gates-in-ci').status).toBe('fail') // --all-targets isn't --all
    write('.github/workflows/ci.yml', atRoot('--workspace'))
    expect(probe('tauri.rust-gates-in-ci').status).toBe('pass')
    write('.github/workflows/ci.yml', atRoot('-p app'))
    expect(probe('tauri.rust-gates-in-ci').status).toBe('pass')
    write('.github/workflows/ci.yml', atRoot('-p app@0.1.0'))
    expect(probe('tauri.rust-gates-in-ci').status).toBe('pass')
    write('Cargo.toml', '[package]\nname = "root"\n\n[workspace]\nmembers = ["src-tauri"]\ndefault-members = ["src-tauri"]\n')
    write('.github/workflows/ci.yml', atRoot())
    expect(probe('tauri.rust-gates-in-ci').status).toBe('pass') // default-members applies with a root package too
    write('Cargo.toml', '[workspace]\nmembers = ["src-tauri"]\n')
    write('.github/workflows/ci.yml', workflow('      - run: cd "$OTHER" && cargo fmt --check && cargo clippy -- -D warnings && cargo test\n'))
    expect(probe('tauri.rust-gates-in-ci').status).toBe('fail') // run from somewhere it can't know
    const viaManifest = (path: string) =>
      workflow(`      - run: cargo fmt --check --manifest-path ${path} && cargo clippy --manifest-path ${path} -- -D warnings && cargo test --manifest-path ${path}\n`)
    for (const path of ['${{ github.workspace }}/src-tauri/Cargo.toml', '"$GITHUB_WORKSPACE/src-tauri/Cargo.toml"']) {
      write('.github/workflows/ci.yml', viaManifest(path))
      expect(probe('tauri.rust-gates-in-ci').status, path).toBe('pass')
    }
    // The workspace's own manifest: clippy and test take the default members, but cargo fmt pointed at
    // a virtual manifest finds no targets.
    write('.github/workflows/ci.yml', viaManifest('Cargo.toml'))
    expect(probe('tauri.rust-gates-in-ci').evidence[0]).toBe('no pull_request workflow runs cargo fmt --check')
    // In PowerShell the variable is $env:GITHUB_WORKSPACE: $GITHUB_WORKSPACE is empty.
    write('.github/workflows/ci.yml', workflow('      - run: cargo fmt --check --manifest-path $GITHUB_WORKSPACE/src-tauri/Cargo.toml\n        shell: pwsh\n'))
    expect(probe('tauri.rust-gates-in-ci').evidence).toContain('no pull_request workflow runs cargo fmt --check')
    // working-directory isn't a shell: Actions evaluates the expression, but not the variable.
    write('.github/workflows/ci.yml', workflow('      - run: cargo fmt --check && cargo clippy -- -D warnings && cargo test\n        working-directory: $GITHUB_WORKSPACE/src-tauri\n'))
    expect(probe('tauri.rust-gates-in-ci').status).toBe('fail')
    write('.github/workflows/ci.yml', workflow('      - run: cd src-tauri && cd "$GITHUB_WORKSPACE"/other && cargo fmt --check && cargo clippy -- -D warnings && cargo test\n'))
    expect(probe('tauri.rust-gates-in-ci').status).toBe('fail') // a cd it can't read leaves the directory unknown
    write('.github/workflows/ci.yml', workflow('      - run: cd ${{ github.workspace }}/src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test\n'))
    expect(probe('tauri.rust-gates-in-ci').status).toBe('pass')
    write('.github/workflows/ci.yml', workflow('      - run: cargo fmt --check --manifest-path /src-tauri/Cargo.toml && cargo clippy --manifest-path /src-tauri/Cargo.toml -- -D warnings && cargo test --manifest-path /src-tauri/Cargo.toml\n'))
    expect(probe('tauri.rust-gates-in-ci').status).toBe('fail') // an absolute path is another machine's
    write('Cargo.toml', '[package]\nname = "root"\n\n[workspace]\nmembers = ["src-tauri"]\n')
    write('.github/workflows/ci.yml', atRoot())
    write('Cargo.toml', '[workspace]\nmembers = ["src-tauri", "server"]\ndefault-members = ["server"]\n')
    expect(probe('tauri.rust-gates-in-ci').status).toBe('fail') // not a default member
    write('Cargo.toml', '[workspace]\nmembers = ["*"]\nexclude = ["src-tauri"]\n')
    expect(probe('tauri.rust-gates-in-ci').status).toBe('fail') // excluded
    write('Cargo.toml', '[workspace]\nmembers = ["*"]\n')
    expect(probe('tauri.rust-gates-in-ci').status).toBe('pass')
  })

  it('rust-gates-in-ci: clippy denying warnings, fmt --check, and cargo test, on pull requests', () => {
    write('.github/workflows/ci.yml', workflow('      - run: cargo clippy --all-targets\n        working-directory: src-tauri\n'))
    expect(probe('tauri.rust-gates-in-ci').evidence).toEqual([
      expect.stringContaining("isn't cargo clippy with warnings denied"),
      'no pull_request workflow runs cargo fmt --check',
      'no pull_request workflow runs cargo test',
    ])
    write('.github/workflows/ci.yml', `env:\n  RUSTFLAGS: -Dwarnings\n${workflow('      - run: |\n          cargo fmt --all -- --check\n          cargo clippy --all-targets\n          cargo test\n        working-directory: src-tauri\n')}`)
    expect(probe('tauri.rust-gates-in-ci').status).toBe('pass')
    write('.github/workflows/ci.yml', workflow('      - run: cargo fmt --all -- --check && cargo clippy -- -D warnings\n      - run: cargo test\n        continue-on-error: true\n'))
    expect(probe('tauri.rust-gates-in-ci').evidence.slice(0, 2)).toEqual(['no pull_request workflow runs cargo test', expect.stringContaining("which can't fail the run")])
    write('.github/workflows/ci.yml', workflow('      - run: cargo fmt --check && cargo clippy -- -D warnings && cargo test --no-run\n'))
    expect(probe('tauri.rust-gates-in-ci').evidence[0]).toContain("isn't cargo test") // builds the tests, runs none
  })

  it('rust-gates-in-ci: a script that finds the crate from its own directory or the root', () => {
    conf({})
    write('src-tauri/Cargo.toml', '[package]\nname = "app"\n')
    write('.github/workflows/ci.yml', workflow('      - run: bash scripts/ci/rust.sh\n'))
    for (const [cd, status] of [
      ['cd "$(dirname "$0")/../../src-tauri"', 'pass'],
      ['cd "$(dirname "${BASH_SOURCE[0]}")"/../../src-tauri', 'pass'],
      ['cd "$(git rev-parse --show-toplevel)/src-tauri"', 'pass'],
      ['ROOT="$(cd "$(dirname "$0")/../.." && pwd)"\ncd "$ROOT/src-tauri"', 'pass'],
      ['cd src-tauri\ncd -\ncd -', 'pass'],
      ['cd "$(dirname "$0")/.."', 'fail'],
      ['cd -', 'fail'],
    ]) {
      write('scripts/ci/rust.sh', `#!/usr/bin/env bash\nset -e\n${cd}\ncargo fmt --check\ncargo clippy -- -D warnings\ncargo test\n`)
      expect(probe('tauri.rust-gates-in-ci').status, cd).toBe(status)
    }
    // In a workflow step, $0 is a script Actions wrote outside the checkout.
    write('.github/workflows/ci.yml', workflow('      - run: cd "$(dirname "$0")/src-tauri" && cargo fmt --check && cargo clippy -- -D warnings && cargo test\n'))
    expect(probe('tauri.rust-gates-in-ci').status).toBe('fail')
  })

  it('supply-chain: cargo audit at a workspace root reads the lock file every member shares', () => {
    conf({})
    write('src-tauri/Cargo.toml', '[package]\nname = "app"\n')
    write('Cargo.toml', '[package]\nname = "root"\n\n[workspace]\nmembers = ["src-tauri"]\n')
    write('.github/workflows/ci.yml', workflow('      - run: cargo audit\n'))
    expect(probe('tauri.supply-chain').status).toBe('pass')
    write('.github/workflows/ci.yml', workflow('      - run: cargo deny check\n'))
    expect(probe('tauri.supply-chain').status).toBe('fail') // deny takes only the root package here
    write('.github/workflows/ci.yml', workflow('      - run: cargo deny -p app check\n'))
    expect(probe('tauri.supply-chain').status).toBe('fail') // cargo-deny has no -p
    write('.github/workflows/ci.yml', workflow('      - run: cargo deny --workspace check\n'))
    expect(probe('tauri.supply-chain').status).toBe('pass')
    // The action reads ./Cargo.toml by default: the same reach as the command.
    write('.github/workflows/ci.yml', workflow('      - uses: EmbarkStudios/cargo-deny-action@v2\n'))
    expect(probe('tauri.supply-chain').evidence[0]).toContain("checks a manifest that doesn't reach the app's crate")
    write('.github/workflows/ci.yml', workflow('      - uses: EmbarkStudios/cargo-deny-action@v2\n        with:\n          arguments: --workspace --all-features\n'))
    expect(probe('tauri.supply-chain').status).toBe('pass')
    write('Cargo.toml', '[workspace]\nmembers = ["src-tauri", "server"]\ndefault-members = ["server"]\n')
    write('.github/workflows/ci.yml', workflow('      - run: cargo deny check\n'))
    expect(probe('tauri.supply-chain').status).toBe('pass') // a virtual manifest: deny takes every member
    write('.github/workflows/ci.yml', workflow('      - run: cargo deny --exclude app check\n'))
    expect(probe('tauri.supply-chain').status).toBe('fail')
  })

  it('supply-chain: cargo deny or cargo audit, with the action pointed at the real manifest', () => {
    write('src-tauri/Cargo.toml', '[package]\nname = "app"\n')
    expect(probe('tauri.supply-chain').status).toBe('fail')
    write('.github/workflows/deny.yml', workflow('      - uses: EmbarkStudios/cargo-deny-action@v2\n'))
    expect(probe('tauri.supply-chain').evidence[0]).toContain("reads a manifest-path that isn't in the repository")
    write('.github/workflows/deny.yml', workflow('      - uses: EmbarkStudios/cargo-deny-action@v2\n        with:\n          manifest-path: ./src-tauri/Cargo.toml\n'))
    expect(probe('tauri.supply-chain').status).toBe('pass')
    write('.github/workflows/deny.yml', workflow('      - run: cargo audit\n        working-directory: src-tauri\n', 'schedule:\n    - cron: "0 6 * * 1"'))
    expect(probe('tauri.supply-chain').status).toBe('pass')
    write('.github/workflows/deny.yml', workflow('      - run: cargo deny check licenses bans\n'))
    expect(probe('tauri.supply-chain').status).toBe('fail') // no advisories
    write('.github/workflows/deny.yml', workflow('      - uses: EmbarkStudios/cargo-deny-action@v2\n        with:\n          manifest-path: src-tauri/Cargo.toml\n          command: check licenses\n'))
    expect(probe('tauri.supply-chain').evidence).toEqual([expect.stringContaining('runs `cargo deny check licenses`, which leaves out the advisories check')])
    write('.github/workflows/deny.yml', workflow('      - run: cargo deny --all-features check advisories\n'))
    expect(probe('tauri.supply-chain').status).toBe('pass')
    write('.github/workflows/deny.yml', workflow('      - run: cargo deny check || true\n'))
    expect(probe('tauri.supply-chain').evidence).toEqual(['no workflow on pull requests or a schedule runs cargo deny or cargo audit', expect.stringContaining("which can't fail the run")])
  })
})

describe('python', () => {
  it('locked-dependencies: pinned requirements, or a lockfile', () => {
    expect(probe('python.locked-dependencies').status).toBe('n/a')
    write('engine/requirements.txt', '# deps\nnumpy>=1.23\nrequests==2.32.3\n-r base.txt\n')
    expect(probe('python.locked-dependencies')).toMatchObject({ status: 'fail', evidence: ['engine/requirements.txt: 1 of 2 requirement(s) not pinned with ==: numpy>=1.23'] })
    write('engine/requirements.txt', 'numpy==1.26.4\n')
    expect(probe('python.locked-dependencies').status).toBe('pass')
    write('pyproject.toml', '[project]\nname = "tool"\ndependencies = [\n  "httpx>=0.27",\n]\n')
    expect(probe('python.locked-dependencies').evidence[0]).toContain("there's no lockfile")
    write('uv.lock', 'version = 1\n')
    expect(probe('python.locked-dependencies').status).toBe('pass')
  })

  it('audit-gate: an audit on pull requests and on a schedule, able to fail', () => {
    write('tool.py', 'print(1)\n')
    write('requirements.txt', '# none yet\n')
    expect(probe('python.audit-gate').status).toBe('n/a')
    write('requirements.txt', 'requests==2.32.3\n')
    write('.github/workflows/ci.yml', workflow('      - run: pip install -r requirements.txt pip-audit\n', 'pull_request:'))
    expect(probe('python.audit-gate')).toMatchObject({
      status: 'fail',
      evidence: ['no Python dependency audit in a pull_request workflow step that can fail', 'no Python dependency audit in a workflow with a schedule trigger'],
    })
    write('.github/workflows/ci.yml', workflow('      - run: python -m pip_audit -r requirements.txt || true\n'))
    expect(probe('python.audit-gate').evidence[1]).toContain("which can't fail the run")
    write('.github/workflows/ci.yml', workflow('      - run: uvx pip-audit -r requirements.txt\n', 'pull_request:'))
    expect(probe('python.audit-gate')).toMatchObject({ status: 'fail', evidence: ['no Python dependency audit in a workflow with a schedule trigger', expect.stringContaining('on pull requests: uvx pip-audit')] })
    write('.github/workflows/audit.yml', 'on:\n  schedule:\n    - cron: "0 6 * * 1"\njobs:\n  scan:\n    uses: google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml@v2.3.0\n')
    expect(probe('python.audit-gate')).toMatchObject({ status: 'pass', evidence: [expect.stringContaining('on pull requests'), 'on a schedule: google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml@v2.3.0 in .github/workflows/audit.yml (job scan)'] })
    write('.github/workflows/audit.yml', 'on:\n  schedule:\n    - cron: "0 6 * * 1"\njobs:\n  scan:\n    runs-on: ubuntu-latest\n    continue-on-error: true\n    steps:\n      - uses: pypa/gh-action-pip-audit@v1\n')
    expect(probe('python.audit-gate').status).toBe('fail')
    write('.github/workflows/audit.yml', 'on:\n  schedule:\n    - cron: "0 6 * * 1"\njobs:\n  scan:\n    if: false\n    uses: google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml@v2.3.0\n')
    expect(probe('python.audit-gate').status).toBe('fail') // a called workflow can't continue on error, but it can never run
    write('.github/workflows/audit.yml', 'on:\n  schedule:\n    - cron: "0 6 * * 1"\njobs:\n  scan:\n    uses: google/osv-scanner-action/.github/workflows/osv-scanner-reusable.yml@v2.3.0\n    with:\n      fail-on-vuln: false\n')
    expect(probe('python.audit-gate').status).toBe('fail') // reports, never fails
    write('.github/workflows/audit.yml', 'on:\n  schedule:\n    - cron: "0 6 * * 1"\njobs:\n  scan:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: pypa/gh-action-pip-audit@v1\n        with:\n          internal-be-careful-allow-failure: true\n')
    expect(probe('python.audit-gate').status).toBe('fail')
  })

  it('audit-gate: applies to requirements split across files, and not to a project that needs only Python', () => {
    write('requirements.txt', '-r requirements/prod.txt\n')
    write('requirements/prod.txt', 'django==5.0\n')
    expect(probe('python.audit-gate').status).toBe('fail')
    rmSync(join(root, 'requirements.txt'))
    rmSync(join(root, 'requirements'), { recursive: true })
    write('pyproject.toml', '[tool.poetry.dependencies]\npython = "^3.12"\n')
    expect(probe('python.audit-gate').status).toBe('n/a')
    write('pyproject.toml', '[tool.poetry.dependencies\nhttpx = ')
    expect(probe('python.audit-gate').status).toBe('fail') // unreadable can't be shown to need nothing
    write('pyproject.toml', '[tool.poetry.dependencies]\n# see [docs]\npython = "^3.12"\nhttpx = "^0.27"\n')
    expect(probe('python.audit-gate').status).toBe('fail')
  })

  it('tests-in-ci: tests that a pull_request workflow runs', () => {
    write('tool.py', 'print(1)\n')
    expect(probe('python.tests-in-ci').status).toBe('fail')
    write('tests/test_tool.py', 'def test_x():\n    assert True\n')
    write('.github/workflows/ci.yml', workflow('      - run: pip install -r requirements.txt pytest pytest-cov\n'))
    expect(probe('python.tests-in-ci')).toMatchObject({ status: 'fail', evidence: ["1 test file(s), but no pull_request workflow runs them"] })
    write('.github/workflows/ci.yml', workflow('      - run: python -m unittest discover tests\n'))
    expect(probe('python.tests-in-ci').status).toBe('pass')
  })
})

describe('a run', { timeout: 60_000 }, () => {
  it('detects packs from their markers', () => {
    goodNode()
    write('supabase/config.toml', 'project_id = "x"\n')
    write('tool.py', 'print(1)\n')
    const card = conform(root, { today: TODAY })
    expect(card.packs.map((p) => p.pack)).toEqual(['core', 'node', 'python', 'supabase', 'vite-spa'])
    expect(card.packSource).toBe('detected')
  })

  it.each(['_vale.ini', 'vale.ini', '.cspell.yaml', 'cspell.yml', '.cspell.jsonc', 'cSpell.json', '.cspell.config.json', '.config/cspell.json', '.config/cSpell.json', '.vscode/cspell.json', '.textlintrc', '.textlintrc.json'])(
    'detects the writing pack from %s',
    (file) => {
      write(file, '{}\n')
      expect(conform(root, { today: TODAY }).packs.map((p) => p.pack)).toEqual(['core', 'writing'])
    },
  )

  it('takes declared packs instead, keys a pack below the root by its path, and reports what it left out', () => {
    goodNode()
    mkdirSync(join(root, 'web'))
    json('docs/standards/conformance.json', { packs: [{ pack: 'node', path: 'web' }] })
    const card = conform(root, { today: TODAY })
    expect(card.packs).toEqual([
      { pack: 'core', path: '.' },
      { pack: 'node', path: 'web' },
    ])
    expect(card.undeclared).toEqual(['vite-spa'])
    expect(card.results.find((r) => r.key === 'node.strict-types@web')).toMatchObject({ status: 'fail', path: 'web' })
  })

  it("names a scored pack whose standards a repository that took the process doesn't carry", () => {
    goodNode()
    expect(conform(root, { today: TODAY }).undelivered).toEqual([]) // no manifest: the process isn't there to carry them
    json('prompts/.apply-manifest.json', { files: {} })
    const card = conform(root, { today: TODAY })
    expect(card.undelivered).toEqual(['node', 'vite-spa'])
    expect(formatCard(card)).toContain("Scored pack(s) whose standards this repository doesn't carry: node, vite-spa. Deliver them with the template's process:apply -- --target <this repository> --pack node --pack vite-spa")
    write('prompts/standards/node/strict-types.md', 'delivered\n')
    expect(conform(root, { today: TODAY }).undelivered).toEqual(['vite-spa'])
  })

  it.each([
    [['nope'], 'no pack "nope"'],
    [['node@missing'], 'isn\'t a directory in the repository'],
    [['node@../outside'], 'isn\'t a directory in the repository'],
    [[{ pack: 'node', path: 5 }], '"path" must be a non-empty string'],
    [[{ pack: 'node', pth: 'web' }], 'a pack takes only "pack" and "path"'],
  ])('refuses --pack %j', (packs, message) => {
    expect(() => conform(root, { packs: packs as never, today: TODAY })).toThrow(message)
  })

  it('lists audit standards without scoring them, and exits 1 on a failure', () => {
    const card = conform(root, { today: TODAY })
    expect(card.results.find((r) => r.id === 'core.error-reporting')).toMatchObject({ status: 'audit', evidence: [] })
    expect(card.exitCode).toBe(1)
  })
})

describe('waivers and the baseline', { timeout: 60_000 }, () => {
  const config = (value: object) => json('docs/standards/conformance.json', value)
  const waiver = (standard: string, expires = '2026-11-01') => ({
    standard,
    reason: 'Reports go to the account-wide policy in the public .github repository.',
    owner: 'maintainer',
    expires,
  })
  const keyed = (card: ReturnType<typeof conform>, key: string) => card.results.find((r) => r.key === key)

  it('a current waiver covers a failure', () => {
    config({ waivers: [waiver('core.security-policy')] })
    const card = conform(root, { today: TODAY })
    expect(keyed(card, 'core.security-policy')).toMatchObject({ status: 'waived', waiver: { owner: 'maintainer', expires: '2026-11-01' } })
    expect(card.problems).toEqual([])
  })

  it('an expired waiver covers nothing, and a stale one fails the run', () => {
    config({ waivers: [waiver('core.security-policy', '2026-10-01')] })
    let card = conform(root, { today: TODAY })
    expect(keyed(card, 'core.security-policy')?.status).toBe('fail')
    expect(card.problems).toEqual([expect.stringContaining('expired waiver: core.security-policy expired 2026-10-01')])
    write('SECURITY.md', 'Report privately.\n')
    config({ waivers: [waiver('core.security-policy')] })
    card = conform(root, { today: TODAY })
    expect(card.problems).toEqual([expect.stringContaining('stale waiver: core.security-policy no longer fails (pass)')])
    expect(card.exitCode).toBe(1)
  })

  it.each([
    [{ waivers: [{ ...waiver('core.security-policy'), reason: 'later' }] }, 'at least 40 characters'],
    [{ waivers: [waiver('core.security-policy', '2027-03-01')] }, 'more than 90 days out'],
    [{ waivers: [waiver('core.security-policy', '2027-01-06')] }, 'more than 90 days out'], // 91 days
    [{ waivers: [waiver('core.nope')] }, 'no checked standard core.nope'],
    [{ waivers: [waiver('core.error-reporting')] }, "an audit or settings standard isn't scored here"],
    [{ baseline: { recorded: TODAY, standards: ['core.settings-branch-protected'] } }, "an audit or settings standard isn't scored here"],
    [{ baseline: { recorded: '2026-13-01', standards: [] } }, 'baseline "recorded" must be a real date'],
    [{ visibility: 'internal' }, '"visibility" must be "public" or "private"'],
    [{ extra: true }, '"extra" isn\'t a config field'],
  ])('refuses an invalid config: %j', (value, message) => {
    config(value)
    expect(() => conform(root, { today: TODAY })).toThrow(message)
  })

  it('a waiver may run exactly 90 days', () => {
    config({ waivers: [waiver('core.security-policy', '2027-01-05')] })
    expect(keyed(conform(root, { today: TODAY }), 'core.security-policy')?.status).toBe('waived')
  })

  it('a baseline entry for a pack that no longer applies is stale', () => {
    config({ baseline: { recorded: TODAY, standards: ['node.strict-types'] } })
    const card = conform(root, { today: TODAY })
    expect(card.problems).toEqual([expect.stringContaining("stale baseline entry: node.strict-types wasn't evaluated in this run")])
    expect(card.exitCode).toBe(1)
  })

  it('a baseline holds known failures, and a fixed entry fails the run until it is removed', () => {
    config({ baseline: { recorded: TODAY, standards: ['core.security-policy'] } })
    expect(keyed(conform(root, { today: TODAY }), 'core.security-policy')?.status).toBe('baseline')
    write('SECURITY.md', 'Report privately.\n')
    const card = conform(root, { today: TODAY })
    expect(card.problems).toEqual([expect.stringContaining('stale baseline entry: core.security-policy is fixed (pass)')])
  })

  it('nextBaseline records failures once, then only shrinks', () => {
    const card = conform(root, { today: TODAY })
    const failing = card.results.filter((r) => r.status === 'fail').map((r) => r.key)
    const first = nextBaseline(card, {}, TODAY)
    expect(first.refused).toEqual([])
    expect(first.config.baseline).toEqual({ recorded: TODAY, standards: [...failing].sort() })
    const old = { baseline: { recorded: '2026-01-01', standards: [...failing, 'core.license'] } }
    // Skipped (no visibility) isn't fixed, so the entry stays; n/a (a private repository) drops it.
    expect(nextBaseline(card, old, TODAY).config.baseline.standards).toEqual([...failing, 'core.license'])
    const shrunk = nextBaseline(conform(root, { today: TODAY, visibility: 'private' }), old, TODAY)
    expect(shrunk.config.baseline.standards).toEqual(failing)
    expect(shrunk.config.baseline.recorded).toBe('2026-01-01')
    expect(nextBaseline(card, { baseline: { recorded: TODAY, standards: failing.slice(1) } }, TODAY).refused).toEqual([failing[0]])
  })
})

describe('the CLI', { timeout: 60_000 }, () => {
  it("keeps a baseline entry a run couldn't decide, so a later run that can still passes", () => {
    expect(run('--visibility', 'public', '--write-baseline').status).toBe(0)
    expect(JSON.parse(readFileSync(join(root, 'docs/standards/conformance.json'), 'utf8')).baseline.standards).toContain('core.license')
    expect(run('--write-baseline').status).toBe(0) // core.license is skipped here: no visibility
    expect(JSON.parse(readFileSync(join(root, 'docs/standards/conformance.json'), 'utf8')).baseline.standards).toContain('core.license')
    expect(run('--visibility', 'public').status).toBe(0)
  })

  it('exits 1 on failures and 0 once they are baselined, and the baseline only shrinks', () => {
    expect(run().status).toBe(1)
    const write1 = run('--write-baseline')
    expect(write1.stderr).toContain('Wrote the baseline')
    expect(write1.status).toBe(0)
    const config = JSON.parse(readFileSync(join(root, 'docs/standards/conformance.json'), 'utf8'))
    expect(config.baseline.standards).toContain('core.agent-rules')
    write('.agent/workflows/new.md', '# A new failure\n')
    expect(run().status).toBe(1)
    const refused = run('--write-baseline')
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain('A baseline only shrinks')
    expect(refused.stderr).toContain('core.no-agent-workflows')
  })

  it('writes the scorecard as JSON', () => {
    const result = run('--json', '-')
    const card = JSON.parse(result.stdout)
    expect(card.results.length).toBeGreaterThan(5)
    expect(card.exitCode).toBe(1)
  })

  it.each([[['--nope']], [['--visibility', 'internal']], [['--today', '2026-02-31']], [['--write-baseline=yes']]])('exits 2 on %j', (args) => {
    expect(run(...args).status).toBe(2)
  })

  it('exits 2 when the root is not a directory', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--root', join(root, 'missing')], { encoding: 'utf8' })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Not a directory')
  })
})

describe('this repository', { timeout: 120_000 }, () => {
  it('meets its own standards, with an empty baseline', () => {
    expect(existsSync(join(REPO, 'docs/standards/conformance.json'))).toBe(true)
    const card = conform(REPO, { today: TODAY })
    const failing = card.results.filter((r) => r.status === 'fail' || r.status === 'error').map((r) => `${r.key}: ${r.evidence.join('; ')}`)
    expect(failing).toEqual([])
    expect(card.summary.baseline ?? 0).toBe(0)
    expect(card.problems).toEqual([])
    expect(card.summary.pass).toBeGreaterThan(10) // positive control: it checked something
  })
})
