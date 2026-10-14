#!/usr/bin/env node
// Rebrand this template for a new client project. See usage() below, or run with no args.
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORMS, PROCEDURE, SELECTION_FILE, selectionText, unknownIds } from './agent-platforms.mjs';
import { buildEntry, isGenerated } from './generated.mjs';
import { isSite, PLACEHOLDER_HOMEPAGE, siteBase, TEMPLATE_HOMEPAGE } from './homepage.mjs';
import { listRepoFiles } from './repo-files.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FLAGS = new Set(['name', 'slug', 'scope', 'homepage', 'platforms']);
// A line containing this marker is left as written: it describes the placeholder itself
// ("ships with a placeholder brand, Acme Inc."), which a rebrand would make false.
const KEEP = 'init:keep';

function usage() {
  console.error(`Usage: node scripts/init.mjs --name "Client Inc." --slug clientinc [--scope @clientinc] [--homepage https://…]

  --name      Display brand name, quoted if it has spaces. Replaces "Acme Inc." everywhere, then
              any remaining bare "Acme" with --name minus a trailing legal suffix
              (", Inc.", " LLC", " Ltd.", " Corp.", " Co.", ...) if one is present.
  --slug      Kebab-case identifier (a-z, 0-9, single hyphens). Replaces the lowercase "acme"
              in identifiers ("acme-analytics", "billing@acme.example"), and package.json
              "name" becomes "@<slug>/design-system".
  --scope     Optional npm scope (include the "@", e.g. "@clientinc"). If passed,
              package.json "name" becomes "<scope>/design-system" instead of "@<slug>/design-system".
  --homepage  Optional URL of the deployed site that serves public/r/ (the component registry).
              Written to package.json "homepage"; the registry points there. Without it, the
              template's own homepage is removed (any other is kept), and until one is set the
              registry uses a placeholder.
  --platforms Optional comma-separated ids of the coding agents the project uses
              (${PLATFORMS.map((p) => p.id).join(', ')}), written to ${SELECTION_FILE}: its
              instruction files are wired and sized for those. Another agent is researched into
              that file's "custom" list instead (${PROCEDURE}).

It also renames the package in package-lock.json and regenerates the registry, so the fork
starts with no generated file out of date. On the first run it records the template's version as
package.json "templateVersion" and restarts "version" at 0.1.0. CHANGELOG.md (the template's history) and lines
marked ${KEEP} are left as written. Nothing is written unless every argument is valid.
`);
}

function fail(message) {
  console.error(`init: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) {
      fail(`unexpected argument "${argv[i]}": quote a value that has spaces, e.g. --name "Client Inc."`);
    }
    const key = argv[i].slice(2);
    if (Object.hasOwn(args, key)) fail(`--${key} is given twice`);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (typeof args.name !== 'string' || typeof args.slug !== 'string') {
  usage();
  process.exit(1);
}
const unknown = Object.keys(args).filter((key) => !FLAGS.has(key));
if (unknown.length) fail(`unknown option ${unknown.map((k) => `--${k}`).join(', ')}`);
for (const key of FLAGS) {
  if (args[key] === true) fail(`--${key} needs a value`);
}

// The name lands in TS string literals, JSX text and attributes, MDX, and HTML. An ASCII
// apostrophe ("Macy's") becomes the typographic one, which is what brand copy should use anyway
// and is safe in a single-quoted string; characters that would end or open code are refused.
const NAME = args.name.trim().replaceAll("'", '\u2019');
const SLUG = args.slug;
const SCOPE = typeof args.scope === 'string' ? args.scope : null;
if (!NAME) fail('--name is empty');
if (/[\p{Cc}"`<>{}\\$]/u.test(NAME)) fail(`--name "${NAME}" can't contain quotes, backticks, <, >, {, }, \\, $, or control characters`);
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(SLUG)) fail(`--slug "${SLUG}" must be kebab-case: lowercase letters, digits, and single hyphens`);
if (SCOPE !== null && !/^@[a-z0-9][a-z0-9._-]*$/.test(SCOPE)) fail(`--scope "${SCOPE}" must look like @clientinc`);
// A new identity containing "acme" would be replaced again on a re-run.
for (const [flag, value] of [['--name', NAME], ['--slug', SLUG], ['--scope', SCOPE]]) {
  if (value && /acme/i.test(value)) fail(`${flag} "${value}" can't contain "acme": a re-run couldn't tell it from the placeholder`);
}
let PLATFORM_IDS = null;
if (typeof args.platforms === 'string') {
  PLATFORM_IDS = [...new Set(args.platforms.split(',').map((id) => id.trim()).filter(Boolean))];
  if (!PLATFORM_IDS.length) fail('--platforms needs at least one platform id');
  const unknownPlatforms = unknownIds(PLATFORM_IDS);
  if (unknownPlatforms.length) {
    fail(`--platforms: ${unknownPlatforms.join(', ')} isn't a platform the template knows (${PLATFORMS.map((p) => p.id).join(', ')}). Research another into ${SELECTION_FILE}'s "custom" list as ${PROCEDURE} says.`);
  }
}
let HOMEPAGE = null;
if (typeof args.homepage === 'string') {
  try {
    HOMEPAGE = siteBase(args.homepage, '--homepage'); // normalized: what was checked is what gets written
  } catch (error) {
    fail(error.message);
  }
}

const BASE_NAME = NAME.replace(/,?\s+(Inc|Incorporated|LLC|L\.L\.C|Ltd|Limited|Corp|Corporation|Co)\.?$/i, '').trim() || NAME;
const PKG_NAME = SCOPE ? `${SCOPE}/design-system` : `@${SLUG}/design-system`;
const REPLACEMENTS = { 'Acme Inc.': NAME, Acme: BASE_NAME, acme: SLUG };
// One pass, so text a replacement inserts is never matched again.
const PLACEHOLDER = /Acme Inc\.|\bAcme\b|\bacme\b/g;

// Never edited as text: generated output (rebuilt below instead), npm's lockfile and the
// manual palette step, the template's own history, and the two files that name the placeholder
// on purpose.
const SKIP = new Set(['package-lock.json', 'tokens/core/color.json', 'CHANGELOG.md', 'scripts/init.mjs', 'scripts/__tests__/init.test.ts']);

// Read and rewrite everything in memory first: a file that can't be read stops the run before
// anything is written.
const edits = [];
let totalReplacements = 0;
for (const rel of listRepoFiles(ROOT)) {
  if (SKIP.has(rel) || isGenerated(rel)) continue;
  const abs = join(ROOT, rel);
  if (!lstatSync(abs).isFile()) continue; // symlinks, submodules, nested repos
  const buffer = readFileSync(abs);
  if (buffer.includes(0)) continue; // binary
  const before = buffer.toString('utf8');
  let replacements = 0;
  let after = before
    .split('\n')
    .map((line) =>
      line.includes(KEEP)
        ? line
        : line.replace(PLACEHOLDER, (match) => {
            replacements += 1;
            return REPLACEMENTS[match];
          }),
    )
    .join('\n');
  if (rel === 'index.html') after = after.replace(/<title>[^<]*<\/title>/, () => `<title>${NAME} — Design System Template</title>`);
  if (after !== before) edits.push({ abs, after });
  totalReplacements += replacements;
}

// package.json and package-lock.json as JSON: npm writes both as 2-space JSON with a trailing
// newline, so a parse and re-serialize changes only the fields set here.
const json = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
const serialize = (data) => JSON.stringify(data, null, 2) + '\n';
const pkgEdit = edits.find((edit) => edit.abs === join(ROOT, 'package.json'));
const unbranded = json('package.json').name === '@acme/design-system';
let removedTemplateHomepage = false;
const pkg = pkgEdit ? JSON.parse(pkgEdit.after) : json('package.json');
pkg.name = PKG_NAME;
// A fresh copy's versioning starts over; the template version it started from is kept, since
// taking a later template release means reading the CHANGELOG from there (docs/system/
// updating-from-the-template.mdx). Only on the first run, while the package still has the
// template's name: a re-run, or a fork rebranded before init recorded this, keeps its version.
if (unbranded && !Object.hasOwn(pkg, 'templateVersion')) {
  pkg.templateVersion = pkg.version;
  pkg.version = '0.1.0';
}
if (HOMEPAGE !== null) pkg.homepage = HOMEPAGE;
// A fresh fork inherits the template's own site as its homepage. Kept, the fork's registry would
// install every component dependency from the template's registry, so it goes until --homepage
// names the fork's. Any other homepage is the fork's own choice and stays.
else if (isSite(pkg.homepage, TEMPLATE_HOMEPAGE)) {
  delete pkg.homepage;
  removedTemplateHomepage = true;
}
if (pkgEdit) pkgEdit.after = serialize(pkg);
else edits.push({ abs: join(ROOT, 'package.json'), after: serialize(pkg) });
if (existsSync(join(ROOT, 'package-lock.json'))) {
  const lock = json('package-lock.json');
  lock.name = PKG_NAME;
  lock.version = pkg.version;
  if (lock.packages?.['']) Object.assign(lock.packages[''], { name: PKG_NAME, version: pkg.version });
  edits.push({ abs: join(ROOT, 'package-lock.json'), after: serialize(lock) });
}
if (PLATFORM_IDS) edits.push({ abs: join(ROOT, SELECTION_FILE), after: selectionText(ROOT, PLATFORM_IDS) });
let registryEntry;
try {
  registryEntry = buildEntry(ROOT, 'registry:build');
} catch (error) {
  fail(error.message);
}

for (const { abs, after } of edits) {
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, after);
}

// The registry is named after package.json and points at its homepage: rebuild it now, so the
// fork's first `npm run check:generated` isn't already red.
const registry = spawnSync(process.execPath, [registryEntry], { cwd: ROOT, encoding: 'utf8' });
if (registry.status !== 0) {
  process.stderr.write(registry.stdout + registry.stderr);
  fail('the rebrand is written, but regenerating the component registry failed (above); fix it and run npm run registry:build');
}
const built = json('registry.json');
const placeholderHomepage = built.homepage === PLACEHOLDER_HOMEPAGE;

if (totalReplacements === 0) {
  console.warn(
    'No "Acme" left to replace: this copy looks rebranded already. Only the package name, registry, and page title were set' +
      (HOMEPAGE !== null ? ', and the homepage.' : removedTemplateHomepage ? ", and the template's own homepage removed." : '.'),
  );
}
console.log(`Rebrand complete: ${totalReplacements} replacement(s) across ${edits.length} file(s).`);
console.log(`  package.json name -> "${PKG_NAME}", version ${pkg.version} (package-lock.json too); from template ${pkg.templateVersion}`);
console.log(`  registry          -> "${built.name}" at ${built.homepage}${placeholderHomepage ? ' (a placeholder until --homepage is set)' : ''}`);
console.log(`  index.html title  -> "${NAME} — Design System Template"`);
if (PLATFORM_IDS) console.log(`  agent platforms   -> ${SELECTION_FILE}: ${PLATFORM_IDS.join(', ')}`);
if (NAME !== args.name.trim()) console.log(`  (the apostrophe in --name was written as \u2019, which is safe inside code strings)`);
// Which agents the fork's selection names, when --platforms didn't just set it: the template's.
let recorded = null;
try {
  recorded = JSON.parse(readFileSync(join(ROOT, SELECTION_FILE), 'utf8')).platforms;
} catch (error) {
  if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; // absent or unreadable: said below
}
const platformStep = PLATFORM_IDS
  ? ''
  : `
  6. Record the coding agents this project uses: re-run with --platforms <ids>, or edit
     ${SELECTION_FILE}, which ${Array.isArray(recorded) ? `still holds the template's own choice (${recorded.join(', ')})` : "doesn't record one yet"}.
     ${PROCEDURE} lists the ids, and says how to research an agent that isn't listed.`;
console.log(`
Next steps:
  1. Replace public/brand-mark.svg (and its two hardcoded hex colors) with the client's real mark.
  2. Update palette.brand.* / palette.accent.* in tokens/core/color.json per README's existing
     rebrand instructions, then run npm run tokens:build.
  3. Review docs/foundations/iconography.mdx and docs/system/contributing.mdx — they reference a
     fictional "${SLUG}-analytics" app as a rationale anchor; this script only swaps the name, the
     surrounding narrative still needs a human rewrite.
  4. Review docs/brand/terminology.mdx — its example vocabulary (projects/customers/invoices) is
     pinned to a B2B SaaS billing domain; adjust for the client's actual domain.
  5. Replace SECURITY.md with the project's own policy (skeleton: templates/project/SECURITY.md):
     the one here describes the template, and GitHub shows it to anyone reporting a problem.${platformStep}${placeholderHomepage ? `
  ${PLATFORM_IDS ? 6 : 7}. When the site that serves public/r/ is deployed, set package.json "homepage" to its URL and
     run npm run registry:build. On GitHub Pages that's https://<owner>.github.io/<repo>/; the
     Pages workflow refuses to deploy a registry that points anywhere else.` : ''}
`);
