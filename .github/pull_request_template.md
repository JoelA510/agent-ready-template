<!--
  Keep this short. The goal is a reviewer understanding the change and its blast radius
  quickly. See GOVERNANCE.md for the review a change of each size needs.
-->

## What & why

<!-- What does this change, and what problem or need does it address? -->

## Type of change

- [ ] Token change (`tokens/**/*.json` — remember to `npm run tokens:build`)
- [ ] New or changed component (`src/components/ui/`)
- [ ] Content / docs (`docs/`, `README`, etc.)
- [ ] Tooling / build / CI
- [ ] Prompt change (`prompts/` — note which run surfaced the gap)
- [ ] Other:

## Checklist

- [ ] `npm run check` passes locally (tokens build, contrast check, typecheck, lint, app build, Storybook build, tests)
- [ ] For a component, story, or token change: `npm run test:browser` passes (every story in Chromium, both themes; CI runs it too)
- [ ] Generated files were **not** hand-edited, and regenerated ones are committed (`npm run check:generated` passes after committing; CI runs it too)
- [ ] Components use semantic tokens, not hardcoded colors/values
- [ ] New/changed components have a Storybook story for each meaningful state
- [ ] Accessibility: keyboard-operable, screen-reader-labeled, meets WCAG 2.2 AA (see `docs/foundations/accessibility.mdx`)
- [ ] Content and component changes that affect each other were updated together
- [ ] An ADR was added under `docs/adr/` if this makes a consequential decision
- [ ] Any new test, validator, lint rule, or CI gate was shown failing against the defect it
      guards (a planted defect, or the fix reverted), and it fails when it examines nothing
- [ ] For feature work in a project built from this template: the definition of done in
      `CONTRIBUTING.md` is met (validation, surfaced failures, tests incl. an edge case,
      checks that can fail, server-side authz, careful data handling, observability, docs)

## Notes for reviewers

<!-- Anything worth flagging: trade-offs, follow-ups, screenshots for visual changes. -->
