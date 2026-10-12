---
max_turns: 10
allowed_tools: [Read, Glob, Grep, Skill]
tags: [routing]
---

Take a hard, critical look at this change before I merge it:

```diff
--- a/src/pagination.ts
+++ b/src/pagination.ts
@@ -1,4 +1,4 @@
 export function pageCount(total: number, size: number): number {
-  return Math.ceil(total / size)
+  return Math.floor(total / size) + 1
 }
```
