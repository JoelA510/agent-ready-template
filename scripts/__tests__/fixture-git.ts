import { execFileSync } from 'node:child_process'

/**
 * git in a throwaway fixture repo: a fixed identity, and no signing (a contributor's gpgsign or
 * tag.gpgSign config would otherwise prompt or hang). Callers pass --no-verify to skip hooks.
 */
export function fixtureGit(cwd: () => string) {
  return (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgSign=false', ...args],
      { cwd: cwd(), encoding: 'utf8' },
    )
}
