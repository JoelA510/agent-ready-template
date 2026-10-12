#!/usr/bin/env node
// Fails if the committed generated outputs don't match what their sources produce.
//
// `npm run check` rebuilds the tokens before using them, so a PR that edits tokens/**/*.json
// without committing the regenerated files still goes green there — while every consumer that
// reads the committed files (iOS, Android, React Native, the shadcn registry) gets stale values.
// This regenerates everything and fails on any difference under the generated paths: modified,
// deleted (an output the build no longer produces — both builds empty their output directories
// first), or new.
//
// It compares against the last commit, so it's meaningful on a clean tree: CI runs it on every
// PR, and locally you run it after committing a token or component change, before pushing.
// Mid-change, uncommitted regenerated files are the normal state, which is why `npm run check`
// doesn't include it.
//
// Run: node scripts/check-generated.mjs   (npm run check:generated)
import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUILDS, GENERATED, buildEntry } from './generated.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

for (const name of BUILDS) {
  let entry
  try {
    entry = buildEntry(ROOT, name)
  } catch (error) {
    console.error(`✗ ${error.message}`)
    process.exit(2)
  }
  execFileSync(process.execPath, [entry], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
}

// --porcelain covers modified, deleted, and new files; `git diff` alone would miss new ones.
const status = execFileSync(
  'git',
  ['status', '--porcelain', '--untracked-files=all', '--', ...GENERATED],
  { cwd: ROOT, encoding: 'utf8' },
).trimEnd()
if (status) {
  console.error(
    `✗ Generated files are out of date with their sources:\n\n${status}\n\n` +
      `Run \`npm run ${BUILDS.join('` and `npm run ')}\` and commit the result. Never hand-edit these ` +
      `paths: ${GENERATED.join(', ')}.`,
  )
  process.exit(1)
}
console.log(`✓ Generated outputs match their sources (${GENERATED.join(', ')}).`)
