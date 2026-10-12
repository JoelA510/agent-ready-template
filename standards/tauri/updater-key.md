---
id: tauri.updater-key
title: The updater's signing key is configured, kept secret, and used over TLS
severity: high
enforcement: check
audit-area: 8
---

**Requires:** with the updater plugin configured, `plugins.updater.pubkey` holds a minisign public
key; the private key appears in no committed file and reaches CI only from a secret; and every
update endpoint is HTTPS, with `dangerousInsecureTransportProtocol` off.

**Why:** the updater installs whatever is signed with the key. A leaked private key lets anyone ship
code to every installed copy; a lost one means no installed copy can be updated again, ever. Tauri
can't disable signing, so the key's custody is the security of every future release.

**Meeting it:** generate the pair with `tauri signer generate`, put the public key in the config,
the private key (and its password) in CI secrets as `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, and a backup in a password manager, with the release runbook
saying where.

**The check:** decodes the public key; searches committed text files under 1 MB for a minisign
secret key, base64 (on one line or wrapped) or decoded: its header followed by the key, so a file that only names the
header (this template's own check, in a fork) doesn't count; and reads each workflow's
`TAURI_SIGNING_PRIVATE_KEY` (or Tauri 1's `TAURI_PRIVATE_KEY`) for a value that isn't
`${{ secrets.* }}`. `n/a` without the updater plugin. Where the backup is kept is the audit's
question.
