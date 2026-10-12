import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GENERATED } from '../generated.mjs'

const REPO = resolve(__dirname, '../..')
const settings = JSON.parse(readFileSync(join(REPO, '.claude/settings.json'), 'utf8'))

describe('guard-generated (PreToolUse hook)', () => {
  const guard = (payload: unknown, env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [join(REPO, 'scripts/guard-generated.mjs')], {
      input: typeof payload === 'string' ? payload : JSON.stringify(payload),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: '', ...env }, // the guard goes by where it lives, not this
    })
  const edit = (file_path: string) => guard({ tool_name: 'Edit', tool_input: { file_path }, cwd: REPO })

  // Named here rather than read from OUTPUTS, so dropping an output from that list fails this test.
  it.each([
    ['platforms/ios/Tokens.swift', 'tokens/**/*.json', 'tokens:build'],
    ['src/styles/tokens/light.css', 'tokens/**/*.json', 'tokens:build'],
    ['registry.json', 'src/components/ui/, src/lib/utils.ts, src/hooks/use-mobile.ts, or package.json "homepage" or "dependencies"', 'registry:build'],
    ['public/r/utils.json', 'src/components/ui/, src/lib/utils.ts, src/hooks/use-mobile.ts, or package.json "homepage" or "dependencies"', 'registry:build'],
    ['public/llms.txt', 'src/components/ui/, src/lib/utils.ts, src/hooks/use-mobile.ts, or package.json "homepage" or "name"', 'registry:build'],
    ['.claude/skills/bootstrap/SKILL.md', '.agents/skills/', 'skills:build'],
  ])('refuses an edit to %s and names its source and build', (path, source, build) => {
    const { status, stderr } = edit(join(REPO, path))
    expect(status).toBe(2)
    expect(stderr).toContain(`edit ${source} instead, then run \`npm run ${build}\``)
  })

  it('guards every output the drift gate checks', () => {
    for (const output of GENERATED) expect(edit(join(REPO, output, 'x')).status, output).toBe(2)
  })

  it.each(['tokens/core/color.json', 'src/components/ui/button.tsx', '.agents/skills/bootstrap/SKILL.md', 'registry.json.bak', 'platforms-notes.md'])(
    'allows an edit to %s',
    (path) => {
      expect(edit(join(REPO, path))).toMatchObject({ status: 0, stderr: '' })
    },
  )

  it('resolves a relative path against the session cwd, and checks NotebookEdit and Write too', () => {
    expect(guard({ tool_name: 'Write', tool_input: { file_path: 'platforms/js/tokens.ts' }, cwd: REPO }).status).toBe(2)
    expect(guard({ tool_name: 'NotebookEdit', tool_input: { notebook_path: join(REPO, 'public/r/x.ipynb') }, cwd: REPO }).status).toBe(2)
  })

  it('ignores a path outside the project', () => {
    expect(edit(join(REPO, '..', 'elsewhere', 'platforms', 'x.swift')).status).toBe(0)
  })

  it("fails visibly without blocking when the payload isn't JSON: exit 1, which Claude Code reports", () => {
    const { status, stderr } = guard('not json')
    expect(status).toBe(1)
    expect(stderr).toContain("the hook payload isn't JSON")
  })

  it('refuses an edit to a generated file reached through a symlinked project path', () => {
    const link = join(mkdtempSync(join(tmpdir(), 'guard-')), 'repo')
    symlinkSync(REPO, link, 'dir')
    expect(guard({ tool_name: 'Edit', tool_input: { file_path: join(link, 'platforms/ios/x.swift') }, cwd: REPO }).status).toBe(2)
    expect(guard({ tool_name: 'Edit', tool_input: { file_path: 'platforms/ios/x.swift' }, cwd: link }).status).toBe(2) // relative to a linked cwd
  })

  it("survives a link loop on the way to a path, rather than crash (Copilot would refuse every edit)", () => {
    const dir = mkdtempSync(join(tmpdir(), 'guard-loop-'))
    symlinkSync(join(dir, 'b'), join(dir, 'a'))
    symlinkSync(join(dir, 'a'), join(dir, 'b'))
    expect(guard({ tool_name: 'Write', tool_input: { file_path: join(dir, 'a', 'x.txt') }, cwd: REPO })).toMatchObject({ status: 0, stderr: '' })
    rmSync(dir, { recursive: true, force: true })
  })

  // Copilot CLI reads these hooks too, and nothing says it sets CLAUDE_PROJECT_DIR; a hook that
  // can't start exits non-zero, which it takes as "deny". From a subdirectory, as such an agent might.
  it('runs as registered without CLAUDE_PROJECT_DIR, from anywhere in the project', () => {
    const { command } = settings.hooks.PreToolUse.flatMap((h: { hooks: { command: string }[] }) => h.hooks).find((c: { command: string }) => c.command.includes('guard-generated'))
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CLAUDE_PROJECT_DIR'))
    const cwd = join(REPO, 'src')
    const hook = (file_path: string) => spawnSync('bash', ['-c', command], { cwd, env, encoding: 'utf8', input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path }, cwd }) })
    expect(hook(join(REPO, 'platforms/ios/x.swift')).status).toBe(2)
    expect(hook(join(REPO, 'src/main.tsx'))).toMatchObject({ status: 0, stderr: '' })
  })

  it('is registered for every file-writing tool', () => {
    const entry = settings.hooks.PreToolUse.find((h: { hooks: { command: string }[] }) =>
      h.hooks.some((c) => c.command.includes('scripts/guard-generated.mjs')),
    )
    expect(entry.matcher.split('|').sort()).toEqual(['Edit', 'MultiEdit', 'NotebookEdit', 'Write'])
  })

  // Each agent's payload as its documentation shapes it (ADR 0018); none of these ran in the agent.
  describe("other agents' payloads", () => {
    const patch = (...lines: string[]) => ['*** Begin Patch', ...lines, '*** End Patch'].join('\n')
    const codex = (command: string) => guard({ tool_name: 'apply_patch', tool_input: { command }, cwd: REPO })

    it('Codex: refuses an apply_patch that adds, updates, deletes, or moves to a generated file', () => {
      expect(codex(patch('*** Update File: platforms/ios/Tokens.swift', '@@', '-a', '+b')).status).toBe(2)
      expect(codex(patch('*** Add File: docs/notes.md', '+hi', '*** Delete File: public/r/utils.json')).status).toBe(2)
      expect(codex(patch('*** Update File: src/lib/utils.ts', '*** Move to: registry.json', '@@', '-a', '+b')).status).toBe(2)
      expect(codex(patch('*** Add File: docs/notes.md', '+platforms/ios/Tokens.swift'))).toMatchObject({ status: 0, stderr: '' })
      // Codex trims a header line, except inside an Update hunk, where an indented line is context.
      expect(codex(patch('  *** Update File: platforms/ios/Tokens.swift', '@@', '-a', '+b')).status).toBe(2)
      expect(codex(patch('\t*** Delete File: registry.json')).status).toBe(2)
      expect(codex(patch('\u0085*** Delete File: registry.json')).status).toBe(2) // Rust trims a next-line character too
      expect(codex(patch('*** Update File: docs/notes.md', '@@', ' *** Update File: platforms/ios/x.swift', '-a', '+b'))).toMatchObject({ status: 0, stderr: '' })
      expect(codex(patch('*** Update File: docs/notes.md', '@@', '-a', '+b', '*** Update File: registry.json', '@@', '-c', '+d')).status).toBe(2)
    })

    it("Copilot: reads toolArgs, as a JSON string or an object, and ignores args it can't read", () => {
      const copilot = (toolArgs: unknown) => guard({ toolName: 'edit', toolArgs, cwd: REPO })
      expect(copilot(JSON.stringify({ path: join(REPO, 'registry.json') })).status).toBe(2)
      expect(copilot({ path: 'src/styles/tokens/light.css' }).status).toBe(2)
      expect(copilot({ path: 'src/main.tsx' })).toMatchObject({ status: 0, stderr: '' })
      expect(copilot('not json')).toMatchObject({ status: 0, stderr: '' })
    })

    it('Gemini CLI: write_file and replace carry file_path', () => {
      expect(guard({ tool_name: 'replace', tool_input: { file_path: join(REPO, '.claude/skills/verify/SKILL.md') }, cwd: REPO }).status).toBe(2)
    })

    it('Antigravity: a JSON decision on stdout, paths against the workspace, and nothing printed to allow', () => {
      const antigravity = (TargetFile: string) =>
        spawnSync(process.execPath, [join(REPO, 'scripts/guard-generated.mjs'), '--agent', 'antigravity'], {
          input: JSON.stringify({ toolCall: { name: 'write_to_file', args: { TargetFile } }, workspacePaths: [REPO] }),
          encoding: 'utf8',
          env: { ...process.env, CLAUDE_PROJECT_DIR: '' },
        })
      const refused = antigravity('platforms/android/colors.xml')
      expect(refused.status).toBe(0)
      expect(JSON.parse(refused.stdout)).toMatchObject({ decision: 'deny', reason: expect.stringContaining('edit tokens/**/*.json instead') })
      expect(antigravity('src/main.tsx')).toMatchObject({ status: 0, stdout: '', stderr: '' })
      // Relative to the workspace, not to wherever the guard runs: from src/, ../platforms is generated.
      const nested = spawnSync(process.execPath, [join(REPO, 'scripts/guard-generated.mjs'), '--agent', 'antigravity'], {
        input: JSON.stringify({ toolCall: { name: 'write_to_file', args: { TargetFile: '../platforms/js/tokens.ts' } }, workspacePaths: [join(REPO, 'src')] }),
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: '' },
      })
      expect(nested.stdout).toContain('"decision":"deny"')
    })

    it("guards the checkout it lives in, even when CLAUDE_PROJECT_DIR names another (a git worktree's main checkout)", () => {
      const other = mkdtempSync(join(tmpdir(), 'guard-other-'))
      expect(guard({ tool_name: 'Edit', tool_input: { file_path: join(REPO, 'platforms/ios/x.swift') }, cwd: REPO }, { CLAUDE_PROJECT_DIR: other }).status).toBe(2)
      rmSync(other, { recursive: true, force: true })
    })

    it('follows a link that points at a generated file not written yet', () => {
      const link = join(REPO, 'src', `guard-dangling-${process.pid}.swift`)
      symlinkSync('../platforms/ios/NotYetWritten.swift', link)
      try {
        expect(edit(link).status).toBe(2)
      } finally {
        rmSync(link, { force: true })
      }
    })

    it('refuses an argument it doesn\'t know, rather than guess the output format', () => {
      const r = spawnSync(process.execPath, [join(REPO, 'scripts/guard-generated.mjs'), '--agent', 'windsurf'], { input: '{}', encoding: 'utf8' })
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('unknown argument')
    })
  })

  // Each registered command, run the way that agent runs it (from a subdirectory, or Copilot's from
  // its configured cwd), without CLAUDE_PROJECT_DIR, given its payload for a generated file and a source file.
  describe('registered for every agent', () => {
    const json = (path: string) => JSON.parse(readFileSync(join(REPO, path), 'utf8'))
    type Hook = { file: string; matcher: string; command: string; cwd?: string; tools: string[]; payload: (file: string) => unknown; refused: (r: ReturnType<typeof spawnSync>) => boolean }
    const exit2 = (r: ReturnType<typeof spawnSync>) => r.status === 2
    const codex = json('.codex/hooks.json').hooks.PreToolUse[0]
    const copilot = json('.github/hooks/guard-generated.json').hooks.preToolUse[0]
    const gemini = json('.gemini/settings.json').hooks.BeforeTool[0]
    const antigravity = json('.agents/hooks.json')['guard-generated'].PreToolUse[0]
    const hooks: Hook[] = [
      { file: '.codex/hooks.json', matcher: codex.matcher, command: codex.hooks[0].command, tools: ['apply_patch'], payload: (f) => ({ tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n*** Update File: ${f}\n*** End Patch` }, cwd: REPO }), refused: exit2 },
      { file: '.github/hooks/guard-generated.json', matcher: copilot.matcher, command: copilot.bash, cwd: join(REPO, copilot.cwd), tools: ['edit', 'create'], payload: (f) => ({ toolName: 'edit', toolArgs: JSON.stringify({ path: join(REPO, f) }), cwd: REPO }), refused: exit2 },
      { file: '.gemini/settings.json', matcher: gemini.matcher, command: gemini.hooks[0].command, tools: ['write_file', 'replace'], payload: (f) => ({ tool_name: 'write_file', tool_input: { file_path: join(REPO, f) }, cwd: REPO }), refused: exit2 },
      {
        file: '.agents/hooks.json',
        matcher: antigravity.matcher,
        command: antigravity.hooks[0].command,
        tools: ['write_to_file', 'replace_file_content', 'multi_replace_file_content'],
        payload: (f) => ({ toolCall: { name: 'write_to_file', args: { TargetFile: f } }, workspacePaths: [REPO] }),
        refused: (r) => r.status === 0 && String(r.stdout).includes('"decision":"deny"'),
      },
    ]
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CLAUDE_PROJECT_DIR'))

    it.each(hooks.map((h) => [h.file, h]))('%s runs the guard on every file-writing tool', (_, hook) => {
      const h = hook as Hook
      expect(h.matcher.split('|').sort()).toEqual([...h.tools].sort())
      const run = (file: string) => spawnSync('bash', ['-c', h.command], { cwd: h.cwd ?? join(REPO, 'src'), env, encoding: 'utf8', input: JSON.stringify(h.payload(file)) })
      expect(h.refused(run('platforms/ios/x.swift')), 'refuses a generated file').toBe(true)
      expect(run('src/main.tsx')).toMatchObject({ status: 0, stdout: '', stderr: '' })
    })

    it('Copilot runs the same command in PowerShell as in bash, from the repository root, with nothing to expand', () => {
      expect(copilot).toMatchObject({ cwd: '.', bash: 'node scripts/guard-generated.mjs', powershell: 'node scripts/guard-generated.mjs' })
    })

    it('every other agent finds the script from where it works: $(...) in double quotes expands in bash and PowerShell', () => {
      const commands = [settings.hooks.PreToolUse[0].hooks[0].command, ...hooks.filter((h) => !h.cwd).map((h) => h.command)]
      expect(commands).toHaveLength(4)
      for (const c of commands) expect(c).toMatch(/^node "\$\(git rev-parse --show-toplevel\)\/scripts\/guard-generated\.mjs"( --agent antigravity)?$/)
    })
  })
})

describe.skipIf(process.platform === 'win32')('session-start (SessionStart hook, Claude Code on the web)', () => {
  const SCRIPT = join(REPO, '.claude/hooks/session-start.sh')
  let project: string
  let bin: string
  let calls: string

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'session-start-'))
    bin = mkdtempSync(join(tmpdir(), 'session-start-bin-'))
    calls = join(bin, 'calls')
    // A stand-in npm that records its arguments and exits with $FAKE_NPM_STATUS.
    writeFileSync(join(bin, 'npm'), `#!/bin/sh\necho "$@" >> "${calls}"\nexit \${FAKE_NPM_STATUS:-0}\n`)
    chmodSync(join(bin, 'npm'), 0o755)
    writeFileSync(join(project, 'package-lock.json'), '{}\n')
  })
  afterEach(() => {
    rmSync(project, { recursive: true, force: true })
    rmSync(bin, { recursive: true, force: true })
  })

  const run = (env: Record<string, string>) =>
    spawnSync('bash', [SCRIPT], {
      encoding: 'utf8',
      // Blank anything the runner's own session set, so a test never writes a real env file.
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CLAUDE_PROJECT_DIR: project,
        CLAUDE_ENV_FILE: '',
        PLAYWRIGHT_BROWSERS_PATH: '',
        PLAYWRIGHT_CHROMIUM_EXECUTABLE: '',
        ...env,
      },
    })
  const npmCalls = () => (existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [])
  const installedAt = (lockAge: number, installAge: number) => {
    mkdirSync(join(project, 'node_modules'), { recursive: true })
    writeFileSync(join(project, 'node_modules/.package-lock.json'), '{}\n')
    const now = Date.now() / 1000
    utimesSync(join(project, 'package-lock.json'), now - lockAge, now - lockAge)
    utimesSync(join(project, 'node_modules/.package-lock.json'), now - installAge, now - installAge)
  }

  it('does nothing outside Claude Code on the web', () => {
    expect(run({ CLAUDE_CODE_REMOTE: '' })).toMatchObject({ status: 0, stdout: '' })
    expect(npmCalls()).toEqual([])
  })

  it('installs exactly the lockfile with npm ci when node_modules is missing, and says so on stdout', () => {
    const { status, stdout } = run({ CLAUDE_CODE_REMOTE: 'true' })
    expect(status).toBe(0)
    expect(npmCalls()).toEqual(['ci --no-audit --no-fund'])
    expect(stdout).toContain('Installed dependencies with npm ci')
  })

  it('reinstalls when the lockfile changed after the last install', () => {
    installedAt(60, 3600)
    expect(run({ CLAUDE_CODE_REMOTE: 'true' }).status).toBe(0)
    expect(npmCalls()).toEqual(['ci --no-audit --no-fund'])
  })

  it('is a no-op when node_modules already matches the lockfile', () => {
    installedAt(3600, 60)
    const { status, stdout } = run({ CLAUDE_CODE_REMOTE: 'true' })
    expect(status).toBe(0)
    expect(stdout).toContain('already match')
    expect(npmCalls()).toEqual([])
  })

  it('fails, without claiming success, when npm ci fails', () => {
    const { status, stdout } = run({ CLAUDE_CODE_REMOTE: 'true', FAKE_NPM_STATUS: '1' })
    expect(status).not.toBe(0)
    expect(stdout).not.toContain('Installed dependencies')
  })

  describe("points browser tests at the environment's own Chromium", () => {
    let browsers: string
    let envFile: string
    const makeChromium = (dir: string) => {
      writeFileSync(join(dir, 'chromium'), '#!/bin/sh\n')
      chmodSync(join(dir, 'chromium'), 0o755)
    }
    beforeEach(() => {
      browsers = mkdtempSync(join(tmpdir(), 'session-start-browsers-'))
      envFile = join(project, 'session.env')
      makeChromium(browsers)
      installedAt(3600, 60)
    })
    afterEach(() => rmSync(browsers, { recursive: true, force: true }))
    const env = () => (existsSync(envFile) ? readFileSync(envFile, 'utf8') : '')
    const session = (extra: Record<string, string> = {}) =>
      run({ CLAUDE_CODE_REMOTE: 'true', CLAUDE_ENV_FILE: envFile, PLAYWRIGHT_BROWSERS_PATH: browsers, ...extra })
    // What a shell that sources the env file ends up with, which is what the session sees.
    const sourced = () =>
      spawnSync('bash', ['-c', 'source "$1" && printf %s "$PLAYWRIGHT_CHROMIUM_EXECUTABLE"', '_', envFile], {
        encoding: 'utf8',
        cwd: project,
        env: { PATH: process.env.PATH },
      })

    it('exports PLAYWRIGHT_CHROMIUM_EXECUTABLE when the environment ships a Chromium', () => {
      expect(session().status).toBe(0)
      expect(env()).toBe(`export PLAYWRIGHT_CHROMIUM_EXECUTABLE=${browsers}/chromium\n`)
      expect(sourced().stdout).toBe(`${browsers}/chromium`)
    })

    it('writes the line once, however many times the session resumes', () => {
      for (let i = 0; i < 3; i++) expect(session().status).toBe(0)
      expect(env().trim().split('\n')).toHaveLength(1)
    })

    it('quotes the path for the shell that sources it, so no character in it runs as code', () => {
      const odd = mkdtempSync(join(tmpdir(), 'session-start "q" $(touch pwned) `touch pwned2` '))
      try {
        makeChromium(odd)
        expect(session({ PLAYWRIGHT_BROWSERS_PATH: odd }).status).toBe(0)
        const result = sourced()
        expect(result.status).toBe(0)
        expect(result.stdout).toBe(`${odd}/chromium`)
        expect(existsSync(join(project, 'pwned')) || existsSync(join(project, 'pwned2'))).toBe(false)
      } finally {
        rmSync(odd, { recursive: true, force: true })
      }
    })

    it('leaves a PLAYWRIGHT_CHROMIUM_EXECUTABLE that is already set', () => {
      expect(session({ PLAYWRIGHT_CHROMIUM_EXECUTABLE: '/custom/chrome' }).status).toBe(0)
      expect(env()).toBe('')
    })

    it('does nothing when there is no Chromium file to point at', () => {
      rmSync(join(browsers, 'chromium'))
      expect(session().status).toBe(0)
      mkdirSync(join(browsers, 'chromium')) // a directory is executable too, but not a browser
      expect(session().status).toBe(0)
      expect(env()).toBe('')
    })

    it('writes nothing when the session has no env file', () => {
      expect(session({ CLAUDE_ENV_FILE: '' }).status).toBe(0)
      expect(existsSync(envFile)).toBe(false)
    })
  })

  it('is registered for new and resumed sessions', () => {
    const entry = settings.hooks.SessionStart.find((h: { hooks: { command: string }[] }) =>
      h.hooks.some((c) => c.command.includes('.claude/hooks/session-start.sh')),
    )
    expect(entry.matcher).toBe('startup|resume')
  })
})
