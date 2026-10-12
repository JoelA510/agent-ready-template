#!/usr/bin/env node
// Refuses to publish a component registry that points somewhere other than where it's published.
//
// Every served item names its dependencies by URL under package.json's "homepage"
// (build-registry.mjs), so a registry deployed anywhere else installs its dependencies from that
// other place: the template's own site, or the example.com placeholder. The Pages workflow runs
// this with the URL GitHub reports for the site before it deploys anything.
//
// Run: node scripts/check-pages-homepage.mjs <site-url>
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { siteBase } from './homepage.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

// Both read as site addresses (scripts/homepage.mjs), the form the registry builds URLs from.
function base(value, label) {
  try {
    return siteBase(value, label)
  } catch (error) {
    fail(`${error.message}.`)
  }
}

const [site, ...rest] = process.argv.slice(2)
if (!site || rest.length) {
  console.error('Usage: node scripts/check-pages-homepage.mjs <site-url>')
  process.exit(2)
}
const expected = base(site, 'The site URL')
const { homepage } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const fix = `Set package.json "homepage" to ${expected} (npm run init takes it as --homepage), run npm run registry:build, and commit the result.`
if (typeof homepage !== 'string' || !homepage) {
  fail(`package.json has no "homepage", so the registry's items install their dependencies from the example.com placeholder. ${fix}`)
}
const actual = base(homepage, 'package.json "homepage"')
if (actual !== expected) {
  fail(`package.json "homepage" is ${actual}, but this site is ${expected}: the registry's items would install their dependencies from ${actual}. ${fix}`)
}
console.log(`✓ The registry is built for this site: ${expected}`)
