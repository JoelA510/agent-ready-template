---
id: expo.updates-code-signed
title: Over-the-air updates are code-signed, or the risk is written down
severity: medium
enforcement: audit
audit-area: 8
---

**Requires:** an app that ships EAS updates either signs them (`updates.codeSigningCertificate` and
`codeSigningMetadata` in the app config) or records why it doesn't, and what limits the damage.

**Why:** an unsigned update is trusted because of where it came from. Whoever can publish to the
project's update channel can run code on every installed copy of the app.

**Audit question:** who can publish an update to production, how is that access protected, and
would a signed update change what an attacker who got it could do?
