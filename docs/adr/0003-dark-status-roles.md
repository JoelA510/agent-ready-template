# 0003. Dark-theme status roles are light fills with dark text

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** template maintainers
- **Applies to:** `tokens/semantic/dark.json` (`destructive`, `success`, `info` and their
  `-foreground` roles), and every component that renders them

## Context

The status roles do two jobs. As a **fill**, `bg-destructive` carries `destructive-foreground`
text (buttons, badges, toasts). As **text**, `text-destructive` sits on the page or in a popover
(form errors in `form.tsx`, destructive items in the dropdown, context, and menubar menus).

In the dark theme both jobs used the light theme's strategy: a mid-dark red (`danger.600`,
`#cc2c24`) with white text. As a fill that clears AA (5.31:1). As text on the dark surfaces it
measured 3.44:1 on `background` and 2.90:1 on `card`/`popover`, below the 4.5:1 SC 1.4.3 needs
for body-size text. `success` and `info` had the same shape and failed 3:1 as alert icons on
their own tint. The contrast gate missed all of it because it only measured each role on its
own fill; see the `TEXT_ON_SURFACE` list in `scripts/check-contrast.mjs`.

On a near-black page, one value can't be both dark enough to carry white text and light enough
to read as text itself (the arithmetic is under Alternatives).

## Decision

In the dark theme, `destructive`, `success`, and `info` use the palette's `300` step as the role
value, with `neutral-950` as their `-foreground`. That's the pattern `primary` (`brand.400` +
`neutral-950`) and `warning` already use there, so every colored role in the dark theme is now a
light fill with dark text. The light theme is unchanged.

## Alternatives considered

### Alternative: separate text roles (`destructive-text`, `success-text`, …)

Keep the dark fills and white text, and add a lighter role per status for text use. This keeps
dark-mode buttons as they looked, and it's the model Primer-style systems use
(`fgColor.danger` vs `bgColor.danger.emphasis`). It lost because it adds four roles to the
public token API. Every text usage would also have to switch to a new class, and forks would
have to keep eight values in step instead of four, all to preserve a look the dark theme's own
`primary` and `warning` roles already don't use.

### Alternative: pick a mid-value that passes both jobs

No such color exists, in any hue. White text at 4.5:1 needs a fill with relative luminance at
most 0.183; 4.5:1 as text on the dark card (`#242523`, luminance 0.018) needs at least 0.257.
The two ranges don't overlap.

## Consequences

- **Easier:** one rule for the whole dark theme (colored role = light fill + dark text), and
  status colors work as text on every dark surface. The gate now measures that use.
- **Harder / visible:** dark-mode destructive buttons and badges are a light red with dark text
  rather than a saturated red with white. Forks that restyle the dark theme have to satisfy both
  jobs, and `npm run check-contrast` tells them when they don't.
- **Revisit if:** a fork's palette has a status step that clears 4.5:1 both ways, or the team
  decides separate text roles are worth the API growth. That second case supersedes this ADR.

## Verification

`npm run check-contrast` measures `destructive` as text on `background`, `card`, and `popover`,
and on its `/10` menu tint, plus the status icons on their alert tints. Any of those below its
bar fails `npm run check`. `scripts/__tests__/check-contrast.test.ts` reproduces the original
values and asserts the gate fails on them.
