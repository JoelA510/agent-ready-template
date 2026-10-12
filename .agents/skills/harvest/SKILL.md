---
name: harvest
description: Use when a check proven in one repository should become a standard every repository is held to (in the template repository, where the catalog lives). Runs prompts/harvest.md — prove the check failing in its source, generalize it, write the standard, its probe, and a planted-defect test, and measure which repositories it fails.
metadata:
  argument-hint: "<source repository and where the check lives, what it caught, the pack>"
---

Harvest the check exactly as written in `prompts/harvest.md`. Read that file in full first; it
is the authoritative instruction set, and this skill only wires it up.

1. **Assemble the inputs** from what was given with the request: the source repository and
   where the check lives, what it caught, and the pack. If the source or the evidence is
   missing, ask for both in one question before starting.
2. **Execute the phases in order.** Don't write the standard before Phase 1 has the check
   failing in its source.
3. **Report** using the prompt's "Output of this prompt" contract.
