#!/bin/bash
# Copies the template's prompts into the empty workspace, so the skill finds the prompt it runs.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
if [ ! -f "$root/prompts/review.md" ]; then
  echo "fixture.sh: no prompts/ under $root; run claude plugin eval from the template's root" >&2
  exit 1
fi
cp -R "$root/prompts" ./prompts
mkdir -p src
cat > change.diff <<'DIFF'
--- a/src/invoices.ts
+++ b/src/invoices.ts
@@ -8,9 +8,9 @@ export async function getInvoice(db: Db, session: Session, id: string) {
   const invoice = await db.invoices.findById(id)
   if (!invoice) throw new NotFound('invoice')
-  if (invoice.orgId !== session.orgId) throw new Forbidden('invoice')
+  if (invoice.ownerId !== session.userId && !session.isAdmin) throw new Forbidden('invoice')
   return invoice
 }
DIFF
