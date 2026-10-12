// Loads a package from the template's node_modules for the scripts that need one
// (check-instructions through skills.mjs needs `yaml`, check-env needs `typescript`). A checkout
// with no install gets an error that says how to install, carrying MISSING_DEPENDENCY so the
// script can print it and exit 2, instead of a module-resolution stack trace. process:apply and
// check-placeholders use Node builtins only and never come through here.
import { createRequire } from 'node:module'

export const MISSING_DEPENDENCY = 'TEMPLATE_DEPENDENCY_MISSING'

const require = createRequire(import.meta.url)

/** The package `name`, or an error with code MISSING_DEPENDENCY that says how to install it. */
export function templateDependency(name) {
  try {
    return require(name)
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') throw error
    throw Object.assign(
      new Error(
        `This needs the template's dependencies (${name}), and they aren't installed. In the template ` +
          'checkout, run `npm ci`. In a checkout you use only for the process, ' +
          "`npm ci --ignore-scripts` installs the same packages without setting up the template's git hooks.",
        { cause: error },
      ),
      { code: MISSING_DEPENDENCY },
    )
  }
}
