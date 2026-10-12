# DataTable on TanStack Table v9

Kind: REFACTOR · Drawn up: 2026-10-08 · Owner: template maintainers · Status: DONE (agreed 2026-10-08)

## Proposal (GOVERNANCE.md tier (c))

`DataTable` moves from `@tanstack/react-table` 8.21.3 to 9.x, which renames the hook, requires a
declared feature set, and adds a features type parameter to every table type. Why: 8.21.3 is the
last v8 release (2025-04-14) and v9 is where fixes land; v9 also bundles only the features a
table registers. Who's affected: anyone who installed `data-table` from the registry or forked
the template and wrote column definitions, because `ColumnDef<Person>[]` becomes
`ColumnDef<DataTableFeatures, Person>[]`, and a row type has to be an object or an array. The
registry item's dependency moves to `@tanstack/react-table@^9`, so `shadcn add data-table`
installs v9 code from then on; a project that installed the v8 item keeps it until it re-adds.

## Why

The data table is the component a product built from the template reaches for first to list
records. Staying on a major line that stopped releasing 18 months ago means every new project
starts on it, and every later fix arrives only through a migration under pressure. This
repository is the template itself, so the context is AGENTS.md's "What this is" and
GOVERNANCE.md rather than a `docs/product.md`, which it doesn't keep.

## Behavior

- **Now:** sortable columns through `DataTableColumnHeader`, a global search box, Prev/Next
  pagination with a page count, an empty state, all on v8's `useReactTable` with every feature
  bundled.
- **After:** the same, on v9's `useTable` with only sorting, global filtering, and pagination
  registered. The component exports `dataTableFeatures` and its type, `DataTableFeatures`, for
  typing column definitions.
- **Unchanged (each one a test):**
  - Clicking a sortable header sorts ascending, then descending, and its arrow shows which.
  - Typing in the search box narrows rows to those with a cell containing the text, and
    clearing it brings them back.
  - Pagination shows `pageSize` rows a page, "Page n of m", and disables Previous on the first
    page and Next on the last; `paginated={false}` shows every row and no controls.
  - No rows renders "No results." across every column.
  - The stories pass axe in jsdom and in Chromium, light and dark.

## Out of scope

- New table features (row selection, column visibility, resizing). The v8 component sets
  `data-state="selected"` from `row.getIsSelected()` but never enables selection, so it is
  always unset; v9 has no `getIsSelected` without the selection feature, so the attribute goes.
  Selection would be its own tier (b) addition.
- `table.Subscribe`, atoms, `createTableHook`: v9's opt-in rendering optimizations. The table
  re-renders on every state change, as it does on v8.
- A deprecation window. GOVERNANCE.md §4 keeps a removed token or component working for a minor
  release; here nothing is removed, the types change shape. The migration note in the CHANGELOG
  is the window: one find-and-replace per column definition.

## Against the rules

- **AGENTS.md, "stop and agree a plan first" (a component's public API):** follows it; this plan
  waits for agreement.
- **GOVERNANCE.md tier (c):** the proposal above, then the PR, then a CHANGELOG migration note;
  a `major` version under §3.
- **ADR 0019 and `.npmrc` (`min-release-age=7`):** follows it. 9.2.6 and 9.2.5 were published
  2026-10-04, four days ago; the newest v9 past the wait is 9.2.4 (2026-08-28). Install `^9.2.4`,
  which resolves to 9.2.4 until 9.2.5 is a week old (2026-10-11).
- **ADR 0013 (the registry on Pages):** follows it; `registry:build` names the dependency's new
  major (`@tanstack/react-table@^9`) and the item is republished.
- **ADR 0009 (WCAG 2.2 AA):** follows it; markup and roles don't change, and the stories' axe
  runs prove it.

## Design

- **Features, at module level** so their identity is stable across renders, exported as
  `dataTableFeatures` and its type `DataTableFeatures`: `rowSortingFeature`,
  `columnFilteringFeature` (v9 requires it for global filtering; the plan left it out),
  `globalFilteringFeature`, `rowPaginationFeature`, their three row models, and the sort functions
  `'auto'` picks between (`sortFn_alphanumeric`, `sortFn_text`, `sortFn_datetime`; it falls back
  to `sortFn_basic` by itself). The global filter's `'auto'` is `filterFn_includesString`
  directly, so no filter function is registered.
- **`paginated={false}`:** one feature set, and the component renders
  `table.getPrePaginatedRowModel()` instead of the page. Chosen over two feature sets picked by
  the prop because a table's features shouldn't change while it's mounted.
- **Types:** `DataTableProps.columns: ReadonlyArray<ColumnDef<DataTableFeatures, TData>>`, the
  type v9's `useTable` takes, and
  `DataTableColumnHeaderProps.column: Column<DataTableFeatures, TData, TValue>`, with
  `TData extends RowData`. `DataTableProps` and `DataTable` drop `TValue` (the
  plan had kept it): `useTable` takes columns with an `unknown` value, which a generic `TValue`
  can't be assigned to. A column helper's list goes through `helper.columns([...])`, as it does
  for `useTable` itself; v8 took an unwrapped list whose columns shared one value type. An `any`
  value instead (review round 2) took every list but made an inline column's value `any`, looser
  than v8's `unknown` (review round 3), so it was reverted.
- **State and cells:** sorting and the search stay in React state (`state` and `on*Change`, which
  v9 keeps); the page number reads `table.state.pagination`; cells come from `row.getAllCells()`,
  since `getVisibleCells` belongs to the column-visibility feature, which isn't registered.
- **Bundle:** Storybook only; the smoke app doesn't render `DataTable`, so `check:bundle` didn't
  move.

## Risks and rollback

- **Risk:** a consumer's columns stop type-checking after `shadcn add` — **watch:** the
  migration note's one-line change is all it takes — **if it happens:** the note says which
  type to use; `useLegacyTable` (`@tanstack/react-table/legacy`) is v9's own bridge, deprecated,
  if a project needs time.
- **Risk:** v9's patch rate (two releases on 2026-10-04) means a regression lands mid-flight —
  **watch:** the unchanged-behavior tests and the browser tier on each Dependabot update —
  **if it happens:** pin the last good 9.x and report it upstream with the failing story
  (AGENTS.md: a dependency's bug is fixed upstream).
- **Rollback:** revert the PR; the registry item returns to v8 on the next Pages deploy. No data
  or migration involved.

## Tasks

- [x] Behavior tests first, on v8, so they prove the migration rather than describe it: sort
  toggling, global filter, pagination bounds, `paginated={false}`, empty state — proved by
  `src/components/ui/data-table.test.tsx` passing on v8 before any other change.
- [x] `@tanstack/react-table@^9.2.4`, lockfile only — proved by `npm ci` and `npm run typecheck`
  failing exactly in `data-table.tsx` and its story (the expected breakage, nothing else).
- [x] Rewrite `data-table.tsx` on `useTable` with `dataTableFeatures` — proved by
  `data-table.test.tsx` unchanged and passing, and `npm run typecheck`.
- [x] Stories typed with `ColumnDef<DataTableFeatures, Invoice>` — proved by
  `stories.a11y.test.tsx` and `npm run test:browser` (light and dark).
- [x] `npm run registry:build` — proved by `check:generated` and `build-registry.test.ts`
  (the item names `@tanstack/react-table@^9`).
- [x] CHANGELOG migration note (what changed, the column-type change, `useLegacyTable` as the
  bridge). The version is chosen when the release is cut (CONTRIBUTING.md), and this entry makes
  it a major there.
