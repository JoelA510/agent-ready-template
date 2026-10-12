# Proposals

Rendered, self-contained artifacts for **stakeholder review** — the visual counterpart to the
"options menu, not a mandate" decisions this system leaves open in Foundations and Brand.

Most of this repo is for the people building the product; Storybook is their operating manual.
But the open decisions the template ships — the **color strategy**, the **display typeface**,
and any other "recommendation vs. alternatives" item in `docs/foundations/*` and `docs/brand/*`
— often need sign-off from people who don't read MDX: a founder, a marketing lead, a client.
Those stakeholders decide faster when they can *see* the options rendered than when they read
about them. A **decision guide** is that surface.

## What a decision guide is

A single, **self-contained HTML file** that, for each open decision:

- renders every option at real fidelity — actual token hex swatches, the real candidate fonts
  **embedded as `data:` URIs** (no CDN/network requests), and live component previews — in both
  **light and dark**;
- states the **recommendation**, the honest **alternatives and trade-offs**, and an explicit
  **"if you leave it to us → X"** default;
- reads in about ten minutes, in plain language, on a phone.

The content already exists — the Foundations and Brand pages frame each decision with a
recommendation and at least one genuine alternative. A guide *visualizes straight from those*;
it doesn't invent new opinions.

## How to make one

This folder ships intentionally empty except for this README. Generate a guide on demand rather
than committing one — a rendered guide carries a specific brand and a specific set of open
questions, so it goes stale the moment either changes. An agent can produce one from the docs
([`AGENTS.md`](../../AGENTS.md) points it here):

- Pull the content straight from the pages that frame each decision (`docs/foundations/colors.mdx`,
  `docs/foundations/typography.mdx`, and the rest of Foundations and Brand), not new opinions.
- Use the real token hex values, and embed the candidate fonts as base64 `data:` URIs, taken from
  `node_modules/@fontsource*`, so the file makes no network requests.
- Render live button and component previews in both themes, and keep it readable on a phone, for
  a non-engineer, in about ten minutes.

Drop the result here as `design-decisions.html` (or similar).

Generated `*.html` guides in this folder are gitignored for that reason — they're deliverables,
not source. If your fork wants to keep a particular guide as a record of what was decided,
commit it deliberately with `git add -f docs/proposals/<file>.html`.

## Delivery

A rendered guide carries your real brand name and mark, so **hand it over as a self-contained
file** for review and forwarding — do **not** auto-publish it to a public URL. For clicking
through the real, working components, point people to the hosted Storybook instead (the Pages
site at `package.json`'s `homepage`): the guide is the decide-in-ten-minutes surface, the
Storybook is the complete reference.
