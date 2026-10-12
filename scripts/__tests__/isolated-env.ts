import { spawnSync } from 'node:child_process'

/**
 * The environment for a child process that should see only the packages installed where its
 * script sits. NODE_PATH adds folders to every module lookup, and some sandboxes (Claude Code on the
 * web among them) point it at a global folder that holds typescript, so a scratch copy of a script
 * outside the template would find a dependency the test means to be missing.
 */
export const isolatedEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(env).filter(([name]) => name !== 'NODE_PATH'))

export const ISOLATED_ENV = isolatedEnv(process.env)

/** Whether `name` resolves from `file`'s location, in a process with `env` (ISOLATED_ENV by default). */
export function resolvesFrom(file: string, name: string, env: NodeJS.ProcessEnv = ISOLATED_ENV) {
  const script = 'require("node:module").createRequire(process.argv[1]).resolve(process.argv[2])'
  return spawnSync(process.execPath, ['-e', script, file, name], { env, stdio: 'ignore' }).status === 0
}
