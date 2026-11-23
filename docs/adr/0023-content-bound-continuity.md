# 0023. Bind decision receipts to Git content and anchor the ledger to the protected base

- **Status:** Accepted
- **Date:** 2026-11-22
- **Decider:** Joel Abraham
- **Applies to:** This repository's decision ledger, its gate and its pull-request check

## Context

An ADR records the reason for a decision. A later edit can invalidate its evidence while the
ADR and every link still read correctly. Two branches can also revalidate the same decision
independently. Both observations need to survive a merge. A person able to replace an entire
history can recompute an unsigned hash chain, so checking the candidate alone cannot establish
that the repository kept its reviewed decisions.

## Decision

The shared core owns one append-only ledger per repository. Each decision or receipt is a
content-addressed file. Its parents identify the observed history. A receipt binds the result
of a named check to the evidence examined. The Node gate verifies the graph and the continued
presence of records from the protected Git base. On a PR it evaluates explicitly cited and
affected decisions against the candidate Git snapshot. A selected stale decision initially
warns. A failed or unchecked decision, a broken graph or an unresolvable citation blocks.

## Alternatives considered

- A single tracked log gives simple iteration but makes simultaneous appends edit the same
  tail. Independent files allow both branches to contribute observations to the merged graph.
- An external memory store or authorization gateway could hold a signed audit trail. Making
  either service a shared-core dependency would make protected-branch verification depend on
  credentials, a service, and evidence outside the checkout. The ledger accepts bounded
  public links to Nomos artifacts; their issuer and execution authority remain external.
- A self-contained checksum can find an accidental edit, but a fully recomputed replacement
  looks valid to that reader. The protected upstream Git history supplies the separate anchor.

## Consequences

A changed claim or citation set receives a superseding decision. Corrections and failures
remain in history. A held receipt identifies the recorded observation and its input bytes.
Reviewers still assess the method, the truth of the claim, and who could run or attest it.
The initial gate and skill are template-only. Stage 3 can offer the executable through
`process:apply` after qualifying delivery, with every consumer owning its own genesis and
records. See [ADR 0016](./0016-apply-delivers-standards-proposes-merges-checks-drift.md).

## Verification

Run `npm test -- scripts/__tests__/continuity-gate.test.ts`. Observe both rejection of changed
record bytes and rejection of a self-consistent replacement against its protected Git base.
The [operator guide](../../continuity/README.md) explains how to inspect the same distinction
and when the maintainer can promote stale evidence from a warning to a block.
