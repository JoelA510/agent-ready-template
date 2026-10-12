# Security policy

## Reporting a vulnerability

Report it privately: on this repository's security tab (**Security and quality** in current
GitHub), choose **Report a vulnerability** (GitHub's private vulnerability reporting). Please
don't open a public issue or pull request for it; that discloses the problem before a fix exists.
If there's no such button, private reporting isn't turned on (GitHub offers it only on public
repositories): open an issue that asks for a private contact, with no details of the problem.

Include what's affected (a file, script, workflow, or component), how to reproduce it, and what
an attacker gains. A proof of concept against a throwaway fork is the most useful form.

You'll get a reply on the advisory. A confirmed issue is fixed on `main`, recorded under
**Security** in `CHANGELOG.md`, and credited to you unless you'd rather it weren't.

## What's in scope

This is a template: its code runs on the machines of everyone who forks it, applies its process,
or installs one of its components. All of that is in scope:

- **Scripts** under `scripts/` and `.claude/hooks/`, which run on developer machines and in CI:
  `init`, `process:apply`, the checks, and the agent hooks. For example, a path or argument that
  makes one write outside the repository it was pointed at.
- **Workflows** under `.github/workflows/`: a token with more permission than its job needs, or
  untrusted pull-request input reaching a shell.
- **Components** under `src/components/`, which forks ship to their users: for example, markup
  injection through a prop.
- **The component registry** (`public/r/`, served with the Storybook site): installing an item
  copies its code into the consumer's repository, so an item that installs anything other than
  what's in `src/` is a supply-chain issue.
- **Agent instructions and prompts** (`AGENTS.md`, `prompts/`, `.agents/skills/`) that would
  lead an agent to leak a secret or run something it shouldn't.

A vulnerability in a dependency belongs upstream. Tell us too if the audit gate misses it or a
waiver in `docs/security/audit-waivers.json` is wrong
([dependency policy](docs/security/dependency-policy.md)).

## Supported versions

Fixes land on `main`. Forks own their copy: a fix reaches a fork when the fork pulls it in.
The CHANGELOG's **Security** entries say what changed and what a fork needs to do.

## For a project built from this template

This file describes the template. Replace it with your project's own policy; the skeleton is
`templates/project/SECURITY.md` (in a target that received the process via `process:apply`,
`prompts/skeletons/SECURITY.md`).
