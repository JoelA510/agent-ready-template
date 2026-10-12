# 0010. One color grammar, React Native shapes from authored values, and no partial builds

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** template maintainers
- **Applies to:** `style-dictionary.config.mjs`, `scripts/color.mjs`, `scripts/native-tokens.mjs`,
  `scripts/check-contrast.mjs`, and the generated `platforms/js/tokens-native.{ts,json}`

## Context

Four problems in the token pipeline, each reproduced before it was fixed:

- **`oklch()` colors failed in two places.** Tailwind v4 authors its palette in oklch, so a
  rebrand that copies it puts `oklch()` in `tokens/core`. The contrast gate threw, because it
  read only 6-digit hex. Worse, Style Dictionary's `color/UIColorSwift` and `color/hex8android`
  use tinycolor2, which reads `oklch()` as invalid and returns `#000000ff`. iOS and Android would
  have shipped black.
- **Style Dictionary reports a throwing transform as a warning.** It keeps the raw value and
  exits 0, so an unconvertible value ships as written.
- **The config clears its output directories before building.** Any error mid-build removes
  the web's CSS tokens along with everything else.
- **The JS output told React Native users to use it directly.** Its easing and shadows are CSS
  strings and its font family is a CSS stack. Its line height is a unitless multiplier, which
  React Native reads as points.

## Decision

- **One color grammar, `scripts/color.mjs`,** shared by the contrast gate, the build, and the
  native shadow parser:
  - It reads hex (3, 4, 6, or 8 digits), `rgb()`, `hsl()`, `oklch()`, and `transparent`.
  - It clamps components as CSS does, and throws on malformed input.
  - It gamut-maps out-of-sRGB oklch with **CSS Color 4's algorithm** (reduce chroma, keep
    lightness and hue), which is what the spec asks browsers to do.
- **The contrast gate** measures every color it can read. It lists the colors it had to
  gamut-map, and it refuses translucent or unreadable ones.
- **The build converts only what the native transforms can't read.** A new `color/css-to-hex`
  transform sits in front of Style Dictionary's own:
  - An `oklch()` color becomes its sRGB hex, alpha kept.
  - Every format tinycolor2 reads passes through untouched, so those builds are byte-identical
    to before.
  - Anything else throws.
  - It isn't transitive, because an alias must take its target's finished value.
- **The build fails instead of guessing.** Style Dictionary warnings are errors, and every
  platform is transformed and formatted in memory before the output directories are cleared. A
  rejected token leaves the last good output in place.
- **React Native gets its own output, derived from authored values.** `tokens-native` holds:
  - easing control points;
  - iOS shadow props plus an Android elevation and a `boxShadow` string;
  - font family arrays;
  - line height and letter spacing in points.

  It reads each value's authored unit rather than assuming one. A web value with no React
  Native form (a `steps()` easing) is left out and listed in `unsupported`, so it doesn't fail
  the web build. A malformed value throws.

## Alternatives considered

### Alternative: clip out-of-gamut colors instead of gamut-mapping

Clipping is simpler, and some browsers do it today. It lost because CSS Color 4 specifies
mapping, and mapping keeps hue while clipping shifts it. The gate says which colors it mapped
and tells authors to leave those a margin, so a clipping browser's small difference is covered.

### Alternative: convert every color to hex for the native platforms

One code path, and native outputs that never depend on tinycolor2. It lost because it changed
output for colors the old build already handled, and it would have to reproduce all of CSS's
named colors. Converting only `oklch()` fixes the bug and leaves everything else identical.

### Alternative: make React Native consumers parse the CSS strings themselves

No new output file. It lost because every React Native project would write the same parsers,
and the multiplier-versus-points mistake is invisible until the text renders wrong.

### Alternative: build into a staging directory and swap it in

This gives the same guarantee as formatting in memory first. It lost because the in-memory pass
is three lines and reuses Style Dictionary's cache. A staging swap means rewriting every
platform's `buildPath`.

## Consequences

- **Easier:** a Tailwind v4 palette works everywhere as pasted. A bad token fails loudly, and
  the web keeps its CSS. React Native gets values it can use as-is.
- **Harder:**
  - Style Dictionary warnings now fail the build, so a new warning from an upgrade needs fixing
    (or an explicit exception) before it can land.
  - The native shadow radius and elevation are approximations that someone has to check on a
    device.
- **Revisit** when Style Dictionary's own color transforms read `oklch()`: then the pre-transform
  becomes redundant. Also revisit when React Native's color parsing accepts `oklch()`.
