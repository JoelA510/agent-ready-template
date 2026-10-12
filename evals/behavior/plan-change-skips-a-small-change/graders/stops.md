---
type: llm
---

The prompt the skill runs (prompts/plan-change.md) says that for a small change the agent gives a size verdict, names the test that proves it, and stops with no plan file; its output for a small change is that verdict and test, the first task (the edit itself) with its test, and what planning taught.

PASS if the reply calls the change small and writes no plan file, whatever else it includes from that output.
FAIL if it writes or proposes a plan file (docs/changes/...), or lays out a plan anyway: sections such as behavior, design, or risks and rollback, or more than one task.
