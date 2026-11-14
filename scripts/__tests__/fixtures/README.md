# Test fixtures

`placeholder-tokens/` is a frozen copy of the template's placeholder token sources (`tokens/` as
the template ships them). `check-contrast.test.ts` and `tokens-build.test.ts` test the contrast
checker and the token build, so they plant defects into this copy and expect its exact ratios and
references (`primary` is `{palette.brand.700}`, ring/50 on background is 1.82:1).

They must not read the repository's live `tokens/`: a fork that rebrands its palette, by hand or
with `npm run init -- --preset <id>` (ADR 0021), would change those numbers and fail tests that
say nothing about its own tokens. The fork's own tokens are checked by `npm run check-contrast`
and the "passes on this repo" test, which do read `tokens/`.

Change this copy only to test the checker or the build against a different input.
